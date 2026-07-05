import Booking, { PaymentMethod } from "../models/booking";
import CashShift from "../models/cashShift";
import dotenv from "dotenv";
import crypto from "crypto";

import { NextFunction, Request, Response } from "express";
import { logActivity } from "../services/activityServices";
import {
  LARGE_REFUND_THRESHOLD,
  normalizeTransaction,
  summarizeTransactions,
  transactionDashboardCollectedRevenueAmount,
  transactionDashboardGrossRevenueAmount,
  transactionDirection,
  transactionUnpaidAmount,
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
  IdempotencyConflictError,
  withMutationIdempotency,
} from "../services/mutationIdempotency";

dotenv.config();

const TOTAL_GUEST_CAPACITY = 52;
const ROOM_GUEST_CAPACITY: Record<string, number> = {
  Balcony: 2,
  Window: 2,
  "Pottery 1": 3,
  "Pottery 2": 3,
};
const CARD_SURCHARGE_RATE = 0.03;
const ADD_TRANSACTION_TYPES: TransactionType[] = [
  "deposit",
  "adjustment",
  "depositRefund",
  "towel",
  "motorbike",
  "slowBoat",
  "joinTour",
  "extraBed",
];
const RESOLVE_BOOKING_TRANSACTION_TYPES: TransactionType[] = [
  "roomRefund",
  "settlementCharge",
  "compensation",
  "depositKept",
  "paymentCorrection",
  "depositRefund",
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
const NAME_PREFIXES: NamePrefix[] = ["Mr", "Mrs", "Ms", "Miss", "Dr"];
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
  $or: [
    { status: { $nin: ["cancelled", "checkedOut", "noShow"] } },
    { "cancellation.roomReleaseStatus": "blocked" },
    { "checkout.roomReleaseStatus": "blocked" },
    { "resolution.roomReleaseStatus": "blocked" },
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

const bookingKeepsRoomForOccupancy = (booking: booking) => {
  if (booking.status !== "cancelled" && booking.status !== "noShow") {
    return true;
  }

  return (
    booking.cancellation?.roomReleaseStatus === "blocked" ||
    booking.resolution?.roomReleaseStatus === "blocked"
  );
};

const effectiveRoomStayEnd = (currentBooking: booking, roomStay: roomStay) => {
  const stayEnd = new Date(roomStay.to);

  if (
    currentBooking.checkout?.earlyCheckOut &&
    currentBooking.checkout.roomReleaseStatus === "released" &&
    currentBooking.checkout.checkedOutAt
  ) {
    const checkoutStart = getBookingBusinessDateStart(
      new Date(currentBooking.checkout.checkedOutAt),
    );
    return checkoutStart < stayEnd ? checkoutStart : stayEnd;
  }

  return stayEnd;
};

const bookingOccupiedCapacityOnDate = (
  currentBooking: booking,
  start: Date,
  end: Date,
) => {
  if (!bookingKeepsRoomForOccupancy(currentBooking)) return 0;

  return (currentBooking.roomStays || []).reduce((total, roomStay) => {
    const stayStart = new Date(roomStay.from);
    const stayEnd = effectiveRoomStayEnd(currentBooking, roomStay);

    if (stayStart >= end || stayEnd <= start) return total;

    return (
      total +
      getRoomStayRoomIds(roomStay).reduce(
        (roomTotal, roomId) => roomTotal + getRoomGuestCapacity(roomId),
        0,
      )
    );
  }, 0);
};

const getRoomGuestCapacity = (roomId: string) =>
  ROOM_GUEST_CAPACITY[roomId] ?? 1;

const getRequestedRoomIds = (booking: { roomIds?: string[]; roomId?: string }) =>
  getRoomStayRoomIds({
    roomIds: booking.roomIds,
    roomId: booking.roomId,
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

  return checkedInBookings.reduce(
    (bookingTotal, booking) =>
      bookingTotal +
      booking.roomStays.reduce((roomTotal, roomStay) => {
        const stayFrom = new Date(roomStay.from);
        const stayTo = new Date(roomStay.to);
        const stayIsActiveToday = stayFrom < end && stayTo > start;

        return stayIsActiveToday
          ? roomTotal +
              getRoomStayRoomIds(roomStay).reduce(
                (total, roomId) => total + getRoomGuestCapacity(roomId),
                0,
              )
          : roomTotal;
      }, 0),
    0,
  );
};

const calculateCardSurcharge = (amount: number) =>
  Number((amount * CARD_SURCHARGE_RATE).toFixed(2));

const buildTransactionsWithCardSurcharge = (
  transaction: transcation,
  options: {
    createdBy?: string;
    sourceAction: SourceAction;
    note?: string;
    reference?: string;
    sameTypeCount?: number;
  },
): transcation[] => {
  const transactions = [normalizeTransaction(transaction, options)];

  if (
    transaction.paymentMethod === "Card" &&
    transaction.amount > 0 &&
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
          amount: calculateCardSurcharge(transaction.amount),
        },
        options,
      ),
    );
  }

  return transactions;
};

