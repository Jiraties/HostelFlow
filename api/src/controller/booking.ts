import { effectiveRoomStayEnd, occupiedCapacityOnDate, occupancySummaryForRange } from "../helpers/occupancyHelpers";
import { summarizeChannelMix } from "../helpers/channelMixHelpers";
export { occupiedCapacityOnDate, occupancySummaryForRange } from "../helpers/occupancyHelpers";
import Booking, {
  PASSPORT_SENSITIVE_SELECT,
  PaymentMethod,
} from "../models/booking";
import StandaloneSale from "../models/standaloneSale";
import RoomBlock, {
  HOUSE_USE_ROOM_BLOCK_REASON,
} from "../models/roomBlock";
import ExtraSaleAnnotation from "../models/extraSaleAnnotation";
import dotenv from "dotenv";
import crypto from "crypto";
import mongoose from "mongoose";

import { NextFunction, Request, Response } from "express";
import {
  logActivity,
  logActivityStrict,
} from "../services/activityServices";
import {
  bookingRemainingDepositAmount,
  normalizeTransaction,
  summarizeReceivedPaymentsByMethod,
  summarizeTransactions,
  transactionDirection,
  type SourceAction,
} from "../helpers/financeHelpers";
import type {
  booking,
  NamePrefix,
  PlatformId,
  ResolutionOutcome,
  RoomReleaseStatus,
  roomStay,
  Status,
  transcation,
  TransactionDirection,
  TransactionType,
  EncryptedField,
} from "../models/booking";
import { dateRangeText, toInputDate } from "../helpers/dateHelpers";
import {
  formatRoomStayRooms,
  getPrimaryRoomId,
  getRoomStayRoomIds,
  getUniqueRoomIdsFromRoomStays,
  normalizeRoomStay,
} from "../helpers/roomStayHelpers";
import {
  RoomMutationConflictError,
  withRoomMutationLocks,
} from "../services/roomMutationLocks";
import {
  findActiveRoomBlockConflict,
  getActiveBlockedRoomIds,
} from "../services/roomBlockAvailability";
import {
  IdempotencyConflictError,
  withMutationIdempotency,
} from "../services/mutationIdempotency";
import {
  CashShiftLedgerConflictError,
  withCashLedgerTransaction,
} from "../services/cashLedgerTransaction";
import {
  FinancialTransactionPolicyError,
  canonicalTransactionDirection,
  enforceAddTransactionPolicy,
} from "../services/financialTransactionPolicy";
import {
  activeRoomInventory,
  invalidRoomIds,
} from "../config/roomInventory";
import {
  commercialRoomSlices,
  effectiveCommercialSegments,
} from "../helpers/commercialSegmentHelpers";
import {
  buildGuestNameSearchPrefixes,
  normalizeBookingSearchText,
} from "../helpers/bookingSearchHelpers";
import {
  bookingRevisionPredicate,
  expectedBookingRevision,
  sendBookingRevisionConflict,
} from "../services/bookingConcurrency";
import {
  BookingExtensionError,
  extendBooking as performBookingExtension,
  type BookingExtensionInput,
} from "../services/bookingExtension";
import {
  effectiveBookingTransactions,
  roomChargeFinancialPosition,
  summarizeBookingFinancialPosition,
  withEffectiveTransactions,
} from "../services/transactionCorrections";
import {
  PassportDataError,
  validateAndEncryptPassportData,
  validatePassportData,
} from "../services/passportData";
import {
  resolveReplacementFor,
  resolveRetirementFlags,
} from "../config/resolveRetirement";
import {
  expectedStayRevenueBookingQuery,
  summarizeExpectedStayRevenue,
} from "../helpers/expectedStayRevenueHelpers";
import { assessOrdinaryRefundEntitlements } from "../services/refundEntitlement";

dotenv.config();

const ACTIVE_ROOM_INVENTORY = activeRoomInventory();
const CARD_SURCHARGE_RATE = 0.03;
const ADD_TRANSACTION_TYPES: TransactionType[] = [
  "adjustment",
  "deposit",
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
];
const RESOLVE_BOOKING_TRANSACTION_TYPES: TransactionType[] = [
  "roomRefund",
  "settlementCharge",
  "compensation",
  "paymentCorrection",
  "cancellationRefund",
  "adjustment",
];
const PAYMENT_METHODS: PaymentMethod[] = ["Cash", "Card", "Transfer"];
const SETTLEMENT_PAYMENT_METHODS: PaymentMethod[] = [
  "OTA",
  "Cash",
  "Card",
  "Transfer",
];
const NEW_BOOKING_PAYMENT_METHODS: PaymentMethod[] = [
  "OTA",
  "Cash",
  "Card",
  "Transfer",
  "Unpaid",
];
const CHECK_IN_PAYMENT_METHODS: PaymentMethod[] = ["Cash", "Card", "Transfer"];
const PLATFORM_IDS: PlatformId[] = ["BOOK", "HOST", "TRAV", "AGOD", "WALK"];
const RESOLUTION_OUTCOMES: ResolutionOutcome[] = [
  "normal_checkout",
  "early_checkout",
  "cancelled_before_arrival",
  "cancelled_after_checkin",
  "no_show",
  "guest_left",
  "post_close_adjustment",
];
const ROOM_RELEASE_STATUSES: RoomReleaseStatus[] = ["released", "blocked"];
const BOOKING_STATUSES: Status[] = [
  "booked",
  "checkedIn",
  "checkedOut",
  "cancelled",
  "noShow",
];
const RESOLUTION_FINAL_STATUSES: Status[] = [
  "checkedOut",
  "cancelled",
  "noShow",
];
const SENSITIVE_SETTLEMENT_TYPES: TransactionType[] = [
  "roomRefund",
  "depositRefund",
  "cancellationRefund",
  "compensation",
  "paymentCorrection",
];
const ROOM_BLOCKING_BOOKING_FILTER = {
  voided: { $ne: true },
  $or: [
    { status: { $nin: ["cancelled", "checkedOut", "noShow"] as const } },
    { "cancellation.roomReleaseStatus": "blocked" as const },
    { "checkout.roomReleaseStatus": "blocked" as const },
    { "resolution.roomReleaseStatus": "blocked" as const },
  ],
};
const BUSINESS_TIME_ZONE = "Asia/Bangkok";
const BANGKOK_UTC_OFFSET_HOURS = 7;
const REVENUE_CHART_RANGES = ["mtd", "1m", "3m", "1y"] as const;
type RevenueChartRange = (typeof REVENUE_CHART_RANGES)[number];
type RevenueChartBucketSize = "day" | "week" | "month";

const sendDuplicateMutationResponse = (res: Response) =>
  res.status(409).json({
    error: "DUPLICATE_REQUEST",
    message: "คำขอนี้ถูกส่งซ้ำหรือเพิ่งดำเนินการสำเร็จ กรุณารีเฟรชข้อมูล",
  });

const getBusinessDateParts = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  return {
    year: Number(parts.find((part) => part.type === "year")?.value),
    month: Number(parts.find((part) => part.type === "month")?.value),
    day: Number(parts.find((part) => part.type === "day")?.value),
  };
};

const getBusinessDateKey = (date = new Date()) => {
  const { year, month, day } = getBusinessDateParts(date);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
};

const nextDateKey = (dateKey: string) => {
  const [year, month, day] = dateKey.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(
    2,
    "0",
  )}-${String(next.getUTCDate()).padStart(2, "0")}`;
};

const completedRoomAssignments = (
  roomStays: roomStay[],
  checkIn: string | Date,
  checkOut: string | Date,
  cutoffDateKey: string,
) => {
  const normalizedStays = roomStays.map((stay) => ({
    from: toInputDate(stay.from),
    to: toInputDate(stay.to),
    roomIds: [...getRoomStayRoomIds(stay)].sort(),
  }));
  const assignments = new Map<string, string>();
  const finalDateKey =
    toInputDate(checkOut) < cutoffDateKey
      ? toInputDate(checkOut)
      : cutoffDateKey;

  for (
    let dateKey = toInputDate(checkIn);
    dateKey < finalDateKey;
    dateKey = nextDateKey(dateKey)
  ) {
    const stay = normalizedStays.find(
      (candidate) => candidate.from <= dateKey && dateKey < candidate.to,
    );
    assignments.set(dateKey, stay?.roomIds.join("\u0000") || "");
  }

  return assignments;
};

const preservesCompletedRoomAssignments = (
  originalRoomStays: roomStay[],
  incomingRoomStays: roomStay[],
  checkIn: string | Date,
  checkOut: string | Date,
  cutoffDateKey: string,
) => {
  const originalAssignments = completedRoomAssignments(
    originalRoomStays,
    checkIn,
    checkOut,
    cutoffDateKey,
  );
  const incomingAssignments = completedRoomAssignments(
    incomingRoomStays,
    checkIn,
    checkOut,
    cutoffDateKey,
  );

  return [...originalAssignments].every(
    ([dateKey, roomIds]) => incomingAssignments.get(dateKey) === roomIds,
  );
};

const getBusinessDateStart = (year: number, month: number, day: number) =>
  new Date(Date.UTC(year, month - 1, day, -BANGKOK_UTC_OFFSET_HOURS, 0, 0, 0));

const getBusinessDayBounds = (date = new Date()) => {
  const { year, month, day } = getBusinessDateParts(date);
  const start = getBusinessDateStart(year, month, day);
  const end = new Date(start.getTime() + 86400000);

  return { start, end };
};

const getBusinessMonthBounds = (date = new Date()) => {
  const { year, month } = getBusinessDateParts(date);
  const start = getBusinessDateStart(year, month, 1);
  const end = getBusinessDateStart(year, month + 1, 1);

  return { start, end };
};

const getBusinessMonthBoundsFromKey = (monthKey: unknown, date = new Date()) => {
  if (monthKey === undefined) {
    const bounds = getBusinessMonthBounds(date);
    const { year, month } = getBusinessDateParts(date);
    return {
      ...bounds,
      monthKey: `${year}-${String(month).padStart(2, "0")}`,
    };
  }
  if (typeof monthKey !== "string" || !/^\d{4}-\d{2}$/.test(monthKey)) {
    return null;
  }

  const [year, month] = monthKey.split("-").map(Number);
  if (month < 1 || month > 12) return null;

  return {
    start: getBusinessDateStart(year, month, 1),
    end: getBusinessDateStart(year, month + 1, 1),
    monthKey,
  };
};

const daysInBusinessMonth = (year: number, month: number) =>
  new Date(Date.UTC(year, month, 0)).getUTCDate();

const getClampedBusinessDateStart = (
  year: number,
  month: number,
  day: number,
) => {
  const monthStart = new Date(Date.UTC(year, month - 1, 1));
  const normalizedYear = monthStart.getUTCFullYear();
  const normalizedMonth = monthStart.getUTCMonth() + 1;
  const normalizedDay = Math.min(
    day,
    daysInBusinessMonth(normalizedYear, normalizedMonth),
  );

  return getBusinessDateStart(normalizedYear, normalizedMonth, normalizedDay);
};

const normalizeRevenueChartRange = (value: unknown): RevenueChartRange =>
  typeof value === "string" &&
  REVENUE_CHART_RANGES.includes(value as RevenueChartRange)
    ? (value as RevenueChartRange)
    : "mtd";

const getRevenueChartBounds = (
  date: Date,
  range: RevenueChartRange,
  startOfMonth: Date,
  endOfToday: Date,
) => {
  if (range === "mtd") return { start: startOfMonth, end: endOfToday };

  const { year, month, day } = getBusinessDateParts(date);

  if (range === "1m") {
    return {
      start: getClampedBusinessDateStart(year, month - 1, day),
      end: endOfToday,
    };
  }

  if (range === "3m") {
    return {
      start: getClampedBusinessDateStart(year, month - 3, day),
      end: endOfToday,
    };
  }

  return {
    start: getClampedBusinessDateStart(year - 1, month, day),
    end: endOfToday,
  };
};

const getRevenueChartBucketSize = (
  range: RevenueChartRange,
): RevenueChartBucketSize => {
  if (range === "1y") return "month";
  if (range === "3m") return "week";
  return "day";
};

const addBusinessMonths = (date: Date, months: number) => {
  const { year, month, day } = getBusinessDateParts(date);
  return getClampedBusinessDateStart(year, month + months, day);
};

const getRevenueBucketStart = (
  date: Date,
  bucketSize: RevenueChartBucketSize,
) => {
  if (bucketSize === "month") {
    const { year, month } = getBusinessDateParts(date);
    return getBusinessDateStart(year, month, 1);
  }

  if (bucketSize === "week") {
    const dayStart = getBookingBusinessDateStart(date);
    const weekday = dayStart.getUTCDay();
    const daysFromMonday = (weekday + 6) % 7;
    return new Date(dayStart.getTime() - daysFromMonday * 86400000);
  }

  return getBookingBusinessDateStart(date);
};

const nextRevenueBucketStart = (
  date: Date,
  bucketSize: RevenueChartBucketSize,
) => {
  if (bucketSize === "month") return addBusinessMonths(date, 1);
  if (bucketSize === "week") return new Date(date.getTime() + 7 * 86400000);
  return new Date(date.getTime() + 86400000);
};

const effectiveCalendarRoomStayEnd = (
  currentBooking: booking,
  roomStay: roomStay,
) => {
  if (currentBooking.checkout?.roomReleaseStatus === "blocked") {
    return new Date(roomStay.to);
  }

  return effectiveRoomStayEnd(currentBooking, roomStay);
};

const getRequestedRoomIds = (booking: { roomIds?: string[]; roomId?: string }) =>
  getRoomStayRoomIds({
    roomIds: booking.roomIds,
    roomId: booking.roomId,
  });

const buildActivityBookingSnapshot = (booking: booking) => ({
  name: booking.name,
  checkIn: booking.checkIn,
  checkOut: booking.checkOut,
  platformId: booking.platformId,
  roomIds: getUniqueRoomIdsFromRoomStays(booking.roomStays || []),
  bookingId: booking.bookingId,
});

const getRawRoomIds = (value: { roomIds?: string[]; roomId?: string }) =>
  (Array.isArray(value.roomIds) ? value.roomIds : value.roomId ? [value.roomId] : [])
    .map((roomId) => roomId.trim())
    .filter(Boolean);

const hasDuplicateRoomIds = (value: { roomIds?: string[]; roomId?: string }) => {
  const roomIds = getRawRoomIds(value);
  return new Set(roomIds).size !== roomIds.length;
};

const roomSetsIntersect = (left: string[], right: string[]) =>
  left.some((roomId) => right.includes(roomId));

type RoomStayWithDates = {
  roomId?: string;
  roomIds?: string[];
  from: string | Date;
  to: string | Date;
};

const roomStaysConflict = (
  existing: RoomStayWithDates,
  incoming: RoomStayWithDates,
) =>
  roomSetsIntersect(
    getRoomStayRoomIds(existing),
    getRoomStayRoomIds(incoming),
  ) &&
  new Date(existing.from) < new Date(incoming.to) &&
  new Date(existing.to) > new Date(incoming.from);

const buildRoomConflictQuery = (roomIds: string[], from: Date, to: Date) => ({
  $or: [
    {
      roomStays: {
        $elemMatch: {
          roomIds: { $in: roomIds },
          from: { $lt: to },
          to: { $gt: from },
        },
      },
    },
    {
      roomStays: {
        $elemMatch: {
          roomId: { $in: roomIds },
          from: { $lt: to },
          to: { $gt: from },
        },
      },
    },
  ],
});

const buildBlockingRoomConflictQuery = (
  roomIds: string[],
  from: Date,
  to: Date,
) => ({
  $and: [
    ROOM_BLOCKING_BOOKING_FILTER,
    buildRoomConflictQuery(roomIds, from, to),
  ],
});

const buildAnyRoomConflictQuery = (from: Date, to: Date) => ({
  roomStays: {
    $elemMatch: {
      from: { $lt: to },
      to: { $gt: from },
    },
  },
});

const getGuestsInHouse = async (date = new Date()) => {
  const { start, end } = getBusinessDayBounds(date);
  const checkedInBookings = await Booking.find({
    status: "checkedIn",
    roomStays: {
      $elemMatch: {
        from: { $lt: end },
        to: { $gt: start },
      },
    },
  })
    .select("roomStays")
    .lean();

  return occupiedCapacityOnDate(checkedInBookings as booking[], start, end);
};

const calculateCardSurcharge = (amount: number) =>
  Number((amount * CARD_SURCHARGE_RATE).toFixed(2));

const roundMoney = (amount: number) => Number(amount.toFixed(2));

const buildTransactionsWithCardSurcharge = (
  transaction: transcation,
  options: {
    createdBy?: string;
    sourceAction: SourceAction;
    note?: string;
    reference?: string;
    sameTypeCount?: number;
    cardSurchargeBaseAmount?: number;
  },
): transcation[] => {
  const { cardSurchargeBaseAmount, ...transactionOptions } = options;
  const transactions = [normalizeTransaction(transaction, transactionOptions)];
  const surchargeBaseAmount = cardSurchargeBaseAmount ?? transaction.amount;

  if (
    transaction.paymentMethod === "Card" &&
    surchargeBaseAmount > 0 &&
    transactionDirection(transaction) === "in" &&
    transaction.type !== "depositRefund" &&
    transaction.type !== "cardSurcharge"
  ) {
    transactions.push(
      normalizeTransaction(
        {
          type: "cardSurcharge",
          paymentMethod: "Card",
          relatedTransactionType: transaction.type,
          relatedTransactionId: transaction._id
            ? String(transaction._id)
            : undefined,
          amount: calculateCardSurcharge(surchargeBaseAmount),
          platformId: transaction.platformId,
          commercialSegmentId: transaction.commercialSegmentId,
        },
        transactionOptions,
      ),
    );
  }

  return transactions;
};

const formatLocalDateKey = (date: Date) => {
  const { year, month, day } = getBusinessDateParts(date);

  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(
    2,
    "0",
  )}`;
};

