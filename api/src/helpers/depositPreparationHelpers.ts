import type { booking } from "../models/booking";
import { bookingRemainingDepositAmount } from "./financeHelpers";
import { projectEffectiveTransactions } from "../services/transactionCorrections";

export type DepositRequirementBooking = {
  bookingId: string;
  guestName: string;
  checkOut: Date;
  amount: number;
};

export type DepositRequirement = {
  businessDate: string;
  total: number;
  checkoutCount: number;
  refundBookingCount: number;
  bookings: DepositRequirementBooking[];
  calculatedAt: Date;
};

export const buildDepositRequirement = (
  businessDate: string,
  bookings: Array<
    Pick<booking, "bookingId" | "name" | "checkOut" | "transactions"> &
      Partial<Pick<booking, "transactionCorrections">>
  >,
  calculatedAt = new Date(),
): DepositRequirement => {
  const refundBookings = bookings
    .map((currentBooking) => ({
      bookingId: currentBooking.bookingId,
      guestName: currentBooking.name,
      checkOut: currentBooking.checkOut,
      amount: bookingRemainingDepositAmount(
        projectEffectiveTransactions(
          currentBooking.transactions || [],
          currentBooking.transactionCorrections || [],
        ),
      ),
    }))
    .filter((currentBooking) => currentBooking.amount > 0);

  return {
    businessDate,
    total: refundBookings.reduce(
      (total, currentBooking) => total + currentBooking.amount,
      0,
    ),
    checkoutCount: bookings.length,
    refundBookingCount: refundBookings.length,
    bookings: refundBookings,
    calculatedAt,
  };
};

export const depositPreparationAdjustment = (
  currentDepositCash: number,
  requiredDepositCash: number,
) => requiredDepositCash - currentDepositCash;

export const nextBusinessDateKey = (businessDate: string) => {
  const [year, month, day] = businessDate.split("-").map(Number);
  const nextDate = new Date(Date.UTC(year, month - 1, day + 1));
  return nextDate.toISOString().slice(0, 10);
};
