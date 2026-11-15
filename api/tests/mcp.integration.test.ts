import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { createServer, request, type Server } from "node:http";
import { after, before, test } from "node:test";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import express from "express";
import { mongo, Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { scope } from "../src/mcp/contracts";
import { createMcpRouter } from "../src/mcp/server";
import { connectStore, readableCollections, type Store } from "../src/mcp/store";

const dbName = "hostelflow_mcp_synthetic";
const rootUser = "mcp_fixture_admin";
const readerUser = "mcp_fixture_reader";
const ownerSubject = "synthetic-owner";
const clientId = "synthetic-mcp-client";
const currentDate = () => new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
const oid = () => new Types.ObjectId();
const shift = oid(), olderShift = oid(), openShift = oid();
const firstCharge = oid(), nextCharge = oid(), nextSegment = oid();
const lateCharge = oid(), lateReceipt = oid(), rounding = oid();
const splitCharge = oid(), splitCash = oid(), splitCard = oid();
const correctedPayment = oid(), correction = oid(), refundable = oid();
const transferPayment = oid();
const dec30 = "2040-12-30", dec31 = "2040-12-31", jan1 = "2041-01-01", jan2 = "2041-01-02";
const at = (value: string) => new Date(value);
const staff = "synthetic-cashier";
const primary = "SYNTHETIC-ADVANCE";
const secretMarker = "SYNTHETIC_FORBIDDEN_PASSPORT_AND_NOTE";
const txn = (_id: Types.ObjectId, type: string, amount: number, paymentMethod: string, dating: string, props = {}) => ({
  _id, type, amount, paymentMethod, createdAt: at(dating), createdBy: staff, ...props,
  note: secretMarker, reference: secretMarker,
});
const stay = (room: string, from: string, to: string) => ({ roomIds: [room], from: at(from), to: at(to), note: secretMarker });
const segment = (transactionId: Types.ObjectId, kind: string, amount: number, from: string, to: string, _id = oid()) => ({
  _id, transactionId: String(transactionId), kind, amount, from: at(from), to: at(to), platformId: "WALK", note: secretMarker,
});
const baseBooking = (bookingId: string, name: string, checkIn: string, checkOut: string, room: string, props = {}) => ({
  bookingId, name, checkIn: at(checkIn), checkOut: at(checkOut), status: "checkedOut", platformId: "WALK",
  roomStays: [stay(room, checkIn, checkOut)], staffUsername: staff, searchNamePrefixes: ["synthetic", name.toLowerCase()],
  transactions: [], transactionCorrections: [], commercialSegments: [], note: secretMarker,
  passport: { passportNo: { cipherText: secretMarker } }, additionalGuests: [{ identityDocument: { passportHash: secretMarker } }],
  ...props,
});

async function start(app: express.Express) {
  const s = createServer(app);
  s.listen(0, "127.0.0.1");
  await once(s, "listening");
  const address = s.address();
  assert(address && typeof address !== "string");
  return { server: s, origin: "http://127.0.0.1:" + address.port };
}
async function close(s?: Server) {
  if (!s) return;
  await new Promise<void>((resolve) => {
    s.close(() => resolve());
    s.closeAllConnections();
  });
}
let mongod: MongoMemoryServer, admin: mongo.MongoClient, store: Store, readerUri: string;
let keys: Server, server: Server, rateServer: Server;
let mcpClose: () => Promise<void>, rateClose: () => Promise<void>;
let resource: URL, issuer: string, token: string, jwt: (overrides?: Record<string, unknown>) => Promise<string>;
let client: Client;
const audit: { event: string; code?: string; tool?: string }[] = [];
type ToolResult = Awaited<ReturnType<Client["callTool"]>>;
async function connect(target = resource, access = token, mode: "legacy" | "auto" = "auto") {
  const c = new Client({ name: "hostelflow-verified-sdk-client", version: "1.0.0" }, { versionNegotiation: { mode } });
  await c.connect(new StreamableHTTPClientTransport(target, { requestInit: { headers: { Authorization: "Bearer " + access } } }));
  return c;
}
function data(result: ToolResult) {
  assert(!result.isError, JSON.stringify(result.content));
  assert(!JSON.stringify(result).includes(secretMarker));
  const body = result.structuredContent as { property: unknown; data: Record<string, any> };
  assert.deepEqual(body.property, { id: "bmk", timeZone: "Asia/Bangkok", currency: "THB" });
  return body.data;
}
const call = async (name: string, args: Record<string, unknown> = {}) => data(await client.callTool({ name, arguments: args }));
async function post(url: URL, access: string | null, body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }), headers = {}) {
  return fetch(url, { method: "POST", headers: {
    "Content-Type": "application/json", Accept: "application/json, text/event-stream",
    ...(access === null ? {} : { Authorization: "Bearer " + access }), ...headers,
  }, body });
}