const unpaidRoomChargeAmount = (booking: booking) =>
  booking.status === "cancelled"
    ? 0
    : roomChargeFinancialPosition(effectiveBookingTransactions(booking))
        .outstanding;

const calculateNights = (checkIn: string, checkOut: string) => {
  const checkInDate = new Date(checkIn + "T00:00:00");
  const checkOutDate = new Date(checkOut + "T00:00:00");

  const diff = checkOutDate.getTime() - checkInDate.getTime();
  return diff / 86400000;
};

const isValidDate = (date: Date) => !Number.isNaN(date.getTime());

const getBookingBusinessDateStart = (date: Date) => {
  const parts = getBusinessDateParts(date);
  return getBusinessDateStart(parts.year, parts.month, parts.day);
};

export const newBooking = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const staffUsername = req.user?.username;
    if (!staffUsername) {
      return res.status(401).json({ message: "กรุณาเข้าสู่ระบบใหม่" });
    }

    if (!req.body.booking)
      return res.status(400).json({ message: "ไม่พบข้อมูล booking" });

    const { booking } = req.body;
    const requestedRoomIds = getRequestedRoomIds(booking);
    const advancePaymentRequested = booking.advancePayment?.enabled === true;
    const advancePaymentMethod = booking.advancePayment?.paymentMethod as
      | PaymentMethod
      | undefined;
    const advancePaymentCalculationMode =
      booking.advancePayment?.calculationMode === "amount"
        ? "amount"
        : "percentage";
    const requestedAdvancePaymentPercentage = Number(
      booking.advancePayment?.percentage ?? 50,
    );
    const requestedAdvancePaymentAmount = Number(booking.advancePayment?.amount);

    if (
      !booking.name?.trim() ||
      !booking.checkIn ||
      !booking.checkOut ||
      !booking.platformId ||
      requestedRoomIds.length === 0 ||
      !booking.paymentMethod ||
      !booking.bookingId?.trim()
    ) {
      return res.status(400).json({
        message: "กรุณากรอกข้อมูลให้ครบทุกช่อง",
      });
    }

    if (!PLATFORM_IDS.includes(booking.platformId)) {
      return res.status(400).json({
        message: "ช่องทางการจองไม่ถูกต้อง",
      });
    }

    if (!NEW_BOOKING_PAYMENT_METHODS.includes(booking.paymentMethod)) {
      return res.status(400).json({
        message: "ช่องทางการชำระเงินไม่ถูกต้อง",
      });
    }

    if (advancePaymentRequested && booking.platformId !== "WALK") {
      return res.status(400).json({
        error: "ADVANCE_PAYMENT_REQUIRES_WALK_IN",
        message: "รับเงินล่วงหน้าได้เฉพาะการจอง Walk-In",
      });
    }

    if (
      advancePaymentRequested &&
      advancePaymentCalculationMode === "percentage" &&
      (!Number.isFinite(requestedAdvancePaymentPercentage) ||
        requestedAdvancePaymentPercentage <= 0 ||
        requestedAdvancePaymentPercentage > 100)
    ) {
      return res.status(400).json({
        error: "INVALID_ADVANCE_PAYMENT_PERCENTAGE",
        message: "เปอร์เซ็นต์เงินล่วงหน้าต้องมากกว่า 0 และไม่เกิน 100",
      });
    }

    if (
      advancePaymentRequested &&
      (!advancePaymentMethod || !PAYMENT_METHODS.includes(advancePaymentMethod))
    ) {
      return res.status(400).json({
        error: "INVALID_ADVANCE_PAYMENT_METHOD",
        message: "กรุณาเลือกช่องทางรับเงินล่วงหน้า",
      });
    }

    if (hasDuplicateRoomIds(booking)) {
      return res.status(400).json({
        message: "เลือกห้องซ้ำกัน",
      });
    }
    const invalidRequestedRooms = invalidRoomIds(requestedRoomIds);
    if (invalidRequestedRooms.length > 0) {
      return res.status(400).json({
        error: "INVALID_ROOM_ID",
        message: `ไม่พบห้องที่เปิดใช้งาน: ${invalidRequestedRooms.join(", ")}`,
      });
    }

    const roomChargeAmount = Number(booking.price);

    if (!Number.isFinite(roomChargeAmount) || roomChargeAmount <= 0) {
      return res.status(400).json({
        message: "ราคาห้องต้องมากกว่า 0",
      });
    }

    if (
      advancePaymentRequested &&
      advancePaymentCalculationMode === "amount" &&
      (!Number.isFinite(requestedAdvancePaymentAmount) ||
        requestedAdvancePaymentAmount <= 0 ||
        requestedAdvancePaymentAmount > roomChargeAmount)
    ) {
      return res.status(400).json({
        error: "INVALID_ADVANCE_PAYMENT_AMOUNT",
        message: "ยอดเงินล่วงหน้าต้องมากกว่า 0 และไม่เกินราคาห้องทั้งหมด",
      });
    }

    const advancePaymentAmount = advancePaymentRequested
      ? advancePaymentCalculationMode === "amount"
        ? Number(requestedAdvancePaymentAmount.toFixed(2))
        : Number(
            (
              (roomChargeAmount * requestedAdvancePaymentPercentage) /
              100
            ).toFixed(2),
          )
      : 0;
    const advancePaymentPercentage = advancePaymentRequested
      ? advancePaymentCalculationMode === "amount"
        ? Number(((advancePaymentAmount / roomChargeAmount) * 100).toFixed(4))
        : requestedAdvancePaymentPercentage
      : 0;

    if (advancePaymentRequested && advancePaymentAmount <= 0) {
      return res.status(400).json({
        error: "ADVANCE_PAYMENT_TOO_SMALL",
        message: "ยอดเงินล่วงหน้าต่ำกว่าหน่วยเงินที่ระบบบันทึกได้",
      });
    }

    const newCheckIn = new Date(booking.checkIn + "T00:00:00");
    const newCheckOut = new Date(booking.checkOut + "T00:00:00");

    if (!isValidDate(newCheckIn) || !isValidDate(newCheckOut)) {
      return res.status(400).json({
        message: "วันที่เช็คอินหรือเช็คเอาท์ไม่ถูกต้อง",
      });
    }

    if (newCheckIn >= newCheckOut)
      return res.status(400).json({
        message: "วันที่เช็คอินต้องไม่อยู่หลังวันที่เช็คเอาท์",
      });

    const createResult = await withRoomMutationLocks(
      [
        {
          roomIds: requestedRoomIds,
          from: newCheckIn,
          to: newCheckOut,
        },
      ],
      async () => {
        const overlappingRoomBlock = await findActiveRoomBlockConflict([
          { roomIds: requestedRoomIds, from: newCheckIn, to: newCheckOut },
        ]);
        if (overlappingRoomBlock) {
          return { overlappingRoomBlock };
        }

        // find bookings that have same room && checkout greater than new checkin && checkin less than new checkout
        const overlappingBooking = await Booking.findOne(
          buildBlockingRoomConflictQuery(
            requestedRoomIds,
            newCheckIn,
            newCheckOut,
          ),
        );

        if (overlappingBooking) {
          return { overlappingBooking };
        }

        const commercialSegmentId = new mongoose.Types.ObjectId();
        const roomChargeTransactionId = new mongoose.Types.ObjectId();
        const advancePaymentTransactionId = advancePaymentRequested
          ? new mongoose.Types.ObjectId()
          : null;
        const createdAt = new Date();
        const roomChargeTransaction: transcation = {
          _id: String(roomChargeTransactionId),
          type: "roomCharge",
          amount: roomChargeAmount,
          paymentMethod: advancePaymentRequested
            ? "Unpaid"
            : booking.paymentMethod,
          platformId: booking.platformId,
          commercialSegmentId: String(commercialSegmentId),
          createdAt,
        };

        const transactions = buildTransactionsWithCardSurcharge(
          roomChargeTransaction,
          {
            createdBy: req.user?.username,
            sourceAction: "NEW_BOOKING",
          },
        );

        if (
          advancePaymentRequested &&
          advancePaymentMethod &&
          advancePaymentTransactionId
        ) {
          transactions.push(
            ...buildTransactionsWithCardSurcharge(
              {
                _id: String(advancePaymentTransactionId),
                type: "settlementCharge",
                paymentMethod: advancePaymentMethod,
                relatedTransactionType: "roomCharge",
                relatedTransactionId: String(roomChargeTransactionId),
                amount: advancePaymentAmount,
                platformId: booking.platformId,
                commercialSegmentId: String(commercialSegmentId),
                createdAt,
              },
              {
                createdBy: req.user?.username,
                sourceAction: "NEW_BOOKING",
                note:
                  advancePaymentCalculationMode === "amount"
                    ? `Non-refundable advance room payment: THB ${advancePaymentAmount}`
                    : `Non-refundable ${advancePaymentPercentage}% advance room payment`,
              },
            ),
          );
        }

        const savedBooking = await withCashLedgerTransaction(
          transactions,
          async (assignedTransactions, session) => {
            const bookingDocument = new Booking({
              name: booking.name.trim(),
              checkIn: newCheckIn,
              checkOut: newCheckOut,
              nights: calculateNights(booking.checkIn, booking.checkOut),
              platformId: booking.platformId,
              roomStays: [
                {
                  roomIds: requestedRoomIds,
                  from: newCheckIn,
                  to: newCheckOut,
                },
              ],
              commercialSegments: [
                {
                  _id: commercialSegmentId,
                  kind: "original",
                  from: newCheckIn,
                  to: newCheckOut,
                  platformId: booking.platformId,
                  channelBookingId: booking.bookingId.trim(),
                  amount: roomChargeAmount,
                  transactionId: String(roomChargeTransactionId),
                  createdBy: staffUsername,
                  createdAt,
                },
              ],
              note: booking.note || "",
              ...(advancePaymentRequested && advancePaymentTransactionId
                ? {
                    advancePayment: {
                      calculationMode: advancePaymentCalculationMode,
                      percentage: advancePaymentPercentage,
                      amount: advancePaymentAmount,
                      nonRefundableOnCancellation: true,
                      transactionId: String(advancePaymentTransactionId),
                    },
                  }
                : {}),
              transactions: assignedTransactions,
              staffUsername,
              bookingId: booking.bookingId.trim(),
              checkInByStaffUsername: null,
              status: "booked",
            });

            await bookingDocument.save({ session });
            return bookingDocument;
          },
        );

        return { savedBooking };
      },
    );

    if (createResult.overlappingBooking) {
      return res.status(409).json({
        message: `ห้องนี้ถูกจองแล้วระหว่างวันที่ ${dateRangeText(createResult.overlappingBooking.roomStays[0].from, createResult.overlappingBooking.roomStays[0].to)} กรุณาเลือกช่วงเวลาอื่น`,
      });
    }
    if (createResult.overlappingRoomBlock) {
      return res.status(409).json({
        error: "ROOM_BLOCK_CONFLICT",
        message: "ห้องนี้ถูกบล็อกอยู่ในช่วงวันที่เลือก กรุณาเลือกช่วงเวลาอื่น",
      });
    }

    const savedBooking = createResult.savedBooking!;

    res
      .status(201)
      .json({ message: "Booking created successfully", booking: savedBooking });

    logActivity(req.user?.username, "NEW_BOOKING", {
      snapshot: {
        name: booking.name,
        checkIn: newCheckIn,
        checkOut: newCheckOut,
        platformId: booking.platformId,
        roomIds: requestedRoomIds,
        price: booking.price,
        paymentMethod: booking.paymentMethod,
        ...(advancePaymentRequested
          ? {
              advancePayment: {
                calculationMode: advancePaymentCalculationMode,
                percentage: advancePaymentPercentage,
                paymentMethod: advancePaymentMethod,
              },
            }
          : {}),
        bookingId: booking.bookingId,
      },
    });
  } catch (err: any) {
    if (err instanceof CashShiftLedgerConflictError) {
      return res.status(409).json({ error: err.code, message: err.message });
    }
    if (err instanceof RoomMutationConflictError) {
      return res.status(409).json({
        message: "ห้องนี้กำลังถูกแก้ไขโดยผู้ใช้อื่น กรุณาลองอีกครั้ง",
      });
    }

    if (err.code === 11000) {
      return res.status(409).json({
        message: "Booking ID ถูกใช้ไปแล้ว โปรดใช้ Booking ID อื่น",
      });
    }

    res.status(400).json({ error: (err as Error).message });
  }
};

export const getRoomAvailability = async (req: Request, res: Response) => {
  try {
    const { checkIn, checkOut, excludeBookingId } = req.query;

    if (typeof checkIn !== "string" || typeof checkOut !== "string") {
      return res.status(400).json({
        message: "กรุณาระบุวันที่เช็คอินและเช็คเอาท์",
      });
    }

    const from = new Date(`${checkIn}T00:00:00`);
    const to = new Date(`${checkOut}T00:00:00`);

    if (!isValidDate(from) || !isValidDate(to)) {
      return res.status(400).json({
        message: "วันที่เช็คอินหรือเช็คเอาท์ไม่ถูกต้อง",
      });
    }

    if (from >= to) {
      return res.status(400).json({
        message: "วันที่เช็คอินต้องไม่อยู่หลังวันที่เช็คเอาท์",
      });
    }

    const query = {
      ...ROOM_BLOCKING_BOOKING_FILTER,
      ...buildAnyRoomConflictQuery(from, to),
      ...(typeof excludeBookingId === "string" && excludeBookingId.trim()
        ? { bookingId: { $ne: excludeBookingId.trim() } }
        : {}),
    };

    const overlappingBookings = await Booking.find(query)
      .select("roomStays")
      .lean();

    const blockedRoomIds = await getActiveBlockedRoomIds(from, to);

    const occupiedRoomIds = Array.from(
      new Set(
        [
          ...blockedRoomIds,
          ...overlappingBookings.flatMap((booking) =>
            booking.roomStays.flatMap((roomStay) => {
              const overlaps =
                new Date(roomStay.from) < to && new Date(roomStay.to) > from;

              return overlaps ? getRoomStayRoomIds(roomStay) : [];
            }),
          ),
        ],
      ),
    );

    res.status(200).json({ occupiedRoomIds });
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch room availability" });
  }
};

