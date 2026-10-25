import { Request, Response } from "express";
import crypto from "crypto";
import mongoose, { type ClientSession } from "mongoose";
import Booking from "../models/booking";
import CashShift from "../models/cashShift";
import CashShiftReopenCorrection from "../models/cashShiftReopenCorrection";
import DailyClose from "../models/dailyClose";
import User from "../models/user";
import StandaloneSale from "../models/standaloneSale";
import type {
  booking,
  PaymentMethod,
  PlatformId,
  transcation,
  TransactionType,
} from "../models/booking";
import { logActivity, logActivityStrict } from "../services/activityServices";
import {
  CASH_VARIANCE_THRESHOLD,
  bookingTransactionTodayReductionAmount,
  bookingTodayArrivalRevenueAmount,
  calculateTodayRevenueSummary,
  cashBalanceAfterMovements,
  isValidCashCount,
  summarizeTransactions,
  summarizeCashStashes,
  transactionTodayExtrasRevenueAmount,
  transactionDirection,
  transactionFallsOnBusinessDate,
  transactionCorrectionNeedsReview,
  transactionRequiresReview,
} from "../helpers/financeHelpers";
import {
  buildDepositReturnReminder,
  type DepositReturnReminder,
} from "../helpers/depositReturnReminderHelpers";
import { nextBusinessDateKey } from "../helpers/depositPreparationHelpers";
import {
  effectiveCommercialSegments,
  transactionPlatformId,
} from "../helpers/commercialSegmentHelpers";
import {
  IdempotencyConflictError,
  withMutationIdempotency,
} from "../services/mutationIdempotency";
import {
  CashShiftMutationConflictError,
  withCashShiftMutationLock,
} from "../services/cashShiftMutationLock";
import { CashShiftLedgerConflictError } from "../services/cashLedgerTransaction";
import { withEffectiveTransactions } from "../services/transactionCorrections";
import {
  bookingRevisionPredicate,
  sendBookingRevisionConflict,
} from "../services/bookingConcurrency";
import {
  buildExpectedStayRevenueEntries,
  buildExpectedStayRevenueServiceEntries,
  EXPECTED_STAY_REVENUE_SERVICE_TYPES,
  expectedStayRevenueBookingQuery,
  summarizeExpectedStayRevenue,
} from "../helpers/expectedStayRevenueHelpers";

const sendDuplicateMutationResponse = (res: Response) =>
  res.status(409).json({
    error: "DUPLICATE_REQUEST",
    message: "คำขอนี้ถูกส่งซ้ำหรือเพิ่งดำเนินการสำเร็จ กรุณารีเฟรชข้อมูล",
  });

const BUSINESS_TIME_ZONE = "Asia/Bangkok";
const BANGKOK_UTC_OFFSET_HOURS = 7;
const CASH_SHIFT_REOPEN_ENABLED =
  process.env.CASH_SHIFT_REOPEN_ENABLED !== "false";

const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value as Record<string, unknown>)
    .sort()
    .map(
      (key) =>
        `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`,
    )
    .join(",")}}`;
};

const sha256 = (value: string) =>
  crypto.createHash("sha256").update(value).digest("hex");

const expectedStayRevenueTransactionMeta: Partial<
  Record<TransactionType, { label: string; color: string; icon: string }>
> = {
  roomCharge: { label: "ค่าห้อง", color: "#51d1dc", icon: "bx-bed-alt" },
  depositKept: {
    label: "มัดจำที่แขกยอมเสีย",
    color: "#eab308",
    icon: "bx-wallet",
  },
  adjustment: { label: "ปรับราคา", color: "#a78bfa", icon: "bx-edit-alt" },
  towel: { label: "Towel", color: "#38bdf8", icon: "bx-bath" },
  motorbike: { label: "Motorbike", color: "#fb923c", icon: "bx-cycling" },
  slowBoat: { label: "Slow Boat", color: "#2dd4bf", icon: "bx-water" },
  joinTour: { label: "Join Tour", color: "#22c55e", icon: "bx-map" },
  extraBed: { label: "Extra Bed", color: "#ec4899", icon: "bx-bed" },
  pickACraft: { label: "Pick A Craft", color: "#f59e0b", icon: "bx-palette" },
  trek2D: { label: "Trek 2D", color: "#16a34a", icon: "bx-map-alt" },
  setMenu: { label: "Set Menu", color: "#84cc16", icon: "bx-food-menu" },
  sleeperBus: { label: "Sleeper Bus", color: "#6366f1", icon: "bx-bus" },
  onlyWalk: { label: "Only Walk", color: "#14b8a6", icon: "bx-walk" },
  laundry: { label: "Laundry", color: "#60a5fa", icon: "bx-washer" },
  bicycle: { label: "Bicycle", color: "#fb923c", icon: "bx-cycling" },
  car: { label: "Car", color: "#64748b", icon: "bx-car" },
  misc: { label: "Misc", color: "#94a3b8", icon: "bx-dots-horizontal-rounded" },
  rainCoat: { label: "Rain Coat", color: "#0ea5e9", icon: "bx-cloud-rain" },
  passwordLock: { label: "Password Lock", color: "#8b5cf6", icon: "bx-lock" },
  cooking: { label: "Cooking", color: "#f97316", icon: "bx-food-menu" },
  cardSurcharge: {
    label: "ค่าธรรมเนียมบัตร 3%",
    color: "#94a3b8",
    icon: "bx-credit-card-alt",
  },
  roomRefund: { label: "คืนค่าห้อง", color: "#fb7185", icon: "bx-undo" },
  roomChargeWriteOff: {
    label: "ปิดยอดค่าห้องที่เหลือ",
    color: "#94a3b8",
    icon: "bx-calendar-x",
  },
  cancellationRefund: {
    label: "คืนเงินยกเลิก",
    color: "#fb7185",
    icon: "bx-calendar-x",
  },
  compensation: { label: "ชดเชยลูกค้า", color: "#38bdf8", icon: "bx-gift" },
};

const expectedStayRevenueTypes = new Set<TransactionType>([
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

const expectedStayRevenueReductionTypes = new Set<TransactionType>([
  "roomRefund",
  "roomChargeWriteOff",
  "cancellationRefund",
  "compensation",
]);

const paymentMethodMeta: Record<
  PaymentMethod,
  { label: string; icon: string }
> = {
  OTA: { label: "OTA", icon: "bx-bank" },
  Cash: { label: "Cash", icon: "bx-currency-notes" },
  Card: { label: "Card", icon: "bx-credit-card-alt" },
  Transfer: { label: "Transfer", icon: "bx-arrow-right-left" },
  Unpaid: { label: "Unpaid", icon: "bx-alert-triangle" },
};

type ExpectedStayRevenueBreakdownTransaction = {
  transactionId?: string;
  bookingId?: string;
  saleId?: string;
  sourceType?: "booking" | "standaloneSale";
  guestName: string;
  platformId: PlatformId;
  type: TransactionType;
  label: string;
  color: string;
  icon: string;
  amount: number;
  paymentMethod: transcation["paymentMethod"];
  paymentMethodLabel?: string;
  stayChargeKind?: "original" | "extension";
  direction?: transcation["direction"];
  createdAt?: Date;
  createdBy?: string;
  staff?: {
    username: string;
    name?: string;
    profilePictureUrl?: string;
  };
  note?: string;
  reference?: string;
};

const standaloneSaleBookingView = (sale: any): booking =>
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
  }) as unknown as booking;

const standaloneTransactionMeta = (source: booking) => {
  const value = source as unknown as {
    sourceType?: "standaloneSale";
    saleId?: string;
  };
  return value.sourceType === "standaloneSale"
    ? {
        sourceType: "standaloneSale" as const,
        saleId: value.saleId || source.bookingId,
      }
    : { sourceType: "booking" as const, bookingId: source.bookingId };
};

type ExpectedStayRevenueBreakdownCategory = {
  type: TransactionType;
  label: string;
  color: string;
  icon: string;
  total: number;
  percentage: number;
  transactionCount: number;
  transactions: ExpectedStayRevenueBreakdownTransaction[];
};

type ExpectedStayRevenuePaymentMethodBreakdown = {
  paymentMethod: PaymentMethod;
  label: string;
  icon: string;
  total: number;
  percentage: number;
  transactionCount: number;
  transactions: ExpectedStayRevenueBreakdownTransaction[];
};

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

const formatBusinessDateKey = (date: Date) => {
  const parts = getBusinessDateParts(date);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(
    parts.day,
  ).padStart(2, "0")}`;
};

