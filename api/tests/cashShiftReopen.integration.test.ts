import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";

import Activity from "../src/models/activity";
import Booking from "../src/models/booking";
import CashShift from "../src/models/cashShift";
import CashShiftMutationLock from "../src/models/cashShiftMutationLock";
import CashShiftReopenCorrection from "../src/models/cashShiftReopenCorrection";
import MutationIdempotencyKey from "../src/models/mutationIdempotencyKey";
import {
  closeCashShift,
  getCashPosition,
  getCashShiftAudit,
  getDepositReturnReminder,
  reopenFinalCashShift,
} from "../src/controller/finance";

const response = () =>
  ({
    statusCode: 200,
    body: undefined as any,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: any) {
      this.body = body;
      return this;
    },
  }) as any;

const businessDateKey = (date = new Date()) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);

const reopenRequest = (
  shiftId: string,
  options: {
    username?: string;
    admin?: boolean;
    key?: string;
    reason?: string;
    revision?: number;
  } = {},
) =>
  ({
    params: { shiftId },
    body: {
      expectedLedgerRevision: options.revision ?? 4,
      reason: options.reason || "Guest paid cash after final close",
    },
    method: "POST",
    originalUrl: `/finance/cash-shifts/${shiftId}/reopen-final`,
    user: {
      username: options.username || "closer",
      admin: options.admin || false,
    },
    get(name: string) {
      return name === "Idempotency-Key" ? options.key || "reopen-key" : undefined;
    },
  }) as any;

const createFinalShift = (
  overrides: Record<string, unknown> = {},
) => {
  const endedAt = new Date(Date.now() - 60_000);
  return CashShift.create({
    businessDate: businessDateKey(),
    shiftNumber: 1,
    staffUsername: "shift-owner",
    status: "closed",
    ledgerRevision: 4,
    openingMode: "counted",
    operatingOpeningCash: 1000,
    operatingCashIn: 200,
    operatingCashOut: 50,
    operatingExpectedCash: 1150,
    operatingActualCash: 1140,
    operatingVariance: -10,
    note: "Original note",
    startedAt: new Date(Date.now() - 8 * 60 * 60_000),
    endedAt,
    createdBy: "shift-owner",
    closedBy: "closer",
    isFinalDayClose: true,
    auditResolution: {
      note: "Checked",
      reviewedBy: "owner",
      reviewedAt: endedAt,
    },
    depositReturnReminder: {
      targetBusinessDate: businessDateKey(new Date(Date.now() + 86400000)),
      requiredAmount: 0,
      bookingCount: 0,
      bookings: [],
      calculationToken: "old-token",
      calculatedAt: endedAt,
      acknowledgedAt: endedAt,
      acknowledgedBy: "closer",
    },
    ...overrides,
  });
};

let replicaSet: MongoMemoryReplSet;

before(async () => {
  replicaSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replicaSet.getUri(), {
    dbName: "hostelflow_cash_shift_reopen",
  });
  await Promise.all([
    Activity.syncIndexes(),
    Booking.syncIndexes(),
    CashShift.syncIndexes(),
    CashShiftMutationLock.syncIndexes(),
    CashShiftReopenCorrection.syncIndexes(),
    MutationIdempotencyKey.syncIndexes(),
  ]);
});

after(async () => {
  await mongoose.disconnect();
  await replicaSet.stop();
});

beforeEach(async () => {
  await Promise.all(
    Object.values(mongoose.connection.collections).map((collection) =>
      collection.deleteMany({}),
    ),
  );
});

test("original closer reopens the same shift and preserves an immutable close snapshot", async () => {
  const shift = await createFinalShift();
  const result = response();
  await reopenFinalCashShift(reopenRequest(String(shift._id)), result);

  assert.equal(result.statusCode, 200);
  const [storedShift, correction, activity] = await Promise.all([
    CashShift.findById(shift._id).lean(),
    CashShiftReopenCorrection.findOne({ shiftId: String(shift._id) }).lean(),
    Activity.findOne({ "details.summary.action": "REOPEN_FINAL_CASH_SHIFT" }).lean(),
  ]);
  assert.equal(storedShift?.status, "open");
  assert.equal(storedShift?.isFinalDayClose, false);
  assert.equal(storedShift?.ledgerRevision, 5);
  assert.equal(storedShift?.endedAt, undefined);
  assert.equal(storedShift?.closedBy, undefined);
  assert.equal(storedShift?.operatingActualCash, undefined);
  assert.equal(storedShift?.operatingVariance, undefined);
  assert.equal(storedShift?.depositReturnReminder, undefined);
  assert.equal(storedShift?.auditResolution, undefined);
  assert.equal(storedShift?.note, "Original note");
  assert.equal(correction?.originalClose.closedBy, "closer");
  assert.equal(correction?.originalClose.operatingActualCash, 1140);
  assert.equal(correction?.originalClose.depositReturnReminder?.calculationToken, "old-token");
  assert.equal(correction?.originalLedgerRevision, 4);
  assert.equal(correction?.resultingLedgerRevision, 5);
  assert.ok(activity);
  await assert.rejects(
    CashShiftReopenCorrection.updateOne(
      { correctionId: correction?.correctionId },
      { $set: { reason: "rewritten" } },
    ),
    /immutable/,
  );
});

