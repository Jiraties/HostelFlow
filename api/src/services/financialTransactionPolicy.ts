import type {
  booking,
  transcation,
  TransactionDirection,
  TransactionType,
} from "../models/booking";
import {
  LARGE_REFUND_THRESHOLD,
  bookingRemainingDepositAmount,
} from "../helpers/financeHelpers";

const outwardTypes: TransactionType[] = [
  "depositRefund",
  "cancellationRefund",
  "roomRefund",
  "compensation",
];

export class FinancialTransactionPolicyError extends Error {
  constructor(
    readonly status: 400 | 403 | 409,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FinancialTransactionPolicyError";
  }
}

export const canonicalTransactionDirection = (
  transaction: Pick<transcation, "type" | "paymentMethod">,
): TransactionDirection => {
  if (transaction.paymentMethod === "Unpaid") return "neutral";
  if (transaction.type === "depositKept") return "neutral";
  if (outwardTypes.includes(transaction.type)) return "out";
  return "in";
};

export const enforceAddTransactionPolicy = ({
  booking,
  transaction,
  isAdmin,
}: {
  booking: Pick<booking, "transactions">;
  transaction: transcation;
  isAdmin: boolean;
}): transcation => {
  const direction = canonicalTransactionDirection(transaction);

  if (transaction.direction && transaction.direction !== direction) {
    throw new FinancialTransactionPolicyError(
      400,
      "INVALID_TRANSACTION_DIRECTION",
      "ทิศทางรายการไม่ตรงกับประเภทรายการ",
    );
  }

  if (transaction.type === "depositRefund") {
    const remainingDeposit = bookingRemainingDepositAmount(booking.transactions);
    if (transaction.amount > remainingDeposit) {
      throw new FinancialTransactionPolicyError(
        409,
        "REFUND_EXCEEDS_AVAILABLE_BALANCE",
        `ยอดคืนมัดจำเกินยอดคงเหลือ ${remainingDeposit}`,
      );
    }

    const priorRefunds = booking.transactions.reduce(
      (total, existing) =>
        existing.type === "depositRefund"
          ? total + Math.abs(existing.amount || 0)
          : total,
      0,
    );
    if (!isAdmin && priorRefunds + transaction.amount >= LARGE_REFUND_THRESHOLD) {
      throw new FinancialTransactionPolicyError(
        403,
        "ADMIN_APPROVAL_REQUIRED",
        "ยอดคืนเงินสะสมสูง ต้องให้ Admin ดำเนินการ",
      );
    }
  }

  return { ...transaction, direction };
};
