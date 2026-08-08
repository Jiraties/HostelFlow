import type { booking } from "../types/bookingTypes";

type Transaction = booking["transactions"][number];

export const effectiveTransactions = (currentBooking: booking): Transaction[] => {
  if (currentBooking.effectiveTransactions?.length) {
    return currentBooking.effectiveTransactions;
  }

  const histories = new Map<string, NonNullable<booking["transactionCorrections"]>>();
  (currentBooking.transactionCorrections || []).forEach((correction) => {
    const existing = histories.get(correction.targetTransactionId) || [];
    existing.push(correction);
    histories.set(correction.targetTransactionId, existing);
  });

  const workingTransactions = (currentBooking.transactions || []).map(
    (transaction) => ({ ...transaction }),
  );
  const legacyIds = new Set<string>();
  const legacyCountByTarget = new Map<string, number>();
  workingTransactions.forEach((transaction) => {
    if (transaction.type !== "adjustment" || !transaction.relatedTransactionId) {
      return;
    }
    const target = workingTransactions.find(
      (candidate) => candidate._id === transaction.relatedTransactionId,
    );
    if (!target) return;
    const delta =
      transaction.direction === "out"
        ? -Math.abs(transaction.amount || 0)
        : Math.abs(transaction.amount || 0);
    target.amount = Math.max(Number((target.amount + delta).toFixed(2)), 0);
    legacyIds.add(String(transaction._id || ""));
    legacyCountByTarget.set(
      transaction.relatedTransactionId,
      (legacyCountByTarget.get(transaction.relatedTransactionId) || 0) + 1,
    );
  });

  return workingTransactions
    .filter((transaction) => !legacyIds.has(String(transaction._id || "")))
    .map((transaction) => {
    const transactionId = String(transaction.originalTransactionId || transaction._id || "");
    const history = (histories.get(transactionId) || []).sort(
      (first, second) =>
        new Date(first.correctedAt).getTime() -
        new Date(second.correctedAt).getTime(),
    );
    const latest = history[history.length - 1];
    const legacyAdjustmentCount = legacyCountByTarget.get(transactionId) || 0;
    const projectedTransaction: Transaction = {
      ...transaction,
      ...(latest?.after || {}),
      _id: transaction._id,
      originalTransactionId: transactionId,
      corrected: history.length > 0 || legacyAdjustmentCount > 0,
      correctionCount: history.length + legacyAdjustmentCount,
      latestCorrectionId: latest?._id,
      legacyAdjustmentCount,
    };
    if (latest && !latest.after.cashShiftId) {
      delete projectedTransaction.cashShiftId;
    }
    return projectedTransaction;
  });
};

const correctionChargeTypes = new Set<Transaction["type"]>([
  "roomCharge",
  "towel",
  "motorbike",
  "slowBoat",
  "joinTour",
  "extraBed",
  "pickACraft",
  "trek2D",
  "setMenu",
  "sleeperBus",
  "onlyWalk",
  "laundry",
  "bicycle",
  "car",
  "misc",
  "rainCoat",
  "passwordLock",
  "cooking",
  "cardSurcharge",
]);

const signedTransactionAmount = (transaction: Transaction) => {
  if (transaction.direction === "out") return -Math.abs(transaction.amount || 0);
  if (transaction.paymentMethod === "Unpaid" || transaction.direction === "neutral") {
    return 0;
  }
  return Math.abs(transaction.amount || 0);
};

export const bookingFinancialPosition = (
  currentBooking: booking,
  suppliedTransactions = effectiveTransactions(currentBooking),
) => {
  const chargeIds = new Set(
    suppliedTransactions
      .filter((transaction) => correctionChargeTypes.has(transaction.type))
      .map((transaction) => transaction._id)
      .filter((id): id is string => Boolean(id)),
  );
  let bookingTotal = 0;
  let amountReceived = 0;

  suppliedTransactions.forEach((transaction) => {
    const amount = Math.abs(transaction.amount || 0);
    const direction = transaction.direction === "out" ? -1 : 1;
    if (correctionChargeTypes.has(transaction.type)) {
      bookingTotal += direction * amount;
      if (transaction.paymentMethod !== "Unpaid") {
        amountReceived += signedTransactionAmount(transaction);
      }
      return;
    }
    if (transaction.type === "adjustment") {
      const isCashRounding = transaction.reasonOfAdjustment === "rounding";
      if (
        isCashRounding ||
        (transaction.relatedTransactionId &&
          chargeIds.has(transaction.relatedTransactionId))
      ) {
        bookingTotal += direction * amount;
      }
      if (transaction.paymentMethod !== "Unpaid") {
        amountReceived += signedTransactionAmount(transaction);
      }
      return;
    }
    if (["settlementCharge", "paymentCorrection"].includes(transaction.type)) {
      amountReceived += signedTransactionAmount(transaction);
      return;
    }
    if (transaction.type === "roomChargeWriteOff") {
      bookingTotal -= amount;
      return;
    }
    if (["cancellationRefund", "roomRefund", "compensation"].includes(transaction.type)) {
      bookingTotal -= amount;
      amountReceived -= amount;
    }
  });

  bookingTotal = Math.max(Number(bookingTotal.toFixed(2)), 0);
  amountReceived = Math.max(Number(amountReceived.toFixed(2)), 0);
  const difference = Number((bookingTotal - amountReceived).toFixed(2));
  return {
    bookingTotal,
    amountReceived,
    outstandingBalance: Math.max(difference, 0),
    guestCredit: Math.max(-difference, 0),
  };
};

const ROUNDING_ADJUSTMENT_REVIEW_THRESHOLD = 10;

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
  transactions: effectiveTransactions(booking).filter(
    (transaction) =>
      transaction.type !== "cardSurcharge" || transaction.amount > 0,
  ),
  legacyTransactionAdjustments:
    booking.legacyTransactionAdjustments ||
    (booking.transactions || []).filter(
      (transaction) =>
        transaction.type === "adjustment" && transaction.relatedTransactionId,
    ),
});

export function truncateDecimal(number: number, digits: number) {
  const multiplier = Math.pow(10, digits);
  return Math.trunc(number * multiplier) / multiplier;
}