const parseBusinessDateKey = (dateKey?: string) => {
  if (!dateKey || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return null;

  const [year, month, day] = dateKey.split("-").map(Number);
  if (!year || !month || !day) return null;

  return getBusinessDateStart(year, month, day);
};

const getBusinessMonthBounds = (date = new Date()) => {
  const parts = getBusinessDateParts(date);
  const start = getBusinessDateStart(parts.year, parts.month, 1);
  const end =
    parts.month === 12
      ? getBusinessDateStart(parts.year + 1, 1, 1)
      : getBusinessDateStart(parts.year, parts.month + 1, 1);

  return { start, end };
};

const getExpectedStayRevenueBounds = (startDate?: string, endDate?: string) => {
  if (!startDate && !endDate) return getBusinessMonthBounds();

  const start = parseBusinessDateKey(startDate);
  const end = parseBusinessDateKey(endDate);

  if (!start || !end || start >= end) return null;
  return { start, end };
};

const getBusinessDayBoundsFromKey = (dateKey?: string) => {
  if (dateKey && !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return null;

  const parts = dateKey
    ? dateKey.split("-").map(Number)
    : [
        getBusinessDateParts().year,
        getBusinessDateParts().month,
        getBusinessDateParts().day,
      ];
  const start = getBusinessDateStart(parts[0], parts[1], parts[2]);
  const end = new Date(start.getTime() + 86400000);

  return {
    businessDate: `${parts[0]}-${String(parts[1]).padStart(2, "0")}-${String(
      parts[2],
    ).padStart(2, "0")}`,
    start,
    end,
  };
};

const getDepositReturnReminderForDate = async (
  businessDate?: string,
  session?: ClientSession,
) => {
  const bounds = getBusinessDayBoundsFromKey(businessDate);
  if (!bounds) return null;

  const targetBusinessDate = nextBusinessDateKey(bounds.businessDate);
  const targetBounds = getBusinessDayBoundsFromKey(targetBusinessDate);
  if (!targetBounds) return null;

  const query = Booking.find({
    status: "checkedIn",
    voided: { $ne: true },
    checkOut: { $lt: targetBounds.end },
  }).select(
    "bookingId name roomStays checkOut transactions transactionCorrections",
  );
  if (session) query.session(session);

  const bookings = await query.lean<booking[]>();
  const tomorrowBookings = bookings.filter((currentBooking) => {
    const checkOut = new Date(currentBooking.checkOut).getTime();
    return (
      checkOut >= targetBounds.start.getTime() &&
      checkOut < targetBounds.end.getTime()
    );
  });
  const overdueBookings = bookings.filter(
    (currentBooking) =>
      new Date(currentBooking.checkOut).getTime() <
      targetBounds.start.getTime(),
  );

  return buildDepositReturnReminder(
    bounds.businessDate,
    tomorrowBookings,
    overdueBookings,
  );
};

const getTransactionsForBusinessDate = async (
  businessDate?: string,
  staffUsername?: string,
) => {
  const bounds = getBusinessDayBoundsFromKey(businessDate);
  if (!bounds) return null;

  const [bookings, standaloneSales] = await Promise.all([
    Booking.find({
      $or: [
        { "transactions.createdAt": { $gte: bounds.start, $lt: bounds.end } },
        { checkIn: { $gte: bounds.start, $lt: bounds.end } },
        { checkOut: { $gte: bounds.start, $lt: bounds.end } },
        { "cancellation.cancelledAt": { $gte: bounds.start, $lt: bounds.end } },
        { "checkout.checkedOutAt": { $gte: bounds.start, $lt: bounds.end } },
      ],
    }).lean<booking[]>(),
    StandaloneSale.find({
      "transactions.createdAt": { $gte: bounds.start, $lt: bounds.end },
    }).lean(),
  ]);

  const transactions = [
    ...bookings.map((booking) => withEffectiveTransactions(booking)),
    ...standaloneSales.map(standaloneSaleBookingView),
  ].flatMap((booking) =>
    (booking.transactions || [])
      .filter((transaction) =>
        transactionFallsOnBusinessDate(
          transaction,
          booking.checkIn,
          bounds.start,
          bounds.end,
        ),
      )
      .filter((transaction) => {
        if (!staffUsername) return true;
        return (
          (transaction.createdBy || booking.staffUsername) === staffUsername
        );
      })
      .map((transaction) => ({
        ...transaction,
        ...standaloneTransactionMeta(booking),
        guestName: booking.name,
        staffUsername: transaction.createdBy || booking.staffUsername,
      })),
  );

  return {
    ...bounds,
    transactions,
    summary: summarizeTransactions(transactions),
  };
};

const getCorrectionReviewEventsForBusinessDate = async (
  businessDate?: string,
) => {
  const bounds = getBusinessDayBoundsFromKey(businessDate);
  if (!bounds) return null;

  const bookings = await Booking.find({
    transactionCorrections: {
      $elemMatch: {
        correctedAt: { $gte: bounds.start, $lt: bounds.end },
        reviewStatus: { $ne: "reviewed" },
      },
    },
  })
    .select(
      "bookingId name staffUsername transactions transactionCorrections",
    )
    .lean<booking[]>();

  const transactions = bookings.flatMap((sourceBooking) => {
    return (sourceBooking.transactionCorrections || []).flatMap(
      (correction, correctionIndex, corrections) => {
        const priorCorrectionCount = corrections
          .slice(0, correctionIndex)
          .filter(
            (candidate) =>
              candidate.targetTransactionId ===
                correction.targetTransactionId && candidate.financialChange,
          ).length;
        const reviewFlags = (correction.reviewFlags || []).length
          ? correction.reviewFlags || []
          : transactionCorrectionNeedsReview(
              correction.before,
              correction.after,
              priorCorrectionCount,
            );
        if (
          correction.reviewStatus === "reviewed" ||
          reviewFlags.length === 0 ||
          new Date(correction.correctedAt) < bounds.start ||
          new Date(correction.correctedAt) >= bounds.end
        ) {
          return [];
        }
        const originalTransaction = sourceBooking.transactions.find(
          (candidate) =>
            String(candidate._id) === correction.targetTransactionId,
        );
        if (!originalTransaction) return [];
        const transaction = {
          ...originalTransaction,
          ...correction.after,
          _id: originalTransaction._id,
        };
        if (!correction.after.cashShiftId) delete transaction.cashShiftId;

        return [
          {
            ...transaction,
            _id: correction._id ? String(correction._id) : undefined,
            transactionId: correction.targetTransactionId,
            correctionId: correction._id ? String(correction._id) : undefined,
            reviewEventKind: "transactionCorrection" as const,
            reviewFlags,
            reviewStatus: correction.reviewStatus || "needs_review",
            createdAt: correction.correctedAt,
            createdBy: correction.correctedBy,
            staffUsername: correction.correctedBy,
            bookingId: sourceBooking.bookingId,
            sourceType: "booking" as const,
            guestName: sourceBooking.name,
            note: correction.note,
            correctionBeforeAmount: correction.before.amount,
            correctionAmountDelta: Number(
              (correction.after.amount - correction.before.amount).toFixed(2),
            ),
          },
        ];
      },
    );
  });

  return { ...bounds, transactions };
};

const attachDailyCloseStaffProfiles = async (
  dailyCloses: Awaited<ReturnType<typeof DailyClose.find>>,
) => {
  const usernames = [
    ...new Set(
      dailyCloses.flatMap((dailyClose) => [
        dailyClose.staffUsername,
        dailyClose.createdBy,
      ]),
    ),
  ].filter((username): username is string => Boolean(username));

  const users = await User.find({ username: { $in: usernames } })
    .select("username name profilePictureUrl")
    .lean();
  const usersByUsername = new Map(users.map((user) => [user.username, user]));

  return dailyCloses.map((dailyClose) => {
    const closeObject = dailyClose.toObject();
    const staff = usersByUsername.get(dailyClose.staffUsername);
    const closedBy = usersByUsername.get(dailyClose.createdBy);

    return {
      ...closeObject,
      staff: staff
        ? {
            username: staff.username,
            name: staff.name,
            profilePictureUrl: staff.profilePictureUrl,
          }
        : undefined,
      closedBy: closedBy
        ? {
            username: closedBy.username,
            name: closedBy.name,
            profilePictureUrl: closedBy.profilePictureUrl,
          }
        : undefined,
    };
  });
};

const getShiftTransactions = async (
  shift: { _id?: unknown },
  session?: ClientSession,
) => {
  const shiftId = String(shift._id);
  const [bookings, standaloneSales] = await Promise.all([
    Booking.find({
      $or: [
        { "transactions.cashShiftId": shiftId },
        { "transactionCorrections.after.cashShiftId": shiftId },
      ],
    })
      .session(session || null)
      .lean<booking[]>(),
    StandaloneSale.find({ "transactions.cashShiftId": shiftId })
      .session(session || null)
      .lean(),
  ]);

  return [
    ...bookings.map((booking) => withEffectiveTransactions(booking)),
    ...standaloneSales.map(standaloneSaleBookingView),
  ].flatMap((booking) =>
    (booking.transactions || [])
      .filter((transaction) => transaction.cashShiftId === shiftId)
      .map((transaction) => ({
        ...transaction,
        ...standaloneTransactionMeta(booking),
        guestName: booking.name,
        staffUsername: transaction.createdBy || booking.staffUsername,
      })),
  );
};

const getUnassignedCashTransactionsBetween = async (
  start: Date,
  end: Date,
  session?: ClientSession,
) => {
  const [bookings, standaloneSales] = await Promise.all([
    Booking.find({
      "transactions.createdAt": { $gte: start, $lt: end },
    })
      .session(session || null)
      .lean<booking[]>(),
    StandaloneSale.find({
      "transactions.createdAt": { $gte: start, $lt: end },
    })
      .session(session || null)
      .lean(),
  ]);

  return [
    ...bookings.map((booking) => withEffectiveTransactions(booking)),
    ...standaloneSales.map(standaloneSaleBookingView),
  ].flatMap((booking) =>
    (booking.transactions || [])
      .filter((transaction) => {
        if (transaction.cashShiftId) return false;
        const createdAt = new Date(transaction.createdAt || booking.checkIn);
        return createdAt >= start && createdAt < end;
      })
      .map((transaction) => ({
        ...transaction,
        ...standaloneTransactionMeta(booking),
        guestName: booking.name,
        staffUsername: transaction.createdBy || booking.staffUsername,
      })),
  );
};

const enrichCashShift = async <T extends { _id?: unknown; toObject?: () => T }>(
  cashShift: T,
) => {
  const shiftObject =
    typeof cashShift.toObject === "function" ? cashShift.toObject() : cashShift;
  const movements = summarizeCashStashes(
    await getShiftTransactions(shiftObject as T & { startedAt: Date }),
  );
  const operatingExpectedCash =
    Number((shiftObject as any).operatingOpeningCash || 0) +
    movements.operatingCashIn -
    movements.operatingCashOut;

  return {
    ...shiftObject,
    operatingCashIn: movements.operatingCashIn,
    operatingCashOut: movements.operatingCashOut,
    operatingExpectedCash,
  };
};

const operatingCashShiftView = (shift: any) => {
  const {
    depositOpeningCash: _depositOpeningCash,
    depositCashIn: _depositCashIn,
    depositCashOut: _depositCashOut,
    depositExpectedCash: _depositExpectedCash,
    depositActualCash: _depositActualCash,
    depositVariance: _depositVariance,
    depositPreparation: _depositPreparation,
    ...operatingShift
  } = shift;

  return operatingShift;
};

const cashShiftAuditView = (shift: any) => {
  const legacyValues = [
    shift.depositOpeningCash,
    shift.depositCashIn,
    shift.depositCashOut,
    shift.depositExpectedCash,
    shift.depositActualCash,
    shift.depositVariance,
    shift.depositPreparation,
  ];

  return {
    ...operatingCashShiftView(shift),
    legacyDeposit: legacyValues.some(
      (value) => value !== undefined && value !== null,
    )
      ? {
          openingCash: shift.depositOpeningCash,
          cashIn: shift.depositCashIn,
          cashOut: shift.depositCashOut,
          expectedCash: shift.depositExpectedCash,
          actualCash: shift.depositActualCash,
          variance: shift.depositVariance,
          preparation: shift.depositPreparation,
        }
      : undefined,
  };
};

const attachCashShiftStaffProfiles = async <
  T extends { staffUsername?: string; closedBy?: string },
>(
  cashShifts: T[],
) => {
  const usernames = [
    ...new Set(
      cashShifts.flatMap((cashShift) => [
        cashShift.staffUsername,
        cashShift.closedBy,
      ]),
    ),
  ].filter((username): username is string => Boolean(username));

  const users = await User.find({ username: { $in: usernames } })
    .select("username name profilePictureUrl")
    .lean();
  const usersByUsername = new Map(users.map((user) => [user.username, user]));

  return cashShifts.map((cashShift) => {
    const staff = cashShift.staffUsername
      ? usersByUsername.get(cashShift.staffUsername)
      : undefined;
    const closedBy = cashShift.closedBy
      ? usersByUsername.get(cashShift.closedBy)
      : undefined;

    return {
      ...cashShift,
      staff: staff
        ? {
            username: staff.username,
            name: staff.name,
            profilePictureUrl: staff.profilePictureUrl,
          }
        : undefined,
      closedBy: cashShift.closedBy
        ? {
            username: cashShift.closedBy,
            name: closedBy?.name,
            profilePictureUrl: closedBy?.profilePictureUrl,
          }
        : undefined,
    };
  });
};

const getCashPositionForDate = async (
  businessDate?: string,
  viewer?: { username?: string; admin?: boolean },
) => {
  const bounds = getBusinessDayBoundsFromKey(businessDate);
  if (!bounds) return null;

  const shifts = await CashShift.find({
    businessDate: bounds.businessDate,
  }).sort({
    shiftNumber: 1,
  });
  const activeShift = shifts.find((shift) => shift.status === "open");
  const previousShift = [...shifts]
    .reverse()
    .find((shift) => shift.status === "closed");
  const enrichedShifts = await attachCashShiftStaffProfiles(
    await Promise.all(shifts.map(enrichCashShift)),
  );
  const enrichedActiveShift = activeShift
    ? enrichedShifts.find(
        (shift) => String((shift as any)._id) === String(activeShift._id),
      )
    : null;
  const enrichedPreviousShift = previousShift
    ? enrichedShifts.find(
        (shift) => String((shift as any)._id) === String(previousShift._id),
      )
    : null;
  const unassignedStart = activeShift
    ? activeShift.startedAt
    : previousShift?.endedAt || bounds.start;
  const unassignedMovements = summarizeCashStashes(
    await getUnassignedCashTransactionsBetween(unassignedStart, bounds.end),
  );
  const currentOperatingCash = enrichedActiveShift
    ? enrichedActiveShift.operatingExpectedCash
    : (enrichedPreviousShift?.operatingActualCash || 0) +
      unassignedMovements.operatingCashIn -
      unassignedMovements.operatingCashOut;
  const latestShift = shifts[shifts.length - 1];
  const finalShift = previousShift?.isFinalDayClose ? previousShift : null;
  const finalShiftView = finalShift
    ? enrichedShifts.find(
        (shift) => String((shift as any)._id) === String(finalShift._id),
      )
    : null;
  const isCurrentBusinessDate =
    bounds.businessDate === formatBusinessDateKey(new Date());
  const hasUnassignedOperatingCash =
    Math.abs(unassignedMovements.operatingCashIn) > 0 ||
    Math.abs(unassignedMovements.operatingCashOut) > 0;
  const permissionAllowed = Boolean(
    finalShift &&
      viewer?.username &&
      (viewer.admin || finalShift.closedBy === viewer.username),
  );
  const recoveryDenial = !finalShift
    ? null
    : !CASH_SHIFT_REOPEN_ENABLED
      ? {
          code: "FEATURE_DISABLED",
          message: "การเปิดกะอีกครั้งถูกปิดใช้งานชั่วคราว",
        }
      : !isCurrentBusinessDate
      ? {
          code: "PAST_BUSINESS_DATE",
          message: "เปิดกะได้เฉพาะวันทำการกรุงเทพปัจจุบัน",
        }
      : activeShift
        ? { code: "OPEN_SHIFT_EXISTS", message: "มีกะเงินสดเปิดอยู่แล้ว" }
        : String(latestShift?._id) !== String(finalShift._id)
          ? { code: "NOT_LATEST_SHIFT", message: "กะนี้ไม่ใช่กะล่าสุดของวัน" }
          : hasUnassignedOperatingCash
            ? {
                code: "UNASSIGNED_CASH_ACTIVITY",
                message: "พบรายการเงินสดนอกกะหลังปิดยอด กรุณาตรวจสอบก่อน",
              }
            : !permissionAllowed
              ? {
                  code: "FORBIDDEN",
                  message: "เฉพาะผู้ปิดกะเดิมหรือเจ้าของเท่านั้นที่เปิดกะได้",
                }
              : null;

  return {
    businessDate: bounds.businessDate,
    threshold: CASH_VARIANCE_THRESHOLD,
    activeShift: enrichedActiveShift
      ? operatingCashShiftView(enrichedActiveShift)
      : null,
    previousShift: enrichedPreviousShift
      ? operatingCashShiftView(enrichedPreviousShift)
      : null,
    current: {
      operatingCash: currentOperatingCash,
    },
    unassignedCash: {
      operatingCashIn: unassignedMovements.operatingCashIn,
      operatingCashOut: unassignedMovements.operatingCashOut,
    },
    handoff: {
      operatingCash: activeShift
        ? enrichedPreviousShift?.operatingActualCash || 0
        : currentOperatingCash,
      fromShiftId: enrichedPreviousShift
        ? String(enrichedPreviousShift._id)
        : undefined,
      fromShiftNumber: enrichedPreviousShift?.shiftNumber,
    },
    shifts: enrichedShifts.map(operatingCashShiftView),
    finalCloseRecovery:
      finalShift && finalShiftView
        ? {
            eligible: !recoveryDenial,
            shiftId: String(finalShift._id),
            businessDate: finalShift.businessDate,
            shiftNumber: finalShift.shiftNumber,
            ledgerRevision: finalShift.ledgerRevision || 0,
            shiftOwner: (finalShiftView as any).staff,
            originalCloser: (finalShiftView as any).closedBy,
            originalClose: {
              endedAt: finalShift.endedAt,
              operatingExpectedCash: finalShiftView.operatingExpectedCash,
              operatingActualCash: finalShift.operatingActualCash,
              operatingVariance: finalShift.operatingVariance,
            },
            denialReason: recoveryDenial || undefined,
          }
        : null,
  };
};

type CashAuditWarning = {
  code:
    | "operating_variance"
    | "handoff_mismatch"
    | "open_shift"
    | "flagged_transactions"
    | "unassigned_cash_activity";
  severity: "warning" | "critical";
  message: string;
};

const hasCashMovement = (movements: ReturnType<typeof summarizeCashStashes>) =>
  Math.abs(movements.operatingCashIn) > 0 ||
  Math.abs(movements.operatingCashOut) > 0;

const cashMovementTotal = (
  movements: ReturnType<typeof summarizeCashStashes>,
) => movements.operatingCashIn - movements.operatingCashOut;

type OperatingCashMovements = Pick<
  ReturnType<typeof summarizeCashStashes>,
  "operatingCashIn" | "operatingCashOut"
>;

const formatCashAuditAmount = (amount: number) =>
  new Intl.NumberFormat("th-TH", { maximumFractionDigits: 2 }).format(amount);

const cashShiftReopenCorrectionView = (correction: any) => ({
  correctionId: correction.correctionId,
  shiftId: correction.shiftId,
  businessDate: correction.businessDate,
  shiftNumber: correction.shiftNumber,
  originalClose: correction.originalClose,
  reopenedAt: correction.reopenedAt,
  reopenedBy: correction.reopenedBy,
  reason: correction.reason,
  originalLedgerRevision: correction.originalLedgerRevision,
  resultingLedgerRevision: correction.resultingLedgerRevision,
});

const getCashShiftAuditForDate = async (businessDate?: string) => {
  const bounds = getBusinessDayBoundsFromKey(businessDate);
  if (!bounds) return null;
  const isCurrentBusinessDate =
    bounds.businessDate === formatBusinessDateKey(new Date());

  const shifts = await CashShift.find({
    businessDate: bounds.businessDate,
  }).sort({
    shiftNumber: 1,
  });
  const reopenCorrections = await CashShiftReopenCorrection.find({
    businessDate: bounds.businessDate,
  })
    .sort({ reopenedAt: 1 })
    .lean();
  const enrichedShifts = await attachCashShiftStaffProfiles(
    await Promise.all(shifts.map(enrichCashShift)),
  );
  const gaps: Array<{
    from: Date;
    to: Date;
    movements: OperatingCashMovements;
    warning: CashAuditWarning;
  }> = [];

  const coverage: Array<{ start: Date; end: Date }> = [];
  if (shifts.length) {
    coverage.push({ start: bounds.start, end: shifts[0].startedAt });
    shifts.forEach((shift, index) => {
      const nextShift = shifts[index + 1];
      if (shift.endedAt && nextShift) {
        coverage.push({ start: shift.endedAt, end: nextShift.startedAt });
      } else if (shift.endedAt && !nextShift) {
        coverage.push({ start: shift.endedAt, end: bounds.end });
      }
    });
  } else {
    coverage.push({ start: bounds.start, end: bounds.end });
  }

  for (const gap of coverage) {
    if (gap.end <= gap.start) continue;
    const movements = summarizeCashStashes(
      await getUnassignedCashTransactionsBetween(gap.start, gap.end),
    );
    if (!hasCashMovement(movements)) continue;
    gaps.push({
      from: gap.start,
      to: gap.end,
      movements: {
        operatingCashIn: movements.operatingCashIn,
        operatingCashOut: movements.operatingCashOut,
      },
      warning: {
        code: "unassigned_cash_activity",
        severity: "critical",
        message: `พบเงินสด ${formatCashAuditAmount(cashMovementTotal(movements))} บาทนอกกะเงินสด`,
      },
    });
  }

  const auditShifts = await Promise.all(
    enrichedShifts.map(async (shift, index) => {
      const shiftTransactions = await getShiftTransactions(
        shift as { _id?: unknown; startedAt: Date; endedAt?: Date },
      );
      const flaggedTransactions = shiftTransactions.filter(
        transactionRequiresReview,
      );
      const warnings: CashAuditWarning[] = [];
      const operatingVariance = Number(shift.operatingVariance || 0);
      if (
        shift.status === "closed" &&
        Math.abs(operatingVariance) > CASH_VARIANCE_THRESHOLD
      ) {
        warnings.push({
          code: "operating_variance",
          severity: "critical",
          message: `เงินดำเนินงานต่าง ${formatCashAuditAmount(operatingVariance)} บาท`,
        });
      }
      const isOperating =
        shift.status === "open" && isCurrentBusinessDate;
      if (shift.status === "open" && !isOperating) {
        warnings.push({
          code: "open_shift",
          severity: "warning",
          message: "กะนี้ยังไม่ปิดยอด",
        });
      }
      if (flaggedTransactions.length) {
        warnings.push({
          code: "flagged_transactions",
          severity: "warning",
          message: `มี ${flaggedTransactions.length} รายการที่ต้องตรวจ`,
        });
      }

      const previousShift = enrichedShifts[index - 1];
      let handoff: Record<string, unknown> | undefined;
      if (previousShift?.endedAt) {
        const handoffMovements = summarizeCashStashes(
          await getUnassignedCashTransactionsBetween(
            new Date(previousShift.endedAt),
            new Date(shift.startedAt),
          ),
        );
        const expectedOperatingOpening = cashBalanceAfterMovements(
          Number(previousShift.operatingActualCash || 0),
          handoffMovements.operatingCashIn,
          handoffMovements.operatingCashOut,
        );
        const operatingDifference =
          Number(shift.operatingOpeningCash) - expectedOperatingOpening;
        const mismatch =
          shift.openingMode === "counted" &&
          Math.abs(operatingDifference) > CASH_VARIANCE_THRESHOLD;
        if (mismatch) {
          warnings.push({
            code: "handoff_mismatch",
            severity: "critical",
            message: "ยอดรับส่งเงินไม่ตรงกับกะก่อนหน้า",
          });
        }
        handoff = {
          fromShiftId: String(previousShift._id),
          fromShiftNumber: previousShift.shiftNumber,
          mode: shift.openingMode,
          elapsedMinutes: Math.max(
            0,
            Math.round(
              (new Date(shift.startedAt).getTime() -
                new Date(previousShift.endedAt).getTime()) /
                60000,
            ),
          ),
          expectedOperatingOpening,
          operatingDifference,
          movements: {
            operatingCashIn: handoffMovements.operatingCashIn,
            operatingCashOut: handoffMovements.operatingCashOut,
          },
          mismatch,
        };
      }

      return {
        ...cashShiftAuditView(shift),
        reopenCorrections: reopenCorrections
          .filter((correction) => correction.shiftId === String(shift._id))
          .map(cashShiftReopenCorrectionView),
        auditStatus: warnings.length
          ? "needs_review"
          : isOperating
            ? "operating"
            : "complete",
        warnings,
        auditResolution: shift.auditResolution,
        flaggedTransactions,
        handoff,
      };
    }),
  );

  return {
    businessDate: bounds.businessDate,
    threshold: CASH_VARIANCE_THRESHOLD,
    shifts: auditShifts,
    gaps,
  };
};

const addBreakdownTransaction = (
  categories: Map<TransactionType, ExpectedStayRevenueBreakdownCategory>,
  transaction: transcation,
  booking: booking,
  amount: number,
  direction: NonNullable<transcation["direction"]>,
  paymentMethodLabel?: string,
  stayChargeKind?: "original" | "extension",
) => {
  const meta = expectedStayRevenueTransactionMeta[transaction.type] || {
    label: transaction.type,
    color: "#94a3b8",
    icon: "bx-receipt",
  };
  const existingCategory =
    categories.get(transaction.type) ||
    ({
      type: transaction.type,
      label: meta.label,
      color: meta.color,
      icon: meta.icon,
      total: 0,
      percentage: 0,
      transactionCount: 0,
      transactions: [],
    } satisfies ExpectedStayRevenueBreakdownCategory);

  existingCategory.total += amount;
  existingCategory.transactionCount += 1;
  existingCategory.transactions.push({
    transactionId: transaction._id ? String(transaction._id) : undefined,
    ...standaloneTransactionMeta(booking),
    guestName: booking.name,
    platformId: transactionPlatformId(booking, transaction),
    type: transaction.type,
    label: meta.label,
    color: meta.color,
    icon: meta.icon,
    amount,
    paymentMethod: transaction.paymentMethod,
    paymentMethodLabel,
    stayChargeKind,
    direction,
    createdAt: transaction.createdAt,
    createdBy: transaction.createdBy || booking.staffUsername,
    note: transaction.note,
    reference: transaction.reference,
  });

  categories.set(transaction.type, existingCategory);
};

const paymentAllocationEntries = (
  paymentAmounts: Record<PaymentMethod, number> | undefined,
) =>
  paymentAmounts
    ? (Object.entries(paymentAmounts) as Array<[PaymentMethod, number]>).filter(
        ([, amount]) => amount > 0,
      )
    : [];

const paymentAllocationKey = (booking: booking, transactionId: string) =>
  `${booking.bookingId}::${transactionId}`;

const paymentAllocationDisplay = (
  paymentAmounts: Record<PaymentMethod, number> | undefined,
  fallback: PaymentMethod,
) => {
  const entries = paymentAllocationEntries(paymentAmounts);
  if (!entries.length) return { paymentMethod: fallback };

  return {
    paymentMethod: entries[0][0],
    paymentMethodLabel:
      entries.length > 1
        ? entries
            .map(([paymentMethod]) => paymentMethodMeta[paymentMethod].label)
            .join(" + ")
        : undefined,
  };
};

const addPaymentAllocationBreakdown = (
  paymentMethods: Map<PaymentMethod, ExpectedStayRevenuePaymentMethodBreakdown>,
  transaction: transcation,
  booking: booking,
  paymentAmounts: Record<PaymentMethod, number> | undefined,
) => {
  const entries = paymentAllocationEntries(paymentAmounts);
  if (!entries.length) {
    addPaymentMethodBreakdownTransaction(
      paymentMethods,
      transaction,
      booking,
      Math.abs(transaction.amount || 0),
      transactionDirection(transaction),
    );
    return;
  }

  entries.forEach(([paymentMethod, amount]) => {
    const direction = paymentMethod === "Unpaid" ? "neutral" : "in";
    addPaymentMethodBreakdownTransaction(
      paymentMethods,
      { ...transaction, paymentMethod, amount, direction },
      booking,
      amount,
      direction,
    );
  });
};

const addPaymentMethodBreakdownTransaction = (
  paymentMethods: Map<PaymentMethod, ExpectedStayRevenuePaymentMethodBreakdown>,
  transaction: transcation,
  booking: booking,
  amount: number,
  direction: NonNullable<transcation["direction"]>,
) => {
  const methodMeta = paymentMethodMeta[transaction.paymentMethod];
  const transactionMeta = expectedStayRevenueTransactionMeta[
    transaction.type
  ] || {
    label: transaction.type,
    color: "#94a3b8",
    icon: "bx-receipt",
  };
  const existingPaymentMethod =
    paymentMethods.get(transaction.paymentMethod) ||
    ({
      paymentMethod: transaction.paymentMethod,
      label: methodMeta.label,
      icon: methodMeta.icon,
      total: 0,
      percentage: 0,
      transactionCount: 0,
      transactions: [],
    } satisfies ExpectedStayRevenuePaymentMethodBreakdown);

  existingPaymentMethod.total += amount;
  existingPaymentMethod.transactionCount += 1;
  existingPaymentMethod.transactions.push({
    transactionId: transaction._id ? String(transaction._id) : undefined,
    ...standaloneTransactionMeta(booking),
    guestName: booking.name,
    platformId: transactionPlatformId(booking, transaction),
    type: transaction.type,
    label: transactionMeta.label,
    color: transactionMeta.color,
    icon: transactionMeta.icon,
    amount,
    paymentMethod: transaction.paymentMethod,
    direction,
    createdAt: transaction.createdAt,
    createdBy: transaction.createdBy || booking.staffUsername,
    note: transaction.note,
    reference: transaction.reference,
  });

  paymentMethods.set(transaction.paymentMethod, existingPaymentMethod);
};

const todayArrivalPaymentMethod = (
  booking: booking,
  roomCharge: transcation,
): PaymentMethod => {
  if (roomCharge.paymentMethod !== "Unpaid") return roomCharge.paymentMethod;

  const settlement = (booking.transactions || []).find(
    (transaction) =>
      transaction.type === "settlementCharge" &&
      transaction.paymentMethod !== "Unpaid" &&
      transaction.relatedTransactionType === "roomCharge" &&
      transaction.relatedTransactionId === String(roomCharge._id),
  );

  return settlement?.paymentMethod || roomCharge.paymentMethod;
};

const finalizeBreakdownCategories = (
  categories: Map<TransactionType, ExpectedStayRevenueBreakdownCategory>,
  expectedStayRevenue: number,
) =>
  Array.from(categories.values())
    .map((category) => ({
      ...category,
      total: Number(category.total.toFixed(2)),
      percentage:
        expectedStayRevenue === 0
          ? 0
          : Number(((category.total / expectedStayRevenue) * 100).toFixed(2)),
      transactions: category.transactions.sort((first, second) => {
        const firstTime = first.createdAt
          ? new Date(first.createdAt).getTime()
          : 0;
        const secondTime = second.createdAt
          ? new Date(second.createdAt).getTime()
          : 0;
        return secondTime - firstTime;
      }),
    }))
    .sort((first, second) => second.total - first.total);

const finalizePaymentMethodBreakdowns = (
  paymentMethods: Map<PaymentMethod, ExpectedStayRevenuePaymentMethodBreakdown>,
  expectedStayRevenue: number,
) =>
  Array.from(paymentMethods.values())
    .map((paymentMethod) => ({
      ...paymentMethod,
      total: Number(paymentMethod.total.toFixed(2)),
      percentage:
        expectedStayRevenue === 0
          ? 0
          : Number(
              ((paymentMethod.total / expectedStayRevenue) * 100).toFixed(2),
            ),
      transactions: paymentMethod.transactions.sort((first, second) => {
        const firstTime = first.createdAt
          ? new Date(first.createdAt).getTime()
          : 0;
        const secondTime = second.createdAt
          ? new Date(second.createdAt).getTime()
          : 0;
        return secondTime - firstTime;
      }),
    }))
    .sort((first, second) => second.total - first.total);

type RevenueBreakdownGroup = {
  transactions: ExpectedStayRevenueBreakdownTransaction[];
};

type RevenueBreakdownStaffProfile = {
  username: string;
  name?: string;
  profilePictureUrl?: string;
};

const loadRevenueBreakdownStaffProfiles = async (
  ...groupSets: RevenueBreakdownGroup[][]
) => {
  const usernames = [
    ...new Set(
      groupSets.flatMap((groups) =>
        groups.flatMap((group) =>
          group.transactions.map((transaction) => transaction.createdBy),
        ),
      ),
    ),
  ].filter((username): username is string => Boolean(username));

  const users = await User.find({ username: { $in: usernames } })
    .select("username name profilePictureUrl")
    .lean<RevenueBreakdownStaffProfile[]>();

  return new Map(users.map((user) => [user.username, user]));
};

const attachRevenueBreakdownStaffProfiles = <T extends RevenueBreakdownGroup>(
  groups: T[],
  usersByUsername: Map<string, RevenueBreakdownStaffProfile>,
) =>
  groups.map((group) => ({
    ...group,
    transactions: group.transactions.map((transaction) => {
      if (!transaction.createdBy) return transaction;

      const user = usersByUsername.get(transaction.createdBy);
      return {
        ...transaction,
        staff: {
          username: transaction.createdBy,
          name: user?.name,
          profilePictureUrl: user?.profilePictureUrl,
        },
      };
    }),
  }));

export const getExpectedStayRevenueBreakdown = async (
  req: Request,
  res: Response,
) => {
  try {
    if (!req.user?.admin) {
      return res.status(403).json({
        message: "เฉพาะผู้ดูแลระบบเท่านั้นที่สามารถดูสรุปรายได้นี้ได้",
      });
    }

    const bounds = getExpectedStayRevenueBounds(
      req.query.startDate as string | undefined,
      req.query.endDate as string | undefined,
    );

    if (!bounds) {
      return res.status(400).json({
        message: "Invalid date range. Use startDate and endDate as YYYY-MM-DD.",
      });
    }

    const [bookingRecords, standaloneSales] = await Promise.all([
      Booking.find(
        expectedStayRevenueBookingQuery(bounds.start, bounds.end),
      ).lean<booking[]>(),
      StandaloneSale.find({
        transactions: {
          $elemMatch: {
            type: { $in: EXPECTED_STAY_REVENUE_SERVICE_TYPES },
            createdAt: { $gte: bounds.start, $lt: bounds.end },
          },
        },
      }).lean(),
    ]);
    const summary = summarizeExpectedStayRevenue(
      [
        ...bookingRecords,
        ...standaloneSales.map(standaloneSaleBookingView),
      ],
      bounds.start,
      bounds.end,
    );
    const categories = new Map<
      TransactionType,
      ExpectedStayRevenueBreakdownCategory
    >();
    const reductions = new Map<
      TransactionType,
      ExpectedStayRevenueBreakdownCategory
    >();
    const paymentMethods = new Map<
      PaymentMethod,
      ExpectedStayRevenuePaymentMethodBreakdown
    >();

    summary.entries.forEach((entry) => {
      addBreakdownTransaction(
        categories,
        entry.roomCharge,
        entry.booking,
        Math.abs(entry.roomCharge.amount ?? entry.segment.amount ?? 0),
        "in",
        undefined,
        entry.segment.kind,
      );

      entry.chargeAdjustments.forEach(({ transaction, amount }) => {
        addBreakdownTransaction(
          categories,
          transaction,
          entry.booking,
          amount,
          "in",
        );
      });

      entry.reductions.forEach(({ transaction, amount }) => {
        addBreakdownTransaction(
          reductions,
          transaction,
          entry.booking,
          amount,
          "out",
        );
      });

      (Object.entries(entry.paymentAmounts) as Array<
        [PaymentMethod, number]
      >).forEach(([paymentMethod, amount]) => {
        if (amount <= 0) return;

        addPaymentMethodBreakdownTransaction(
          paymentMethods,
          {
            ...entry.roomCharge,
            paymentMethod,
            amount,
            direction: paymentMethod === "Unpaid" ? "neutral" : "in",
            createdAt: entry.segment.from,
          },
          entry.booking,
          amount,
          paymentMethod === "Unpaid" ? "neutral" : "in",
        );
      });
    });
    summary.serviceEntries.forEach((entry) => {
      addBreakdownTransaction(
        categories,
        entry.transaction,
        entry.booking,
        entry.grossRevenue,
        "in",
      );

      (Object.entries(entry.paymentAmounts) as Array<
        [PaymentMethod, number]
      >).forEach(([paymentMethod, amount]) => {
        if (amount <= 0) return;

        addPaymentMethodBreakdownTransaction(
          paymentMethods,
          {
            ...entry.transaction,
            paymentMethod,
            amount,
            direction: paymentMethod === "Unpaid" ? "neutral" : "in",
            createdAt: entry.start,
          },
          entry.booking,
          amount,
          paymentMethod === "Unpaid" ? "neutral" : "in",
        );
      });
    });

    const finalizedCategories = finalizeBreakdownCategories(
      categories,
      summary.grossStayCharges,
    );
    const finalizedReductions = finalizeBreakdownCategories(
      reductions,
      summary.grossStayCharges,
    );
    const finalizedPaymentMethods = finalizePaymentMethodBreakdowns(
      paymentMethods,
      summary.expectedStayRevenue,
    );
    const usersByUsername = await loadRevenueBreakdownStaffProfiles(
      finalizedCategories,
      finalizedReductions,
      finalizedPaymentMethods,
    );

    res.status(200).json({
      period: {
        startDate: formatBusinessDateKey(bounds.start),
        endDate: formatBusinessDateKey(bounds.end),
        basis: "bookingOrExtensionStartAndServiceCreatedAt",
      },
      totals: {
        grossStayCharges: summary.grossStayCharges,
        grossRoomCharges: summary.grossRoomCharges,
        grossServiceRevenue: summary.grossServiceRevenue,
        expectedStayRevenue: summary.expectedStayRevenue,
        collectedRevenue: summary.collectedRevenue,
        unpaidRevenue: summary.unpaidRevenue,
        reductions: summary.reductions,
        netAfterReductions: summary.expectedStayRevenue,
        transactionCount:
          finalizedCategories.reduce(
            (sum, category) => sum + category.transactionCount,
            0,
          ) +
          finalizedReductions.reduce(
            (sum, category) => sum + category.transactionCount,
            0,
          ),
      },
      categories: attachRevenueBreakdownStaffProfiles(
        finalizedCategories,
        usersByUsername,
      ),
      reductions: attachRevenueBreakdownStaffProfiles(
        finalizedReductions,
        usersByUsername,
      ),
      paymentMethods: attachRevenueBreakdownStaffProfiles(
        finalizedPaymentMethods,
        usersByUsername,
      ),
    });
  } catch (err) {
    console.error("Failed to fetch expected stay revenue breakdown", err);
    res.status(500).json({ error: (err as Error).message });
  }
};

export const getTodayRevenueBreakdown = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(403).json({
        message: "กรุณาเข้าสู่ระบบเพื่อดูสรุปรายได้นี้",
      });
    }

    const bounds = getBusinessDayBoundsFromKey(
      req.query.businessDate as string | undefined,
    );
    if (!bounds) {
      return res.status(400).json({
        message: "Invalid business date. Use YYYY-MM-DD.",
      });
    }

    const [bookingRecords, standaloneSales] = await Promise.all([
      Booking.find({
        $or: [
          { checkIn: { $gte: bounds.start, $lt: bounds.end } },
          {
            commercialSegments: {
              $elemMatch: { from: { $gte: bounds.start, $lt: bounds.end } },
            },
          },
          { "transactions.createdAt": { $gte: bounds.start, $lt: bounds.end } },
        ],
      }).lean<booking[]>(),
      StandaloneSale.find({
        "transactions.createdAt": { $gte: bounds.start, $lt: bounds.end },
      }).lean(),
    ]);
    const bookings = [
      ...bookingRecords.map((booking) => withEffectiveTransactions(booking)),
      ...standaloneSales.map(standaloneSaleBookingView),
    ];
    const todaySummary = calculateTodayRevenueSummary(
      bookings,
      bounds.start,
      bounds.end,
    );
    const roomPaymentAmounts = new Map(
      buildExpectedStayRevenueEntries(bookings, bounds.start, bounds.end).map(
        (entry) => [
          paymentAllocationKey(entry.booking, entry.segment.transactionId),
          entry.paymentAmounts,
        ],
      ),
    );
    const servicePaymentAmounts = new Map(
      buildExpectedStayRevenueServiceEntries(
        bookings,
        bounds.start,
        bounds.end,
      ).map((entry) => [
        paymentAllocationKey(
          entry.booking,
          String(entry.transaction._id || ""),
        ),
        entry.paymentAmounts,
      ]),
    );
    const categories = new Map<
      TransactionType,
      ExpectedStayRevenueBreakdownCategory
    >();
    const reductions = new Map<
      TransactionType,
      ExpectedStayRevenueBreakdownCategory
    >();
    const paymentMethods = new Map<
      PaymentMethod,
      ExpectedStayRevenuePaymentMethodBreakdown
    >();

    bookings.forEach((booking) => {
      const isTodayArrival =
        new Date(booking.checkIn) >= bounds.start &&
        new Date(booking.checkIn) < bounds.end;

      if (
        isTodayArrival &&
        ["cancelled", "noShow"].includes(booking.status)
      ) {
        const arrivalAmount = bookingTodayArrivalRevenueAmount(booking);
        const roomCharge = (booking.transactions || []).find(
          (transaction) => transaction.type === "roomCharge",
        );

        if (arrivalAmount > 0 && roomCharge) {
          const arrivalTransaction = {
            ...roomCharge,
            amount: arrivalAmount,
            createdAt: booking.checkIn,
            paymentMethod: todayArrivalPaymentMethod(booking, roomCharge),
          };
          const direction = transactionDirection(arrivalTransaction);
          addBreakdownTransaction(
            categories,
            arrivalTransaction,
            booking,
            arrivalAmount,
            direction,
            undefined,
            "original",
          );
          addPaymentMethodBreakdownTransaction(
            paymentMethods,
            arrivalTransaction,
            booking,
            arrivalAmount,
            direction,
          );
        }
      }

      if (!["cancelled", "noShow"].includes(booking.status)) {
        effectiveCommercialSegments(booking)
          .filter((segment) => {
            const segmentStart = new Date(segment.from);
            return segmentStart >= bounds.start && segmentStart < bounds.end;
          })
          .forEach((segment) => {
            const roomCharge = (booking.transactions || []).find(
              (transaction) =>
                String(transaction._id) === segment.transactionId,
            );
            if (!roomCharge) return;
            const amount = Math.abs(roomCharge.amount ?? segment.amount ?? 0);
            const segmentTransaction = {
              ...roomCharge,
              amount,
              createdAt: segment.from,
            };
            const paymentAmounts = roomPaymentAmounts.get(
              paymentAllocationKey(booking, segment.transactionId),
            );
            const displayPayment = paymentAllocationDisplay(
              paymentAmounts,
              segmentTransaction.paymentMethod,
            );
            const displayTransaction = {
              ...segmentTransaction,
              paymentMethod: displayPayment.paymentMethod,
            };
            const direction = transactionDirection(displayTransaction);
            addBreakdownTransaction(
              categories,
              displayTransaction,
              booking,
              amount,
              direction,
              displayPayment.paymentMethodLabel,
              segment.kind,
            );
            addPaymentAllocationBreakdown(
              paymentMethods,
              segmentTransaction,
              booking,
              paymentAmounts,
            );
          });
      }

      (booking.transactions || []).forEach((transaction) => {
        if (!transaction.createdAt) return;
        const createdAt = new Date(transaction.createdAt);
        if (createdAt < bounds.start || createdAt >= bounds.end) return;

        const direction = transactionDirection(transaction);
        const extrasAmount = transactionTodayExtrasRevenueAmount(transaction);
        if (extrasAmount > 0) {
          const paymentAmounts = servicePaymentAmounts.get(
            paymentAllocationKey(booking, String(transaction._id || "")),
          );
          const displayPayment = paymentAllocationDisplay(
            paymentAmounts,
            transaction.paymentMethod,
          );
          const displayTransaction = {
            ...transaction,
            paymentMethod: displayPayment.paymentMethod,
          };
          addBreakdownTransaction(
            categories,
            displayTransaction,
            booking,
            extrasAmount,
            transactionDirection(displayTransaction),
            displayPayment.paymentMethodLabel,
          );
          addPaymentAllocationBreakdown(
            paymentMethods,
            transaction,
            booking,
            paymentAmounts,
          );
        }

        const reductionAmount = bookingTransactionTodayReductionAmount(
          booking,
          transaction,
          bounds.end,
        );
        const arrivalReductionAlreadyNetted =
          isTodayArrival &&
          ["cancelled", "noShow"].includes(booking.status) &&
          ["roomRefund", "roomChargeWriteOff", "cancellationRefund"].includes(
            transaction.type,
          );
        if (reductionAmount > 0 && !arrivalReductionAlreadyNetted) {
          addBreakdownTransaction(
            reductions,
            transaction,
            booking,
            reductionAmount,
            direction,
          );
        }
      });
    });

    const grossStayCharges = Array.from(categories.values()).reduce(
      (sum, category) => sum + category.total,
      0,
    );
    const reductionTotal = Array.from(reductions.values()).reduce(
      (sum, category) => sum + category.total,
      0,
    );
    const todayRevenue = todaySummary.todayRevenue;
    const finalizedCategories = finalizeBreakdownCategories(
      categories,
      grossStayCharges,
    );
    const finalizedReductions = finalizeBreakdownCategories(
      reductions,
      grossStayCharges,
    );
    const finalizedPaymentMethods = finalizePaymentMethodBreakdowns(
      paymentMethods,
      grossStayCharges,
    );
    const usersByUsername = await loadRevenueBreakdownStaffProfiles(
      finalizedCategories,
      finalizedReductions,
      finalizedPaymentMethods,
    );

    res.status(200).json({
      period: {
        startDate: formatBusinessDateKey(bounds.start),
        endDate: formatBusinessDateKey(bounds.end),
        basis: "commercialSegmentStartAndServiceCreatedAt",
      },
      totals: {
        grossStayCharges: Number(grossStayCharges.toFixed(2)),
        expectedStayRevenue: Number(todayRevenue.toFixed(2)),
        reductions: Number(reductionTotal.toFixed(2)),
        netAfterReductions: Number(todayRevenue.toFixed(2)),
        transactionCount:
          finalizedCategories.reduce(
            (sum, category) => sum + category.transactionCount,
            0,
          ) +
          finalizedReductions.reduce(
            (sum, category) => sum + category.transactionCount,
            0,
          ),
      },
      categories: attachRevenueBreakdownStaffProfiles(
        finalizedCategories,
        usersByUsername,
      ),
      reductions: attachRevenueBreakdownStaffProfiles(
        finalizedReductions,
        usersByUsername,
      ),
      paymentMethods: attachRevenueBreakdownStaffProfiles(
        finalizedPaymentMethods,
        usersByUsername,
      ),
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
};

export const getTodayRevenueSummary = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(403).json({ message: "กรุณาเข้าสู่ระบบ" });
    }

    const bounds = getBusinessDayBoundsFromKey(
      req.query.businessDate as string | undefined,
    );
    if (!bounds) {
      return res.status(400).json({
        message: "Invalid business date. Use YYYY-MM-DD.",
      });
    }

    const [bookingRecords, standaloneSales] = await Promise.all([
      Booking.find({
        $or: [
          { checkIn: { $gte: bounds.start, $lt: bounds.end } },
          {
            commercialSegments: {
              $elemMatch: { from: { $gte: bounds.start, $lt: bounds.end } },
            },
          },
          { "transactions.createdAt": { $gte: bounds.start, $lt: bounds.end } },
        ],
      }).lean<booking[]>(),
      StandaloneSale.find({
        "transactions.createdAt": { $gte: bounds.start, $lt: bounds.end },
      }).lean(),
    ]);
    const bookings = [
      ...bookingRecords.map((booking) => withEffectiveTransactions(booking)),
      ...standaloneSales.map(standaloneSaleBookingView),
    ];

    res
      .status(200)
      .json(calculateTodayRevenueSummary(bookings, bounds.start, bounds.end));
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
};