test("owner may reopen another staff close while unrelated staff receives 403", async () => {
  const deniedShift = await createFinalShift();
  const denied = response();
  await reopenFinalCashShift(
    reopenRequest(String(deniedShift._id), { username: "other-staff" }),
    denied,
  );
  assert.equal(denied.statusCode, 403);

  const allowed = response();
  await reopenFinalCashShift(
    reopenRequest(String(deniedShift._id), {
      username: "owner",
      admin: true,
      key: "owner-reopen",
    }),
    allowed,
  );
  assert.equal(allowed.statusCode, 200);
});

test("past dates, stale revisions, and unassigned post-close cash are rejected", async () => {
  const past = await createFinalShift({
    businessDate: businessDateKey(new Date(Date.now() - 86400000)),
  });
  const pastResult = response();
  await reopenFinalCashShift(reopenRequest(String(past._id)), pastResult);
  assert.equal(pastResult.statusCode, 409);
  assert.equal(pastResult.body.error, "PAST_BUSINESS_DATE");

  await CashShift.deleteMany({});
  const stale = await createFinalShift();
  const staleResult = response();
  await reopenFinalCashShift(
    reopenRequest(String(stale._id), { revision: 3, key: "stale" }),
    staleResult,
  );
  assert.equal(staleResult.body.error, "CASH_SHIFT_LEDGER_CONFLICT");

  await Booking.create({
    bookingId: "UNASSIGNED-LATE",
    name: "Late Guest",
    status: "booked",
    staffUsername: "closer",
    transactions: [
      {
        type: "roomCharge",
        paymentMethod: "Cash",
        amount: 100,
        direction: "in",
        createdAt: new Date(),
        createdBy: "closer",
      },
    ],
  });
  const blocked = response();
  await reopenFinalCashShift(
    reopenRequest(String(stale._id), { key: "unassigned" }),
    blocked,
  );
  assert.equal(blocked.body.error, "UNASSIGNED_CASH_ACTIVITY");
});

test("idempotent replay returns the original result and changed payload conflicts", async () => {
  const shift = await createFinalShift();
  const first = response();
  const replay = response();
  await reopenFinalCashShift(
    reopenRequest(String(shift._id), { key: "same-key" }),
    first,
  );
  await reopenFinalCashShift(
    reopenRequest(String(shift._id), { key: "same-key" }),
    replay,
  );
  assert.equal(first.statusCode, 200);
  assert.equal(replay.statusCode, 200);
  assert.deepEqual(replay.body, first.body);
  assert.equal(await CashShiftReopenCorrection.countDocuments(), 1);

  const changed = response();
  await reopenFinalCashShift(
    reopenRequest(String(shift._id), {
      key: "same-key",
      reason: "Different reason",
    }),
    changed,
  );
  assert.equal(changed.statusCode, 409);
  assert.equal(changed.body.error, "IDEMPOTENCY_KEY_REUSED");
});

test("concurrent reopen attempts commit once", async () => {
  const shift = await createFinalShift();
  const first = response();
  const second = response();
  await Promise.all([
    reopenFinalCashShift(
      reopenRequest(String(shift._id), { key: "race-a" }),
      first,
    ),
    reopenFinalCashShift(
      reopenRequest(String(shift._id), { key: "race-b" }),
      second,
    ),
  ]);
  assert.deepEqual([first.statusCode, second.statusCode].sort(), [200, 409]);
  assert.equal(await CashShiftReopenCorrection.countDocuments(), 1);
});