type EditBookingBody = {
  expectedRevision: number;
  booking: {
    name: string;
    checkIn: string;
    checkOut: string;
    platformId: PlatformId;
    note?: string;
  };
};

type EditBookingParams = {
  bookingId: string;
};

type UpdateBookingNoteBody = {
  note?: string;
};

type PinBookingBody = {
  pinned?: boolean;
};

export const editBooking = async (
  req: Request<EditBookingParams, {}, EditBookingBody>,
  res: Response,
) => {
  try {
    const { booking } = req.body;
    const { bookingId } = req.params;
    const expectedRevision = expectedBookingRevision(req.body.expectedRevision);

    if (
      !booking ||
      !booking.name ||
      !booking.checkIn ||
      !booking.checkOut ||
      !booking.platformId
    ) {
      return res.status(400).json({
        message: "กรุณากรอกข้อมูลให้ครบทุกช่อง",
      });
    }
    if (expectedRevision === null) {
      return res.status(400).json({
        error: "EXPECTED_REVISION_REQUIRED",
        message: "กรุณารีเฟรชข้อมูลการจองก่อนแก้ไข",
      });
    }

    const newCheckIn = new Date(booking.checkIn + "T00:00:00");
    const newCheckOut = new Date(booking.checkOut + "T00:00:00");

    if (newCheckIn >= newCheckOut) {
      return res.status(400).json({
        message: "วันที่เช็คอินต้องไม่อยู่หลังวันที่เช็คเอาท์",
      });
    }

    const existingBooking = await Booking.findOne({ bookingId }).lean();
    if (!existingBooking) {
      return res.status(404).json({ message: "Booking not found" });
    }

    if ((existingBooking.revision || 0) !== expectedRevision) {
      return sendBookingRevisionConflict(res, bookingId);
    }
    if (existingBooking.status !== "booked" || existingBooking.voided) {
      return res.status(409).json({
        error: "BOOKING_LIFECYCLE_CONFLICT",
        message: "แก้ไขข้อมูลหลักได้เฉพาะการจองที่ยังไม่เช็คอิน",
        booking: existingBooking,
      });
    }
    const hasExtensionSegments = (existingBooking.commercialSegments || []).some(
      (segment) => segment.kind === "extension",
    );
    if (
      hasExtensionSegments &&
      (toInputDate(existingBooking.checkIn) !== booking.checkIn ||
        toInputDate(existingBooking.checkOut) !== booking.checkOut ||
        existingBooking.platformId !== booking.platformId)
    ) {
      return res.status(400).json({
        error: "EXTENDED_BOOKING_COMMERCIAL_FIELDS_LOCKED",
        message:
          "Booking ที่เพิ่มคืนแล้วต้องเปลี่ยนวันเข้าพักผ่าน Add Nights และไม่สามารถเปลี่ยนช่องทางเดิมได้",
      });
    }

    const originalRoomStays = [...existingBooking.roomStays].sort(
      (a, b) => new Date(a.from).getTime() - new Date(b.from).getTime(),
    );

    const correctedRoomStays = originalRoomStays.map((roomStay) => ({
      roomIds: getRoomStayRoomIds(roomStay),
      from: toInputDate(roomStay.from),
      to: toInputDate(roomStay.to),
    }));

    correctedRoomStays[0].from = booking.checkIn;
    correctedRoomStays[correctedRoomStays.length - 1].to = booking.checkOut;

    const hasInvalidStay = correctedRoomStays.some(
      (roomStay) => new Date(roomStay.from) >= new Date(roomStay.to),
    );

    if (hasInvalidStay) {
      return res.status(400).json({
        message:
          "วันที่ใหม่ทำให้ช่วงพักเดิมไม่ถูกต้อง กรุณาใช้จัดการช่วงการเข้าพักแทน",
      });
    }

    for (let i = 0; i < correctedRoomStays.length - 1; i++) {
      if (correctedRoomStays[i].to !== correctedRoomStays[i + 1].from) {
        return res.status(400).json({
          message:
            "วันที่ใหม่ทำให้ช่วงพักไม่ต่อเนื่อง กรุณาใช้จัดการช่วงการเข้าพักแทน",
        });
      }
    }

    const roomIds = getUniqueRoomIdsFromRoomStays(correctedRoomStays);
    const invalidEditedRooms = invalidRoomIds(roomIds);
    if (invalidEditedRooms.length > 0) {
      return res.status(400).json({
        error: "INVALID_ROOM_ID",
        message: `ไม่พบห้องที่เปิดใช้งาน: ${invalidEditedRooms.join(", ")}`,
      });
    }

    const editResult = await withRoomMutationLocks(
      correctedRoomStays,
      async () => {
        const conflictingRoomBlock = await findActiveRoomBlockConflict(
          correctedRoomStays,
        );
        if (conflictingRoomBlock) {
          return { hasConflict: true };
        }

        const conflictingBookings = await Booking.find({
          bookingId: { $ne: bookingId },
          ...buildBlockingRoomConflictQuery(
            roomIds,
            newCheckIn,
            newCheckOut,
          ),
        });

        const hasConflict = conflictingBookings.some((conflictingBooking) =>
          conflictingBooking.roomStays.some((existing: roomStay) =>
            correctedRoomStays.some((incoming) =>
              roomStaysConflict(existing, incoming),
            ),
          ),
        );

        if (hasConflict) {
          return { hasConflict };
        }

        const updatedCommercialSegments = (
          existingBooking.commercialSegments || []
        ).map((segment) =>
          segment.kind === "original"
            ? {
                ...segment,
                from: newCheckIn,
                to: hasExtensionSegments ? segment.to : newCheckOut,
                platformId: hasExtensionSegments
                  ? segment.platformId
                  : booking.platformId,
              }
            : segment,
        );
        const updatedTransactions = existingBooking.transactions.map(
          (transaction) =>
            transaction.type === "roomCharge" &&
            transaction.sourceAction !== "EXTEND_BOOKING"
              ? { ...transaction, platformId: booking.platformId }
              : transaction,
        );
        const updatedBooking = await Booking.findOneAndUpdate(
          {
            bookingId,
            status: "booked",
            voided: { $ne: true },
            ...bookingRevisionPredicate(expectedRevision),
          },
          {
            $set: {
              name: booking.name,
              searchNamePrefixes: buildGuestNameSearchPrefixes(booking.name),
              checkIn: newCheckIn,
              checkOut: newCheckOut,
              nights: calculateNights(booking.checkIn, booking.checkOut),
              platformId: booking.platformId,
              note: booking.note || "",
              roomStays: correctedRoomStays,
              commercialSegments: updatedCommercialSegments,
              transactions: updatedTransactions,
            },
            $inc: { revision: 1 },
          },
          { returnDocument: "after", runValidators: true },
        );

        return { updatedBooking };
      },
    );

    if (editResult.hasConflict) {
      return res.status(409).json({
        message: "ห้องถูกจองหรือบล็อกในช่วงวันที่ที่แก้ไข",
      });
    }

    const updatedBooking = editResult.updatedBooking;
    if (!updatedBooking) {
      return sendBookingRevisionConflict(res, bookingId);
    }

    logActivity(
      req.user?.username,
      "EDIT_BOOKING",
      {
        changes: {
          name: { before: existingBooking.name, after: booking.name },
          checkIn: { before: existingBooking.checkIn, after: newCheckIn },
          checkOut: { before: existingBooking.checkOut, after: newCheckOut },
          platformId: {
            before: existingBooking.platformId,
            after: booking.platformId,
          },
          note: {
            before: existingBooking.note || "",
            after: booking.note || "",
          },
          roomStays: {
            before: existingBooking.roomStays,
            after: correctedRoomStays,
          },
        },
      },
      String(bookingId),
    );

    res.status(200).json({
      message: "แก้ไข booking สำเร็จ",
      booking: updatedBooking,
    });
  } catch (err) {
    if (err instanceof RoomMutationConflictError) {
      return res.status(409).json({
        message: "ห้องนี้กำลังถูกแก้ไขโดยผู้ใช้อื่น กรุณาลองอีกครั้ง",
      });
    }

    res.status(500).json({ error: (err as Error).message });
  }
};

export const updateBookingNote = async (
  req: Request<EditBookingParams, {}, UpdateBookingNoteBody>,
  res: Response,
) => {
  try {
    const { bookingId } = req.params;
    const note = typeof req.body.note === "string" ? req.body.note : "";

    if (!bookingId) {
      return res.status(400).json({
        error: "MISSING",
        message: "กรุณากรอก BookingId ใน Params",
      });
    }

    const existingBooking = await Booking.findOne({ bookingId }).lean();

    if (!existingBooking) {
      return res.status(404).json({
        error: "BOOKING_NOT_FOUND",
        message: "ไม่พบ booking นี้",
      });
    }

    const updatedBooking = await Booking.findOneAndUpdate(
      { bookingId },
      { $set: { note } },
      { returnDocument: "after" },
    );

    logActivity(
      req.user?.username,
      "EDIT_BOOKING",
      {
        changes: {
          note: {
            before: existingBooking.note || "",
            after: note,
          },
        },
      },
      String(bookingId),
    );

    res.status(200).json({
      message: "อัปเดต Note สำเร็จ",
      booking: updatedBooking,
    });
  } catch (err) {
    console.log(err);
    res.status(500).json({
      error: "SERVER_ERROR",
      message: "เกิดข้อผิดพลาดในการอัปเดต Note",
    });
  }
};

export const pinBooking = async (
  req: Request<EditBookingParams, {}, PinBookingBody>,
  res: Response,
) => {
  try {
    const { bookingId } = req.params;
    const pinned = Boolean(req.body.pinned);

    if (!bookingId) {
      return res.status(400).json({
        error: "MISSING",
        message: "กรุณากรอก BookingId ใน Params",
      });
    }

    const existingBooking = await Booking.findOne({ bookingId }).lean();

    if (!existingBooking) {
      return res.status(404).json({
        error: "BOOKING_NOT_FOUND",
        message: "ไม่พบ booking นี้",
      });
    }

    const updatedBooking = await Booking.findOneAndUpdate(
      { bookingId },
      { $set: { pinned }, $unset: { starred: "" } },
      { returnDocument: "after", strict: false },
    );

    logActivity(
      req.user?.username,
      "EDIT_BOOKING",
      {
        changes: {
          pinned: {
            before: Boolean(existingBooking.pinned),
            after: pinned,
          },
        },
      },
      String(bookingId),
    );

    res.status(200).json({
      message: pinned ? "ปัก Booking สำเร็จ" : "ยกเลิกปัก Booking สำเร็จ",
      booking: updatedBooking,
    });
  } catch (err) {
    console.log(err);
    res.status(500).json({
      error: "SERVER_ERROR",
      message: "เกิดข้อผิดพลาดในการปัก Booking",
    });
  }
};

export const getTodayBookings = async (req: Request, res: Response) => {
  const { type } = req.params;
  const { start: startOfToday, end: startOfTomorrow } = getBusinessDayBounds();

  try {
    let bookings: booking[] = [];

    switch (type) {
      case "arrivals":
        bookings = await Booking.find({
          status: { $nin: ["cancelled", "noShow"] },
          checkIn: { $gte: startOfToday, $lt: startOfTomorrow },
        });
        break;
      case "departures":
        bookings = await Booking.find({
          status: { $nin: ["cancelled", "noShow"] },
          checkOut: { $gte: startOfToday, $lt: startOfTomorrow },
        });
        break;
      default:
        return res
          .status(400)
          .json({ error: "Please specify the type of query" });
    }

    const occupancy = await getGuestsInHouse();

    res.status(200).json({ bookings, occupancy });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch bookings" });
  }
};