export const getReconciliation = async (req: Request, res: Response) => {
  try {
    const staffUsername = req.user?.admin
      ? typeof req.query.staffUsername === "string"
        ? req.query.staffUsername
        : undefined
      : req.user?.username;
    const reconciliation = await getTransactionsForBusinessDate(
      req.query.date as string | undefined,
      staffUsername,
    );

    if (!reconciliation) {
      return res.status(400).json({ message: "Invalid date format" });
    }

    const dailyCloses = await DailyClose.find({
      businessDate: reconciliation.businessDate,
      ...(staffUsername ? { staffUsername } : {}),
    }).sort({ createdAt: -1, staffUsername: 1 });
    const dailyClosesWithStaff =
      await attachDailyCloseStaffProfiles(dailyCloses);
    const cashPosition = await getCashPositionForDate(
      reconciliation.businessDate,
    );

    res.status(200).json({
      businessDate: reconciliation.businessDate,
      threshold: CASH_VARIANCE_THRESHOLD,
      summary: reconciliation.summary,
      cashStashes: summarizeCashStashes(reconciliation.transactions),
      cashShifts: cashPosition?.shifts || [],
      transactions: reconciliation.transactions,
      dailyCloses: dailyClosesWithStaff,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
};

export const getCashPosition = async (req: Request, res: Response) => {
  try {
    const cashPosition = await getCashPositionForDate(
      req.query.date as string | undefined,
      { username: req.user?.username, admin: req.user?.admin },
    );

    if (!cashPosition) {
      return res.status(400).json({ message: "Invalid date format" });
    }

    res.status(200).json(cashPosition);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
};

export const getDepositReturnReminder = async (req: Request, res: Response) => {
  try {
    if (!req.user?.username) {
      return res.status(401).json({ message: "กรุณาเข้าสู่ระบบใหม่" });
    }

    const reminder = await getDepositReturnReminderForDate(
      req.query.businessDate as string | undefined,
    );
    if (!reminder) {
      return res.status(400).json({ message: "Invalid date format" });
    }

    return res.status(200).json({ reminder });
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
};

export const getCashShiftAudit = async (req: Request, res: Response) => {
  try {
    if (!req.user?.admin) {
      return res.status(403).json({
        message: "เฉพาะผู้ดูแลระบบเท่านั้นที่สามารถดูการตรวจสอบเงินสดได้",
      });
    }

    const audit = await getCashShiftAuditForDate(
      req.query.date as string | undefined,
    );
    if (!audit) {
      return res.status(400).json({ message: "Invalid date format" });
    }

    res.status(200).json(audit);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
};

export const resolveCashShiftAudit = async (req: Request, res: Response) => {
  try {
    if (!req.user?.admin || !req.user.username) {
      return res.status(403).json({
        message: "เฉพาะผู้ดูแลระบบเท่านั้นที่สามารถรับทราบข้อยกเว้นได้",
      });
    }

    const note = String(req.body.note || "").trim();
    if (!note) {
      return res.status(400).json({
        message: "กรุณาระบุสรุปการตรวจสอบ",
      });
    }

    const cashShift = await CashShift.findById(req.params.shiftId);
    if (!cashShift) {
      return res.status(404).json({ message: "ไม่พบกะเงินสดนี้" });
    }

    const audit = await getCashShiftAuditForDate(cashShift.businessDate);
    const auditedShift = audit?.shifts.find(
      (shift) => String(shift._id) === String(cashShift._id),
    );
    if (!auditedShift?.warnings.length) {
      return res.status(400).json({
        message: "กะนี้ไม่มีข้อยกเว้นที่ต้องรับทราบ",
      });
    }

    cashShift.auditResolution = {
      note,
      reviewedBy: req.user.username,
      reviewedAt: new Date(),
    };
    await cashShift.save();
    await logActivity(req.user.username, "DAILY_CLOSE", {
      summary: {
        action: "REVIEW_CASH_SHIFT_AUDIT",
        businessDate: cashShift.businessDate,
        shiftNumber: cashShift.shiftNumber,
        note,
        warningCodes: auditedShift.warnings.map(
          (warning: CashAuditWarning) => warning.code,
        ),
      },
    });

    res
      .status(200)
      .json({ cashShift: cashShiftAuditView(cashShift.toObject()) });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
};

export const startCashShift = async (req: Request, res: Response) => {
  try {
    if (!req.user?.username) {
      return res.status(401).json({ message: "กรุณาเข้าสู่ระบบใหม่" });
    }

    const bounds = getBusinessDayBoundsFromKey(req.body.businessDate);
    if (!bounds) {
      return res.status(400).json({ message: "Invalid date format" });
    }

    return await withCashShiftMutationLock(bounds.businessDate, async () => {
      const finalizedDay = await CashShift.findOne({
        businessDate: bounds.businessDate,
        isFinalDayClose: true,
      }).select("_id");
      if (finalizedDay) {
        return res.status(409).json({
          message: "วันนี้ปิดยอดสุดท้ายแล้ว ไม่สามารถเปิดกะเพิ่มได้",
        });
      }

      const existingOpenShift = await CashShift.findOne({
        businessDate: bounds.businessDate,
        status: "open",
      });

      if (existingOpenShift) {
        return res.status(409).json({
          message: "มีกะเงินสดที่เปิดอยู่แล้ว กรุณาปิดกะเดิมก่อน",
        });
      }

      const previousShift = await CashShift.findOne({
        businessDate: bounds.businessDate,
        status: "closed",
      }).sort({ shiftNumber: -1 });
      const handoffMovements = summarizeCashStashes(
        await getUnassignedCashTransactionsBetween(
          previousShift?.endedAt || bounds.start,
          new Date(),
        ),
      );
      const openingMode =
        req.body.openingMode === "accepted_handoff"
          ? "accepted_handoff"
          : "counted";

      if (openingMode === "accepted_handoff" && !previousShift) {
        return res.status(400).json({
          message: "ยังไม่มีกะก่อนหน้าให้รับส่งเงิน",
        });
      }

      const expectedOperatingOpening = cashBalanceAfterMovements(
        previousShift?.operatingActualCash || 0,
        handoffMovements.operatingCashIn,
        handoffMovements.operatingCashOut,
      );
      const operatingOpeningCash =
        openingMode === "accepted_handoff"
          ? expectedOperatingOpening
          : Number(req.body.operatingOpeningCash || 0);

      if (!isValidCashCount(operatingOpeningCash)) {
        return res.status(400).json({ message: "ยอดเงินสดไม่ถูกต้อง" });
      }

      const openingNoteRequired =
        Math.abs(operatingOpeningCash - expectedOperatingOpening) >
        CASH_VARIANCE_THRESHOLD;
      if (openingNoteRequired && !String(req.body.note || "").trim()) {
        return res.status(400).json({
          message: "กรุณาระบุหมายเหตุเมื่อยอดรับส่งเงินไม่ตรงกัน",
        });
      }

      const shiftNumber = (previousShift?.shiftNumber || 0) + 1;
      const cashShift = await withMutationIdempotency(req, () =>
        CashShift.create({
          businessDate: bounds.businessDate,
          shiftNumber,
          staffUsername: req.user?.username,
          status: "open",
          openingMode,
          handoffFromShiftId: previousShift
            ? String(previousShift._id)
            : undefined,
          operatingOpeningCash,
          operatingExpectedCash: operatingOpeningCash,
          note: String(req.body.note || "").trim(),
          startedAt: new Date(),
          createdBy: req.user?.username,
        }),
      );

      await logActivity(req.user!.username, "DAILY_CLOSE", {
        summary: {
          action: "START_CASH_SHIFT",
          businessDate: bounds.businessDate,
          shiftNumber,
          openingMode,
          operatingOpeningCash,
          expectedOperatingOpening,
          note: String(req.body.note || "").trim(),
        },
      }).catch((err) => {
        console.error("Failed to log cash shift start", err);
      });

      return res.status(201).json({ cashShift });
    });
  } catch (err) {
    if (err instanceof CashShiftMutationConflictError) {
      return res.status(409).json({
        message: "กำลังมีการเริ่มหรือปิดกะเงินสด กรุณาลองอีกครั้ง",
      });
    }
    if (err instanceof IdempotencyConflictError) {
      return sendDuplicateMutationResponse(res);
    }

    res.status(500).json({ error: (err as Error).message });
  }
};

class CashShiftReopenValidationError extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 409,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "CashShiftReopenValidationError";
  }
}

const cashShiftReopenResponse = (correction: any) => ({
  correction: cashShiftReopenCorrectionView(correction),
  cashShift: {
    _id: correction.shiftId,
    status: "open" as const,
    ledgerRevision: correction.resultingLedgerRevision,
  },
});

const findReopenByOperationKey = (operationKeyHash: string) =>
  CashShiftReopenCorrection.findOne({ operationKeyHash })
    .select("+operationKeyHash +requestHash")
    .lean();

export const reopenFinalCashShift = async (req: Request, res: Response) => {
  try {
    if (!CASH_SHIFT_REOPEN_ENABLED) {
      return res.status(404).json({
        error: "CASH_SHIFT_REOPEN_DISABLED",
        message: "การเปิดกะอีกครั้งถูกปิดใช้งานชั่วคราว",
      });
    }
    const username = req.user?.username;
    if (!username) {
      return res.status(401).json({ message: "กรุณาเข้าสู่ระบบใหม่" });
    }

    const reason = String(req.body.reason || "").trim();
    const expectedLedgerRevision = Number(req.body.expectedLedgerRevision);
    const idempotencyKey = req.get("Idempotency-Key")?.trim();
    if (!Number.isInteger(expectedLedgerRevision) || expectedLedgerRevision < 0) {
      return res.status(400).json({
        error: "EXPECTED_LEDGER_REVISION_REQUIRED",
        message: "กรุณารีเฟรชข้อมูลกะเงินสดก่อนเปิดกะอีกครั้ง",
      });
    }
    if (!reason) {
      return res.status(400).json({
        error: "REOPEN_REASON_REQUIRED",
        message: "กรุณาระบุเหตุผลที่เปิดกะอีกครั้ง",
      });
    }
    if (reason.length > 500) {
      return res.status(400).json({
        error: "REOPEN_REASON_TOO_LONG",
        message: "เหตุผลต้องไม่เกิน 500 ตัวอักษร",
      });
    }
    if (!idempotencyKey || idempotencyKey.length > 200) {
      return res.status(400).json({
        error: "IDEMPOTENCY_KEY_REQUIRED",
        message: "ไม่พบรหัสป้องกันคำขอซ้ำ กรุณาลองใหม่",
      });
    }

    const operationKeyHash = sha256(
      `${username}:POST:/finance/cash-shifts/${req.params.shiftId}/reopen-final:${idempotencyKey}`,
    );
    const requestHash = sha256(
      stableStringify({
        shiftId: req.params.shiftId,
        expectedLedgerRevision,
        reason,
      }),
    );
    const existingOperation = await findReopenByOperationKey(operationKeyHash);
    if (existingOperation) {
      if (existingOperation.requestHash !== requestHash) {
        return res.status(409).json({
          error: "IDEMPOTENCY_KEY_REUSED",
          message: "รหัสคำขอนี้ถูกใช้กับข้อมูลอื่นแล้ว",
        });
      }
      return res.status(200).json(cashShiftReopenResponse(existingOperation));
    }

    const requestedShift = await CashShift.findById(req.params.shiftId).select(
      "businessDate",
    );
    if (!requestedShift) {
      return res.status(404).json({ message: "ไม่พบกะเงินสดนี้" });
    }

    const correction = await withCashShiftMutationLock(
      requestedShift.businessDate,
      async () => {
        const session = await mongoose.startSession();
        try {
          const transactionResult = await session.withTransaction(async () => {
            const cashShift = await CashShift.findById(req.params.shiftId).session(
              session,
            );
            if (!cashShift) {
              throw new CashShiftReopenValidationError(
                404,
                "CASH_SHIFT_NOT_FOUND",
                "ไม่พบกะเงินสดนี้",
              );
            }
            if (cashShift.status !== "closed" || !cashShift.isFinalDayClose) {
              throw new CashShiftReopenValidationError(
                409,
                "NOT_REOPENABLE_FINAL_CLOSE",
                "กะนี้ไม่ใช่ยอดปิดสุดท้ายที่เปิดใหม่ได้",
              );
            }
            if (!cashShift.endedAt || !cashShift.closedBy) {
              throw new CashShiftReopenValidationError(
                409,
                "INCOMPLETE_FINAL_CLOSE",
                "ข้อมูลการปิดกะเดิมไม่สมบูรณ์",
              );
            }
            if (
              !Number.isFinite(cashShift.operatingExpectedCash) ||
              !Number.isFinite(cashShift.operatingActualCash) ||
              !Number.isFinite(cashShift.operatingVariance)
            ) {
              throw new CashShiftReopenValidationError(
                409,
                "INCOMPLETE_FINAL_CLOSE",
                "ข้อมูลยอดเงินของการปิดกะเดิมไม่สมบูรณ์",
              );
            }
            if (cashShift.businessDate !== formatBusinessDateKey(new Date())) {
              throw new CashShiftReopenValidationError(
                409,
                "PAST_BUSINESS_DATE",
                "เปิดกะได้เฉพาะวันทำการกรุงเทพปัจจุบัน",
              );
            }
            if (!req.user?.admin && cashShift.closedBy !== username) {
              throw new CashShiftReopenValidationError(
                403,
                "REOPEN_FORBIDDEN",
                "เฉพาะผู้ปิดกะเดิมหรือเจ้าของเท่านั้นที่เปิดกะได้",
              );
            }
            if ((cashShift.ledgerRevision || 0) !== expectedLedgerRevision) {
              throw new CashShiftReopenValidationError(
                409,
                "CASH_SHIFT_LEDGER_CONFLICT",
                "กะเงินสดมีการเปลี่ยนแปลง กรุณารีเฟรชแล้วลองอีกครั้ง",
              );
            }

            const [latestShift, openShift] = await Promise.all([
              CashShift.findOne({ businessDate: cashShift.businessDate })
                .sort({ shiftNumber: -1 })
                .select("_id")
                .session(session),
              CashShift.findOne({
                businessDate: cashShift.businessDate,
                status: "open",
              })
                .select("_id")
                .session(session),
            ]);
            if (String(latestShift?._id) !== String(cashShift._id)) {
              throw new CashShiftReopenValidationError(
                409,
                "NOT_LATEST_SHIFT",
                "เปิดใหม่ได้เฉพาะกะล่าสุดของวัน",
              );
            }
            if (openShift) {
              throw new CashShiftReopenValidationError(
                409,
                "OPEN_SHIFT_EXISTS",
                "มีกะเงินสดเปิดอยู่แล้ว",
              );
            }

            const unassignedMovements = summarizeCashStashes(
              await getUnassignedCashTransactionsBetween(
                cashShift.endedAt,
                new Date(),
                session,
              ),
            );
            if (hasCashMovement(unassignedMovements)) {
              throw new CashShiftReopenValidationError(
                409,
                "UNASSIGNED_CASH_ACTIVITY",
                "พบรายการเงินสดนอกกะหลังปิดยอด กรุณาตรวจสอบก่อน",
              );
            }

            const originalLedgerRevision = cashShift.ledgerRevision || 0;
            const resultingLedgerRevision = originalLedgerRevision + 1;
            const reopenedAt = new Date();
            const terminalCloseKey = sha256(
              `${cashShift._id}:${cashShift.endedAt.toISOString()}`,
            );
            const correctionRecord = new CashShiftReopenCorrection({
              correctionId: crypto.randomUUID(),
              shiftId: String(cashShift._id),
              businessDate: cashShift.businessDate,
              shiftNumber: cashShift.shiftNumber,
              terminalCloseKey,
              originalClose: {
                endedAt: cashShift.endedAt,
                closedBy: cashShift.closedBy,
                operatingExpectedCash: cashShift.operatingExpectedCash,
                operatingActualCash: cashShift.operatingActualCash,
                operatingVariance: cashShift.operatingVariance,
                note: cashShift.note,
                depositReturnReminder: cashShift.depositReturnReminder,
                auditResolution: cashShift.auditResolution,
              },
              reopenedAt,
              reopenedBy: username,
              reason,
              originalLedgerRevision,
              resultingLedgerRevision,
              operationKeyHash,
              requestHash,
            });

            const reopenedShift = await CashShift.findOneAndUpdate(
              {
                _id: cashShift._id,
                status: "closed",
                isFinalDayClose: true,
                endedAt: cashShift.endedAt,
                ledgerRevision: originalLedgerRevision,
              },
              {
                $set: { status: "open", isFinalDayClose: false },
                $unset: {
                  endedAt: 1,
                  closedBy: 1,
                  operatingActualCash: 1,
                  operatingVariance: 1,
                  depositReturnReminder: 1,
                  auditResolution: 1,
                },
                $inc: { ledgerRevision: 1 },
              },
              { returnDocument: "after", session, runValidators: true },
            );
            if (!reopenedShift) throw new CashShiftLedgerConflictError();

            await correctionRecord.save({ session });
            await logActivityStrict(
              username,
              "DAILY_CLOSE",
              {
                summary: {
                  action: "REOPEN_FINAL_CASH_SHIFT",
                  correctionId: correctionRecord.correctionId,
                  shiftId: String(cashShift._id),
                  businessDate: cashShift.businessDate,
                  shiftNumber: cashShift.shiftNumber,
                  originalEndedAt: cashShift.endedAt,
                  originalClosedBy: cashShift.closedBy,
                  reopenedAt,
                  reopenedBy: username,
                  reason,
                  originalLedgerRevision,
                  resultingLedgerRevision,
                },
              },
              undefined,
              session,
            );

            return correctionRecord.toObject();
          });
          if (!transactionResult) throw new CashShiftLedgerConflictError();
          return transactionResult;
        } finally {
          await session.endSession();
        }
      },
    );

    return res.status(200).json(cashShiftReopenResponse(correction));
  } catch (err) {
    if (err instanceof CashShiftReopenValidationError) {
      return res.status(err.status).json({ error: err.code, message: err.message });
    }
    if (
      err instanceof CashShiftMutationConflictError ||
      err instanceof CashShiftLedgerConflictError
    ) {
      return res.status(409).json({
        error: "CASH_SHIFT_LEDGER_CONFLICT",
        message: "กะเงินสดกำลังเปลี่ยนแปลง กรุณารีเฟรชแล้วลองอีกครั้ง",
      });
    }
    if ((err as { code?: number }).code === 11000) {
      const username = req.user?.username || "";
      const idempotencyKey = req.get("Idempotency-Key")?.trim() || "";
      const operationKeyHash = sha256(
        `${username}:POST:/finance/cash-shifts/${req.params.shiftId}/reopen-final:${idempotencyKey}`,
      );
      const existingOperation = await findReopenByOperationKey(operationKeyHash);
      if (existingOperation) {
        const requestHash = sha256(
          stableStringify({
            shiftId: req.params.shiftId,
            expectedLedgerRevision: Number(req.body.expectedLedgerRevision),
            reason: String(req.body.reason || "").trim(),
          }),
        );
        if (existingOperation.requestHash === requestHash) {
          return res
            .status(200)
            .json(cashShiftReopenResponse(existingOperation));
        }
      }
      return res.status(409).json({
        error: "CASH_SHIFT_ALREADY_REOPENED",
        message: "ยอดปิดนี้ถูกเปิดกะอีกครั้งแล้ว",
      });
    }

    return res.status(500).json({ error: (err as Error).message });
  }
};

class CashShiftCloseValidationError extends Error {
  constructor(
    readonly status: 400 | 409,
    message: string,
    readonly code?: string,
    readonly reminder?: DepositReturnReminder,
  ) {
    super(message);
    this.name = "CashShiftCloseValidationError";
  }
}

export const closeCashShift = async (req: Request, res: Response) => {
  try {
    if (!req.user?.username) {
      return res.status(401).json({ message: "กรุณาเข้าสู่ระบบใหม่" });
    }

    const requestedShift = await CashShift.findById(req.params.shiftId);
    if (!requestedShift) {
      return res.status(404).json({ message: "ไม่พบกะเงินสดนี้" });
    }
    if (requestedShift.status !== "open") {
      return res.status(409).json({ message: "กะเงินสดนี้ปิดไปแล้ว" });
    }
    if (!req.user.admin && requestedShift.staffUsername !== req.user.username) {
      return res.status(403).json({
        message: "เฉพาะผู้รับผิดชอบกะหรือผู้ดูแลระบบเท่านั้นที่ปิดกะได้",
      });
    }

    const operatingActualCash = Number(req.body.operatingActualCash);
    if (!isValidCashCount(operatingActualCash)) {
      return res.status(400).json({ message: "ยอดเงินสดไม่ถูกต้อง" });
    }

    const closeDay = req.body.closeDay === true;
    const closingUsername = req.user.username;
    const result = await withCashShiftMutationLock(
      requestedShift.businessDate,
      () =>
        withMutationIdempotency(req, async () => {
          const session = await mongoose.startSession();
          try {
            const transactionResult = await session.withTransaction(
              async () => {
                const cashShift = await CashShift.findOne({
                  _id: requestedShift._id,
                  status: "open",
                }).session(session);
                if (!cashShift) throw new CashShiftLedgerConflictError();

                const currentLedgerRevision = cashShift.ledgerRevision || 0;
                const guardUpdate = await CashShift.updateOne(
                  {
                    _id: cashShift._id,
                    status: "open",
                    $or: [
                      { ledgerRevision: currentLedgerRevision },
                      { ledgerRevision: { $exists: false } },
                    ],
                  },
                  { $inc: { ledgerRevision: 1 } },
                  { session },
                );
                if (guardUpdate.modifiedCount !== 1) {
                  throw new CashShiftLedgerConflictError();
                }
                const guardedLedgerRevision = currentLedgerRevision + 1;

                if (closeDay) {
                  const existingFinalClose = await CashShift.findOne({
                    businessDate: cashShift.businessDate,
                    isFinalDayClose: true,
                    _id: { $ne: cashShift._id },
                  })
                    .select("_id")
                    .session(session);
                  if (existingFinalClose) {
                    throw new CashShiftCloseValidationError(
                      409,
                      "วันนี้ปิดยอดสุดท้ายแล้ว",
                    );
                  }
                }

                let depositReturnReminder: DepositReturnReminder | undefined;
                if (closeDay) {
                  depositReturnReminder =
                    (await getDepositReturnReminderForDate(
                      cashShift.businessDate,
                      session,
                    )) || undefined;
                  if (!depositReturnReminder) {
                    throw new CashShiftCloseValidationError(
                      400,
                      "ไม่สามารถคำนวณรายการมัดจำของวันพรุ่งนี้ได้",
                      "DEPOSIT_REMINDER_UNAVAILABLE",
                    );
                  }
                  const submittedToken = String(
                    req.body.depositReminderToken || "",
                  );
                  if (!submittedToken) {
                    throw new CashShiftCloseValidationError(
                      400,
                      "กรุณาตรวจสอบรายการมัดจำก่อนปิดยอดวันนี้",
                      "DEPOSIT_REMINDER_REQUIRED",
                      depositReturnReminder,
                    );
                  }
                  if (
                    submittedToken !== depositReturnReminder.calculationToken
                  ) {
                    throw new CashShiftCloseValidationError(
                      409,
                      "รายการมัดจำมีการเปลี่ยนแปลง กรุณาตรวจสอบยอดใหม่อีกครั้ง",
                      "DEPOSIT_REMINDER_CHANGED",
                      depositReturnReminder,
                    );
                  }
                }

                const movements = summarizeCashStashes(
                  await getShiftTransactions(cashShift, session),
                );
                const operatingExpectedCash =
                  cashShift.operatingOpeningCash +
                  movements.operatingCashIn -
                  movements.operatingCashOut;
                const operatingVariance =
                  operatingActualCash - operatingExpectedCash;

                if (
                  Math.abs(operatingVariance) > CASH_VARIANCE_THRESHOLD &&
                  !String(req.body.note || "").trim()
                ) {
                  throw new CashShiftCloseValidationError(
                    400,
                    "กรุณาระบุหมายเหตุเมื่อยอดเงินสดไม่ตรงกัน",
                  );
                }

                const closedAt = new Date();
                const closedShift = await CashShift.findOneAndUpdate(
                  {
                    _id: cashShift._id,
                    status: "open",
                    ledgerRevision: guardedLedgerRevision,
                  },
                  {
                    $set: {
                      status: "closed",
                      operatingCashIn: movements.operatingCashIn,
                      operatingCashOut: movements.operatingCashOut,
                      operatingExpectedCash,
                      operatingActualCash,
                      operatingVariance,
                      isFinalDayClose: closeDay,
                      ...(closeDay && depositReturnReminder
                        ? {
                            depositReturnReminder: {
                              targetBusinessDate:
                                depositReturnReminder.targetBusinessDate,
                              requiredAmount:
                                depositReturnReminder.requiredAmount,
                              bookingCount: depositReturnReminder.bookingCount,
                              bookings: depositReturnReminder.bookings,
                              calculationToken:
                                depositReturnReminder.calculationToken,
                              calculatedAt: depositReturnReminder.calculatedAt,
                              acknowledgedAt: closedAt,
                              acknowledgedBy: closingUsername,
                            },
                          }
                        : {}),
                      note: String(
                        req.body.note || cashShift.note || "",
                      ).trim(),
                      endedAt: closedAt,
                      closedBy: closingUsername,
                    },
                  },
                  { returnDocument: "after", session, runValidators: true },
                );
                if (!closedShift) throw new CashShiftLedgerConflictError();

                return {
                  closedShift,
                  auditSummary: {
                    action: "CLOSE_CASH_SHIFT",
                    businessDate: cashShift.businessDate,
                    shiftNumber: cashShift.shiftNumber,
                    closeDay,
                    operatingExpectedCash,
                    operatingActualCash,
                    operatingVariance,
                    operatingCashIn: movements.operatingCashIn,
                    operatingCashOut: movements.operatingCashOut,
                    note: String(req.body.note || cashShift.note || "").trim(),
                    ...(depositReturnReminder
                      ? {
                          depositReturnReminder: {
                            targetBusinessDate:
                              depositReturnReminder.targetBusinessDate,
                            requiredAmount:
                              depositReturnReminder.requiredAmount,
                            bookingCount: depositReturnReminder.bookingCount,
                            bookings: depositReturnReminder.bookings,
                            acknowledgedAt: closedAt,
                            acknowledgedBy: closingUsername,
                          },
                        }
                      : {}),
                  },
                };
              },
            );
            if (!transactionResult) throw new CashShiftLedgerConflictError();
            return transactionResult;
          } finally {
            await session.endSession();
          }
        }),
    );

    await logActivity(closingUsername, "DAILY_CLOSE", {
      summary: result.auditSummary,
    }).catch((err) => {
      console.error("Failed to log cash shift close", err);
    });

    return res.status(200).json({ cashShift: result.closedShift });
  } catch (err) {
    if (err instanceof CashShiftCloseValidationError) {
      return res.status(err.status).json({
        error: err.code,
        message: err.message,
        ...(err.reminder ? { reminder: err.reminder } : {}),
      });
    }
    if (
      err instanceof CashShiftMutationConflictError ||
      err instanceof CashShiftLedgerConflictError
    ) {
      return res.status(409).json({
        error: "CASH_SHIFT_LEDGER_CONFLICT",
        message: "กะเงินสดกำลังเปลี่ยนแปลง กรุณารีเฟรชแล้วลองอีกครั้ง",
      });
    }
    if (err instanceof IdempotencyConflictError) {
      return sendDuplicateMutationResponse(res);
    }

    res.status(500).json({ error: (err as Error).message });
  }
};

class DailyCloseRevisionConflictError extends Error {
  constructor() {
    super("DAILY_CLOSE_REVISION_CONFLICT");
    this.name = "DailyCloseRevisionConflictError";
  }
}

export const upsertDailyClose = async (req: Request, res: Response) => {
  try {
    const staffUsername =
      req.user?.admin && typeof req.body.staffUsername === "string"
        ? req.body.staffUsername
        : req.user?.username;

    if (!staffUsername || !req.user?.username) {
      return res.status(401).json({ message: "กรุณาเข้าสู่ระบบใหม่" });
    }

    const requestUsername = req.user.username;
    const actualCash = Number(req.body.actualCash);
    const openingCash = Number(req.body.openingCash || 0);
    const expectedRevision = Number(req.body.expectedRevision);

    if (
      !isValidCashCount(actualCash) ||
      !isValidCashCount(openingCash) ||
      !Number.isInteger(expectedRevision) ||
      expectedRevision < 0
    ) {
      return res.status(400).json({ message: "ยอดเงินสดไม่ถูกต้อง" });
    }

    const reconciliation = await getTransactionsForBusinessDate(
      req.body.businessDate,
      staffUsername,
    );

    if (!reconciliation) {
      return res.status(400).json({ message: "Invalid date format" });
    }

    const expectedCash =
      openingCash +
      reconciliation.summary.cashIn -
      reconciliation.summary.cashOut;
    const variance = actualCash - expectedCash;

    if (
      Math.abs(variance) > CASH_VARIANCE_THRESHOLD &&
      !String(req.body.note || "").trim()
    ) {
      return res.status(400).json({
        message: "กรุณาระบุหมายเหตุเมื่อยอดเงินสดไม่ตรงกัน",
      });
    }

    const existingDailyClose = await DailyClose.findOne({
      businessDate: reconciliation.businessDate,
      staffUsername,
    }).lean();
    if ((existingDailyClose?.revision || 0) !== expectedRevision) {
      return res.status(409).json({
        error: "DAILY_CLOSE_REVISION_CONFLICT",
        message: "ยอดปิดวันถูกแก้ไขโดยผู้ใช้อื่น กรุณารีเฟรชแล้วลองใหม่",
        dailyClose: existingDailyClose,
      });
    }
    const now = new Date();
    const previousRevision = existingDailyClose
      ? {
          revision: existingDailyClose.revision || 1,
          openingCash: existingDailyClose.openingCash,
          expectedCash: existingDailyClose.expectedCash,
          actualCash: existingDailyClose.actualCash,
          variance: existingDailyClose.variance,
          cashIn: existingDailyClose.cashIn,
          cashOut: existingDailyClose.cashOut,
          note: existingDailyClose.note || "",
          createdBy: existingDailyClose.createdBy,
          createdAt: existingDailyClose.createdAt,
          supersededAt: now,
          supersededBy: requestUsername,
        }
      : null;

    const dailyClose = await withMutationIdempotency(req, async () => {
      if (!existingDailyClose) {
        const created = await DailyClose.create({
          businessDate: reconciliation.businessDate,
          staffUsername,
          revision: 1,
          openingCash,
          expectedCash,
          actualCash,
          variance,
          cashIn: reconciliation.summary.cashIn,
          cashOut: reconciliation.summary.cashOut,
          note: req.body.note || "",
          createdBy: requestUsername,
          createdAt: now,
          revisions: [],
        });
        return created;
      }

      const updated = await DailyClose.findOneAndUpdate(
        {
          businessDate: reconciliation.businessDate,
          staffUsername,
          revision: expectedRevision,
        },
        {
          $set: {
            openingCash,
            expectedCash,
            actualCash,
            variance,
            cashIn: reconciliation.summary.cashIn,
            cashOut: reconciliation.summary.cashOut,
            note: req.body.note || "",
            createdBy: requestUsername,
            createdAt: now,
          },
          $inc: { revision: 1 },
          $push: { revisions: previousRevision! },
        },
        { returnDocument: "after", runValidators: true },
      );
      if (!updated) throw new DailyCloseRevisionConflictError();
      return updated;
    });

    await logActivity(requestUsername, "DAILY_CLOSE", {
      summary: {
        action: "SAVE_DAILY_RECONCILIATION",
        businessDate: reconciliation.businessDate,
        staffUsername,
        revision: dailyClose.revision,
        openingCash,
        expectedCash,
        actualCash,
        variance,
        cashIn: reconciliation.summary.cashIn,
        cashOut: reconciliation.summary.cashOut,
        note: req.body.note || "",
      },
    });

    res.status(200).json({ dailyClose });
  } catch (err) {
    if (
      err instanceof DailyCloseRevisionConflictError ||
      (err as any)?.code === 11000
    ) {
      const staffUsername =
        req.user?.admin && typeof req.body.staffUsername === "string"
          ? req.body.staffUsername
          : req.user?.username;
      const latest = staffUsername
        ? await DailyClose.findOne({
            businessDate: req.body.businessDate,
            staffUsername,
          })
        : null;
      return res.status(409).json({
        error: "DAILY_CLOSE_REVISION_CONFLICT",
        message: "ยอดปิดวันถูกแก้ไขโดยผู้ใช้อื่น กรุณารีเฟรชแล้วลองใหม่",
        dailyClose: latest,
      });
    }
    if (err instanceof IdempotencyConflictError) {
      return sendDuplicateMutationResponse(res);
    }

    res.status(500).json({ error: (err as Error).message });
  }
};

export const getReviewEvents = async (req: Request, res: Response) => {
  try {
    if (!req.user?.admin) {
      return res.status(403).json({
        message: "เฉพาะผู้ดูแลระบบเท่านั้นที่สามารถดูรายการตรวจสอบได้",
      });
    }

    const requestedDate = req.query.date as string | undefined;
    const [reconciliation, correctionReviews] = await Promise.all([
      getTransactionsForBusinessDate(requestedDate),
      getCorrectionReviewEventsForBusinessDate(requestedDate),
    ]);

    if (!reconciliation || !correctionReviews) {
      return res.status(400).json({ message: "Invalid date format" });
    }

    const transactions = [
      ...reconciliation.transactions.filter(
        (transaction: transcation & { bookingId?: string }) =>
          transactionRequiresReview(transaction),
      ),
      ...correctionReviews.transactions,
    ];

    res.status(200).json({
      businessDate: reconciliation.businessDate,
      transactions,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
};

export const getReviewEventCount = async (req: Request, res: Response) => {
  try {
    if (!req.user?.admin) {
      return res.status(403).json({
        message: "เฉพาะผู้ดูแลระบบเท่านั้นที่สามารถดูรายการตรวจสอบได้",
      });
    }

    const [reconciliation, correctionReviews] = await Promise.all([
      getTransactionsForBusinessDate(),
      getCorrectionReviewEventsForBusinessDate(),
    ]);
    if (!reconciliation || !correctionReviews) {
      return res.status(500).json({ message: "Unable to resolve business date" });
    }

    const transactionReviewCount = reconciliation.transactions.reduce(
      (total, transaction) =>
        total + (transactionRequiresReview(transaction) ? 1 : 0),
      0,
    );
    const cashAuditReviewCount = await CashShift.countDocuments({
      businessDate: reconciliation.businessDate,
      status: "closed",
      $and: [
        {
          $or: [
            { operatingVariance: { $gt: CASH_VARIANCE_THRESHOLD } },
            { operatingVariance: { $lt: -CASH_VARIANCE_THRESHOLD } },
          ],
        },
        {
          $or: [
            { auditResolution: { $exists: false } },
            { auditResolution: null },
          ],
        },
      ],
    });
    const count =
      transactionReviewCount +
      correctionReviews.transactions.length +
      cashAuditReviewCount;

    return res.status(200).json({
      businessDate: reconciliation.businessDate,
      count,
    });
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
};

export const approveReviewEvent = async (req: Request, res: Response) => {
  try {
    if (!req.user?.admin || !req.user.username) {
      return res.status(403).json({
        message: "เฉพาะผู้ดูแลระบบเท่านั้นที่สามารถอนุมัติรายการตรวจสอบได้",
      });
    }

    const bookingId = String(req.params.bookingId);
    const transactionId = String(req.params.transactionId);
    const correctionId =
      typeof req.query.correctionId === "string"
        ? req.query.correctionId
        : "";
    const booking = await Booking.findOne({ bookingId });

    if (!booking) {
      return res.status(404).json({ message: "ไม่พบ Booking" });
    }

    if (correctionId) {
      const correction = booking.transactionCorrections.find(
        (existingCorrection) =>
          String(existingCorrection._id) === correctionId &&
          existingCorrection.targetTransactionId === transactionId,
      );
      if (!correction) {
        return res.status(404).json({ message: "ไม่พบรายการแก้ไขธุรกรรม" });
      }
      if (correction.reviewStatus === "reviewed") {
        return res.status(200).json({
          message: "รายการแก้ไขนี้ได้รับการอนุมัติแล้ว",
          correction,
        });
      }
      const correctionIndex = booking.transactionCorrections.findIndex(
        (candidate) => String(candidate._id) === correctionId,
      );
      const priorCorrectionCount = booking.transactionCorrections
        .slice(0, correctionIndex)
        .filter(
          (candidate) =>
            candidate.targetTransactionId === transactionId &&
            candidate.financialChange,
        ).length;
      const reviewFlags = (correction.reviewFlags || []).length
        ? correction.reviewFlags || []
        : transactionCorrectionNeedsReview(
            correction.before,
            correction.after,
            priorCorrectionCount,
          );
      if (!reviewFlags.length) {
        return res.status(400).json({
          message: "รายการแก้ไขนี้ไม่จำเป็นต้องตรวจสอบ",
        });
      }

      const expectedRevision = Number(booking.revision || 0);
      const reviewedAt = new Date();
      const updatedBooking = await Booking.findOneAndUpdate(
        {
          bookingId,
          ...bookingRevisionPredicate(expectedRevision),
          transactionCorrections: {
            $elemMatch: {
              _id: correctionId,
              targetTransactionId: transactionId,
              reviewStatus: { $ne: "reviewed" },
            },
          },
        },
        {
          $set: {
            "transactionCorrections.$.reviewFlags": reviewFlags,
            "transactionCorrections.$.reviewStatus": "reviewed",
            "transactionCorrections.$.reviewedBy": req.user.username,
            "transactionCorrections.$.reviewedAt": reviewedAt,
          },
          $inc: { revision: 1 },
        },
        { returnDocument: "after", runValidators: true },
      );
      if (!updatedBooking) {
        return sendBookingRevisionConflict(res, bookingId);
      }
      const reviewedCorrection = updatedBooking.transactionCorrections.find(
        (candidate) => String(candidate._id) === correctionId,
      );
      if (!reviewedCorrection) {
        return sendBookingRevisionConflict(res, bookingId);
      }

      await logActivity(
        req.user.username,
        "REVIEW_TRANSACTION",
        {
          summary: {
            reviewEventKind: "transactionCorrection",
            bookingId,
            transactionId,
            correctionId,
            guestName: booking.name,
            before: correction.before,
            after: correction.after,
            flags: reviewFlags,
            reviewedBy: reviewedCorrection.reviewedBy,
            reviewedAt,
          },
        },
        bookingId,
      );

      return res.status(200).json({ correction: reviewedCorrection });
    }

    const transaction = booking.transactions.find(
      (existingTransaction) =>
        String(existingTransaction._id) === transactionId,
    );

    if (!transaction) {
      return res.status(404).json({ message: "ไม่พบรายการธุรกรรม" });
    }

    if (transaction.reviewStatus === "reviewed") {
      return res.status(200).json({
        message: "รายการนี้ได้รับการอนุมัติแล้ว",
        transaction,
      });
    }

    const requiresReview = transactionRequiresReview(transaction);

    if (!requiresReview) {
      return res.status(400).json({
        message: "รายการนี้ไม่จำเป็นต้องตรวจสอบ",
      });
    }

    const expectedRevision = Number(booking.revision || 0);
    const reviewedAt = transaction.reviewedAt || new Date();
    const reviewedBy = transaction.reviewedBy || req.user.username;
    const updatedBooking = await Booking.findOneAndUpdate(
      {
        bookingId,
        ...bookingRevisionPredicate(expectedRevision),
        transactions: {
          $elemMatch: {
            _id: transactionId,
            reviewStatus: { $ne: "reviewed" },
          },
        },
      },
      {
        $set: {
          "transactions.$.reviewStatus": "reviewed",
          "transactions.$.reviewedBy": reviewedBy,
          "transactions.$.reviewedAt": reviewedAt,
        },
        $inc: { revision: 1 },
      },
      { returnDocument: "after", runValidators: true },
    );
    if (!updatedBooking) {
      return sendBookingRevisionConflict(res, bookingId);
    }
    const reviewedTransaction = updatedBooking.transactions.find(
      (candidate) => String(candidate._id) === transactionId,
    );
    if (!reviewedTransaction) {
      return sendBookingRevisionConflict(res, bookingId);
    }

    await logActivity(
      req.user.username,
      "REVIEW_TRANSACTION",
      {
        summary: {
          bookingId,
          transactionId,
          guestName: booking.name,
          type: transaction.type,
          paymentMethod: transaction.paymentMethod,
          amount: transaction.amount,
          flags: transaction.reviewFlags || [],
          reviewedBy: reviewedTransaction.reviewedBy,
          reviewedAt,
        },
      },
      bookingId,
    );

    res.status(200).json({
      transaction: reviewedTransaction,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
};

export const approveStandaloneReviewEvent = async (
  req: Request,
  res: Response,
) => {
  try {
    if (!req.user?.admin || !req.user.username) {
      return res.status(403).json({
        message: "เฉพาะผู้ดูแลระบบเท่านั้นที่สามารถอนุมัติรายการตรวจสอบได้",
      });
    }
    const sale = await StandaloneSale.findOne({ saleId: req.params.saleId });
    if (!sale) return res.status(404).json({ message: "ไม่พบรายการแขกนอก" });
    const transaction = sale.transactions.find(
      (item) => String(item._id) === String(req.params.transactionId),
    );
    if (!transaction)
      return res.status(404).json({ message: "ไม่พบรายการธุรกรรม" });
    if (transaction.reviewStatus !== "reviewed") {
      if (
        transaction.reviewStatus !== "needs_review" &&
        !(transaction.reviewFlags || []).length
      ) {
        return res
          .status(400)
          .json({ message: "รายการนี้ไม่จำเป็นต้องตรวจสอบ" });
      }
      transaction.reviewStatus = "reviewed";
      transaction.reviewedBy = req.user.username;
      transaction.reviewedAt = new Date();
      sale.markModified("transactions");
      await sale.save();
      await logActivity(req.user.username, "REVIEW_TRANSACTION", {
        summary: {
          sourceType: "standaloneSale",
          saleId: sale.saleId,
          customerName: sale.customerName || "ลูกค้าทั่วไป",
          transactionId: String(transaction._id),
          type: transaction.type,
          amount: transaction.amount,
          flags: transaction.reviewFlags || [],
        },
      });
    }
    return res.status(200).json({ transaction });
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
};
