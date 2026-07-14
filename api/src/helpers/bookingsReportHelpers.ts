import type { transcation } from "../models/booking";
import {
  transactionDashboardGrossRevenueAmount,
  transactionDirection,
} from "./financeHelpers";

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
