import type { transcation } from "../models/booking";
import {
  transactionDashboardGrossRevenueAmount,
  transactionDirection,
} from "./financeHelpers";

const BANGKOK_UTC_OFFSET_MS = 7 * 60 * 60 * 1000;

export const bookingsReportCheckInMonthBounds = (month: string) => {
  if (!/^\d{4}-\d{2}$/.test(month)) return null;
  const [year, monthNumber] = month.split("-").map(Number);
  if (monthNumber < 1 || monthNumber > 12) return null;

  return {
    start: new Date(
      Date.UTC(year, monthNumber - 1, 1) - BANGKOK_UTC_OFFSET_MS,
    ),
    end: new Date(Date.UTC(year, monthNumber, 1) - BANGKOK_UTC_OFFSET_MS),
  };
};

export const bookingsReportRoomChargeTotal = (transactions: transcation[]) =>
  transactions
    .filter((transaction) => transaction.type === "roomCharge")
    .reduce(
      (sum, transaction) =>
        sum + transactionDashboardGrossRevenueAmount(transaction),
      0,
    );

export const bookingsReportDepositCollectedTotal = (
  transactions: transcation[],
) =>
  transactions
    .filter(
      (transaction) =>
        transaction.type === "deposit" &&
        transaction.paymentMethod !== "Unpaid" &&
        transactionDirection(transaction) === "in",
    )
    .reduce((sum, transaction) => sum + Math.abs(transaction.amount || 0), 0);

export const bookingsReportTransactionAmount = (transaction: transcation) =>
  transaction.type === "roomCharge"
    ? 0
    : transactionDashboardGrossRevenueAmount(transaction);
