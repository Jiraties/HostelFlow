import type { booking } from "../types/bookingTypes";

type Transaction = booking["transactions"][number];

const ROUNDING_ADJUSTMENT_REVIEW_THRESHOLD = 1;

export const transactionRequiresReview = (transaction: Transaction) => {
  if (transaction.reviewStatus === "reviewed") return false;

  const isMinorRoundingAdjustment =
    transaction.type === "adjustment" &&
    transaction.reasonOfAdjustment === "rounding" &&
    Math.abs(transaction.amount || 0) <= ROUNDING_ADJUSTMENT_REVIEW_THRESHOLD;
  const effectiveFlags = (transaction.reviewFlags || []).filter(
    (flag) =>
      !isMinorRoundingAdjustment ||
      !["adjustment", "negative_adjustment"].includes(flag),
  );

  return (
    effectiveFlags.length > 0 ||
    (transaction.reviewStatus === "needs_review" && !isMinorRoundingAdjustment)
  );
};

export const roomChargeTransaction = (booking: booking) => {
  const transaction = booking.transactions.find(
    (transaction) => transaction.type === "roomCharge",
  );

  if (transaction) return transaction;

  const fallbackRoomCharge: Transaction = {
    type: "roomCharge",
    paymentMethod: "Unpaid",
    amount: 0,
  };

  return fallbackRoomCharge;
};

export const roomChargeOutstandingAmount = (booking: booking) => {
  if (booking.status === "cancelled") return 0;

  const unpaidRoomChargeIds = new Set(
    booking.transactions
      .filter(
        (transaction) =>
          transaction.type === "roomCharge" &&
          transaction.paymentMethod === "Unpaid",
      )
      .map((transaction) => transaction._id)
      .filter(
        (transactionId): transactionId is string => Boolean(transactionId),
      ),
  );

  return Math.max(
    Number(
      booking.transactions
        .reduce((outstandingAmount, transaction) => {
          if (
            transaction.type === "roomCharge" &&
            transaction.paymentMethod === "Unpaid"
          ) {
            return outstandingAmount + Math.abs(transaction.amount || 0);
          }

          const relatedTransactionIsUnpaidRoomCharge =
            transaction.relatedTransactionId !== undefined
              ? unpaidRoomChargeIds.has(transaction.relatedTransactionId)
              : transaction.relatedTransactionType === "roomCharge";
          const settlesRoomCharge =
            ["settlementCharge", "paymentCorrection"].includes(
              transaction.type,
            ) &&
            transaction.paymentMethod !== "Unpaid" &&
            relatedTransactionIsUnpaidRoomCharge;
          const writesOffRoomCharge =
            transaction.type === "roomChargeWriteOff" &&
            relatedTransactionIsUnpaidRoomCharge;

          return settlesRoomCharge || writesOffRoomCharge
            ? outstandingAmount - Math.abs(transaction.amount || 0)
            : outstandingAmount;
        }, 0)
        .toFixed(2),
    ),
    0,
  );
};

export const roomChargeSettlementTransactions = (
  booking: booking,
): Transaction[] => {
  const roomCharge = roomChargeTransaction(booking);
  if (!roomCharge._id) return [];

  return booking.transactions.filter(
    (transaction) =>
      transaction.type === "settlementCharge" &&
      transaction.relatedTransactionType === "roomCharge" &&
      transaction.relatedTransactionId === roomCharge._id &&
      transaction.paymentMethod !== "Unpaid",
  );
};

export const advanceRoomPaymentTransaction = (
  booking: booking,
): Transaction | undefined => {
  const transactionId = booking.advancePayment?.transactionId;
  if (!transactionId) return undefined;

  return booking.transactions.find(
    (transaction) => transaction._id === transactionId,
  );
};

export const roomChargeDisplayPaymentMethod = (
  booking: booking,
): Transaction["paymentMethod"] => {
  if (roomChargeOutstandingAmount(booking) > 0) return "Unpaid";

  const settlements = roomChargeSettlementTransactions(booking);
  return (
    settlements[settlements.length - 1]?.paymentMethod ||
    roomChargeTransaction(booking).paymentMethod
  );
};

export const isRoomChargeSettlementTransaction = (
  booking: booking,
  transaction: Transaction,
) =>
  transaction._id !== booking.advancePayment?.transactionId &&
  roomChargeSettlementTransactions(booking).some(
    (settlement) => settlement._id === transaction._id,
  );

export const calculateNights = (checkIn: Date, checkOut: Date) => {
  const start = new Date(
    checkIn.getFullYear(),
    checkIn.getMonth(),
    checkIn.getDate(),
  );

  const end = new Date(
    checkOut.getFullYear(),
    checkOut.getMonth(),
    checkOut.getDate(),
  );

  const diff = end.getTime() - start.getTime();
  return diff / 86400000;
};

export const formatLocalDate = (date: Date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

export const isSameDay = (d1: Date, d2: Date) =>
  d1.getFullYear() === d2.getFullYear() &&
  d1.getMonth() === d2.getMonth() &&
  d1.getDate() === d2.getDate();

type Booking = {
  name: string;
  status: "booked" | "checkedIn" | "checkedOut" | "cancelled" | "noShow";
  bookingId: string;
  from: Date;
  to: Date;
};

export const toInputDate = formatLocalDate;

export const populateDummyBookings = (
  rooms: { roomId: string; bookings: Booking[] }[],
  year: number,
  month: number,
) => {
  const getRandomInt = (min: number, max: number) =>
    Math.floor(Math.random() * (max - min + 1)) + min;

  const names = [
    "Alice",
    "Bob",
    "Charlie",
    "David",
    "Emma",
    "Frank",
    "Grace",
    "Henry",
    "Ivy",
    "Jack",
  ];

  return rooms.map((room) => {
    const bookings: Booking[] = [];

    let currentDay = getRandomInt(1, 5); // start early in month

    while (currentDay < 25) {
      const stayLength = getRandomInt(2, 4); // 2–4 nights

      const from = new Date(year, month, currentDay);
      const to = new Date(year, month, currentDay + stayLength);

      bookings.push({
        name: names[getRandomInt(0, names.length - 1)],
        status: "booked",
        bookingId: `${room.roomId}-${currentDay}`,
        from,
        to,
      });

      // move forward with a gap (prevents overlap)
      currentDay += stayLength + getRandomInt(1, 3);
    }

    return {
      ...room,
      bookings,
    };
  });
};

export const formatBookingsDates = (bookings: booking[]) =>
  bookings.map(formatBookingDates);

export const formatBookingDates = (booking: booking) => ({
  ...booking,
  checkIn: new Date(booking.checkIn),
  checkOut: new Date(booking.checkOut),
});

export function truncateDecimal(number: number, digits: number) {
  const multiplier = Math.pow(10, digits);
  return Math.trunc(number * multiplier) / multiplier;
}
