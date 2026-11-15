import { mongo, Types } from "mongoose";
import type { booking } from "../models/booking";
import type { standaloneSale } from "../models/standaloneSale";
import type { cashShift } from "../models/cashShift";
import type { CashShiftReopenCorrectionRecord } from "../models/cashShiftReopenCorrection";
import type { OccupancyRoomBlock } from "../helpers/occupancyHelpers";
import { property, ToolError, type OwnerContext } from "./contracts";

const txnFields = ["_id", "type", "paymentMethod", "amount", "direction", "reasonOfAdjustment", "relatedTransactionType",
  "relatedTransactionId", "createdBy", "createdAt", "sourceAction", "cashShiftId", "platformId", "commercialSegmentId"];
const correctionFields = ["_id", "targetTransactionId", "correctionType", "reasonCode", "correctedBy",
  "correctedAt", "financialChange", "originalBusinessDate", "affectedCashShiftId",
  ...["before", "after"].flatMap((side) => ["type", "paymentMethod", "amount", "cashShiftId"].map((key) => side + "." + key))];
const fields = (key: string, names: string[]) => names.map((name) => key + "." + name);
const stays = fields("roomStays", ["roomId", "roomIds", "from", "to"]);
const placement = ["bookingId", "platformId", "checkIn", "checkOut", "status", "voided",
  "checkout.earlyCheckOut", "checkout.checkedOutAt", "checkedInAt", ...stays];
const ledger = [...fields("transactions", txnFields), ...fields("transactionCorrections", correctionFields)];
const projections = {
  bookingList: [...placement, "name"],
  bookingFinance: [...placement, "staffUsername", "cancellation.keptAmount", ...ledger,
    ...fields("commercialSegments", ["_id", "kind", "placement", "from", "to", "platformId", "amount", "transactionId"])],
  bookingDetail: [...placement, "name", ...ledger,
    ...fields("commercialSegments", ["_id", "kind", "placement", "from", "to", "platformId", "amount", "transactionId"])],
  occupancy: placement,
  sale: ["saleId", "createdBy", ...ledger],
  block: ["roomId", "roomIds", "from", "to", "reason", "reasonType", "releasedAt"],
  shift: ["businessDate", "shiftNumber", "staffUsername", "status", "openingMode", "handoffFromShiftId",
    "operatingOpeningCash", "operatingCashIn", "operatingCashOut", "operatingExpectedCash",
    "operatingActualCash", "operatingVariance", "startedAt", "endedAt", "closedBy", "isFinalDayClose", "ledgerRevision"],
  reopen: ["correctionId", "shiftId", "reopenedAt", "reopenedBy", "originalClose.endedAt",
    "originalClose.operatingActualCash", "originalClose.operatingExpectedCash", "originalClose.operatingVariance"],
  activity: ["staffUsername", "bookingId", "action", "timestamp", "details.summary.transactionId",
    "details.summary.targetTransactionId", "details.summary.shiftId", "details.summary.saleId",
    "details.summary.correctionId", "details.success"],
} as const;
const collections = {
  bookingList: "bookings", bookingFinance: "bookings", bookingDetail: "bookings", occupancy: "bookings",
  sale: "standalonesales", block: "roomblocks", shift: "cashshifts", reopen: "cashshiftreopencorrections", activity: "activities",
} as const;
export const readableCollections = [...new Set(Object.values(collections))];
type Key = keyof typeof collections;
type Raw = {
  bookingList: booking; bookingDetail: booking; bookingFinance: booking; occupancy: booking; sale: standaloneSale;
  block: OccupancyRoomBlock; shift: cashShift; reopen: CashShiftReopenCorrectionRecord;
  activity: { staffUsername: string; bookingId?: string; action: string; timestamp: Date; details?: {
    success?: boolean; summary?: Record<string, unknown>;
  } };
};
export const oid = (value: string) => new Types.ObjectId(value);
export type ReadOptions = { cap?: number; skip?: number; sort?: mongo.Sort };
export type Reader = ReturnType<typeof createReader>;

// Filters and projections are constructed only in this module's internal tool service. No client object is forwarded.
function createReader(db: mongo.Db, signal: AbortSignal) {
  return async <K extends Key>(key: K, filter: mongo.Filter<mongo.Document>, options: ReadOptions = {}) => {
    if (signal.aborted) throw new ToolError("CANCELLED");
    const cap = options.cap ?? 650;
    const cursor = db.collection(collections[key]).find(filter, {
      projection: Object.fromEntries(projections[key].map((field) => [field, 1])),
      maxTimeMS: 1500,
      timeoutMS: 2300,
      signal,
      limit: options.skip !== undefined ? cap : cap + 1,
      batchSize: 20,
      skip: options.skip,
      sort: options.sort,
      allowDiskUse: false,
    });
    const records: (Raw[K] & { _id: Types.ObjectId })[] = [];
    let nestedCount = 0;
    try {
      for await (const row of cursor) {
        const { transactions, transactionCorrections, commercialSegments, roomStays } = row;
        const arrays = [transactions, transactionCorrections, commercialSegments, roomStays].filter(Array.isArray);
        if (arrays.some((array) => array.length > 300)) throw new ToolError("LIMIT_EXCEEDED");
        nestedCount += arrays.reduce((total, array) => total + array.length, 0);
        if (nestedCount > 6500) throw new ToolError("LIMIT_EXCEEDED");
        records.push(row as unknown as Raw[K] & { _id: Types.ObjectId });
      }
      if (records.length > cap) throw new ToolError("LIMIT_EXCEEDED");
      return records;
    } finally {
      await cursor.close();
    }
  };
}

async function attestReadPrivileges(db: mongo.Db) {
  // No write probe against application data. Effective session privileges must be restricted to our exact targets.
  const status = await db.command({ connectionStatus: 1, showPrivileges: true }, { timeoutMS: 3000 });
  const auth = status.authInfo;
  const privileges: { resource: { db?: string; collection?: string }; actions: string[] }[] = auth?.authenticatedUserPrivileges ?? [];
  const allowed = new Set<string>(readableCollections);
  if (auth?.authenticatedUsers?.length !== 1 || !privileges.length || privileges.some(({ resource, actions }) =>
    resource.db !== db.databaseName || !resource.collection || !allowed.has(resource.collection) ||
      Object.keys(resource).some((key) => !["db", "collection"].includes(key)) ||
      actions.length !== 1 || actions[0] !== "find"
  ) || readableCollections.some((collection) => !privileges.some((grant) => grant.resource.collection === collection))) {
    throw new Error("MCP database identity lacks the required collection-only read privileges");
  }
}

export async function connectStore(uri: string, database: string) {
  const client = new mongo.MongoClient(uri, {
    appName: "hostelflow-mcp", maxPoolSize: 4, maxConnecting: 1,
    serverSelectionTimeoutMS: 2500, connectTimeoutMS: 2000, waitQueueTimeoutMS: 1000, retryReads: false,
  });
  try {
    await client.connect();
    const db = client.db(database);
    await attestReadPrivileges(db);
    return {
      reader(context: OwnerContext, signal: AbortSignal) {
        if (context.property !== property) throw new ToolError("DATA_UNAVAILABLE");
        return createReader(db, signal);
      },
      close: () => client.close(),
    };
  } catch {
    await client.close();
    throw new Error("MCP read-only database is unavailable or its privileges could not be verified");
  }
}

export type Store = Awaited<ReturnType<typeof connectStore>>;
