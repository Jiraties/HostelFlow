import { createHash } from "node:crypto";

import type { booking } from "../models/booking";
import { bookingRemainingDepositAmount } from "./financeHelpers";
import { nextBusinessDateKey } from "./depositPreparationHelpers";
import { projectEffectiveTransactions } from "../services/transactionCorrections";

export type DepositReturnReminderBooking = {
  bookingId: string;
  guestName: string;
  roomIds: string[];
  checkOut: Date;
  amount: number;
};

export type DepositReturnReminder = {
  businessDate: string;
  targetBusinessDate: string;
  requiredAmount: number;
  bookingCount: number;
  bookings: DepositReturnReminderBooking[];
  overdueAmount: number;
  overdueBookingCount: number;
  overdueBookings: DepositReturnReminderBooking[];
  calculationToken: string;
  calculatedAt: Date;
};

type ReminderBooking = Pick<
  booking,
  "bookingId" | "name" | "roomStays" | "checkOut" | "transactions"
> & Partial<Pick<booking, "transactionCorrections">>;

const reminderRow = (
  currentBooking: ReminderBooking,
): DepositReturnReminderBooking => ({
  bookingId: currentBooking.bookingId,
  guestName: currentBooking.name,
  roomIds: [
    ...new Set(
      (currentBooking.roomStays || []).flatMap((roomStay) =>
        roomStay.roomIds?.length
          ? roomStay.roomIds
          : roomStay.roomId
            ? [roomStay.roomId]
            : [],
      ),
    ),
  ],
  checkOut: currentBooking.checkOut,
  amount: bookingRemainingDepositAmount(
    projectEffectiveTransactions(
      currentBooking.transactions || [],
      currentBooking.transactionCorrections || [],
    ),
  ),
});

const positiveDepositRows = (bookings: ReminderBooking[]) =>
  bookings
    .map(reminderRow)
    .filter((currentBooking) => currentBooking.amount > 0)
    .sort((first, second) => first.bookingId.localeCompare(second.bookingId));

const reminderToken = (
  businessDate: string,
  targetBusinessDate: string,
  bookings: DepositReturnReminderBooking[],
  overdueBookings: DepositReturnReminderBooking[],
) =>
  createHash("sha256")
    .update(
      JSON.stringify({
        businessDate,
        targetBusinessDate,
        bookings: bookings.map(
          ({ bookingId, guestName, roomIds, amount, checkOut }) => ({
            bookingId,
            guestName,
            roomIds,
            amount,
            checkOut: new Date(checkOut).toISOString(),
          }),
        ),
        overdueBookings: overdueBookings.map(
          ({ bookingId, guestName, roomIds, amount, checkOut }) => ({
            bookingId,
            guestName,
            roomIds,
            amount,
            checkOut: new Date(checkOut).toISOString(),
          }),
        ),
      }),
    )
    .digest("hex");

export const buildDepositReturnReminder = (
  businessDate: string,
  tomorrowBookings: ReminderBooking[],
  overdueBookings: ReminderBooking[],
  calculatedAt = new Date(),
): DepositReturnReminder => {
  const targetBusinessDate = nextBusinessDateKey(businessDate);
  const bookings = positiveDepositRows(tomorrowBookings);
  const overdue = positiveDepositRows(overdueBookings);

  return {
    businessDate,
    targetBusinessDate,
    requiredAmount: bookings.reduce(
      (total, currentBooking) => total + currentBooking.amount,
      0,
    ),
    bookingCount: bookings.length,
    bookings,
    overdueAmount: overdue.reduce(
      (total, currentBooking) => total + currentBooking.amount,
      0,
    ),
    overdueBookingCount: overdue.length,
    overdueBookings: overdue,
    calculationToken: reminderToken(
      businessDate,
      targetBusinessDate,
      bookings,
      overdue,
    ),
    calculatedAt,
  };
};