const attachActiveCashShift = async (transactions: transcation[]) => {
  if (!transactions.some((transaction) => transaction.paymentMethod === "Cash")) {
    return transactions;
  }

  const activeCashShift = await CashShift.findOne({ status: "open" }).sort({
    startedAt: -1,
  });
  if (!activeCashShift) return transactions;

  const cashShiftId = String(activeCashShift._id);
  return transactions.map((transaction) =>
    transaction.paymentMethod === "Cash"
      ? { ...transaction, cashShiftId }
      : transaction,
  );
};

const formatLocalDateKey = (date: Date) => {
  const { year, month, day } = getBusinessDateParts(date);

  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(
    2,
    "0",
  )}`;
};

const unpaidRoomChargeAmount = (booking: booking) =>
  Math.max(
    booking.transactions.reduce((sum, transaction) => {
      if (transaction.type === "roomCharge") {
        return sum + transactionUnpaidAmount(transaction);
      }

      if (
        ["settlementCharge", "paymentCorrection"].includes(transaction.type) &&
        transaction.relatedTransactionType === "roomCharge" &&
        transaction.paymentMethod !== "Unpaid"
      ) {
        return sum - Math.abs(transaction.amount || 0);
      }

      return sum;
    }, 0),
    0,
  );

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
    if (!req.body.booking)
      return res.status(400).json({ message: "ไม่พบข้อมูล booking" });

    const { booking } = req.body;
    const requestedRoomIds = getRequestedRoomIds(booking);

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

    if (hasDuplicateRoomIds(booking)) {
      return res.status(400).json({
        message: "เลือกห้องซ้ำกัน",
      });
    }

    const roomChargeAmount = Number(booking.price);

    if (!Number.isFinite(roomChargeAmount) || roomChargeAmount <= 0) {
      return res.status(400).json({
        message: "ราคาห้องต้องมากกว่า 0",
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
        // find bookings that have same room && checkout greater than new checkin && checkin less than new checkout
        const overlappingBooking = await Booking.findOne({
          ...ROOM_BLOCKING_BOOKING_FILTER,
          ...buildRoomConflictQuery(requestedRoomIds, newCheckIn, newCheckOut),
        });

        if (overlappingBooking) {
          return { overlappingBooking };
        }

        const roomChargeTransaction: transcation = {
          type: "roomCharge",
          amount: roomChargeAmount,
          paymentMethod: booking.paymentMethod,
        };

        const transactions = await attachActiveCashShift(
          buildTransactionsWithCardSurcharge(roomChargeTransaction, {
            createdBy: req.user?.username,
            sourceAction: "NEW_BOOKING",
          }),
        );

        const savedBooking = new Booking({
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
          note: booking.note || "",

          // ------- OLD TRANSACTION STRUCTURE --------
          // price: booking.price,
          // paymentMethod: booking.paymentMethod,
          // deposit: null,
          // depositRepaid: null,

          transactions,

          staffUsername: booking.staffUsername,
          bookingId: booking.bookingId.trim(),
          checkInByStaffUsername: null,
          status: "booked",
        });

        await savedBooking.save();

        return { savedBooking };
      },
    );

    if (createResult.overlappingBooking) {
      return res.status(409).json({
        message: `ห้องนี้ถูกจองแล้วระหว่างวันที่ ${dateRangeText(createResult.overlappingBooking.roomStays[0].from, createResult.overlappingBooking.roomStays[0].to)} กรุณาเลือกช่วงเวลาอื่น`,
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
        bookingId: booking.bookingId,
      },
    });
  } catch (err: any) {
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

    const occupiedRoomIds = Array.from(
      new Set(
        overlappingBookings.flatMap((booking) =>
          booking.roomStays.flatMap((roomStay) => {
            const overlaps =
              new Date(roomStay.from) < to && new Date(roomStay.to) > from;

            return overlaps ? getRoomStayRoomIds(roomStay) : [];
          }),
        ),
      ),
    );

    res.status(200).json({ occupiedRoomIds });
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch room availability" });
  }
};

type EditBookingBody = {
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

type StarBookingBody = {
  starred?: boolean;
};

export const editBooking = async (
  req: Request<EditBookingParams, {}, EditBookingBody>,
  res: Response,
) => {
  try {
    const { booking } = req.body;
    const { bookingId } = req.params;

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

    if (existingBooking.status === "checkedOut") {
      return res.status(409).json({
        message: "ไม่สามารถแก้ไข booking ที่ check-out แล้ว",
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

    const editResult = await withRoomMutationLocks(
      correctedRoomStays,
      async () => {
        const conflictingBookings = await Booking.find({
          bookingId: { $ne: bookingId },
          ...ROOM_BLOCKING_BOOKING_FILTER,
          ...buildRoomConflictQuery(roomIds, newCheckIn, newCheckOut),
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

        const updatedBooking = await Booking.findOneAndUpdate(
          { bookingId },
          {
            $set: {
              name: booking.name,
              checkIn: newCheckIn,
              checkOut: newCheckOut,
              nights: calculateNights(booking.checkIn, booking.checkOut),
              platformId: booking.platformId,
              note: booking.note || "",
              roomStays: correctedRoomStays,
            },
          },
          { returnDocument: "after" },
        );

        return { updatedBooking };
      },
    );

    if (editResult.hasConflict) {
      return res.status(409).json({
        message: "ห้องถูกจองในช่วงวันที่ที่แก้ไข",
      });
    }

    const updatedBooking = editResult.updatedBooking;

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

export const starBooking = async (
  req: Request<EditBookingParams, {}, StarBookingBody>,
  res: Response,
) => {
  try {
    const { bookingId } = req.params;
    const starred = Boolean(req.body.starred);

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
      { $set: { starred } },
      { returnDocument: "after" },
    );

    logActivity(
      req.user?.username,
      "EDIT_BOOKING",
      {
        changes: {
          starred: {
            before: Boolean(existingBooking.starred),
            after: starred,
          },
        },
      },
      String(bookingId),
    );

    res.status(200).json({
      message: starred ? "ปักดาว Booking สำเร็จ" : "ยกเลิกปักดาว Booking สำเร็จ",
      booking: updatedBooking,
    });
  } catch (err) {
    console.log(err);
    res.status(500).json({
      error: "SERVER_ERROR",
      message: "เกิดข้อผิดพลาดในการปักดาว Booking",
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
  const { start: startOfToday, end: startOfTomorrow } =
    getBusinessDayBounds(today);
  const { start: startOfMonth, end: startOfNextMonth } =
    getBusinessMonthBounds(today);
  const revenueRange = normalizeRevenueChartRange(req.query.revenueRange);
  const { start: chartStart, end: chartEnd } = getRevenueChartBounds(
    today,
    revenueRange,
    startOfMonth,
    startOfTomorrow,
  );

  try {
    const [
      monthFinancialBookings,
      chartFinancialBookings,
      occupancyBookings,
      monthBookings,
      unpaidBookings,
      occupancy,
    ] = await Promise.all([
        Booking.find({
          "transactions.createdAt": { $gte: startOfMonth, $lt: startOfNextMonth },
        }),
        Booking.find({
          "transactions.createdAt": { $gte: chartStart, $lt: chartEnd },
        }),
        Booking.find({
          roomStays: {
            $elemMatch: {
              from: { $lt: chartEnd },
              to: { $gt: chartStart },
            },
          },
        }),
        Booking.find({
          checkIn: { $gte: startOfMonth, $lt: startOfNextMonth },
        }),
        Booking.find({
          status: { $ne: "checkedOut" },
          transactions: {
            $elemMatch: {
              type: "roomCharge",
              paymentMethod: "Unpaid",
            },
          },
        }),
        getGuestsInHouse(today),
      ]);

    const transactionsInRange = (
      bookings: typeof monthFinancialBookings,
      start: Date,
      end: Date,
    ) =>
      bookings.flatMap((booking) =>
        (booking.transactions || [])
          .filter((transaction) => {
            if (!transaction.createdAt) return false;
            const transactionDate = new Date(transaction.createdAt);
            return transactionDate >= start && transactionDate < end;
          })
          .map((transaction) => ({
            transaction,
            bookingTransactions: booking.transactions || [],
          })),
      );
    const monthFinancialTransactions = transactionsInRange(
      monthFinancialBookings,
      startOfMonth,
      startOfNextMonth,
    );
    const chartFinancialTransactions = transactionsInRange(
      chartFinancialBookings,
      chartStart,
      chartEnd,
    );
    const dailyFinancialTransactions = monthFinancialTransactions.filter(
      ({ transaction }) => {
        const transactionDate = new Date(transaction.createdAt || 0);
        return transactionDate >= startOfToday && transactionDate < startOfTomorrow;
      },
    );

    const calculateGrossRevenue = (
      transactions: typeof monthFinancialTransactions,
    ) =>
      transactions.reduce(
        (sum, { transaction }) =>
          sum + transactionDashboardGrossRevenueAmount(transaction),
        0,
      );
    const calculateCollectedRevenue = (
      transactions: typeof monthFinancialTransactions,
    ) =>
      transactions.reduce(
        (sum, { transaction, bookingTransactions }) =>
          sum +
          transactionDashboardCollectedRevenueAmount(
            transaction,
            bookingTransactions,
          ),
        0,
      );

    const dailyGrossRevenue = calculateGrossRevenue(dailyFinancialTransactions);
    const dailyCollectedRevenue = calculateCollectedRevenue(
      dailyFinancialTransactions,
    );
    const monthlyGrossRevenue = calculateGrossRevenue(monthFinancialTransactions);
    const monthlyCollectedRevenue = calculateCollectedRevenue(
      monthFinancialTransactions,
    );
    const unpaidAmount = unpaidBookings.reduce(
      (sum, booking) => sum + unpaidRoomChargeAmount(booking),
      0,
    );

    const channelCounts = new Map<PlatformId, number>();
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

    for (
      let date = getRevenueBucketStart(chartStart, revenueBucketSize);
      date <= startOfToday;
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

    monthBookings.forEach((booking) => {
      channelCounts.set(
        booking.platformId,
        (channelCounts.get(booking.platformId) || 0) + 1,
      );
    });

    chartFinancialTransactions.forEach(({ transaction, bookingTransactions }) => {
      const bucketKey = formatLocalDateKey(
        getRevenueBucketStart(
          new Date(transaction.createdAt || 0),
          revenueBucketSize,
        ),
      );
      const bucketRevenue = revenueByDate.get(bucketKey);
      if (!bucketRevenue) return;

      bucketRevenue.grossRevenue += transactionDashboardGrossRevenueAmount(
        transaction,
      );
      bucketRevenue.collectedRevenue += transactionDashboardCollectedRevenueAmount(
        transaction,
        bookingTransactions,
      );
    });

    revenueBuckets.forEach((bucket) => {
      const bucketRevenue = revenueByDate.get(bucket.key);
      if (!bucketRevenue) return;

      let date = bucket.start < chartStart ? chartStart : bucket.start;
      let dayCount = 0;
      let occupiedCapacityTotal = 0;

      while (date < bucket.end) {
        const dayEnd = new Date(date.getTime() + 86400000);
        const occupiedCapacity = occupancyBookings.reduce(
          (total, currentBooking) =>
            total + bookingOccupiedCapacityOnDate(currentBooking, date, dayEnd),
          0,
        );

        occupiedCapacityTotal += occupiedCapacity;
        dayCount += 1;
        date = dayEnd;
      }

      const averageOccupiedCapacity =
        dayCount === 0 ? 0 : occupiedCapacityTotal / dayCount;
      bucketRevenue.occupiedCapacity = averageOccupiedCapacity;
      bucketRevenue.occupancyRate = averageOccupiedCapacity / TOTAL_GUEST_CAPACITY;
    });

    const channelMix = Array.from(channelCounts.entries()).map(
      ([platformId, count]) => ({
        platformId,
        count,
      }),
    );
    const revenueSeries = Array.from(revenueByDate.entries()).map(
      ([date, revenue]) => ({
        date,
        grossRevenue: revenue.grossRevenue,
        collectedRevenue: revenue.collectedRevenue,
        occupancyRate: revenue.occupancyRate,
        occupiedCapacity: revenue.occupiedCapacity,
      }),
    );

    res.status(200).json({
      dailyGrossRevenue,
      dailyCollectedRevenue,
      monthlyGrossRevenue,
      monthlyCollectedRevenue,
      todayExpectedRevenue: dailyGrossRevenue,
      monthRoomRevenue: monthlyGrossRevenue,
      monthBookings: monthBookings.length,
      unpaidAmount,
      financialSummary: monthFinancialSummary,
      occupancyRate: occupancy / TOTAL_GUEST_CAPACITY,
      channelMix,
      revenueRange,
      revenueSeries,
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch admin dashboard stats" });
  }
};

const escapeRegex = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const getMasterBookings = async (req: Request, res: Response) => {
  const { from, to, name, bookingId, room, channel, status } = req.query;

  if (!from || !to) {
    return res.status(400).json({
      message: "Please specify from and to dates",
    });
  }

  const fromDate = new Date(`${from as string}T00:00:00`);
  const toDate = new Date(`${to as string}T00:00:00`);

  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
    return res.status(400).json({
      message: "Invalid date range",
    });
  }

  if (fromDate > toDate) {
    return res.status(400).json({
      message: "วันที่เริ่มต้นต้องไม่อยู่หลังวันที่สิ้นสุด",
    });
  }

  const endOfToDate = new Date(toDate);
  endOfToDate.setDate(endOfToDate.getDate() + 1);

  try {
    const query: Record<string, unknown> = {
      checkIn: { $lt: endOfToDate },
      checkOut: { $gt: fromDate },
    };

    if (typeof name === "string" && name.trim()) {
      query.name = { $regex: escapeRegex(name.trim()), $options: "i" };
    }

    if (typeof bookingId === "string" && bookingId.trim()) {
      query.bookingId = {
        $regex: escapeRegex(bookingId.trim()),
        $options: "i",
      };
    }

    if (typeof room === "string" && room.trim()) {
      query.$or = [
        { "roomStays.roomIds": room.trim() },
        { "roomStays.roomId": room.trim() },
      ];
    }

    if (typeof channel === "string" && channel.trim()) {
      query.platformId = channel.trim();
    }

    if (
      typeof status === "string" &&
      status.trim() &&
      BOOKING_STATUSES.includes(status.trim() as Status)
    ) {
      query.status = status.trim();
    }

    const bookings = await Booking.find(query).sort({
      checkIn: 1,
      checkOut: 1,
      name: 1,
    });
    const occupancy = await getGuestsInHouse();

    res.status(200).json({ bookings, occupancy });
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
        message: "เฉพาะผู้ดูแลระบบเท่านั้นที่สามารถลบการจองได้",
      });
    }

    const booking = await Booking.findOne({ bookingId });

    if (!booking)
      return res.status(404).json({
        message: "ไม่พบ booking นี้",
      });

    if (booking.status !== "booked") {
      return res.status(409).json({
        message: "ลบได้เฉพาะ booking ที่ยังไม่ได้ check-in",
      });
    }

    const deletedBooking = await withMutationIdempotency(req, () =>
      Booking.findOneAndDelete({ bookingId }),
    );

    if (!deletedBooking)
      return res.status(400).json({
        message: "Deletion Unsuccessfull",
      });

    res.status(200).json({
      removedBooking: deletedBooking,
      message: `Successfully deleted bookingId: ${bookingId}`,
    });

    logActivity(req.user?.username, "REMOVE_BOOKING", {
      snapshot: {
        name: deletedBooking.name,
        checkIn: deletedBooking.checkIn,
        checkOut: deletedBooking.checkOut,
        platformId: deletedBooking.platformId,
        roomIds: getRoomStayRoomIds(deletedBooking.roomStays?.[0] || {}),
        price: deletedBooking.transactions?.[0]?.amount,
        paymentMethod: deletedBooking.transactions?.[0]?.paymentMethod,
        bookingId: deletedBooking.bookingId,
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
  deposit: number;
  unpaidPayment?: {
    paymentMethod: PaymentMethod;
    roundingAdjustment?: number;
  };
  passportData: {
    namePrefix: NamePrefix;
    passportNo: string;
    passportName: string;
    nationality: string;
  };
};

export const checkIn = async (req: Request, res: Response) => {
  try {
    const { bookingId } = req.params;
    const checkInData: checkInData = req.body;

    if (!bookingId)
      return res.status(400).json({
        message: "กรุณาแนบข้อมูล bookingId เพื่อดำเนินการ check-in",
      });

    if (
      !checkInData.passportData?.namePrefix ||
      !checkInData.passportData?.nationality ||
      !checkInData.passportData?.passportNo ||
      !checkInData.passportData?.passportName ||
      checkInData.deposit == null
    ) {
      return res.status(400).json({
        message: "กรุณากรอกข้อมูลให้ครบทุกช่อง",
      });
    }

    if (!NAME_PREFIXES.includes(checkInData.passportData.namePrefix)) {
      return res.status(400).json({
        message: "คำนำหน้าชื่อไม่ถูกต้อง",
      });
    }

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

    if (todayStart < checkInDateStart) {
      return res.status(409).json({
        message: "ยังไม่ถึงวันเช็คอินของ booking นี้",
      });
    }

    if (todayStart >= checkOutDateStart) {
      return res.status(409).json({
        message:
          "booking นี้เลยวันเช็คเอาท์แล้ว กรุณาแก้ไขวันที่หรือยกเลิกก่อน check-in",
      });
    }

    const hasDeposit = existingBooking.transactions.some(
      (transaction) => transaction.type === "deposit",
    );

    if (hasDeposit) {
      return res.status(409).json({
        message: "booking นี้มีรายการมัดจำแล้ว",
      });
    }

    const unpaidRoomCharge = existingBooking.transactions.find(
      (transaction) =>
        transaction.type === "roomCharge" &&
        transaction.paymentMethod === "Unpaid",
    );

    if (unpaidRoomCharge && !checkInData.unpaidPayment) {
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

    if (checkInData.unpaidPayment && !unpaidRoomCharge) {
      return res.status(400).json({
        message: "booking นี้ไม่มีค่าห้องค้างชำระ",
      });
    }

    const hashPassport = (passportNo: string) => {
      return crypto.createHash("sha256").update(passportNo).digest("hex");
    };

    const encrypt = (text: string) => {
      if (!process.env.CRYPTO_SECRET) throw new Error("CRYPTO_SECRET Missing");

      const key = Buffer.from(process.env.CRYPTO_SECRET, "hex");
      const iv = crypto.randomBytes(12);

      const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);

      let cipherText = cipher.update(text, "utf8", "hex");
      cipherText += cipher.final("hex");

      const authTag = cipher.getAuthTag();

      return {
        iv: iv.toString("hex"),
        cipherText,
        authTag: authTag.toString("hex"),
      };
    };

    const encryptedPassportData = {
      passportHash: hashPassport(checkInData.passportData.passportNo),
      namePrefix: checkInData.passportData.namePrefix,
      nationality: checkInData.passportData.nationality,
      passportNo: encrypt(checkInData.passportData.passportNo),
      passportName: encrypt(checkInData.passportData.passportName),
    };

    let newTransactions: transcation[] = [
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
    ];

    const roundingAdjustment = Number(
      checkInData.unpaidPayment?.roundingAdjustment || 0,
    );

    if (!Number.isFinite(roundingAdjustment)) {
      return res.status(400).json({
        message: "ยอดปรับเศษเงินไม่ถูกต้อง",
      });
    }

    if (roundingAdjustment)
      newTransactions.push(
        normalizeTransaction(
          {
            type: "adjustment",
            paymentMethod: "Cash",
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

    if (checkInData.unpaidPayment && unpaidRoomCharge) {
      newTransactions.push(
        ...buildTransactionsWithCardSurcharge(
          {
            type: "settlementCharge",
            paymentMethod: checkInData.unpaidPayment.paymentMethod,
            relatedTransactionType: "roomCharge",
            relatedTransactionId: String(unpaidRoomCharge._id),
            amount: unpaidRoomCharge.amount,
          },
          {
            createdBy: req.user?.username,
            sourceAction: "CHECK_IN",
            note: "Unpaid room charge settled at check-in",
          },
        ),
      );
    }
    newTransactions = await attachActiveCashShift(newTransactions);

    const checkedInAt = new Date();
    const setFields: Record<string, unknown> = {
      status: "checkedIn",
      checkInByStaffUsername: req.user?.username,
      checkedInAt,
      passport: encryptedPassportData,
    };

    const updateQuery: Record<string, unknown> = {
      bookingId,
      status: "booked",
    };
    const updateOperation: Record<string, unknown> = {
      $push: {
        transactions: {
          $each: newTransactions,
        },
      },
      $set: setFields,
    };

    if (checkInData.unpaidPayment && unpaidRoomCharge) {
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

    const updatedBooking = await withMutationIdempotency(req, () =>
      Booking.findOneAndUpdate(updateQuery, updateOperation, {
        returnDocument: "after",
      }),
    );

    if (!updatedBooking) {
      return res.status(409).json({
        message: "booking นี้ไม่สามารถ check-in ซ้ำได้",
      });
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
        },
      },
      String(bookingId),
    );
  } catch (err) {
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
    const checkedOutByStaffUsername = req.user?.username;

    if (!bookingId)
      return res.status(400).json({
        message: "กรุณาแนบข้อมูล bookingId เพื่อดำเนินการ check-out",
      });

    if (typeof depositReturned !== "boolean") {
      return res.status(400).json({
        error: "INVALID_PAYLOAD",
        message: "กรุณายืนยันการคืนมัดจำ",
      });
    }

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

    if (existingBooking.status !== "checkedIn") {
      return res.status(409).json({
        message: "สามารถ check-out ได้เฉพาะ booking ที่ check-in แล้ว",
      });
    }

    const depositAmount = existingBooking.transactions
      .filter((transaction) => transaction.type === "deposit")
      .reduce((sum, transaction) => sum + transaction.amount, 0);
    const refundedDepositAmount = existingBooking.transactions
      .filter((transaction) => transaction.type === "depositRefund")
      .reduce((sum, transaction) => sum + transaction.amount, 0);
    const remainingDepositAmount = Math.max(
      depositAmount - refundedDepositAmount,
      0,
    );

    if (remainingDepositAmount > 0 && !depositReturned) {
      return res.status(400).json({
        error: "DEPOSIT_NOT_CONFIRMED",
        message: "กรุณายืนยันการคืนมัดจำก่อน check-out",
      });
    }

    if (!req.user?.admin && remainingDepositAmount >= LARGE_REFUND_THRESHOLD) {
      return res.status(403).json({
        error: "ADMIN_APPROVAL_REQUIRED",
        message: "ยอดคืนเงินสูง ต้องให้ Admin ดำเนินการ",
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
    const refundTransactions: transcation[] = await attachActiveCashShift(
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
        : [],
    );

    const updatedBooking = await withMutationIdempotency(req, () =>
      Booking.findOneAndUpdate(
        { bookingId, status: "checkedIn" },
        {
          $set: {
            status: "checkedOut",
            checkout: {
              roomReleaseStatus,
              depositRefundAmount: remainingDepositAmount,
              checkedOutAt: new Date(),
              checkedOutByStaffUsername,
              earlyCheckOut,
              nightsEarly,
            },
          },
          ...(refundTransactions.length > 0
            ? {
                $push: {
                  transactions: {
                    $each: refundTransactions,
                  },
                },
              }
            : {}),
        },
        { returnDocument: "after" },
      ),
    );

    if (!updatedBooking) {
      return res.status(404).json({
        message: "ไม่พบ booking นี้",
      });
    }

    res.status(200).json({
      message: "Check-out สำเร็จ",
      booking: updatedBooking,
    });

    logActivity(
      req.user?.username,
      "CHECK_OUT",
      {
        changes: {
          status: { before: "checkedIn", after: "checkedOut" },
          transactions: {
            before: existingBooking.transactions,
            after: updatedBooking.transactions,
          },
        },
        summary: {
          depositRefundAmount: remainingDepositAmount,
          roomReleaseStatus,
          earlyCheckOut,
          nightsEarly,
        },
      },
      String(bookingId),
    );
  } catch (err) {
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
};

type Room = {
  roomId: string;
  bookings: CalendarBooking[];
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
      ...ROOM_BLOCKING_BOOKING_FILTER,
      checkIn: { $lt: endingDate },
      checkOut: { $gt: startingDate },
    });

    const rooms: Room[] = [
      {
        roomId: "Balcony",
        bookings: [],
      },
      {
        roomId: "Window",
        bookings: [],
      },
      {
        roomId: "Pottery 1",
        bookings: [],
      },
      {
        roomId: "Pottery 2",
        bookings: [],
      },

      ...Array.from({ length: 14 }, (_, i) => ({
        roomId: `Siesta ${i + 1}`,
        bookings: [],
      })),

      ...Array.from({ length: 8 }, (_, i) => ({
        roomId: `Marquisette ${i + 1}`,
        bookings: [],
      })),

      ...Array.from({ length: 8 }, (_, i) => ({
        roomId: `Homespan ${i + 1}`,
        bookings: [],
      })),

      ...Array.from({ length: 6 }, (_, i) => ({
        roomId: `Veranda ${i + 1}`,
        bookings: [],
      })),

      ...Array.from({ length: 6 }, (_, i) => ({
        roomId: `Wicker ${i + 1}`,
        bookings: [],
      })),
    ];

    monthOfBookings.forEach((booking) => {
      booking.roomStays.forEach((roomStay) => {
        getRoomStayRoomIds(roomStay).forEach((roomId) => {
          const roomWithMatchingId = rooms.find((room) => room.roomId === roomId);
          roomWithMatchingId?.bookings.push({
            name: booking.name,
            platformId: booking.platformId,
            bookingId: booking.bookingId,
            from: roomStay.from,
            to: roomStay.to,
            status: booking.status,
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

    const booking = await Booking.findOne({ bookingId });

    res.status(200).json(booking);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
};

export const manageRoomStays = async (req: Request, res: Response) => {
  try {
    const { roomStays } = req.body;
    const { bookingId } = req.params;

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

    if (booking.status === "checkedOut") {
      return res.status(409).json({
        error: "BOOKING_CHECKED_OUT",
        message: "ไม่สามารถแก้ไขช่วงพักของ booking ที่ check-out แล้ว",
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

    const roomIds = getUniqueRoomIdsFromRoomStays(sorted);
    const minFrom = new Date(sorted[0].from);
    const maxTo = new Date(sorted[sorted.length - 1].to);

    const manageResult = await withRoomMutationLocks(sorted, async () => {
      const conflictingBookings = await Booking.find({
        bookingId: { $ne: bookingId },
        ...ROOM_BLOCKING_BOOKING_FILTER,

        ...buildRoomConflictQuery(roomIds, minFrom, maxTo),
      });

      const hasConflict = conflictingBookings.some((booking) =>
        booking.roomStays.some((existing: roomStay) =>
          sorted.some((incoming: roomStay) =>
            roomStaysConflict(existing, incoming),
          ),
        ),
      );

      if (hasConflict) {
        return { hasConflict };
      }

      const updatedBooking = await Booking.findOneAndUpdate(
        { bookingId },
        {
          $set: {
            roomStays: sorted,
          },
        },
        { returnDocument: "after" },
      );

      return { updatedBooking };
    });

    if (manageResult.hasConflict) {
      return res.status(409).json({
        error: "ROOM_CONFLICT",
        message: "ห้องถูกจองในช่วงเวลานี้",
      });
    }

    const updatedBooking = manageResult.updatedBooking;

    logActivity(
      req.user?.username,
      "MANAGE_ROOM_STAYS",
      {
        summary: {
          beforeRoomStays: originalRoomStays,
          afterRoomStays: sorted,
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

type AddTransactionRequestBody = {
  transaction: transcation;
};
type AddTransactionParams = {
  bookingId: string;
};

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

    if (
      !req.user?.admin &&
      (booking.status === "checkedOut" || booking.status === "cancelled")
    ) {
      return res.status(403).json({
        error: "ADMIN_APPROVAL_REQUIRED",
        message: "รายการหลังปิด Booking ต้องให้ Admin ดำเนินการ",
      });
    }

    if (
      !req.user?.admin &&
      transaction.type === "depositRefund" &&
      amount >= LARGE_REFUND_THRESHOLD
    ) {
      return res.status(403).json({
        error: "ADMIN_APPROVAL_REQUIRED",
        message: "ยอดคืนเงินสูง ต้องให้ Admin ดำเนินการ",
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

    const baseTransaction: transcation = {
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

    const sameTypeCount = booking.transactions.filter(
      (existingTransaction) => existingTransaction.type === transaction.type,
    ).length;
    const newTransactions = await attachActiveCashShift(
      buildTransactionsWithCardSurcharge(baseTransaction, {
        createdBy: req.user?.username,
        sourceAction: "ADD_TRANSACTION",
        note: transaction.note,
        reference: transaction.reference,
        sameTypeCount,
      }),
    );

    const updatedBooking = await withMutationIdempotency(req, () =>
      Booking.findOneAndUpdate(
        { bookingId },
        {
          $push: {
            transactions: {
              $each: newTransactions,
            },
          },
        },
        { returnDocument: "after" },
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
    if (err instanceof IdempotencyConflictError) {
      return sendDuplicateMutationResponse(res);
    }

    res.status(500).json({ error: (err as Error).message });
  }
};

export const getPassportData = async (req: Request, res: Response) => {
  try {
    const { bookingId } = req.params;

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
      .select("passport")
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

    res.status(200).json({ passportData });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
};

export const cancelBooking = async (req: Request, res: Response) => {
  try {
    const { bookingId } = req.params;
    const { cancellationType, reopenRoom } = req.body;
    const cancelledByStaffUsername = req.user?.username;
    const paidCancellationTypes = ["refundable", "non_refundable"];

    if (!bookingId)
      return res.status(400).json({
        error: "MISSING",
        message: "กรุณากรอก BookingId ใน Params",
      });

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
    if (existingBooking.status !== "booked")
      return res.status(409).json({
        message: "สามารถยกเลิกได้เฉพาะ Booking ที่ยังไม่ได้ Check-In",
      });

    const paidByMethod = existingBooking.transactions.reduce(
      (totals, transaction) => {
        if (transaction.paymentMethod === "Unpaid") return totals;
        totals.set(
          transaction.paymentMethod,
          (totals.get(transaction.paymentMethod) || 0) + transaction.amount,
        );
        return totals;
      },
      new Map<PaymentMethod, number>(),
    );
    const paidAmount = Array.from(paidByMethod.values()).reduce(
      (sum, amount) => sum + amount,
      0,
    );
    const hasReceivedPayment = paidAmount > 0;

    if (
      hasReceivedPayment &&
      (typeof cancellationType !== "string" ||
        !paidCancellationTypes.includes(cancellationType))
    )
      return res.status(400).json({
        error: "INVALID_PAYLOAD",
        message: "กรุณาระบุประเภทการยกเลิกให้ถูกต้อง",
      });

    const refundAmount =
      hasReceivedPayment && cancellationType === "refundable" ? paidAmount : 0;
    const keptAmount =
      hasReceivedPayment && cancellationType === "non_refundable"
        ? paidAmount
        : 0;

    if (!req.user?.admin && refundAmount >= LARGE_REFUND_THRESHOLD) {
      return res.status(403).json({
        error: "ADMIN_APPROVAL_REQUIRED",
        message: "ยอดคืนเงินสูง ต้องให้ Admin ดำเนินการ",
      });
    }
    const refundTransactions: transcation[] = await attachActiveCashShift(
      refundAmount > 0
        ? Array.from(paidByMethod.entries()).map(([paymentMethod, amount]) =>
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
          )
        : [],
    );

    const updatedBooking = await withMutationIdempotency(req, () =>
      Booking.findOneAndUpdate(
        { bookingId, status: "booked" },
        {
          $set: {
            status: "cancelled",
            cancellation: {
              cancellationType: hasReceivedPayment
                ? cancellationType
                : "no_payment_received",
              roomReleaseStatus: reopenRoom ? "released" : "blocked",
              refundAmount,
              keptAmount,
              cancelledAt: new Date(),
              cancelledByStaffUsername,
            },
          },
          ...(refundTransactions.length > 0
            ? {
                $push: {
                  transactions: {
                    $each: refundTransactions,
                  },
                },
              }
            : {}),
        },
        { returnDocument: "after" },
      ),
    );

    if (!updatedBooking) {
      return res.status(404).json({
        error: "NOT_FOUND",
        message: "ไม่พบการจอง",
      });
    }

    res.status(200).json({
      message: "ยกเลิกการจองเรียบร้อย",
      booking: updatedBooking,
    });

    logActivity(
      req.user?.username,
      "CANCEL_BOOKING",
      {
        changes: {
          status: { before: "booked", after: "cancelled" },
          transactions: {
            before: existingBooking.transactions,
            after: updatedBooking.transactions,
          },
        },
        summary: {
          cancellationType: hasReceivedPayment
            ? cancellationType
            : "no_payment_received",
          refundAmount,
          keptAmount,
          roomReleaseStatus: reopenRoom ? "released" : "blocked",
        },
      },
      String(bookingId),
    );
  } catch (err) {
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
  outcome: ResolutionOutcome;
  finalStatus: Status;
  roomReleaseStatus: RoomReleaseStatus;
  reasonCode: string;
  note: string;
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
    const {
      outcome,
      finalStatus,
      roomReleaseStatus,
      reasonCode,
      note,
      transactions = [],
    } = req.body;
    const resolvedByStaffUsername = req.user?.username;

    if (!bookingId) {
      return res.status(400).json({
        error: "MISSING",
        message: "กรุณากรอก BookingId ใน Params",
      });
    }

    if (!resolvedByStaffUsername) {
      return res.status(401).json({
        error: "NOT_AUTHORIZED",
        message: "กรุณาเข้าสู่ระบบใหม่",
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

    if (
      !bookingIsClosed &&
      ((outcome === "no_show" && finalStatus !== "noShow") ||
        (outcome !== "no_show" && finalStatus === "noShow"))
    ) {
      return res.status(400).json({
        error: "INVALID_NO_SHOW_STATUS",
        message: "No-Show ต้องใช้สถานะสุดท้ายเป็น No-Show เท่านั้น",
      });
    }

    let normalizedTransactions: transcation[] = [];
    let sensitiveOutTotal = 0;
    let depositRefundAmount = 0;
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
        direction: transaction.direction,
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

    if (!req.user?.admin && sensitiveOutTotal >= LARGE_REFUND_THRESHOLD) {
      return res.status(403).json({
        error: "ADMIN_APPROVAL_REQUIRED",
        message: "ยอดคืนเงินสูง ต้องให้ Admin ดำเนินการ",
      });
    }
    normalizedTransactions = await attachActiveCashShift(normalizedTransactions);

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
      Booking.findOneAndUpdate(
        { bookingId },
        {
          $set: updateSet,
          ...(normalizedTransactions.length > 0
            ? {
                $push: {
                  transactions: {
                    $each: normalizedTransactions,
                  },
                },
              }
            : {}),
        },
        { returnDocument: "after" },
      ),
    );

    if (!updatedBooking) {
      return res.status(404).json({
        error: "BOOKING_NOT_FOUND",
        message: "ไม่พบ booking นี้",
      });
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
    if (err instanceof IdempotencyConflictError) {
      return sendDuplicateMutationResponse(res);
    }

    res.status(500).json({ error: (err as Error).message });
  }
};

export const getNeedsReviewBookings = async (req: Request, res: Response) => {
  try {
    const { start: todayStart } = getBusinessDayBounds();
    const thirtyDaysAgo = new Date(todayStart);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const lateCheckInBookings = await Booking.find({
      status: "booked",
      checkIn: { $gte: thirtyDaysAgo, $lt: todayStart },
    }).sort({ checkIn: 1, name: 1 });

    const lateCheckOutBookings = await Booking.find({
      status: "checkedIn",
      checkOut: { $gte: thirtyDaysAgo, $lt: todayStart },
    }).sort({ checkOut: 1, name: 1 });

    res.status(200).json({
      lateCheckIns: lateCheckInBookings,
      lateCheckOuts: lateCheckOutBookings,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
};