test("correction or strict activity persistence failure rolls back the reopen", async () => {
  const correctionFailureShift = await createFinalShift();
  const originalCorrectionSave = CashShiftReopenCorrection.prototype.save;
  CashShiftReopenCorrection.prototype.save = async function () {
    throw new Error("synthetic correction failure");
  } as typeof originalCorrectionSave;
  try {
    const failed = response();
    await reopenFinalCashShift(
      reopenRequest(String(correctionFailureShift._id), {
        key: "correction-failure",
      }),
      failed,
    );
    assert.equal(failed.statusCode, 500);
  } finally {
    CashShiftReopenCorrection.prototype.save = originalCorrectionSave;
  }
  let stored = await CashShift.findById(correctionFailureShift._id).lean();
  assert.equal(stored?.status, "closed");
  assert.equal(stored?.isFinalDayClose, true);
  assert.equal(stored?.ledgerRevision, 4);

  await CashShift.deleteMany({});
  const activityFailureShift = await createFinalShift();
  const originalActivitySave = Activity.prototype.save;
  Activity.prototype.save = async function () {
    throw new Error("synthetic activity failure");
  } as typeof originalActivitySave;
  try {
    const failed = response();
    await reopenFinalCashShift(
      reopenRequest(String(activityFailureShift._id), {
        key: "activity-failure",
      }),
      failed,
    );
    assert.equal(failed.statusCode, 500);
  } finally {
    Activity.prototype.save = originalActivitySave;
  }
  stored = await CashShift.findById(activityFailureShift._id).lean();
  assert.equal(stored?.status, "closed");
  assert.equal(stored?.isFinalDayClose, true);
  assert.equal(stored?.ledgerRevision, 4);
  assert.equal(await CashShiftReopenCorrection.countDocuments(), 0);
});

test("cash position eligibility and audit expose the reopen correction", async () => {
  const shift = await createFinalShift();
  const positionBefore = response();
  await getCashPosition(
    {
      ...reopenRequest(String(shift._id)),
      query: {},
    },
    positionBefore,
  );
  assert.equal(positionBefore.body.finalCloseRecovery.eligible, true);
  assert.equal(positionBefore.body.finalCloseRecovery.shiftId, String(shift._id));

  const reopened = response();
  await reopenFinalCashShift(reopenRequest(String(shift._id)), reopened);
  const audit = response();
  await getCashShiftAudit(
    {
      ...reopenRequest(String(shift._id), { admin: true }),
      query: { date: businessDateKey() },
    },
    audit,
  );
  assert.equal(audit.statusCode, 200);
  assert.equal(audit.body.shifts[0].reopenCorrections.length, 1);
  assert.equal(audit.body.shifts[0].reopenCorrections[0].reason, "Guest paid cash after final close");
});

test("late cash stays on the reopened shift and a second final close recalculates it once", async () => {
  const shift = await createFinalShift({
    operatingOpeningCash: 1000,
    operatingExpectedCash: 1000,
    operatingActualCash: 1000,
    operatingVariance: 0,
  });
  const reopened = response();
  await reopenFinalCashShift(reopenRequest(String(shift._id)), reopened);

  await Booking.create({
    bookingId: "LATE-PAYMENT",
    name: "Late Guest",
    status: "booked",
    staffUsername: "closer",
    transactions: [
      {
        type: "roomCharge",
        paymentMethod: "Cash",
        amount: 250,
        direction: "in",
        cashShiftId: String(shift._id),
        createdAt: new Date(),
        createdBy: "closer",
      },
    ],
  });

  const reminder = response();
  await getDepositReturnReminder(
    {
      ...reopenRequest(String(shift._id)),
      query: { businessDate: businessDateKey() },
    },
    reminder,
  );
  assert.equal(reminder.statusCode, 200);
  assert.notEqual(reminder.body.reminder.calculationToken, "old-token");

  const closed = response();
  await closeCashShift(
    {
      ...reopenRequest(String(shift._id), {
        key: "second-final",
        admin: true,
      }),
      body: {
        operatingActualCash: 1250,
        closeDay: true,
        depositReminderToken: reminder.body.reminder.calculationToken,
      },
      params: { shiftId: String(shift._id) },
      originalUrl: `/finance/cash-shifts/${shift._id}/close`,
    },
    closed,
  );
  assert.equal(closed.statusCode, 200);
  const stored = await CashShift.findById(shift._id).lean();
  assert.equal(stored?.operatingCashIn, 250);
  assert.equal(stored?.operatingExpectedCash, 1250);
  assert.equal(stored?.operatingVariance, 0);
  assert.equal(stored?.isFinalDayClose, true);
  assert.equal(await CashShiftReopenCorrection.countDocuments(), 1);
});