export const getAdminDashboardStats = async (req: Request, res: Response) => {
  if (!req.user?.admin) {
    return res.status(403).json({
      message: "เฉพาะผู้ดูแลระบบเท่านั้นที่สามารถดูสถิตินี้ได้",
    });
  }

  const today = new Date();
  const { end: startOfTomorrow } = getBusinessDayBounds(today);
  const selectedMonthBounds = getBusinessMonthBoundsFromKey(
    req.query.month,
    today,
  );
  if (!selectedMonthBounds) {
    return res.status(400).json({
      message: "Invalid month format. Use YYYY-MM.",
    });
  }
  const {
    start: startOfMonth,
    end: startOfNextMonth,
    monthKey: selectedMonth,
  } = selectedMonthBounds;
  const currentMonthBounds = getBusinessMonthBounds(today);
  const selectedMonthIsCurrent =
    startOfMonth.getTime() === currentMonthBounds.start.getTime();
  const chartAnchorDate = selectedMonthIsCurrent
    ? today
    : new Date(startOfNextMonth.getTime() - 86400000);
  const chartPeriodEnd = selectedMonthIsCurrent
    ? startOfTomorrow
    : startOfNextMonth;
  const revenueRange = normalizeRevenueChartRange(req.query.revenueRange);
  const { start: chartStart, end: chartEnd } = getRevenueChartBounds(
    chartAnchorDate,
    revenueRange,
    startOfMonth,
    chartPeriodEnd,
  );
  const occupancyQueryStart = new Date(
    Math.min(chartStart.getTime(), startOfMonth.getTime()),
  );
  const occupancyQueryEnd = new Date(
    Math.max(chartEnd.getTime(), startOfNextMonth.getTime()),
  );

  try {
    const [
      monthFinancialBookings,
      monthStandaloneSales,
      esrBookings,
      occupancyBookings,
      internalUseBlocks,
      monthBookings,
      channelMixBookings,
      unpaidBookings,
    ] = await Promise.all([
        Booking.find({
          "transactions.createdAt": { $gte: startOfMonth, $lt: startOfNextMonth },
        }),
        StandaloneSale.find({
          "transactions.createdAt": { $gte: startOfMonth, $lt: startOfNextMonth },
        }),
        Booking.find(
          expectedStayRevenueBookingQuery(startOfMonth, startOfNextMonth),
        ).lean<booking[]>(),
        Booking.find({
          roomStays: {
            $elemMatch: {
              from: { $lt: occupancyQueryEnd },
              to: { $gt: occupancyQueryStart },
            },
          },
        }),
        RoomBlock.find({
          from: { $lt: occupancyQueryEnd },
          to: { $gt: occupancyQueryStart },
          $or: [
            { reasonType: "house_use" },
            {
              reasonType: { $exists: false },
              reason: HOUSE_USE_ROOM_BLOCK_REASON,
            },
          ],
        })
          .select("roomId roomIds from to reason reasonType releasedAt")
          .lean(),
        Booking.find({
          checkIn: { $gte: startOfMonth, $lt: startOfNextMonth },
        }),
        Booking.find({
          checkIn: { $lt: startOfNextMonth },
          checkOut: { $gt: startOfMonth },
        }),
        Booking.find({
          status: { $ne: "checkedOut" },
          $or: [
            {
              transactions: {
                $elemMatch: {
                  type: "roomCharge",
                  paymentMethod: "Unpaid",
                },
              },
            },
            { "transactionCorrections.after.paymentMethod": "Unpaid" },
          ],
        }),
      ]);

    const transactionsInRange = (
      bookings: Array<{
        transactions: transcation[];
        _id?: unknown;
        saleId?: string;
      }>,
      start: Date,
      end: Date,
    ) =>
      bookings.flatMap((booking) => {
        const bookingTransactions = "transactionCorrections" in booking
          ? withEffectiveTransactions(booking as booking).transactions
          : booking.transactions || [];
        return bookingTransactions
          .filter((transaction) => {
            if (!transaction.createdAt) return false;
            const transactionDate = new Date(transaction.createdAt);
            return transactionDate >= start && transactionDate < end;
          })
          .map((transaction) => ({
            transaction,
            bookingTransactions,
            bookingId: booking.saleId || String(booking._id),
          }));
      });
    const monthFinancialTransactions = transactionsInRange(
      [...monthFinancialBookings, ...monthStandaloneSales],
      startOfMonth,
      startOfNextMonth,
    );
    const esrSummary = summarizeExpectedStayRevenue(
      [
        ...(esrBookings as booking[]),
        ...monthStandaloneSales.map(
          (sale) =>
            ({
              bookingId: sale.saleId,
              name: sale.customerName || "ลูกค้าทั่วไป",
              platformId: "WALK",
              checkIn: new Date(0),
              checkOut: new Date(0),
              status: "checkedOut",
              transactions: sale.transactions || [],
              staffUsername: sale.createdBy,
              sourceType: "standaloneSale",
              saleId: sale.saleId,
            }) as unknown as booking,
        ),
      ],
      startOfMonth,
      startOfNextMonth,
    );
    const monthlyGrossRevenue = esrSummary.expectedStayRevenue;
    const monthlyCollectedRevenue = esrSummary.collectedRevenue;
    const unpaidAmount = unpaidBookings.reduce(
      (sum, booking) => sum + unpaidRoomChargeAmount(booking),
      0,
    );

    const channelSummary = summarizeChannelMix(channelMixBookings, startOfMonth, startOfNextMonth);
    const revenueByDate = new Map<
      string,
      {
        grossRevenue: number;
        collectedRevenue: number;
        occupancyRate: number;
        occupiedCapacity: number;
      }
    >();
    const revenueBucketSize = getRevenueChartBucketSize(revenueRange);
    const revenueBuckets: Array<{
      key: string;
      start: Date;
      end: Date;
    }> = [];
    const monthFinancialSummary = summarizeTransactions(
      monthFinancialTransactions.map(({ transaction }) => transaction),
    );
    const esrByDate = new Map<
      string,
      { grossRevenue: number; collectedRevenue: number }
    >();

    for (
      let date = startOfMonth;
      date < startOfNextMonth;
      date = new Date(date.getTime() + 86400000)
    ) {
      esrByDate.set(formatLocalDateKey(date), {
        grossRevenue: 0,
        collectedRevenue: 0,
      });
    }

    esrSummary.entries.forEach((entry) => {
      const dateKey = formatLocalDateKey(entry.start);
      const current = esrByDate.get(dateKey);
      if (!current) return;

      current.grossRevenue += entry.expectedRevenue;
      current.collectedRevenue += entry.collectedRevenue;
    });
    esrSummary.serviceEntries.forEach((entry) => {
      const dateKey = formatLocalDateKey(entry.start);
      const current = esrByDate.get(dateKey);
      if (!current) return;

      current.grossRevenue += entry.expectedRevenue;
      current.collectedRevenue += entry.collectedRevenue;
    });

    for (
      let date = getRevenueBucketStart(chartStart, revenueBucketSize);
      date < chartEnd;
      date = nextRevenueBucketStart(date, revenueBucketSize)
    ) {
      const nextBucketStart = nextRevenueBucketStart(date, revenueBucketSize);
      const key = formatLocalDateKey(date);
      revenueBuckets.push({
        key,
        start: date,
        end: nextBucketStart < chartEnd ? nextBucketStart : chartEnd,
      });
      revenueByDate.set(key, {
        grossRevenue: 0,
        collectedRevenue: 0,
        occupancyRate: 0,
        occupiedCapacity: 0,
      });
    }

    const wholeMonthOccupancy = occupancySummaryForRange(
      occupancyBookings,
      startOfMonth,
      startOfNextMonth,
      internalUseBlocks,
    );
    const selectedRangeOccupancy = occupancySummaryForRange(
      occupancyBookings,
      chartStart,
      chartEnd,
      internalUseBlocks,
    );

    revenueBuckets.forEach((bucket) => {
      const bucketRevenue = revenueByDate.get(bucket.key);
      if (!bucketRevenue) return;

      const bucketOccupancy = occupancySummaryForRange(
        occupancyBookings,
        bucket.start < chartStart ? chartStart : bucket.start,
        bucket.end,
        internalUseBlocks,
      );
      bucketRevenue.occupiedCapacity =
        bucketOccupancy.averageOccupiedCapacity;
      bucketRevenue.occupancyRate = bucketOccupancy.occupancyRate;
    });

    const channelMix = channelSummary.channels;
    const revenueSeries = Array.from(revenueByDate.entries()).map(
      ([date, revenue]) => ({
        date,
        grossRevenue: revenue.grossRevenue,
        collectedRevenue: revenue.collectedRevenue,
        occupancyRate: revenue.occupancyRate,
        occupiedCapacity: revenue.occupiedCapacity,
      }),
    );
    const esrSeries = Array.from(esrByDate.entries()).map(
      ([date, revenue]) => ({
        date,
        grossRevenue: Number(revenue.grossRevenue.toFixed(2)),
        collectedRevenue: Number(revenue.collectedRevenue.toFixed(2)),
      }),
    );

    res.status(200).json({
      selectedMonth,
      monthlyGrossRevenue,
      monthlyCollectedRevenue,
      monthRoomRevenue: monthlyGrossRevenue,
      monthBookings: monthBookings.length,
      unpaidAmount,
      financialSummary: monthFinancialSummary,
      occupancyRate: wholeMonthOccupancy.occupancyRate,
      rangeOccupancyRate: selectedRangeOccupancy.occupancyRate,
      channelMix,
      channelMixTotal: channelSummary.total,
      channelMixUnit: channelSummary.unit,
      revenueRange,
      revenueSeries,
      esrSeries,
    });
  } catch (err) {
    console.error("Failed to fetch admin dashboard stats", err);
    res.status(500).json({ error: "Failed to fetch admin dashboard stats" });
  }
};

const escapeRegex = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const DEFAULT_MASTER_BOOKINGS_PAGE_SIZE = 75;
const MAX_MASTER_BOOKINGS_PAGE_SIZE = 200;
const MAX_GLOBAL_MASTER_SEARCH_PAGE_SIZE = 50;
const MIN_GLOBAL_MASTER_SEARCH_LENGTH = 3;

