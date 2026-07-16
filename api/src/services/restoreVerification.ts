import Booking from "../models/booking";
import CashShift from "../models/cashShift";
import DailyClose from "../models/dailyClose";
import User from "../models/user";
import { invalidRoomIds } from "../config/roomInventory";
import { summarizeCashStashes } from "../helpers/financeHelpers";

export type RestoreVerificationResult = {
  ok: boolean;
  checkedAt: string;
  counts: {
    bookings: number;
    users: number;
    cashShifts: number;
    dailyCloses: number;
  };
  errors: string[];
};

const moneyEquals = (left: number, right: number) =>
  Math.abs(left - right) < 0.005;

/**
 * Read-only consistency checks intended for an isolated restored database.
 * Messages contain identifiers and counts only; passport data and secrets are
 * never selected, decrypted, or logged.
 */
export const verifyRestoredData = async (): Promise<RestoreVerificationResult> => {
  const [bookings, users, cashShifts, dailyCloses] = await Promise.all([
    Booking.find({})
      .select("bookingId revision roomStays commercialSegments transactions voided")
      .lean(),
    User.find({}).select("username active").lean(),
    CashShift.find({}).lean(),
    DailyClose.find({}).select("businessDate staffUsername revision").lean(),
  ]);

  const errors: string[] = [];
  const bookingIds = new Set<string>();
  const usernames = new Set<string>();
  const shiftIds = new Set(cashShifts.map((shift) => String(shift._id)));
  const transactionsByShift = new Map<string, any[]>();

  for (const booking of bookings) {
    if (!booking.bookingId || bookingIds.has(booking.bookingId)) {
      errors.push(`booking identifier is missing or duplicated: ${booking.bookingId || "<missing>"}`);
    }
    bookingIds.add(booking.bookingId);

    if (!Number.isInteger(booking.revision) || booking.revision < 0) {
      errors.push(`booking ${booking.bookingId} has an invalid revision`);
    }

    const invalidRooms = invalidRoomIds(
      booking.roomStays.flatMap((stay) => stay.roomIds || (stay.roomId ? [stay.roomId] : [])),
    );
    if (invalidRooms.length > 0) {
      errors.push(`booking ${booking.bookingId} references invalid inventory: ${invalidRooms.join(", ")}`);
    }

    for (const transaction of booking.transactions || []) {
      if (!Number.isFinite(transaction.amount) || transaction.amount < 0) {
        errors.push(`booking ${booking.bookingId} has an invalid transaction amount`);
      }

      if (transaction.paymentMethod === "Cash" && Math.abs(transaction.amount || 0) > 0) {
        const shiftId = transaction.cashShiftId;
        if (!shiftId || !shiftIds.has(String(shiftId))) {
          errors.push(`booking ${booking.bookingId} has cash activity without a valid shift`);
          continue;
        }

        const key = String(shiftId);
        transactionsByShift.set(key, [
          ...(transactionsByShift.get(key) || []),
          transaction,
        ]);
      }
    }

    for (const segment of booking.commercialSegments || []) {
      const linkedTransaction = (booking.transactions || []).find(
        (transaction) => String(transaction._id) === segment.transactionId,
      );
      if (
        !linkedTransaction ||
        linkedTransaction.type !== "roomCharge" ||
        new Date(segment.from) >= new Date(segment.to) ||
        !Number.isFinite(segment.amount) ||
        segment.amount <= 0
      ) {
        errors.push(`booking ${booking.bookingId} has an invalid commercial segment`);
      }
    }
  }

  for (const user of users) {
    if (!user.username || usernames.has(user.username)) {
      errors.push(`username is missing or duplicated: ${user.username || "<missing>"}`);
    }
    usernames.add(user.username);
  }

  for (const shift of cashShifts) {
    if (!Number.isInteger(shift.ledgerRevision) || shift.ledgerRevision < 0) {
      errors.push(`cash shift ${shift._id} has an invalid ledger revision`);
    }

    const movements = summarizeCashStashes(
      (transactionsByShift.get(String(shift._id)) || []) as any,
    );
    const fields = [
      ["depositCashIn", movements.depositCashIn],
      ["depositCashOut", movements.depositCashOut],
      ["operatingCashIn", movements.operatingCashIn],
      ["operatingCashOut", movements.operatingCashOut],
    ] as const;

    for (const [field, calculated] of fields) {
      if (!moneyEquals(Number(shift[field] || 0), calculated)) {
        errors.push(`cash shift ${shift._id} does not reconcile ${field}`);
      }
    }

    const expectedDeposit =
      Number(shift.depositOpeningCash || 0) +
      movements.depositCashIn -
      movements.depositCashOut +
      Number(shift.depositPreparation?.adjustment || 0);
    const expectedOperating =
      shift.operatingOpeningCash + movements.operatingCashIn - movements.operatingCashOut;
    if (
      shift.depositExpectedCash !== undefined &&
      !moneyEquals(shift.depositExpectedCash, expectedDeposit)
    ) {
      errors.push(`cash shift ${shift._id} has an inconsistent deposit balance`);
    }
    if (!moneyEquals(shift.operatingExpectedCash, expectedOperating)) {
      errors.push(`cash shift ${shift._id} has an inconsistent operating balance`);
    }
  }

  for (const close of dailyCloses) {
    if (!Number.isInteger(close.revision) || close.revision < 1) {
      errors.push(`daily close ${close.businessDate}/${close.staffUsername} has an invalid revision`);
    }
  }

  return {
    ok: errors.length === 0,
    checkedAt: new Date().toISOString(),
    counts: {
      bookings: bookings.length,
      users: users.length,
      cashShifts: cashShifts.length,
      dailyCloses: dailyCloses.length,
    },
    errors,
  };
};
