import mongoose, { type ClientSession } from "mongoose";
import CashShift from "../models/cashShift";
import type { transcation } from "../models/booking";

const BUSINESS_TIME_ZONE = "Asia/Bangkok";

const businessDateKey = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value;

  return `${value("year")}-${value("month")}-${value("day")}`;
};

export class CashShiftLedgerConflictError extends Error {
  readonly code = "CASH_SHIFT_LEDGER_CONFLICT";

  constructor(message = "ไม่มีกะเงินสดที่เปิดอยู่ หรือกะถูกปิดระหว่างทำรายการ") {
    super(message);
    this.name = "CashShiftLedgerConflictError";
  }
}

type CashLedgerOperation<T> = (
  transactions: transcation[],
  session?: ClientSession,
) => Promise<T>;

/**
 * Cash-bearing booking writes and cash-shift close contend on the same
 * CashShift document. MongoDB therefore commits the booking write only if the
 * selected shift remains open for the entire transaction.
 */
export const withCashLedgerTransaction = async <T>(
  transactions: transcation[],
  operation: CashLedgerOperation<T>,
) => {
  if (!transactions.some((transaction) => transaction.paymentMethod === "Cash")) {
    return operation(transactions);
  }

  const session = await mongoose.startSession();
  try {
    const result = await session.withTransaction(async () => {
      const cashShift = await CashShift.findOne({
        businessDate: businessDateKey(),
        status: "open",
      })
        .sort({ startedAt: -1 })
        .session(session);

      if (!cashShift) throw new CashShiftLedgerConflictError();

      const shiftUpdate = await CashShift.updateOne(
        { _id: cashShift._id, status: "open" },
        { $inc: { ledgerRevision: 1 } },
        { session },
      );
      if (shiftUpdate.modifiedCount !== 1) {
        throw new CashShiftLedgerConflictError();
      }

      const cashShiftId = String(cashShift._id);
      const assignedTransactions = transactions.map((transaction) =>
        transaction.paymentMethod === "Cash"
          ? { ...transaction, cashShiftId }
          : transaction,
      );

      return operation(assignedTransactions, session);
    });

    if (result === undefined) throw new CashShiftLedgerConflictError();
    return result;
  } finally {
    await session.endSession();
  }
};