export const getMasterBookings = async (req: Request, res: Response) => {
  const {
    from,
    to,
    search,
    name,
    bookingId,
    room,
    channel,
    status,
    page,
    limit,
  } = req.query;
  const searchTerm =
    typeof search === "string" ? normalizeBookingSearchText(search) : "";
  const hasSearch = searchTerm.length >= MIN_GLOBAL_MASTER_SEARCH_LENGTH;
  const hasAnyDate = Boolean(from || to);
  const hasDateRange = Boolean(from && to);

  if (searchTerm && !hasSearch) {
    return res.status(400).json({
      message: `กรุณาพิมพ์อย่างน้อย ${MIN_GLOBAL_MASTER_SEARCH_LENGTH} ตัวอักษรเพื่อค้นหาทุกช่วงเวลา`,
    });
  }

  if (!hasSearch && !hasDateRange) {
    return res.status(400).json({
      message: "Please specify from and to dates",
    });
  }

  if (hasAnyDate && !hasDateRange) {
    return res.status(400).json({
      message: "Please specify both from and to dates",
    });
  }

  const fromDate = hasDateRange
    ? new Date(`${from as string}T00:00:00`)
    : null;
  const toDate = hasDateRange ? new Date(`${to as string}T00:00:00`) : null;
  if (
    (fromDate && Number.isNaN(fromDate.getTime())) ||
    (toDate && Number.isNaN(toDate.getTime()))
  ) {
    return res.status(400).json({ message: "Invalid date range" });
  }
  if (fromDate && toDate && fromDate > toDate) {
    return res.status(400).json({
      message: "วันที่เริ่มต้นต้องไม่อยู่หลังวันที่สิ้นสุด",
    });
  }

  const endOfToDate = toDate ? new Date(toDate) : null;
  endOfToDate?.setDate(endOfToDate.getDate() + 1);
  const parsedPage = Number(page);
  const parsedLimit = Number(limit);
  const currentPage =
    Number.isInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1;
  const maximumPageSize = hasSearch
    ? MAX_GLOBAL_MASTER_SEARCH_PAGE_SIZE
    : MAX_MASTER_BOOKINGS_PAGE_SIZE;
  const pageSize =
    Number.isInteger(parsedLimit) && parsedLimit > 0
      ? Math.min(parsedLimit, maximumPageSize)
      : Math.min(DEFAULT_MASTER_BOOKINGS_PAGE_SIZE, maximumPageSize);

  try {
    const query: Record<string, unknown> = {};
    const andFilters: Record<string, unknown>[] = [];

    if (fromDate && endOfToDate) {
      query.checkIn = { $lt: endOfToDate };
      query.checkOut = { $gt: fromDate };
    }

    if (hasSearch) {
      andFilters.push({
        $or: [
          { searchBookingIds: searchTerm },
          { searchBookingIdPrefixes: searchTerm },
          { searchNamePrefixes: searchTerm },
        ],
      });
    }

    if (typeof name === "string" && name.trim()) {
      query.name = { $regex: escapeRegex(name.trim()), $options: "i" };
    }

    if (typeof bookingId === "string" && bookingId.trim()) {
      const bookingIdPattern = {
        $regex: escapeRegex(bookingId.trim()),
        $options: "i",
      };
      andFilters.push({
        $or: [
          { bookingId: bookingIdPattern },
          { "commercialSegments.channelBookingId": bookingIdPattern },
        ],
      });
    }

    if (typeof room === "string" && room.trim()) {
      andFilters.push({
        $or: [
          { "roomStays.roomIds": room.trim() },
          { "roomStays.roomId": room.trim() },
        ],
      });
    }

    if (typeof channel === "string" && channel.trim()) {
      if (fromDate && endOfToDate) {
        andFilters.push({
          $or: [
            {
              commercialSegments: {
                $elemMatch: {
                  platformId: channel.trim(),
                  from: { $lt: endOfToDate },
                  to: { $gt: fromDate },
                },
              },
            },
            {
              platformId: channel.trim(),
              commercialSegments: { $size: 0 },
            },
          ],
        });
      } else {
        andFilters.push({
          $or: [
            { platformId: channel.trim() },
            { "commercialSegments.platformId": channel.trim() },
          ],
        });
      }
    }

    if (
      typeof status === "string" &&
      status.trim() &&
      BOOKING_STATUSES.includes(status.trim() as Status)
    ) {
      query.status = status.trim();
    }
    if (andFilters.length > 0) query.$and = andFilters;

    const bookingPage = await Booking.find(query)
      .sort(
        hasSearch && !hasDateRange
          ? { checkIn: -1, checkOut: -1, name: 1, _id: -1 }
          : { checkIn: 1, checkOut: 1, name: 1, _id: 1 },
      )
      .skip((currentPage - 1) * pageSize)
      .limit(pageSize + 1)
      .maxTimeMS(2000);
    const hasMore = bookingPage.length > pageSize;
    const bookings = hasMore ? bookingPage.slice(0, pageSize) : bookingPage;

    res.status(200).json({
      bookings,
      scope: hasDateRange ? "range" : "all_dates",
      pagination: {
        page: currentPage,
        pageSize,
        hasMore,
      },
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch bookings" });
  }
};

// export const getTodayDepartureBookings = async (
//   req: Request,
//   res: Response,
// ) => {
//   const now = new Date();
//   const startOfToday = new Date(now);
//   startOfToday.setHours(0, 0, 0, 0);

//   const startOfTomorrow = new Date(startOfToday);
//   startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);

//   try {
//     const bookings = await Booking.find({
//       checkOut: { $gte: startOfToday, $lt: startOfTomorrow },
//     });
//     res.status(200).json({ bookings });
//   } catch (err) {
//     res.status(500).json({ error: "Failed to fetch bookings" });
//   }
// };

export const removeBooking = async (req: Request, res: Response) => {
  const { bookingId } = req.params;

  try {
    if (!req.user?.admin) {
      return res.status(403).json({
        message: "เฉพาะผู้ดูแลระบบเท่านั้นที่สามารถ void การจองได้",
      });
    }

    const reason = String(req.body?.reason || "").trim();
    const expectedRevision = expectedBookingRevision(req.body?.expectedRevision);
    if (!reason) {
      return res.status(400).json({
        error: "VOID_REASON_REQUIRED",
        message: "กรุณาระบุเหตุผลที่ void การจอง",
      });
    }
    if (expectedRevision === null) {
      return res.status(400).json({
        error: "EXPECTED_REVISION_REQUIRED",
        message: "กรุณารีเฟรชข้อมูลการจองก่อน void",
      });
    }

    const booking = await Booking.findOne({ bookingId });

    if (!booking)
      return res.status(404).json({
        message: "ไม่พบ booking นี้",
      });

    if ((booking.revision || 0) !== expectedRevision) {
      return sendBookingRevisionConflict(res, bookingId);
    }
    if (booking.status !== "booked" || booking.voided) {
      return res.status(409).json({
        error: "BOOKING_LIFECYCLE_CONFLICT",
        message: "void ได้เฉพาะ booking ที่ยังไม่ได้ check-in และยังไม่ถูก void",
        booking,
      });
    }

    const voidedBooking = await withMutationIdempotency(req, () =>
      Booking.findOneAndUpdate(
        {
          bookingId,
          status: "booked",
          voided: { $ne: true },
          ...bookingRevisionPredicate(expectedRevision),
        },
        {
          $set: {
            status: "cancelled",
            voided: true,
            voidedAt: new Date(),
            voidedBy: req.user?.username,
            voidReason: reason,
          },
          $inc: { revision: 1 },
        },
        { returnDocument: "after", runValidators: true },
      ),
    );

    if (!voidedBooking) return sendBookingRevisionConflict(res, bookingId);

    res.status(200).json({
      booking: voidedBooking,
      message: `Voided bookingId: ${bookingId}`,
    });

    logActivity(req.user?.username, "REMOVE_BOOKING", {
      snapshot: {
        name: voidedBooking.name,
        checkIn: voidedBooking.checkIn,
        checkOut: voidedBooking.checkOut,
        platformId: voidedBooking.platformId,
        roomIds: getRoomStayRoomIds(voidedBooking.roomStays?.[0] || {}),
        bookingId: voidedBooking.bookingId,
        transactionCount: voidedBooking.transactions.length,
        voidedBy: req.user?.username,
        voidReason: reason,
      },
    });
  } catch (err) {
    if (err instanceof IdempotencyConflictError) {
      return sendDuplicateMutationResponse(res);
    }

    res.status(400).json({ error: "Deletion Unsuccessful" });
  }
};

type checkInData = {
  expectedRevision: number;
  deposit: number;
  adminHistoricalCheckIn?: boolean;
  unpaidPayment?: {
    paymentMethod: PaymentMethod;
    roundingAdjustment?: number;
  };
  passportData: {
    namePrefix: NamePrefix;
    passportNo: string;
    passportName: string;
    nationality: string;
    nextDestinationCountry: string;
  };
};

export const checkIn = async (req: Request, res: Response) => {
  try {
    const { bookingId } = req.params;
    const checkInData: checkInData = req.body;
    const adminHistoricalCheckIn = checkInData.adminHistoricalCheckIn === true;
    const expectedRevision = expectedBookingRevision(
      checkInData.expectedRevision,
    );

    if (expectedRevision === null) {
      return res.status(400).json({
        error: "EXPECTED_REVISION_REQUIRED",
        message: "กรุณารีเฟรชข้อมูลการจองก่อน check-in",
      });
    }

    if (!bookingId)
      return res.status(400).json({
        message: "กรุณาแนบข้อมูล bookingId เพื่อดำเนินการ check-in",
      });

    if (adminHistoricalCheckIn && !req.user?.admin) {
      return res.status(403).json({
        error: "ADMIN_REQUIRED",
        message: "เฉพาะ Admin เท่านั้นที่สามารถใช้ Historical Check-In ได้",
      });
    }

    if (
      !checkInData.passportData?.namePrefix ||
      !checkInData.passportData?.nationality ||
      !checkInData.passportData?.nextDestinationCountry ||
      !checkInData.passportData?.passportNo ||
      !checkInData.passportData?.passportName ||
      checkInData.deposit == null
    ) {
      return res.status(400).json({
        message: "กรุณากรอกข้อมูลให้ครบทุกช่อง",
      });
    }

    validatePassportData(checkInData.passportData);

    const depositAmount = Number(checkInData.deposit);

    if (!Number.isFinite(depositAmount) || depositAmount < 0) {
      return res.status(400).json({
        message: "ยอดมัดจำต้องไม่ติดลบ",
      });
    }

    const existingBooking = await Booking.findOne({ bookingId });

    if (!existingBooking) {
      return res.status(404).json({
        message: "ไม่พบ booking นี้",
      });
    }

    if ((existingBooking.revision || 0) !== expectedRevision) {
      return sendBookingRevisionConflict(res, bookingId);
    }
    if (existingBooking.voided) {
      return res.status(409).json({
        error: "BOOKING_LIFECYCLE_CONFLICT",
        message: "ไม่สามารถ check-in การจองที่ถูก void",
        booking: existingBooking,
      });
    }

    if (existingBooking.status !== "booked") {
      return res.status(409).json({
        message: "booking นี้ไม่สามารถ check-in ซ้ำได้",
      });
    }

    const { start: todayStart } = getBusinessDayBounds();
    const checkInDateStart = getBookingBusinessDateStart(
      existingBooking.checkIn,
    );
    const checkOutDateStart = getBookingBusinessDateStart(
      existingBooking.checkOut,
    );

    if (adminHistoricalCheckIn && todayStart <= checkInDateStart) {
      return res.status(409).json({
        error: "HISTORICAL_CHECK_IN_NOT_APPLICABLE",
        message: "Historical Check-In ใช้ได้เฉพาะ booking ที่เลยวันเช็คอินแล้ว",
      });
    }

    if (!adminHistoricalCheckIn && todayStart < checkInDateStart) {
      return res.status(409).json({
        message: "ยังไม่ถึงวันเช็คอินของ booking นี้",
      });
    }

    if (!adminHistoricalCheckIn && todayStart > checkOutDateStart) {
      return res.status(409).json({
        message:
          "booking นี้เลยวันเช็คเอาท์แล้ว กรุณาแก้ไขวันที่หรือยกเลิกก่อน check-in",
      });
    }

    const effectiveExistingTransactions =
      effectiveBookingTransactions(existingBooking);
    const existingDepositAmount = bookingRemainingDepositAmount(
      effectiveExistingTransactions,
    );

    const unpaidRoomCharge = effectiveExistingTransactions.find(
      (transaction) =>
        transaction.type === "roomCharge" &&
        transaction.paymentMethod === "Unpaid",
    );
    const outstandingRoomChargeAmount = unpaidRoomChargeAmount(existingBooking);
    const hasOutstandingRoomCharge = outstandingRoomChargeAmount > 0;

    if (hasOutstandingRoomCharge && !checkInData.unpaidPayment) {
      return res.status(400).json({
        message: "กรุณาระบุช่องทางการจ่ายค่าห้อง",
      });
    }

    if (
      checkInData.unpaidPayment &&
      !CHECK_IN_PAYMENT_METHODS.includes(
        checkInData.unpaidPayment.paymentMethod,
      )
    ) {
      return res.status(400).json({
        message: "ช่องทางการจ่ายค่าห้องไม่ถูกต้อง",
      });
    }

    if (checkInData.unpaidPayment && !hasOutstandingRoomCharge) {
      return res.status(400).json({
        message: "booking นี้ไม่มีค่าห้องค้างชำระ",
      });
    }

    const encryptedPassportData = validateAndEncryptPassportData(
      checkInData.passportData,
    );
    const newTransactions: transcation[] = [];

    // A few legacy bookings received their deposit through Add Transaction
    // before check-in. Reuse that outstanding liability instead of blocking the
    // stay or collecting the same deposit twice.
    if (existingDepositAmount <= 0) {
      newTransactions.push(
        normalizeTransaction(
          {
            type: "deposit",
            paymentMethod: "Cash",
            amount: depositAmount,
          },
          {
            createdBy: req.user?.username,
            sourceAction: "CHECK_IN",
          },
        ),
      );
    }

    const roundingAdjustment = Number(
      checkInData.unpaidPayment?.roundingAdjustment || 0,
    );

    if (!Number.isFinite(roundingAdjustment) || roundingAdjustment < 0) {
      return res.status(400).json({
        message: "ยอดปรับเศษเงินไม่ถูกต้อง",
      });
    }

    if (
      roundingAdjustment > 0 &&
      checkInData.unpaidPayment?.paymentMethod !== "Cash"
    ) {
      return res.status(400).json({
        message: "ปรับเศษเงินได้เฉพาะการรับเงินสด",
      });
    }

    if (roundingAdjustment)
      newTransactions.push(
        normalizeTransaction(
          {
            type: "adjustment",
            paymentMethod: checkInData.unpaidPayment!.paymentMethod,
            amount: roundingAdjustment,
            reasonOfAdjustment: "rounding",
          },
          {
            createdBy: req.user?.username,
            sourceAction: "CHECK_IN",
            note: "Rounding adjustment at check-in",
          },
        ),
      );

    if (
      checkInData.unpaidPayment &&
      unpaidRoomCharge &&
      hasOutstandingRoomCharge
    ) {
      newTransactions.push(
        ...buildTransactionsWithCardSurcharge(
          {
            type: "settlementCharge",
            paymentMethod: checkInData.unpaidPayment.paymentMethod,
            relatedTransactionType: "roomCharge",
            relatedTransactionId: String(unpaidRoomCharge._id),
            amount: outstandingRoomChargeAmount,
          },
          {
            createdBy: req.user?.username,
            sourceAction: "CHECK_IN",
            note: "Unpaid room charge settled at check-in",
            cardSurchargeBaseAmount:
              outstandingRoomChargeAmount + roundingAdjustment,
          },
        ),
      );
    }

    if (adminHistoricalCheckIn) {
      newTransactions.forEach((transaction) => {
        transaction.createdAt = existingBooking.checkIn;
        delete transaction.cashShiftId;
        transaction.note = transaction.note
          ? `${transaction.note} · Historical onboarding before production`
          : "Historical onboarding before production";
      });
    }

    const checkedInAt = adminHistoricalCheckIn
      ? existingBooking.checkIn
      : new Date();
    const setFields: Record<string, unknown> = {
      status: "checkedIn",
      checkInByStaffUsername: req.user?.username,
      checkedInAt,
      checkInMode: adminHistoricalCheckIn
        ? "admin_historical_onboarding"
        : "normal",
      passport: encryptedPassportData,
    };

    const updateQuery: Record<string, unknown> = {
      bookingId,
      status: "booked",
      voided: { $ne: true },
      ...bookingRevisionPredicate(expectedRevision),
    };
    if (
      checkInData.unpaidPayment &&
      unpaidRoomCharge &&
      hasOutstandingRoomCharge
    ) {
      updateQuery.transactions = {
        $elemMatch: {
          paymentMethod: "Unpaid",
          type: "roomCharge",
        },
      };
    } else if (checkInData.unpaidPayment) {
      updateQuery.transactions = {
        $elemMatch: {
          paymentMethod: "Unpaid",
          type: "roomCharge",
        },
      };
    }

    const persistCheckIn = (
      assignedTransactions: transcation[],
      session?: mongoose.ClientSession,
    ) =>
      Booking.findOneAndUpdate(
        updateQuery,
        {
          $push: {
            transactions: {
              $each: assignedTransactions,
            },
          },
          $set: setFields,
          $inc: { revision: 1 },
        },
        { returnDocument: "after", session, runValidators: true },
      );

    const updatedBooking = await withMutationIdempotency(req, () =>
      adminHistoricalCheckIn
        ? persistCheckIn(newTransactions)
        : withCashLedgerTransaction(newTransactions, persistCheckIn),
    );

    if (!updatedBooking) {
      return sendBookingRevisionConflict(
        res,
        bookingId,
        "สถานะการจองเปลี่ยนไปแล้ว กรุณารีเฟรชก่อน check-in",
      );
    }

    const sanitizedBooking = updatedBooking?.toObject();

    if (sanitizedBooking?.passport) {
      delete sanitizedBooking.passport.passportHash;
      delete sanitizedBooking.passport.passportNo;
      delete sanitizedBooking.passport.passportName;
    }

    res.status(200).json(sanitizedBooking);

    logActivity(
      req.user?.username,
      "CHECK_IN",
      {
        snapshot: buildActivityBookingSnapshot(existingBooking),
        changes: {
          status: { before: "booked", after: "checkedIn" },
          checkInByStaffUsername: {
            before: existingBooking.checkInByStaffUsername,
            after: req.user?.username,
          },
          checkedInAt: {
            before: existingBooking.checkedInAt,
            after: checkedInAt,
          },
          checkInMode: {
            before: existingBooking.checkInMode,
            after: adminHistoricalCheckIn
              ? "admin_historical_onboarding"
              : "normal",
          },
        },
        summary: {
          adminHistoricalCheckIn,
          financialTransactionDate: adminHistoricalCheckIn
            ? existingBooking.checkIn
            : checkedInAt,
        },
      },
      String(bookingId),
    );
  } catch (err) {
    if (err instanceof PassportDataError) {
      return res.status(err.status).json({ message: err.message });
    }
    if (err instanceof CashShiftLedgerConflictError) {
      return res.status(409).json({ error: err.code, message: err.message });
    }
    if (err instanceof IdempotencyConflictError) {
      return sendDuplicateMutationResponse(res);
    }

    res.status(400).json({ error: (err as Error).message });
  }
};

export const checkOut = async (req: Request, res: Response) => {
  try {
    const { bookingId } = req.params;
    const { depositReturned, releaseRemainingNights = true } = req.body;
    const expectedRevision = expectedBookingRevision(req.body.expectedRevision);
    const checkedOutByStaffUsername = req.user?.username;

    if (expectedRevision === null) {
      return res.status(400).json({
        error: "EXPECTED_REVISION_REQUIRED",
        message: "กรุณารีเฟรชข้อมูลการจองก่อน check-out",
      });
    }

    if (!bookingId)
      return res.status(400).json({
        message: "กรุณาแนบข้อมูล bookingId เพื่อดำเนินการ check-out",
      });

    if (typeof releaseRemainingNights !== "boolean") {
      return res.status(400).json({
        error: "INVALID_PAYLOAD",
        message: "กรุณาระบุสถานะห้องหลัง check-out ให้ถูกต้อง",
      });
    }

    if (!checkedOutByStaffUsername) {
      return res.status(401).json({
        error: "NOT_AUTHORIZED",
        message: "กรุณาเข้าสู่ระบบใหม่",
      });
    }

    const existingBooking = await Booking.findOne({ bookingId });

    if (!existingBooking) {
      return res.status(404).json({
        message: "ไม่พบ booking นี้",
      });
    }

    if ((existingBooking.revision || 0) !== expectedRevision) {
      return sendBookingRevisionConflict(res, bookingId);
    }

    if (existingBooking.status !== "checkedIn") {
      return res.status(409).json({
        message: "สามารถ check-out ได้เฉพาะ booking ที่ check-in แล้ว",
      });
    }

    const remainingDepositAmount = bookingRemainingDepositAmount(
      effectiveBookingTransactions(existingBooking),
    );

    if (remainingDepositAmount > 0 && depositReturned !== true) {
      return res.status(400).json({
        error: "DEPOSIT_RETURN_CONFIRMATION_REQUIRED",
        message: `กรุณายืนยันว่าคืนมัดจำ ${remainingDepositAmount} บาทให้แขกแล้ว`,
      });
    }

    const { start: todayStart } = getBusinessDayBounds();
    const checkOutParts = getBusinessDateParts(existingBooking.checkOut);
    const checkoutDateStart = getBusinessDateStart(
      checkOutParts.year,
      checkOutParts.month,
      checkOutParts.day,
    );
    const nightsEarly = Math.max(
      Math.round(
        (checkoutDateStart.getTime() - todayStart.getTime()) / 86400000,
      ),
      0,
    );
    const earlyCheckOut = nightsEarly > 0;
    const roomReleaseStatus =
      earlyCheckOut && !releaseRemainingNights ? "blocked" : "released";
    const depositTransactionsToRecord: transcation[] =
      remainingDepositAmount > 0
        ? [
            normalizeTransaction(
              {
                type: "depositRefund",
                paymentMethod: "Cash",
                amount: remainingDepositAmount,
              },
              {
                createdBy: checkedOutByStaffUsername,
                sourceAction: "CHECK_OUT",
              },
            ),
          ]
        : [];

    const updatedBooking = await withMutationIdempotency(req, () =>
      withCashLedgerTransaction(
        depositTransactionsToRecord,
        (assignedTransactions, session) =>
          Booking.findOneAndUpdate(
            {
              bookingId,
              status: "checkedIn",
              voided: { $ne: true },
              ...bookingRevisionPredicate(expectedRevision),
            },
            {
              $set: {
                status: "checkedOut",
                checkout: {
                  roomReleaseStatus,
                  depositRefundAmount: remainingDepositAmount,
                  depositDisposition: "returned",
                  checkedOutAt: new Date(),
                  checkedOutByStaffUsername,
                  earlyCheckOut,
                  nightsEarly,
                },
              },
              ...(assignedTransactions.length > 0
                ? {
                    $push: {
                      transactions: {
                        $each: assignedTransactions,
                      },
                    },
                  }
                : {}),
              $inc: { revision: 1 },
            },
            { returnDocument: "after", session, runValidators: true },
          ),
      ),
    );

    if (!updatedBooking) {
      return sendBookingRevisionConflict(
        res,
        bookingId,
        "สถานะการจองเปลี่ยนไปแล้ว กรุณารีเฟรชก่อน check-out",
      );
    }

    res.status(200).json({
      message: "Check-out สำเร็จ",
      booking: updatedBooking,
    });

    logActivity(
      req.user?.username,
      "CHECK_OUT",
      {
        snapshot: buildActivityBookingSnapshot(existingBooking),
        changes: {
          status: { before: "checkedIn", after: "checkedOut" },
          transactions: {
            before: existingBooking.transactions,
            after: updatedBooking.transactions,
          },
        },
        summary: {
          depositRefundAmount: remainingDepositAmount,
          depositDisposition: "returned",
          roomReleaseStatus,
          earlyCheckOut,
          nightsEarly,
        },
      },
      String(bookingId),
    );
  } catch (err) {
    if (err instanceof CashShiftLedgerConflictError) {
      return res.status(409).json({ error: err.code, message: err.message });
    }
    if (err instanceof IdempotencyConflictError) {
      return sendDuplicateMutationResponse(res);
    }

    res.status(500).json({ error: (err as Error).message });
  }
};

type CalendarBooking = {
  name: string;
  from: Date;
  to: Date;
  bookingId: string;
  platformId: PlatformId;
  status: Status;
  isUnpaid: boolean;
};

type Room = {
  roomId: string;
  bookings: CalendarBooking[];
  blocks: {
    blockId: string;
    roomId: string;
    roomIds: string[];
    from: Date;
    to: Date;
    reason: string;
    createdBy: string;
    createdAt: Date;
  }[];
  extraSaleAnnotations: {
    annotationId: string;
    roomId: string;
    roomIds: string[];
    from: Date;
    to: Date;
    kind: string;
    customReason: string;
    note: string;
    createdBy: string;
    createdAt: Date;
    updatedBy?: string;
    updatedAt?: Date;
  }[];
};

export const getMonthCalendar = async (req: Request, res: Response) => {
  try {
    let { year, month } = req.query;
    const today = new Date();

    const parsedYear = year ? parseInt(year as string) : today.getFullYear();
    const parsedMonth = month ? parseInt(month as string) : today.getMonth();

    const startingDate = new Date(parsedYear, parsedMonth, 1); // 1st day of the month
    const endingDate = new Date(parsedYear, parsedMonth + 1, 1); // 1st day of next month

    const monthOfBookings = await Booking.find({
      $or: [...ROOM_BLOCKING_BOOKING_FILTER.$or, { status: "checkedOut" }],
      checkIn: { $lt: endingDate },
      checkOut: { $gt: startingDate },
    });

    const rooms: Room[] = activeRoomInventory().map((room) => ({
      roomId: room.id,
      bookings: [],
      blocks: [],
      extraSaleAnnotations: [],
    }));

    const annotations = await ExtraSaleAnnotation.find({
      removedAt: { $exists: false },
      from: { $lt: endingDate },
      to: { $gt: startingDate },
    }).lean();
    annotations.forEach((annotation) => {
      annotation.roomIds.forEach((roomId) => {
        rooms.find((room) => room.roomId === roomId)?.extraSaleAnnotations.push({
          annotationId: String(annotation._id),
          roomId,
          roomIds: annotation.roomIds,
          from: annotation.from,
          to: annotation.to,
          kind: annotation.kind || "EXTRA_SALE",
          customReason: annotation.customReason || "",
          note: annotation.note || "",
          createdBy: annotation.createdBy,
          createdAt: annotation.createdAt,
          updatedBy: annotation.updatedBy,
          updatedAt: annotation.updatedAt,
        });
      });
    });

    const activeRoomBlocks = await RoomBlock.find({
      releasedAt: { $exists: false },
      from: { $lt: endingDate },
      to: { $gt: startingDate },
    }).lean();

    activeRoomBlocks.forEach((block) => {
      const blockRoomIds = getRoomStayRoomIds(block);
      blockRoomIds.forEach((roomId) => {
        const room = rooms.find((item) => item.roomId === roomId);
        room?.blocks.push({
          blockId: String(block._id),
          roomId,
          roomIds: blockRoomIds,
          from: block.from,
          to: block.to,
          reason: block.reason,
          createdBy: block.createdBy,
          createdAt: block.createdAt,
        });
      });
    });

    monthOfBookings.forEach((booking) => {
      const effectiveTransactions = effectiveBookingTransactions(booking);
      const roomCharge = effectiveTransactions.find(
        (transaction) => transaction.type === "roomCharge",
      );
      const hasRoomChargeSettlement = roomCharge
        ? effectiveTransactions.some(
            (transaction) =>
              transaction.type === "settlementCharge" &&
              transaction.relatedTransactionType === "roomCharge" &&
              transaction.relatedTransactionId === String(roomCharge._id) &&
              transaction.paymentMethod !== "Unpaid",
          )
        : false;
      const isUnpaid =
        !roomCharge ||
        (roomCharge.paymentMethod === "Unpaid" && !hasRoomChargeSettlement);

      commercialRoomSlices(booking).forEach((slice) => {
        const effectiveStayEnd = effectiveCalendarRoomStayEnd(booking, {
          roomIds: slice.roomIds,
          from: slice.from,
          to: slice.to,
        });

        if (effectiveStayEnd <= new Date(slice.from)) return;

        slice.roomIds.forEach((roomId) => {
          const roomWithMatchingId = rooms.find((room) => room.roomId === roomId);
          roomWithMatchingId?.bookings.push({
            name: booking.name,
            platformId: slice.platformId,
            bookingId: booking.bookingId,
            from: slice.from,
            to: effectiveStayEnd,
            status: booking.status,
            isUnpaid,
          });
        });
      });
    });

    res.status(200).json(rooms);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
};

export const getBookingById = async (req: Request, res: Response) => {
  try {
    const { bookingId } = req.params;

    const booking = await Booking.findOne({ bookingId }).lean();
    if (!booking) {
      return res.status(404).json({ message: "ไม่พบ booking นี้" });
    }
    const effectiveTransactions = effectiveBookingTransactions(booking);

    res.status(200).json({
      ...booking,
      effectiveTransactions,
      financialSummary: summarizeBookingFinancialPosition(effectiveTransactions),
    });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
};

export const manageRoomStays = async (req: Request, res: Response) => {
  try {
    const { roomStays } = req.body;
    const { bookingId } = req.params;
    const historicalCorrectionReason =
      typeof req.body.historicalCorrectionReason === "string"
        ? req.body.historicalCorrectionReason.trim()
        : "";
    const expectedRevision = expectedBookingRevision(req.body.expectedRevision);

    if (expectedRevision === null) {
      return res.status(400).json({
        error: "EXPECTED_REVISION_REQUIRED",
        message: "กรุณารีเฟรชข้อมูลการจองก่อนย้ายห้อง",
      });
    }

    if (
      !Array.isArray(roomStays) ||
      roomStays.length === 0 ||
      !roomStays.every(
        (roomStay: roomStay) =>
          getRoomStayRoomIds(roomStay).length > 0 &&
          roomStay.from &&
          roomStay.to,
      )
    )
      return res.status(400).json({
        error: "MISSING",
        message: "กรุณากรอกข้อมูลให้ครบทุกช่อง",
      });

    if (roomStays.some((roomStay: roomStay) => hasDuplicateRoomIds(roomStay))) {
      return res.status(400).json({
        error: "DUPLICATE_ROOMS",
        message: "เลือกห้องซ้ำกัน",
      });
    }

    const normalizedRoomStays = roomStays.map(normalizeRoomStay);
    const sorted = [...normalizedRoomStays].sort(
      (a, b) => new Date(a.from).getTime() - new Date(b.from).getTime(),
    );

    // Check if they overlap or not && each room is available then && full from checkin till checkout
    const hasInternalOverlap = (sorted: roomStay[]) => {
      for (let i = 0; i < sorted.length - 1; i++) {
        const currentEnd = new Date(sorted[i].to);
        const nextStart = new Date(sorted[i + 1].from);

        if (currentEnd > nextStart) return true;
      }

      return false;
    };

    if (hasInternalOverlap(sorted))
      return res.status(400).json({
        error: "ROOM_STAYS_OVERLAP",
        message: "ช่วงการเข้าพักซ้อนกัน",
      });

    const booking = await Booking.findOne({ bookingId }).lean();

    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }

    if ((booking.revision || 0) !== expectedRevision) {
      return sendBookingRevisionConflict(res, bookingId);
    }
    const isClosedRoomHistoryCorrection = booking.status === "checkedOut";
    const canEditBookingRoomStays =
      ["booked", "checkedIn"].includes(booking.status) ||
      (isClosedRoomHistoryCorrection && req.user?.admin === true);

    if (booking.voided || !canEditBookingRoomStays) {
      if (isClosedRoomHistoryCorrection && !req.user?.admin) {
        return res.status(403).json({
          error: "ADMIN_APPROVAL_REQUIRED",
          message: "การแก้ประวัติห้องหลัง Check-Out ทำได้เฉพาะ Admin",
          booking,
        });
      }
      return res.status(409).json({
        error: "BOOKING_LIFECYCLE_CONFLICT",
        message:
          "แก้ห้องได้เฉพาะ Booking ที่ยังไม่ Check-In, กำลังเข้าพัก หรือประวัติหลัง Check-Out โดย Admin",
        booking,
      });
    }

    const originalRoomStays = booking.roomStays;

    // 1. Start must match check-in
    if (sorted[0].from !== toInputDate(booking.checkIn)) {
      return res.status(400).json({
        error: "INVALID_START",
        message: "ช่วงแรกต้องเริ่มตรงกับวันเช็คอิน",
      });
    }

    // 2. End must match check-out
    if (sorted[sorted.length - 1].to !== toInputDate(booking.checkOut)) {
      return res.status(400).json({
        error: "INVALID_END",
        message: "ช่วงสุดท้ายต้องตรงกับวันเช็คเอาท์",
      });
    }

    // 3. No gaps
    for (let i = 0; i < sorted.length - 1; i++) {
      if (sorted[i].to !== sorted[i + 1].from) {
        return res.status(400).json({
          error: "ROOM_STAYS_GAP",
          message: "ช่วงการเข้าพักต้องต่อเนื่องกัน",
        });
      }
    }

    const businessDate = getBusinessDateKey();
    const changesCompletedRoomHistory =
      toInputDate(booking.checkIn) < businessDate &&
      !preservesCompletedRoomAssignments(
        originalRoomStays,
        sorted,
        booking.checkIn,
        booking.checkOut,
        businessDate,
      );
    const requiresHistoricalCorrectionAudit =
      isClosedRoomHistoryCorrection || changesCompletedRoomHistory;

    if (requiresHistoricalCorrectionAudit && !req.user?.admin) {
      return res.status(409).json({
        error: "PAST_ROOM_STAYS_LOCKED",
        message:
          "ไม่สามารถเปลี่ยนห้องของคืนที่ผ่านมาได้ กรุณาย้ายห้องตั้งแต่วันนี้เป็นต้นไป",
        booking,
      });
    }
    if (
      requiresHistoricalCorrectionAudit &&
      !historicalCorrectionReason
    ) {
      return res.status(400).json({
        error: "HISTORICAL_ROOM_CORRECTION_REASON_REQUIRED",
        message: "กรุณาระบุเหตุผลที่แก้ไขประวัติห้องพัก",
      });
    }

    const effectiveFrom =
      !req.user?.admin && toInputDate(booking.checkIn) < businessDate
        ? businessDate
        : null;
    if (
      effectiveFrom &&
      !preservesCompletedRoomAssignments(
        originalRoomStays,
        sorted,
        booking.checkIn,
        booking.checkOut,
        effectiveFrom,
      )
    ) {
      return res.status(409).json({
        error: "PAST_ROOM_STAYS_LOCKED",
        message:
          "ไม่สามารถเปลี่ยนห้องของคืนที่ผ่านมาได้ กรุณาย้ายห้องตั้งแต่วันนี้เป็นต้นไป",
        booking,
      });
    }

    const roomIds = getUniqueRoomIdsFromRoomStays(sorted);
    const invalidManagedRooms = invalidRoomIds(roomIds);
    if (invalidManagedRooms.length > 0) {
      return res.status(400).json({
        error: "INVALID_ROOM_ID",
        message: `ไม่พบห้องที่เปิดใช้งาน: ${invalidManagedRooms.join(", ")}`,
      });
    }
    const roomStaysToValidate = effectiveFrom
      ? sorted
          .filter((stay) => toInputDate(stay.to) > effectiveFrom)
          .map((stay) => ({
            ...stay,
            from:
              toInputDate(stay.from) < effectiveFrom
                ? effectiveFrom
                : stay.from,
          }))
      : sorted;
    const roomIdsToValidate =
      getUniqueRoomIdsFromRoomStays(roomStaysToValidate);
    const allowedStatuses: Status[] = isClosedRoomHistoryCorrection
      ? ["checkedOut"]
      : ["booked", "checkedIn"];

    const manageResult = await withRoomMutationLocks(
      roomStaysToValidate,
      async () => {
        if (
          await findActiveRoomBlockConflict(roomStaysToValidate)
        ) {
          return { hasConflict: true };
        }

        const conflictingBookings =
          roomStaysToValidate.length > 0
            ? await Booking.find({
                bookingId: { $ne: bookingId },
                ...buildBlockingRoomConflictQuery(
                  roomIdsToValidate,
                  new Date(roomStaysToValidate[0].from),
                  new Date(
                    roomStaysToValidate[roomStaysToValidate.length - 1].to,
                  ),
                ),
              })
            : [];

        const hasConflict = conflictingBookings.some((booking) =>
          booking.roomStays.some((existing: roomStay) =>
            roomStaysToValidate.some((incoming: roomStay) =>
              roomStaysConflict(existing, incoming),
            ),
          ),
        );

        if (hasConflict) {
          return { hasConflict };
        }

        const updatedBooking = await Booking.findOneAndUpdate(
          {
            bookingId,
            status: { $in: allowedStatuses },
            voided: { $ne: true },
            ...bookingRevisionPredicate(expectedRevision),
          },
          {
            $set: {
              roomStays: sorted,
            },
            $inc: { revision: 1 },
          },
          { returnDocument: "after", runValidators: true },
        );

        return { updatedBooking };
      },
    );

    if (manageResult.hasConflict) {
      return res.status(409).json({
        error: "ROOM_CONFLICT",
        message: "ห้องถูกจองหรือบล็อกในช่วงเวลานี้",
      });
    }

    const updatedBooking = manageResult.updatedBooking;
    if (!updatedBooking) {
      return sendBookingRevisionConflict(res, bookingId);
    }

    logActivity(
      req.user?.username,
      "MANAGE_ROOM_STAYS",
      {
        summary: {
          beforeRoomStays: originalRoomStays,
          afterRoomStays: sorted,
          ...(effectiveFrom ? { effectiveFrom } : {}),
          ...(requiresHistoricalCorrectionAudit
            ? {
                historicalCorrection: true,
                historicalCorrectionReason,
                bookingStatus: booking.status,
              }
            : {}),
        },
        changes: {
          roomStays: { before: originalRoomStays, after: sorted },
        },
      },
      String(bookingId),
    );

    res.status(200).json({ message: "สำเร็จ", booking: updatedBooking });
  } catch (err) {
    if (err instanceof RoomMutationConflictError) {
      return res.status(409).json({
        error: "ROOM_MUTATION_CONFLICT",
        message: "ห้องนี้กำลังถูกแก้ไขโดยผู้ใช้อื่น กรุณาลองอีกครั้ง",
      });
    }

    res.status(500).json({ error: (err as Error).message });
  }
};

export const extendBooking = async (
  req: Request<{ bookingId: string }, {}, BookingExtensionInput>,
  res: Response,
) => {
  try {
    const staffUsername = req.user?.username;
    if (!staffUsername) {
      return res.status(403).json({
        error: "EXTENSION_NOT_AUTHORIZED",
        message: "ไม่มีสิทธิ์เพิ่มคืนให้ booking",
      });
    }

    const result = await performBookingExtension({
      bookingId: req.params.bookingId,
      input: req.body,
      idempotencyKey: req.get("Idempotency-Key")?.trim() || "",
      staffUsername,
    });

    return res.status(200).json({
      message: "เพิ่มคืนให้ booking สำเร็จ",
      ...result,
    });
  } catch (err) {
    if (err instanceof BookingExtensionError) {
      const latestBooking = err.booking
        ? await Booking.findOne({ bookingId: req.params.bookingId })
        : null;
      return res.status(err.status).json({
        error: err.code,
        message: err.message,
        ...(latestBooking ? { booking: latestBooking } : {}),
      });
    }
    if (err instanceof CashShiftLedgerConflictError) {
      return res.status(409).json({ error: err.code, message: err.message });
    }

    console.error("Booking extension failed", {
      bookingId: req.params.bookingId,
      error: err instanceof Error ? err.message : "Unknown error",
    });
    return res.status(500).json({
      error: "BOOKING_EXTENSION_FAILED",
      message: "ไม่สามารถเพิ่มคืนให้ booking ได้ กรุณาลองใหม่",
    });
  }
};

type AddTransactionRequestBody = {
  transaction: transcation;
};
type AddTransactionParams = {
  bookingId: string;
};

class BookingFinancialConflictError extends Error {
  constructor() {
    super("BOOKING_FINANCIAL_CONFLICT");
    this.name = "BookingFinancialConflictError";
  }
}

export const addTransaction = async (
  req: Request<AddTransactionParams, {}, AddTransactionRequestBody>,
  res: Response,
) => {
  try {
    const { transaction } = req.body;
    const { bookingId } = req.params;

    if (!bookingId)
      return res.status(400).json({
        error: "MISSING",
        message: "กรุณากรอก BookingId ใน Params",
      });

    if (
      !transaction ||
      transaction.amount == null ||
      !transaction.paymentMethod ||
      !transaction.type
    )
      return res.status(400).json({
        error: "MISSING",
        message: "กรุณากรอกข้อมูลให้ครบทุกช่อง",
      });

    const amount = Number(transaction.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({
        error: "INVALID_AMOUNT",
        message: "จำนวนเงินต้องมากกว่า 0",
      });
    }

    if (!PAYMENT_METHODS.includes(transaction.paymentMethod)) {
      return res.status(400).json({
        error: "INVALID_PAYMENT_METHOD",
        message: "ช่องทางการชำระเงินไม่ถูกต้อง",
      });
    }

    if (!ADD_TRANSACTION_TYPES.includes(transaction.type)) {
      return res.status(400).json({
        error: "INVALID_TRANSACTION_TYPE",
        message: "ประเภทรายการไม่ถูกต้อง",
      });
    }

    if (
      ["adjustment", "depositRefund"].includes(transaction.type) &&
      !transaction.note?.trim()
    ) {
      return res.status(400).json({
        error: "NOTE_REQUIRED",
        message: "กรุณาระบุหมายเหตุสำหรับรายการที่ต้องตรวจสอบ",
      });
    }

    if (transaction.type === "misc" && !transaction.note?.trim()) {
      return res.status(400).json({
        error: "MISC_REASON_REQUIRED",
        message: "กรุณาระบุเหตุผลสำหรับรายการ Misc",
      });
    }

    if (
      transaction.type === "adjustment" &&
      !transaction.relatedTransactionId
    ) {
      return res.status(400).json({
        error: "RELATED_TRANSACTION_REQUIRED",
        message: "กรุณาเลือกรายการเดิมที่ต้องการปรับยอด",
      });
    }

    const booking = await Booking.findOne({ bookingId }).lean();
    if (!booking) {
      return res.status(404).json({
        error: "BOOKING_NOT_FOUND",
        message: "ไม่พบ booking นี้",
      });
    }

    if (transaction.type === "deposit" && booking.status !== "checkedIn") {
      return res.status(409).json({
        error: "DEPOSIT_REQUIRES_CHECK_IN",
        message: "รับมัดจำได้หลังจาก check-in แล้วเท่านั้น",
      });
    }

    if (
      transaction.type === "deposit" &&
      transaction.paymentMethod !== "Cash"
    ) {
      return res.status(400).json({
        error: "DEPOSIT_REQUIRES_CASH",
        message: "รับมัดจำเพิ่มได้ด้วยเงินสดเท่านั้น",
      });
    }

    if (!req.user?.admin && booking.status === "cancelled") {
      return res.status(403).json({
        error: "ADMIN_APPROVAL_REQUIRED",
        message: "รายการของ Booking ที่ยกเลิกแล้วต้องให้ Admin ดำเนินการ",
      });
    }

    if (transaction.relatedTransactionId) {
      const linkedTransactionExists = booking.transactions.some(
        (existingTransaction) =>
          String(existingTransaction._id) === transaction.relatedTransactionId,
      );

      if (!linkedTransactionExists) {
        return res.status(400).json({
          error: "INVALID_RELATED_TRANSACTION",
          message: "ไม่พบรายการที่ต้องการแนบกับการปรับยอด",
        });
      }
    }

    let baseTransaction: transcation = {
      type: transaction.type,
      paymentMethod: transaction.paymentMethod,
      amount,
    };

    if (transaction.direction) {
      baseTransaction.direction = transaction.direction;
    }

    if (transaction.reasonOfAdjustment) {
      baseTransaction.reasonOfAdjustment = transaction.reasonOfAdjustment;
    }

    if (transaction.relatedTransactionId) {
      baseTransaction.relatedTransactionId = transaction.relatedTransactionId;
    }

    baseTransaction = enforceAddTransactionPolicy({
      booking: {
        ...booking,
        transactions: effectiveBookingTransactions(booking),
      },
      transaction: baseTransaction,
      isAdmin: req.user?.admin === true,
    });

    const sameTypeCount = booking.transactions.filter(
      (existingTransaction) => existingTransaction.type === transaction.type,
    ).length;
    const newTransactions = buildTransactionsWithCardSurcharge(baseTransaction, {
      createdBy: req.user?.username,
      sourceAction: "ADD_TRANSACTION",
      note: transaction.note?.trim(),
      reference: transaction.reference,
      sameTypeCount,
    });
    const bookingVersion = Number(booking.revision || 0);

    const updatedBooking = await withMutationIdempotency(req, () =>
      withCashLedgerTransaction(
        newTransactions,
        async (assignedTransactions, session) => {
          const result = await Booking.findOneAndUpdate(
            { bookingId, ...bookingRevisionPredicate(bookingVersion) },
            {
              $push: {
                transactions: {
                  $each: assignedTransactions,
                },
              },
              $inc: { revision: 1 },
            },
            { returnDocument: "after", runValidators: true, session },
          );
          if (!result) throw new BookingFinancialConflictError();
          return result;
        },
      ),
    );

    logActivity(
      req.user?.username,
      "ADD_TRANSACTION",
      {
        summary: {
          addedTransactions: newTransactions,
        },
        changes: {
          transactions: {
            before: booking.transactions,
            after: updatedBooking?.transactions,
          },
        },
      },
      String(bookingId),
    );

    res.status(200).json({
      message: "เพิ่มรายการใช้จ่ายสำเร็จ",
      booking: updatedBooking,
    });
  } catch (err) {
    if (err instanceof FinancialTransactionPolicyError) {
      return res.status(err.status).json({ error: err.code, message: err.message });
    }
    if (err instanceof BookingFinancialConflictError) {
      const latestBooking = await Booking.findOne({
        bookingId: req.params.bookingId,
      });
      return res.status(409).json({
        error: "BOOKING_FINANCIAL_CONFLICT",
        message: "ข้อมูลการเงินถูกเปลี่ยนโดยผู้ใช้อื่น กรุณารีเฟรชแล้วลองใหม่",
        booking: latestBooking,
      });
    }
    if (err instanceof CashShiftLedgerConflictError) {
      return res.status(409).json({ error: err.code, message: err.message });
    }
    if (err instanceof IdempotencyConflictError) {
      return sendDuplicateMutationResponse(res);
    }

    res.status(500).json({ error: (err as Error).message });
  }
};

export const getPassportData = async (req: Request, res: Response) => {
  try {
    const bookingId = String(req.params.bookingId || "");

    if (!bookingId)
      return res.status(400).json({
        error: "MISSING",
        message: "กรุณากรอก BookingId ใน Params",
      });

    if (!process.env.CRYPTO_SECRET) {
      throw new Error("CRYPTO_SECRET Missing");
    }

    const booking = await Booking.findOne({
      bookingId,
      status: {
        $in: ["checkedIn", "checkedOut"],
      },
    })
      .select(
        `passport.namePrefix passport.nationality ${PASSPORT_SENSITIVE_SELECT}`,
      )
      .lean();

    if (
      !booking?.passport?.nationality ||
      !booking.passport.passportNo ||
      !booking.passport.passportName
    ) {
      return res.status(404).json({
        error: "NOT_FOUND",
        message: "ไม่พบข้อมูล Passport",
      });
    }

    const decrypt = ({ cipherText, iv, authTag }: EncryptedField) => {
      const key = Buffer.from(process.env.CRYPTO_SECRET!, "hex");

      const decipher = crypto.createDecipheriv(
        "aes-256-gcm",
        key,
        Buffer.from(iv, "hex"),
      );

      decipher.setAuthTag(Buffer.from(authTag, "hex"));

      let decrypted = decipher.update(cipherText, "hex", "utf8");
      decrypted += decipher.final("utf8");

      return decrypted;
    };

    const passportData = {
      namePrefix: booking.passport.namePrefix || "",
      nationality: booking.passport.nationality,
      passportNo: decrypt(booking.passport.passportNo),
      passportName: decrypt(booking.passport.passportName),
    };

    await logActivityStrict(
      req.user?.username,
      "VIEW_PASSPORT",
      { summary: { bookingId } },
      bookingId,
    );

    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Pragma", "no-cache");
    res.status(200).json({ passportData });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
};

export const cancelBooking = async (req: Request, res: Response) => {
  try {
    const { bookingId } = req.params;
    const { cancellationType, reopenRoom } = req.body;
    const expectedRevision = expectedBookingRevision(req.body.expectedRevision);
    const cancelledByStaffUsername = req.user?.username;
    const paidCancellationTypes = ["refundable", "non_refundable"];

    if (!bookingId)
      return res.status(400).json({
        error: "MISSING",
        message: "กรุณากรอก BookingId ใน Params",
      });

    if (expectedRevision === null) {
      return res.status(400).json({
        error: "EXPECTED_REVISION_REQUIRED",
        message: "กรุณารีเฟรชข้อมูลการจองก่อนยกเลิก",
      });
    }

    if (typeof reopenRoom !== "boolean")
      return res.status(400).json({
        error: "INVALID_PAYLOAD",
        message: "กรุณากรอกข้อมูลให้ครบและถูกต้อง",
      });

    if (!cancelledByStaffUsername) {
      return res.status(401).json({
        error: "NOT_AUTHORIZED",
        message: "กรุณาเข้าสู่ระบบใหม่",
      });
    }

    const existingBooking = await Booking.findOne({ bookingId });

    if (!existingBooking)
      return res.status(404).json({ message: "ไม่พบ Booking" });
    if ((existingBooking.revision || 0) !== expectedRevision) {
      return sendBookingRevisionConflict(res, bookingId);
    }
    if (existingBooking.status !== "booked")
      return res.status(409).json({
        message: "สามารถยกเลิกได้เฉพาะ Booking ที่ยังไม่ได้ Check-In",
      });

    const effectiveTransactions = effectiveBookingTransactions(existingBooking);
    const paidByMethod = summarizeReceivedPaymentsByMethod(effectiveTransactions);
    const paidAmount = Array.from(paidByMethod.values()).reduce(
      (sum, amount) => sum + amount,
      0,
    );
    const refundEntitlements = assessOrdinaryRefundEntitlements(
      effectiveTransactions,
    ).entitlements;
    const remainingRefundableAmount = refundEntitlements.reduce(
      (sum, entitlement) => sum + entitlement.remainingAmount,
      0,
    );
    const hasReceivedPayment = paidAmount > 0;
    const hasNonRefundableAdvance =
      existingBooking.advancePayment?.nonRefundableOnCancellation === true;
    const effectiveCancellationType = hasNonRefundableAdvance
      ? "non_refundable"
      : hasReceivedPayment
        ? cancellationType
        : "no_payment_received";

    if (
      hasReceivedPayment &&
      !hasNonRefundableAdvance &&
      (typeof cancellationType !== "string" ||
        !paidCancellationTypes.includes(cancellationType))
    )
      return res.status(400).json({
        error: "INVALID_PAYLOAD",
        message: "กรุณาระบุประเภทการยกเลิกให้ถูกต้อง",
      });

    const refundAmount =
      hasReceivedPayment && effectiveCancellationType === "refundable"
        ? Math.min(paidAmount, remainingRefundableAmount)
        : 0;
    const keptAmount =
      hasReceivedPayment && effectiveCancellationType === "non_refundable"
        ? paidAmount
        : 0;

    let unallocatedCancellationRefund = refundAmount;
    const cancellationRefundByMethod = new Map<PaymentMethod, number>();
    refundEntitlements.forEach((entitlement) => {
      const entitlementRefundAmount = Math.min(
        entitlement.remainingAmount,
        unallocatedCancellationRefund,
      );
      if (entitlementRefundAmount <= 0) return;
      unallocatedCancellationRefund = Number(
        (unallocatedCancellationRefund - entitlementRefundAmount).toFixed(2),
      );
      cancellationRefundByMethod.set(
        entitlement.paymentMethod,
        Number(
          (
            (cancellationRefundByMethod.get(entitlement.paymentMethod) || 0) +
            entitlementRefundAmount
          ).toFixed(2),
        ),
      );
    });
    // Keep cancellation's existing one-row-per-payment-method shape. The
    // entitlement service deterministically allocates these legacy-compatible
    // unlinked rows across the underlying receipts.
    const refundTransactions: transcation[] = Array.from(
      cancellationRefundByMethod.entries(),
    ).map(([paymentMethod, amount]) =>
      normalizeTransaction(
        {
          type: "cancellationRefund",
          paymentMethod,
          amount,
        },
        {
          createdBy: cancelledByStaffUsername,
          sourceAction: "CANCEL_BOOKING",
        },
      ),
    );
    const originalUnpaidRoomCharge = existingBooking.transactions.find(
      (transaction) =>
        transaction.type === "roomCharge" &&
        transaction.sourceAction !== "EXTEND_BOOKING" &&
        transaction.paymentMethod === "Unpaid",
    );
    const remainingAdvanceBookingBalance = hasNonRefundableAdvance
      ? unpaidRoomChargeAmount(existingBooking)
      : 0;
    const writeOffTransactions: transcation[] =
      originalUnpaidRoomCharge && remainingAdvanceBookingBalance > 0
        ? [
            normalizeTransaction(
              {
                type: "roomChargeWriteOff",
                paymentMethod: "Unpaid",
                relatedTransactionType: "roomCharge",
                relatedTransactionId: String(originalUnpaidRoomCharge._id),
                amount: remainingAdvanceBookingBalance,
                direction: "out",
              },
              {
                createdBy: cancelledByStaffUsername,
                sourceAction: "CANCEL_BOOKING",
                note: "Uncollected room balance closed after cancellation",
              },
            ),
          ]
        : [];
    const cancellationTransactions = [
      ...refundTransactions,
      ...writeOffTransactions,
    ];

    const updatedBooking = await withMutationIdempotency(req, () =>
      withCashLedgerTransaction(
        cancellationTransactions,
        (assignedTransactions, session) =>
          Booking.findOneAndUpdate(
            {
              bookingId,
              status: "booked",
              voided: { $ne: true },
              ...bookingRevisionPredicate(expectedRevision),
            },
            {
              $set: {
                status: "cancelled",
                cancellation: {
                  cancellationType: effectiveCancellationType,
                  roomReleaseStatus: reopenRoom ? "released" : "blocked",
                  refundAmount,
                  keptAmount,
                  cancelledAt: new Date(),
                  cancelledByStaffUsername,
                },
              },
              ...(assignedTransactions.length > 0
                ? {
                    $push: {
                      transactions: {
                        $each: assignedTransactions,
                      },
                    },
                  }
                : {}),
              $inc: { revision: 1 },
            },
            { returnDocument: "after", session, runValidators: true },
          ),
      ),
    );

    if (!updatedBooking) {
      return sendBookingRevisionConflict(
        res,
        bookingId,
        "สถานะการจองเปลี่ยนไปแล้ว กรุณารีเฟรชก่อนยกเลิก",
      );
    }

    res.status(200).json({
      message: "ยกเลิกการจองเรียบร้อย",
      booking: updatedBooking,
    });

    logActivity(
      req.user?.username,
      "CANCEL_BOOKING",
      {
        snapshot: buildActivityBookingSnapshot(existingBooking),
        changes: {
          status: { before: "booked", after: "cancelled" },
          transactions: {
            before: existingBooking.transactions,
            after: updatedBooking.transactions,
          },
        },
        summary: {
          cancellationType: hasReceivedPayment
            ? effectiveCancellationType
            : "no_payment_received",
          refundAmount,
          keptAmount,
          writtenOffAmount: remainingAdvanceBookingBalance,
          roomReleaseStatus: reopenRoom ? "released" : "blocked",
        },
      },
      String(bookingId),
    );
  } catch (err) {
    if (err instanceof CashShiftLedgerConflictError) {
      return res.status(409).json({ error: err.code, message: err.message });
    }
    if (err instanceof IdempotencyConflictError) {
      return sendDuplicateMutationResponse(res);
    }

    res.status(500).json({ error: (err as Error).message });
  }
};

type ResolveBookingTransactionInput = {
  type: TransactionType;
  paymentMethod: PaymentMethod;
  amount: number;
  direction: TransactionDirection;
  note?: string;
  relatedTransactionId?: string;
  reference?: string;
};

type ResolveBookingBody = {
  expectedRevision: number;
  outcome: ResolutionOutcome;
  finalStatus: Status;
  roomReleaseStatus: RoomReleaseStatus;
  reasonCode: string;
  note: string;
  depositReturned?: boolean;
  transactions?: ResolveBookingTransactionInput[];
};

type ResolveBookingParams = {
  bookingId: string;
};

export const resolveBooking = async (
  req: Request<ResolveBookingParams, {}, ResolveBookingBody>,
  res: Response,
) => {
  try {
    const { bookingId } = req.params;
    const expectedRevision = expectedBookingRevision(req.body.expectedRevision);
    const {
      outcome,
      finalStatus,
      roomReleaseStatus,
      reasonCode,
      note,
      depositReturned,
      transactions = [],
    } = req.body;
    const resolvedByStaffUsername = req.user?.username;

    if (!bookingId) {
      return res.status(400).json({
        error: "MISSING",
        message: "กรุณากรอก BookingId ใน Params",
      });
    }
    if (expectedRevision === null) {
      return res.status(400).json({
        error: "EXPECTED_REVISION_REQUIRED",
        message: "กรุณารีเฟรชข้อมูลการจองก่อน resolve",
      });
    }

    if (!resolvedByStaffUsername) {
      return res.status(401).json({
        error: "NOT_AUTHORIZED",
        message: "กรุณาเข้าสู่ระบบใหม่",
      });
    }

    const resolveFlags = resolveRetirementFlags();
    const fallbackEnabled =
      outcome === "post_close_adjustment"
        ? resolveFlags.postCloseFallback
        : outcome === "no_show"
          ? false
          : resolveFlags.specialCaseFallback;
    if (
      outcome === "no_show" ||
      !resolveFlags.genericResolveApi ||
      !fallbackEnabled ||
      !req.user?.admin
    ) {
      console.warn("Deprecated Resolve request rejected", {
        bookingId,
        outcome,
        username: resolvedByStaffUsername,
        replacementAction: resolveReplacementFor(outcome),
      });
      const resolveRetired =
        outcome === "no_show" ||
        !resolveFlags.genericResolveApi ||
        !fallbackEnabled;
      return res.status(resolveRetired ? 410 : 403).json({
        error: resolveRetired
          ? "RESOLVE_RETIRED"
          : "RESOLVE_FALLBACK_OWNER_ONLY",
        message:
          outcome === "no_show"
            ? "กรุณาใช้การบันทึก No-Show แบบเฉพาะ"
            : "Resolve แบบเดิมเป็นทางสำรองสำหรับ Admin เท่านั้น",
        replacementAction: resolveReplacementFor(outcome),
      });
    }

    if (
      !RESOLUTION_OUTCOMES.includes(outcome) ||
      !RESOLUTION_FINAL_STATUSES.includes(finalStatus) ||
      !ROOM_RELEASE_STATUSES.includes(roomReleaseStatus) ||
      !reasonCode?.trim() ||
      !note?.trim()
    ) {
      return res.status(400).json({
        error: "INVALID_PAYLOAD",
        message: "กรุณากรอกข้อมูลการ Resolve ให้ครบและถูกต้อง",
      });
    }

    if (!Array.isArray(transactions)) {
      return res.status(400).json({
        error: "INVALID_TRANSACTIONS",
        message: "รายการ Settlement ไม่ถูกต้อง",
      });
    }

    const booking = await Booking.findOne({ bookingId }).lean();

    if (!booking) {
      return res.status(404).json({
        error: "BOOKING_NOT_FOUND",
        message: "ไม่พบ booking นี้",
      });
    }

    if ((booking.revision || 0) !== expectedRevision) {
      return sendBookingRevisionConflict(res, bookingId);
    }
    if (booking.voided) {
      return res.status(409).json({
        error: "BOOKING_LIFECYCLE_CONFLICT",
        message: "ไม่สามารถแก้ไขการจองที่ถูก void",
        booking,
      });
    }

    const bookingIsClosed =
      booking.status === "checkedOut" ||
      booking.status === "cancelled" ||
      booking.status === "noShow";

    if (bookingIsClosed && !req.user?.admin) {
      return res.status(403).json({
        error: "ADMIN_APPROVAL_REQUIRED",
        message: "รายการหลังปิด Booking ต้องให้ Admin ดำเนินการ",
      });
    }

    if (bookingIsClosed && finalStatus !== booking.status) {
      return res.status(409).json({
        error: "CLOSED_BOOKING_STATUS_LOCKED",
        message: "Booking ที่ปิดแล้วไม่สามารถเปลี่ยนสถานะผ่าน Post-Close ได้",
      });
    }

    if (!bookingIsClosed && outcome === "post_close_adjustment") {
      return res.status(400).json({
        error: "INVALID_OUTCOME",
        message: "Post-Close ใช้ได้เฉพาะ Booking ที่ปิดแล้ว",
      });
    }

    if (
      booking.status === "booked" &&
      ["early_checkout", "normal_checkout", "cancelled_after_checkin"].includes(
        outcome,
      )
    ) {
      return res.status(400).json({
        error: "INVALID_OUTCOME",
        message: "Outcome นี้ใช้กับ Booking ที่ Check-In แล้วเท่านั้น",
      });
    }

    if (!bookingIsClosed && finalStatus === "noShow") {
      return res.status(400).json({
        error: "INVALID_NO_SHOW_STATUS",
        message: "กรุณาใช้การบันทึก No-Show แบบเฉพาะ",
      });
    }

    const remainingDepositAmount = bookingRemainingDepositAmount(
      effectiveBookingTransactions(booking),
    );
    const mustReturnDeposit =
      !bookingIsClosed &&
      booking.status === "checkedIn" &&
      remainingDepositAmount > 0;
    if (mustReturnDeposit && depositReturned !== true) {
      return res.status(400).json({
        error: "DEPOSIT_RETURN_CONFIRMATION_REQUIRED",
        message: `กรุณายืนยันว่าคืนมัดจำ ${remainingDepositAmount} บาทให้แขกแล้ว`,
      });
    }

    let normalizedTransactions: transcation[] = mustReturnDeposit
      ? [
          normalizeTransaction(
            {
              type: "depositRefund",
              paymentMethod: "Cash",
              amount: remainingDepositAmount,
            },
            {
              createdBy: resolvedByStaffUsername,
              sourceAction: "RESOLVE_STAY",
              note: "คืนมัดจำเต็มจำนวนเมื่อปิดการเข้าพัก",
            },
          ),
        ]
      : [];
    let sensitiveOutTotal = mustReturnDeposit ? remainingDepositAmount : 0;
    let depositRefundAmount = mustReturnDeposit ? remainingDepositAmount : 0;
    let cancellationRefundAmount = 0;
    let settlementChargeAmount = 0;

    for (const transaction of transactions) {
      const amount = Number(transaction.amount);

      if (
        !RESOLVE_BOOKING_TRANSACTION_TYPES.includes(transaction.type) ||
        !SETTLEMENT_PAYMENT_METHODS.includes(transaction.paymentMethod) ||
        !["in", "out", "neutral"].includes(transaction.direction) ||
        !Number.isFinite(amount) ||
        amount <= 0
      ) {
        return res.status(400).json({
          error: "INVALID_TRANSACTION",
          message: "รายการ Settlement ไม่ถูกต้อง",
        });
      }

      const canonicalDirection = canonicalTransactionDirection(transaction);
      if (transaction.direction !== canonicalDirection) {
        return res.status(400).json({
          error: "INVALID_TRANSACTION_DIRECTION",
          message: "ทิศทางรายการไม่ตรงกับประเภทรายการ",
        });
      }

      if (
        transaction.type === "depositKept" &&
        transaction.direction !== "neutral"
      ) {
        return res.status(400).json({
          error: "INVALID_DEPOSIT_KEPT",
          message: "รายการเก็บมัดจำต้องเป็น Neutral",
        });
      }

      if (
        transaction.relatedTransactionId &&
        !booking.transactions.some(
          (existingTransaction) =>
            String(existingTransaction._id) ===
            transaction.relatedTransactionId,
        )
      ) {
        return res.status(400).json({
          error: "INVALID_RELATED_TRANSACTION",
          message: "ไม่พบรายการที่ต้องการอ้างอิง",
        });
      }

      if (
        transaction.direction === "out" &&
        SENSITIVE_SETTLEMENT_TYPES.includes(transaction.type)
      ) {
        sensitiveOutTotal += amount;
      }

      if (transaction.type === "depositRefund") depositRefundAmount += amount;
      if (transaction.type === "cancellationRefund")
        cancellationRefundAmount += amount;
      if (transaction.type === "settlementCharge")
        settlementChargeAmount += amount;

      const sameTypeCount = booking.transactions.filter(
        (existingTransaction) => existingTransaction.type === transaction.type,
      ).length;
      const settlementTransaction: transcation = {
        type: transaction.type,
        paymentMethod: transaction.paymentMethod,
        amount,
        direction: canonicalDirection,
        relatedTransactionId: transaction.relatedTransactionId,
        note: transaction.note?.trim() || note.trim(),
        reference: transaction.reference,
      };

      normalizedTransactions.push(
        ...buildTransactionsWithCardSurcharge(settlementTransaction, {
          createdBy: resolvedByStaffUsername,
          sourceAction: "RESOLVE_STAY",
          note: transaction.note?.trim() || note.trim(),
          reference: transaction.reference,
          sameTypeCount,
        }),
      );
    }

    if (
      depositRefundAmount >
      bookingRemainingDepositAmount(effectiveBookingTransactions(booking))
    ) {
      return res.status(409).json({
        error: "REFUND_EXCEEDS_AVAILABLE_BALANCE",
        message: "ยอดคืนมัดจำเกินยอดคงเหลือ",
      });
    }
    const currentEffectiveTransactions = effectiveBookingTransactions(booking);
    const currentRefundAssessment = assessOrdinaryRefundEntitlements(
      currentEffectiveTransactions,
    );
    const previewRefundAssessment = assessOrdinaryRefundEntitlements([
      ...currentEffectiveTransactions,
      ...normalizedTransactions,
    ]);
    if (
      previewRefundAssessment.excessRefundAmount >
      currentRefundAssessment.excessRefundAmount
    ) {
      const remainingRefundableAmount = currentRefundAssessment.entitlements.reduce(
        (sum, entitlement) => sum + entitlement.remainingAmount,
        0,
      );
      return res.status(409).json({
        error: "REFUND_EXCEEDS_AVAILABLE_BALANCE",
        message: `คืนได้ไม่เกิน ${remainingRefundableAmount.toLocaleString("th-TH")} บาท`,
        remainingRefundableAmount,
      });
    }
    const now = new Date();
    const updateSet: Record<string, unknown> = {
      status: finalStatus,
      resolution: {
        outcome,
        roomReleaseStatus,
        reasonCode: reasonCode.trim(),
        note: note.trim(),
        resolvedAt: now,
        resolvedByStaffUsername,
        finalStatus,
        amendedAfterClose: bookingIsClosed,
        ...(bookingIsClosed && req.user?.admin
          ? { approvedByStaffUsername: resolvedByStaffUsername }
          : {}),
      },
    };

    if (finalStatus === "checkedOut") {
      updateSet.checkout = {
        roomReleaseStatus,
        depositRefundAmount,
        checkedOutAt: now,
        checkedOutByStaffUsername: resolvedByStaffUsername,
        earlyCheckOut: ["early_checkout", "guest_left"].includes(outcome),
        nightsEarly:
          ["early_checkout", "guest_left"].includes(outcome) && booking.checkOut
            ? Math.max(
                Math.round(
                  (getBookingBusinessDateStart(booking.checkOut).getTime() -
                    getBusinessDayBounds(now).start.getTime()) /
                    86400000,
                ),
                0,
              )
            : 0,
        depositDisposition: "returned",
      };
    }

    if (finalStatus === "cancelled") {
      updateSet.cancellation = {
        cancellationType:
          cancellationRefundAmount > 0 ? "refundable" : "non_refundable",
        roomReleaseStatus,
        refundAmount: cancellationRefundAmount,
        keptAmount: settlementChargeAmount,
        cancelledAt: now,
        cancelledByStaffUsername: resolvedByStaffUsername,
      };
    }

    const updatedBooking = await withMutationIdempotency(req, () =>
      withCashLedgerTransaction(
        normalizedTransactions,
        (assignedTransactions, session) =>
          Booking.findOneAndUpdate(
            {
              bookingId,
              status: booking.status,
              voided: { $ne: true },
              ...bookingRevisionPredicate(expectedRevision),
            },
            {
              $set: updateSet,
              ...(assignedTransactions.length > 0
                ? {
                    $push: {
                      transactions: {
                        $each: assignedTransactions,
                      },
                    },
                  }
                : {}),
              $inc: { revision: 1 },
            },
            { returnDocument: "after", session, runValidators: true },
          ),
      ),
    );

    if (!updatedBooking) {
      return sendBookingRevisionConflict(
        res,
        bookingId,
        "สถานะการจองเปลี่ยนไปแล้ว กรุณารีเฟรชก่อน resolve",
      );
    }

    logActivity(
      resolvedByStaffUsername,
      bookingIsClosed ? "POST_CLOSE_ADJUSTMENT" : "RESOLVE_STAY",
      {
        changes: {
          status: { before: booking.status, after: finalStatus },
          transactions: {
            before: booking.transactions,
            after: updatedBooking.transactions,
          },
        },
        summary: {
          outcome,
          roomReleaseStatus,
          reasonCode,
          sensitiveOutTotal,
          amendedAfterClose: bookingIsClosed,
        },
      },
      String(bookingId),
    );

    res.status(200).json({
      message: bookingIsClosed
        ? "บันทึก Post-Close Adjustment สำเร็จ"
        : "Resolve Stay สำเร็จ",
      booking: updatedBooking,
    });
  } catch (err) {
    if (err instanceof CashShiftLedgerConflictError) {
      return res.status(409).json({ error: err.code, message: err.message });
    }
    if (err instanceof IdempotencyConflictError) {
      return sendDuplicateMutationResponse(res);
    }

    res.status(500).json({ error: (err as Error).message });
  }
};

const needsReviewBookingFilters = () => {
  const { start: todayStart } = getBusinessDayBounds();
  const thirtyDaysAgo = new Date(todayStart);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  return {
    lateCheckIns: {
      status: "booked" as const,
      checkIn: { $gte: thirtyDaysAgo, $lt: todayStart },
    },
    lateCheckOuts: {
      status: "checkedIn" as const,
      checkOut: { $gte: thirtyDaysAgo, $lt: todayStart },
    },
  };
};

export const getNeedsReviewBookings = async (req: Request, res: Response) => {
  try {
    const filters = needsReviewBookingFilters();

    const lateCheckInBookings = await Booking.find({
      ...filters.lateCheckIns,
    }).sort({ checkIn: 1, name: 1 });

    const lateCheckOutBookings = await Booking.find({
      ...filters.lateCheckOuts,
    }).sort({ checkOut: 1, name: 1 });

    res.status(200).json({
      lateCheckIns: lateCheckInBookings,
      lateCheckOuts: lateCheckOutBookings,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
};

export const getNeedsReviewBookingCount = async (
  req: Request,
  res: Response,
) => {
  try {
    const filters = needsReviewBookingFilters();
    const [lateCheckInCount, lateCheckOutCount] = await Promise.all([
      Booking.countDocuments(filters.lateCheckIns),
      Booking.countDocuments(filters.lateCheckOuts),
    ]);

    res.status(200).json({ count: lateCheckInCount + lateCheckOutCount });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
};