before(async () => {
  const rootPwd = randomBytes(18).toString("hex");
  const readerPwd = randomBytes(18).toString("hex");
  mongod = await MongoMemoryServer.create({ instance: { ip: "127.0.0.1", dbName }, auth: {
    enable: true, customRootName: rootUser, customRootPwd: rootPwd,
  } });
  const hostname = new URL(mongod.getUri()).host;
  admin = await new mongo.MongoClient("mongodb://" + rootUser + ":" + rootPwd + "@" + hostname + "/admin?directConnection=true").connect();
  const db = admin.db(dbName);
  await db.command({ createRole: "mcpCollectionRead", roles: [],
    privileges: readableCollections.map((collection) => ({ resource: { db: dbName, collection }, actions: ["find"] })),
  });
  await db.command({ createUser: readerUser, pwd: readerPwd, roles: ["mcpCollectionRead"] });
  readerUri = "mongodb://" + readerUser + ":" + readerPwd + "@" + hostname + "/" + dbName + "?authSource=" + dbName + "&directConnection=true";
  await db.collection("bookings").insertMany([
    baseBooking(primary, "Synthetic Advance", dec30, jan2, "Siesta 1", {
      transactions: [
        txn(firstCharge, "roomCharge", 320, "Transfer", dec30 + "T10:00:00Z"),
        txn(nextCharge, "roomCharge", 560, "Cash", dec31 + "T17:01:00Z", { sourceAction: "EXTEND_BOOKING", cashShiftId: String(shift) }),
      ],
      commercialSegments: [segment(firstCharge, "original", 320, dec30, jan1), segment(nextCharge, "extension", 560, jan1, jan2, nextSegment)],
    }),
    baseBooking("SYNTHETIC-LATE", "Synthetic Late", dec31, jan2, "Siesta 2", {
      checkedInAt: at(jan1 + "T01:30:00Z"),
      transactions: [
        txn(lateCharge, "roomCharge", 446.54, "Unpaid", dec30),
        txn(lateReceipt, "settlementCharge", 446.54, "Cash", jan1 + "T01:30:00Z", {
          sourceAction: "CHECK_IN", relatedTransactionId: String(lateCharge), relatedTransactionType: "roomCharge", cashShiftId: String(shift),
        }),
        txn(rounding, "adjustment", 3.46, "Cash", jan1 + "T01:30:00Z", { sourceAction: "CHECK_IN", reasonOfAdjustment: "rounding", cashShiftId: String(shift) }),
        txn(oid(), "deposit", 200, "Cash", jan1 + "T01:30:00Z", { cashShiftId: String(shift) }),
        txn(oid(), "depositRefund", 200, "Cash", jan1 + "T03:30:00Z", { cashShiftId: String(shift) }),
      ],
      commercialSegments: [segment(lateCharge, "original", 446.54, dec31, jan2)],
    }),
    baseBooking("SYNTHETIC-SPLIT", "Synthetic Split", jan1, jan2, "Balcony", {
      platformId: "HOST",
      transactions: [
        txn(splitCharge, "roomCharge", 140.25, "Unpaid", dec30),
        txn(splitCash, "settlementCharge", 50.10, "Cash", dec31 + "T11:05:00Z", { relatedTransactionId: String(splitCharge), relatedTransactionType: "roomCharge", cashShiftId: String(shift) }),
        txn(splitCard, "settlementCharge", 40.15, "Card", jan1 + "T03:00:00Z", { relatedTransactionId: String(splitCharge), relatedTransactionType: "roomCharge" }),
        txn(refundable, "roomRefund", 5.25, "Card", jan1 + "T03:30:00Z", { relatedTransactionId: String(splitCharge) }),
      ],
      commercialSegments: [segment(splitCharge, "original", 140.25, jan1, jan2)],
    }),
    baseBooking("SYNTHETIC-CORRECTED", "Synthetic Corrected", dec30, dec31, "Siesta 3", {
      transactions: [
        txn(correctedPayment, "laundry", 99.75, "Cash", dec30 + "T08:00:00Z", { cashShiftId: String(olderShift) }),
        txn(transferPayment, "laundry", 11.13, "Cash", dec30 + "T09:00:00Z", { cashShiftId: String(olderShift) }),
      ],
      transactionCorrections: [{
        _id: correction, targetTransactionId: String(correctedPayment), correctionType: "recorded_mistake",
        reasonCode: "incorrect_payment_method", correctedBy: staff, correctedAt: at(jan2), originalBusinessDate: dec30, financialChange: true,
        before: { type: "laundry", amount: 99.75, paymentMethod: "Cash", cashShiftId: String(olderShift), note: secretMarker },
        after: { type: "laundry", amount: 99.75, paymentMethod: "Transfer", note: secretMarker }, note: secretMarker,
      }, {
        _id: oid(), targetTransactionId: String(transferPayment), correctionType: "recorded_mistake", reasonCode: "incorrect_payment_method",
        correctedBy: staff, correctedAt: at(jan2), financialChange: true,
        before: { type: "laundry", amount: 11.13, paymentMethod: "Cash", cashShiftId: String(olderShift) },
        after: { type: "laundry", amount: 11.13, paymentMethod: "Card" },
      }],
    }),
    baseBooking("SYNTHETIC-VOID", "Synthetic Void", dec31, jan2, "Siesta 4", {
      voided: true, transactions: [txn(oid(), "roomCharge", 10.01, "Cash", dec31 + "T12:00:00Z", { cashShiftId: String(shift) })],
    }),
    baseBooking("SYNTHETIC-NOSHOW", "Synthetic No Show", dec31, jan2, "Siesta 5", { status: "noShow" }),
    baseBooking("SYNTHETIC-PHYSICAL", "Synthetic Present", currentDate(), new Date(+at(currentDate()) + 86400000).toISOString().slice(0, 10), "Siesta 6", { status: "checkedIn", checkedInAt: new Date() }),
  ]);
  await db.collection("roomblocks").insertMany([
    { roomIds: ["Siesta 7"], from: at(dec31), to: at(jan1), reasonType: "maintenance", reason: secretMarker },
    { roomIds: ["Siesta 8"], from: at(dec31), to: at(jan1), reasonType: "house_use", reason: secretMarker },
  ]);
  await db.collection("cashshifts").insertMany([
    { _id: shift, businessDate: dec31, shiftNumber: 1, staffUsername: staff, status: "closed", startedAt: at(dec31 + "T02:00:00Z"), endedAt: at(jan1 + "T05:00:00Z"),
      operatingOpeningCash: 100, operatingCashIn: 1070.11, operatingCashOut: 0, operatingExpectedCash: 1170.11, operatingActualCash: 1170.11, operatingVariance: 0, isFinalDayClose: true, note: secretMarker },
    { _id: olderShift, businessDate: dec30, shiftNumber: 1, staffUsername: staff, status: "closed", startedAt: at(dec30 + "T02:00:00Z"), endedAt: at(dec30 + "T12:00:00Z"),
      operatingOpeningCash: 10, operatingExpectedCash: 10, operatingActualCash: 10.01, isFinalDayClose: true },
    { _id: openShift, businessDate: jan1, shiftNumber: 1, staffUsername: staff, status: "open", startedAt: at(jan1 + "T05:00:00Z"),
      operatingOpeningCash: 0, operatingExpectedCash: 0 },
  ]);
  await db.collection("cashshiftreopencorrections").insertOne({
    correctionId: "synthetic-reopen", shiftId: String(shift), reopenedAt: at(jan1), reopenedBy: staff, reason: secretMarker,
    originalClose: { endedAt: at(dec31), operatingActualCash: 50, operatingExpectedCash: 55.5, operatingVariance: -5.5, note: secretMarker },
  });
  await db.collection("standalonesales").insertOne({
    saleId: "SYNTHETIC-SALE", customerName: secretMarker, transactions: [txn(oid(), "towel", 2.55, "Card", dec31 + "T16:59:59.999Z")],
  });
  await db.collection("activities").insertMany([
    { staffUsername: staff, bookingId: "SYNTHETIC-CORRECTED", action: "CORRECT_TRANSACTION", timestamp: at(jan2),
      details: { summary: { transactionId: String(correctedPayment), correctionId: correction, notes: secretMarker }, changes: { before: secretMarker, after: secretMarker } } },
    { staffUsername: staff, bookingId: primary, action: "VIEW_PASSPORT", timestamp: at(jan2), details: { passport: secretMarker } },
  ]);
  store = await connectStore(readerUri, dbName);
  const { generateKeyPair, exportJWK, SignJWT } = await import("jose");
  const pair = await generateKeyPair("RS256");
  const jwk = await exportJWK(pair.publicKey);
  const issuerApp = express();
  issuerApp.get("/jwks", (_req, res) => { res.json({ keys: [{ ...jwk, kid: "synthetic-key", alg: "RS256", use: "sig" }] }); });
  const provider = await start(issuerApp);
  keys = provider.server;
  issuer = provider.origin;
  async function createEndpoint(limits?: { burst: number; perMinute: number; concurrency: number }) {
    const app = express();
    // The bind must precede resource configuration so the test uses the actual audience.
    const result = await start(app);
    const url = new URL("/mcp", result.origin);
    const mcp = createMcpRouter({ store, limits, audit: (event) => audit.push(event), policy: {
      resource: url, issuer, jwksUrl: new URL("/jwks", issuer), ownerSubject, clientId,
      revokedBefore: Math.floor(Date.now() / 1000) - 240,
    } });
    app.use(mcp.router);
    return { ...result, url, close: mcp.close };
  }
  const endpoint = await createEndpoint({ burst: 200, perMinute: 60, concurrency: 3 });
  server = endpoint.server;
  resource = endpoint.url;
  mcpClose = endpoint.close;
  const rate = await createEndpoint({ burst: 2, perMinute: 1, concurrency: 1 });
  rateServer = rate.server;
  rateClose = rate.close;
  jwt = async (overrides = {}) => {
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({ iss: issuer, aud: resource.href, sub: ownerSubject, scope, client_id: clientId,
      exp: now + 180, iat: now - 1, ...overrides }).setProtectedHeader({ alg: "RS256", kid: "synthetic-key" }).sign(pair.privateKey);
  };
  token = await jwt();
  client = await connect();
}, { timeout: 30000 });

after(async () => {
  await client?.close();
  await Promise.all([close(server), close(rateServer), close(keys)]);
  await mcpClose?.();
  await rateClose?.();
  await store?.close();
  await admin?.close();
  await mongod?.stop();
});

test("official SDK discovers 14 read-only, scoped tools in both protocol eras and reconnects", async () => {
  const tools = (await client.listTools()).tools;
  assert.equal(tools.length, 14);
  assert(tools.every((tool) => tool.annotations?.readOnlyHint === true && tool.annotations?.destructiveHint === false &&
    tool.outputSchema?.type === "object" && tool.inputSchema?.type === "object"));
  const second = await connect(resource, token, "legacy");
  try {
    assert.deepEqual((await second.listTools()).tools.map((t) => t.name).sort(), tools.map((t) => t.name).sort());
    assert.equal(data(await second.callTool({ name: "get_booking_details", arguments: { bookingId: primary } })).booking.bookingId, primary);
  } finally {
    await second.close();
  }
});

test("OAuth metadata, signed short-lived claims, revocation, origin and private errors", async () => {
  const denied = await post(resource, null);
  assert.equal(denied.status, 401);
  const challenge = denied.headers.get("WWW-Authenticate") ?? "";
  const metadataUrl = challenge.match(/resource_metadata="([^"]+)"/)?.[1];
  assert(metadataUrl);
  assert.deepEqual(await (await fetch(metadataUrl)).json(), {
    resource: resource.href, authorization_servers: [issuer], scopes_supported: [scope], bearer_methods_supported: ["header"],
  });
  const now = Math.floor(Date.now() / 1000);
  for (const [overrides, status] of [
    [{ sub: "synthetic-staff" }, 403], [{ client_id: "synthetic-other-client" }, 403], [{ scope: "read" }, 403],
    [{ aud: issuer }, 401], [{ aud: [resource.href, issuer] }, 401], [{ iss: resource.origin }, 401], [{ exp: now - 1 }, 401],
    [{ iat: now - 250 }, 401], [{ exp: now + 1800 }, 401],
  ] as const) {
    assert.equal((await post(resource, await jwt(overrides))).status, status);
  }
  const [prefix, payload, originalSignature] = token.split(".");
  assert.equal((await post(resource, [prefix, payload, (originalSignature[0] === "A" ? "B" : "A") + originalSignature.slice(1)].join("."))).status, 401);
  assert.equal((await post(resource, null, undefined, { Cookie: "token=synthetic-staff-cookie" })).status, 401);
  assert.equal((await post(resource, token, undefined, { Origin: "http://untrusted.invalid" })).status, 403);
  const wrongHost = await new Promise<number | undefined>((resolve, reject) => {
    const probe = request(resource, { method: "POST", headers: { Host: "untrusted.invalid" } }, (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    probe.on("error", reject);
    probe.end();
  });
  assert.equal(wrongHost, 403);
  assert.equal((await post(new URL("?access_token=synthetic", resource), null)).status, 400);
  assert.equal((await post(resource, token, "[{}]")).status, 400);
  assert.equal((await post(resource, token, JSON.stringify({ invalid: "x".repeat(17_000) }))).status, 413);
  assert.equal((await post(resource, token, "{malformed")).status, 400);
  assert(audit.some((entry) => entry.event === "access_denied" && entry.code === "OWNER_REQUIRED"));
  assert(!JSON.stringify(audit).includes(token) && !JSON.stringify(audit).includes(primary));
});

test("MongoDB denies writes, other collections, and other databases; store refuses broad credentials", async () => {
  const direct = await new mongo.MongoClient(readerUri).connect();
  try {
    const db = direct.db(dbName);
    assert.equal((await db.collection("bookings").findOne({}, { projection: { bookingId: 1 } }))?.bookingId, primary);
    for (const operation of [
      () => db.collection("bookings").insertOne({ bookingId: "MUST-NOT-BE-WRITTEN" }),
      () => db.collection("bookings").updateOne({}, { $set: { bookingId: "MUST-NOT-BE-WRITTEN" } }),
      () => db.collection("bookings").deleteOne({}),
      () => db.collection("bookings").aggregate([{ $limit: 1 }, { $out: "bookings" }]).toArray(),
      () => db.collection("users").findOne({}),
      () => direct.db("hostelflow_mcp_other").collection("bookings").findOne({}),
    ]) await assert.rejects(operation, { code: 13 });
  } finally {
    await direct.close();
  }
  await assert.rejects(connectStore(admin.options.credentials ?
    "mongodb://" + admin.options.credentials.username + ":" + admin.options.credentials.password + "@" +
      new URL(mongod.getUri()).host + "/admin?directConnection=true" : mongod.getUri(), dbName), /privileges/);
});

test("booking and occupancy DTOs reject arbitrary context, operators and unbounded reads", async () => {
  const details = await call("get_booking_details", { bookingId: primary });
  assert.equal(details.commercialSegments[1].chargeSatang, 56000);
  assert.deepEqual(details.booking.roomIds, ["Siesta 1"]);
  const ops = await call("get_operations_overview", { businessDate: dec31 });
  assert.equal(ops.bookedOccupiedBeds, 4);
  assert.equal(ops.unavailableBeds, 5);
  assert.equal(ops.availableBeds, ops.inventoryBeds - 5);
  assert.equal(ops.checkedInAssignedBeds, null);
  assert.equal((await call("get_operations_overview")).checkedInBookings, 1);
  const listing = await call("list_arrivals_departures", { kind: "arrivals", startDate: dec31, endDate: jan1, limit: 1 });
  assert.equal(listing.records[0].bookingId, "SYNTHETIC-LATE");
  assert.equal(listing.nextOffset, 1);
  assert.equal((await call("list_arrivals_departures", { kind: "departures", startDate: jan2, endDate: jan2 })).records.length, 3);
  const search = await call("search_bookings", { guestNamePrefix: "SYNTHETIC", period: { startDate: dec30, endDate: jan1 }, status: "checkedOut", roomId: "Siesta 1" });
  assert.equal(search.records[0].bookingId, primary);
  for (const [name, args] of [
    ["get_booking_details", { bookingId: { $ne: "" } }],
    ["get_booking_details", { bookingId: primary, [secretMarker]: "bmk" }],
    ["get_operations_overview", { propertyId: "other" }],
    ["search_bookings", { channel: "WALK" }],
    ["search_bookings", { period: { startDate: "2040-12-01", endDate: jan2 } }],
    ["query_financial_records", { recordedPeriod: { startDate: "2040-02-30", endDate: jan1 } }],
    ["query_financial_records", { pipeline: [{ $out: "bookings" }] }],
  ] as const) {
    const result = await client.callTool({ name, arguments: args });
    assert(result.isError, name);
    assert(!JSON.stringify(result).includes(secretMarker));
  }
});

test("daily canonical revenue, advance and late payments, month-end, split allocation, and deposit returns stay distinct", async () => {
  const old = await call("get_revenue_summary", { startDate: dec31, endDate: dec31 });
  const next = await call("get_revenue_summary", { startDate: jan1, endDate: jan1 });
  assert.equal(old.totals.accommodationRevenueSatang, 45000);
  assert.equal(old.totals.serviceRevenueSatang, 255);
  assert.equal((await call("get_revenue_summary", { startDate: dec31, endDate: dec31, channel: "WALK" })).totals.serviceRevenueSatang, 0);
  assert.equal(old.methodAllocations.find((m: any) => m.paymentMethod === "Cash").amountSatang, 45000);
  assert.equal(next.totals.accommodationRevenueSatang, 70025);
  assert.equal(next.totals.reductionsSatang, 525);
  assert.equal(next.totals.netRevenueSatang, 69500);
  const receipts = await call("get_payment_summary", { startDate: jan1, endDate: jan1, paymentMethod: "Cash" });
  assert.equal(receipts.totals.operatingReceiptsSatang, 101000);
  assert.equal(receipts.totals.depositReceiptsSatang, 20000);
  assert.equal(receipts.totals.depositReturnsSatang, 20000);
  assert.equal((await call("get_payment_summary", { startDate: dec31, endDate: dec31 })).voidedBookingPaymentCount, 1);
  const periods = await call("compare_periods", { first: { startDate: dec31, endDate: dec31 }, second: { startDate: jan1, endDate: jan1 } });
  assert.equal(periods.secondMinusFirst.netRevenueSatang, 24245);
  assert(periods.second.channelMix.some((m: any) => m.channel === "HOST"));
  const split = await call("get_booking_financial_history", { bookingId: "SYNTHETIC-SPLIT" });
  assert.equal(split.financialPosition.outstandingBalanceSatang, 5000);
  assert.equal(split.transactions.records.length, 4);
});

test("exact shift arithmetic, corrections, reopened snapshot, typed activity and trace evidence", async () => {
  const shifts = await call("get_cash_shifts", { startDate: dec31, endDate: jan1 });
  assert.equal(shifts.records[0].reopenHistory[0].priorVarianceSatang, -550);
  const reconciliation = await call("reconcile_cash_shifts", { shiftId: String(shift) });
  assert.equal(reconciliation.effectiveOperatingCashInSatang, 107011);
  assert.equal(reconciliation.effectiveExpectedClosingCashSatang, 117011);
  assert.equal(reconciliation.countedMinusExpectedSatang, 0);
  assert.equal(reconciliation.state, "reconciled");
  assert.equal((await call("reconcile_cash_shifts", { shiftId: String(olderShift) })).countedMinusExpectedSatang, 1);
  assert.equal((await call("reconcile_cash_shifts", { shiftId: String(openShift) })).state, "unresolved");
  const history = await call("get_booking_financial_history", { bookingId: "SYNTHETIC-CORRECTED" });
  const changed = history.transactions.records.find((r: any) => r.original.transactionId === String(correctedPayment));
  assert.equal(changed.original.paymentMethod, "Cash");
  assert.equal(changed.effective.paymentMethod, "Transfer");
  assert.equal(changed.effective.paymentDate, dec30);
  assert.equal(changed.effective.cashShiftId, null);
  assert.deepEqual(changed.correctionIds, [String(correction)]);
  const trace = await call("trace_transaction", { transactionId: String(lateReceipt) });
  assert(trace.records.some((r: any) => r.original.transactionId === String(lateCharge)));
  assert(trace.records.some((r: any) => r.original.transactionId === String(rounding)));
  assert.equal(trace.records.find((r: any) => r.original.transactionId === String(lateReceipt)).original.cashShiftBusinessDate, dec31);
  const ledger = await call("query_financial_records", { paymentPeriod: { startDate: jan1, endDate: jan1 }, cashShiftId: String(shift), transactionType: "roomCharge" });
  assert.equal(ledger.records[0].original.transactionId, String(nextCharge));
  const activity = await call("search_activity_logs", { startDate: jan2, endDate: jan2, staffUsername: staff, category: "financial" });
  assert.equal(activity.records.length, 1);
  assert.equal(activity.records[0].referenceIds.correctionId, String(correction));
});

test("cash versus revenue can reconcile across dates with exact signed evidence; count variance stays unresolved", async () => {
  const result = await call("investigate_revenue_discrepancy", {
    startDate: dec31, endDate: dec31, metricA: "operatingShiftCashIn", metricB: "stayRevenueCashAllocation",
  });
  assert.equal(result.totalASatang, 107011);
  assert.equal(result.totalBSatang, 45000);
  assert.equal(result.differenceSatang, 62011);
  assert.equal(result.residualUnexplainedSatang, 0);
  assert.equal(result.state, "reconciled");
  assert(result.evidence.records.some((r: any) => r.explanation === "cross_date_attribution" && r.transactionId === String(nextCharge)));
  assert(result.evidence.records.some((r: any) => r.explanation === "voided_booking_cash"));
  const unresolved = await call("investigate_revenue_discrepancy", {
    startDate: dec30, endDate: dec30, metricA: "shiftActualOperatingCash", metricB: "shiftExpectedOperatingCash",
  });
  assert.equal(unresolved.residualUnexplainedSatang, 1);
  assert.equal(unresolved.state, "unresolved");
});

test("owner rate limit rejects excess calls without accepting caller identity or forwarded headers", async () => {
  const addr = rateServer.address();
  assert(addr && typeof addr !== "string");
  const url = new URL("http://127.0.0.1:" + addr.port + "/mcp");
  const access = await jwt({ aud: url.href });
  assert.equal((await post(url, access)).status, 200);
  assert.equal((await post(url, access)).status, 200);
  const denied = await post(url, access, undefined, { "X-Forwarded-For": "fictional" });
  assert.equal(denied.status, 429);
  assert.equal(denied.headers.get("Retry-After"), "1");
});

test("local launcher binds and handles an authenticated call using the restricted database identity", { timeout: 15_000 }, async () => {
  const allocated = await start(express());
  await close(allocated.server);
  const url = new URL("/mcp", allocated.origin);
  const child = spawn(process.execPath, ["-r", "ts-node/register", "src/mcp/local.ts"], {
    cwd: process.cwd(),
    env: {
      ...process.env, NODE_ENV: "test", MCP_MONGO_URI: readerUri, MCP_MONGO_DB: dbName,
      MCP_RESOURCE_URL: url.href, MCP_OAUTH_ISSUER: issuer, MCP_OAUTH_JWKS_URL: issuer + "/jwks",
      MCP_OWNER_SUBJECT: ownerSubject, MCP_OAUTH_CLIENT_ID: clientId,
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  const exited = once(child, "exit");
  let localClient: Client | undefined;
  try {
    await Promise.race([
      new Promise<void>((resolve) => {
        let output = "";
        child.stderr.on("data", (part) => {
          output += String(part);
          if (output.includes("listening on loopback")) resolve();
        });
      }),
      exited.then(() => assert.fail("loopback launcher exited before listening")),
    ]);
    const response = await fetch(new URL("/mcp-health", url));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: "ok" });
    localClient = await connect(url, await jwt({ aud: url.href }));
    assert.equal(data(await localClient.callTool({ name: "get_booking_details", arguments: { bookingId: primary } })).booking.bookingId, primary);
  } finally {
    await localClient?.close();
    child.kill("SIGTERM");
    await exited;
  }
});

test("complexity limits and non-satang money fail closed without partial totals", async () => {
  const docs = admin.db(dbName).collection("bookings");
  const id = "SYNTHETIC-OVERSIZED";
  const precision = "SYNTHETIC-NON-SATANG";
  await docs.insertMany([
    { bookingId: id, checkIn: at("2050-01-01"), transactions: Array.from({ length: 301 }, () => ({ _id: oid() })) },
    baseBooking(precision, "Synthetic Non Satang", "2051-01-01", "2051-01-04", "Siesta 1", {
      transactions: [txn(oid(), "roomCharge", 1.001, "Cash", "2051-01-01")],
    }),
  ]);
  try {
    const oversized = await client.callTool({ name: "get_booking_details", arguments: { bookingId: id } });
    assert(oversized.isError);
    assert.match(JSON.stringify(oversized.content), /LIMIT_EXCEEDED/);
    const value = await client.callTool({ name: "get_revenue_summary", arguments: { startDate: "2051-01-01", endDate: "2051-01-01" } });
    assert(value.isError);
    assert.match(JSON.stringify(value.content), /DATA_INCOMPLETE/);
    assert.equal(value.structuredContent, undefined);
  } finally {
    await docs.deleteMany({ bookingId: { $in: [id, precision] } });
  }
});

test("concurrency gate holds a slot through completion and serves the owner again after release", async () => {
  const app = express();
  const endpoint = await start(app);
  const url = new URL("/mcp", endpoint.origin);
  let unblock!: () => void, entered!: () => void;
  const wait = new Promise<void>((r) => { unblock = r; });
  const started = new Promise<void>((r) => { entered = r; });
  const mcp = createMcpRouter({
    audit: (event) => audit.push(event),
    limits: { burst: 8, perMinute: 8, concurrency: 1 },
    policy: { resource: url, issuer, jwksUrl: new URL("/jwks", issuer), ownerSubject, clientId },
    store: {
      ...store,
      reader: (owner, signal) => {
        const read = store.reader(owner, signal);
        return new Proxy(read, { apply: async (target, thisArg, args) => { entered(); await wait; return Reflect.apply(target, thisArg, args); } });
      },
    },
  });
  app.use(mcp.router);
  const access = await jwt({ aud: url.href });
  const c = await connect(url, access);
  try {
    const first = c.callTool({ name: "get_booking_details", arguments: { bookingId: primary } });
    await started;
    const blocked = await post(url, access);
    assert.equal(blocked.status, 429);
    assert.deepEqual(await blocked.json(), { code: "BUSY" });
    unblock();
    assert.equal(data(await first).booking.bookingId, primary);
    assert.equal((await post(url, access)).status, 200);
  } finally {
    unblock();
    await c.close();
    await close(endpoint.server);
    await mcp.close();
  }
});
