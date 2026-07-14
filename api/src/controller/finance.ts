import { Request, Response } from "express";
import Booking from "../models/booking";
import CashShift from "../models/cashShift";
import DailyClose from "../models/dailyClose";
import User from "../models/user";
import type {
  booking,
  PaymentMethod,
  PlatformId,
  transcation,
  TransactionType,
} from "../models/booking";
import { logActivity } from "../services/activityServices";
import {
  CASH_VARIANCE_THRESHOLD,
  bookingTodayArrivalRevenueAmount,
  calculateTodayRevenueSummary,
  cashBalanceAfterMovements,
  isValidCashCount,
  summarizeTransactions,
  summarizeCashStashes,
  transactionTodayExtrasRevenueAmount,
  transactionTodayReductionAmount,
  transactionDirection,
  transactionFallsOnBusinessDate,
} from "../helpers/financeHelpers";
import {
  IdempotencyConflictError,
  withMutationIdempotency,
} from "../services/mutationIdempotency";
import {
  CashShiftMutationConflictError,
  withCashShiftMutationLock,
} from "../services/cashShiftMutationLock";
import {
  buildDepositRequirement,
  depositPreparationAdjustment,
  nextBusinessDateKey,
  type DepositRequirement,
} from "../helpers/depositPreparationHelpers";

const sendDuplicateMutationResponse = (res: Response) =>
  res.status(409).json({
    error: "DUPLICATE_REQUEST",
    message: "คำขอนี้ถูกส่งซ้ำหรือเพิ่งดำเนินการสำเร็จ กรุณารีเฟรชข้อมูล",
  });

const BUSINESS_TIME_ZONE = "Asia/Bangkok";
const BANGKOK_UTC_OFFSET_HOURS = 7;

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
  towel: { label: "ผ้าเช็ดตัว", color: "#38bdf8", icon: "bx-bath" },
  motorbike: { label: "มอเตอร์ไซค์", color: "#fb923c", icon: "bx-cycling" },
  slowBoat: { label: "Slow Boat", color: "#2dd4bf", icon: "bx-water" },
  joinTour: { label: "Join Tour", color: "#22c55e", icon: "bx-map" },
  extraBed: { label: "เตียงเสริม", color: "#ec4899", icon: "bx-bed" },
  pickACraft: { label: "Pick A Craft", color: "#f59e0b", icon: "bx-palette" },
  setMenu: { label: "Set Menu", color: "#84cc16", icon: "bx-food-menu" },
  sleeperBus: { label: "Sleeper Bus", color: "#6366f1", icon: "bx-bus" },
  onlyWalk: { label: "Only Walk", color: "#14b8a6", icon: "bx-walk" },
  laundry: { label: "Laundry", color: "#60a5fa", icon: "bx-washer" },
  bicycle: { label: "Bicycle", color: "#fb923c", icon: "bx-cycling" },
  car: { label: "Car", color: "#64748b", icon: "bx-car" },
  misc: { label: "Misc", color: "#94a3b8", icon: "bx-dots-horizontal-rounded" },
  cardSurcharge: {
    label: "ค่าธรรมเนียมบัตร 3%",
    color: "#94a3b8",
    icon: "bx-credit-card-alt",
  },
  roomRefund: { label: "คืนค่าห้อง", color: "#fb7185", icon: "bx-undo" },
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
  "setMenu",
  "sleeperBus",
  "onlyWalk",
  "laundry",
  "bicycle",
  "car",
  "misc",
  "cardSurcharge",
]);

const expectedStayRevenueReductionTypes = new Set<TransactionType>([
  "roomRefund",
  "cancellationRefund",
  "compensation",
]);

const paymentMethodMeta: Record<PaymentMethod, { label: string; icon: string }> = {
  OTA: { label: "OTA", icon: "bx-bank" },
  Cash: { label: "Cash", icon: "bx-currency-notes" },
  Card: { label: "Card", icon: "bx-credit-card-alt" },
  Transfer: { label: "Transfer", icon: "bx-arrow-right-left" },
  Unpaid: { label: "Unpaid", icon: "bx-error" },
};

type ExpectedStayRevenueBreakdownTransaction = {
  transactionId?: string;
  bookingId: string;
  guestName: string;
  platformId: PlatformId;
  type: TransactionType;
  label: string;
  color: string;
  icon: string;
  amount: number;
  paymentMethod: transcation["paymentMethod"];
  direction?: transcation["direction"];
  createdAt?: Date;
  createdBy?: string;
  note?: string;
  reference?: string;
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

const getExpectedStayRevenueBounds = (
  startDate?: string,
  endDate?: string,
) => {
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

const getDepositRequirementForDate = async (
  businessDate: string,
): Promise<DepositRequirement | null> => {
  const bounds = getBusinessDayBoundsFromKey(businessDate);
  if (!bounds) return null;

  const bookings = await Booking.find({
    status: { $nin: ["checkedOut", "cancelled", "noShow"] },
    checkOut: { $gte: bounds.start, $lt: bounds.end },
  })
    .select("bookingId name checkOut transactions")
    .sort({ checkOut: 1, name: 1 })
    .lean<booking[]>();
  return buildDepositRequirement(bounds.businessDate, bookings);
};

const getTransactionsForBusinessDate = async (
  businessDate?: string,
  staffUsername?: string,
) => {
  const bounds = getBusinessDayBoundsFromKey(businessDate);
  if (!bounds) return null;

  const bookings = await Booking.find({
    $or: [
      { "transactions.createdAt": { $gte: bounds.start, $lt: bounds.end } },
      { checkIn: { $gte: bounds.start, $lt: bounds.end } },
      { checkOut: { $gte: bounds.start, $lt: bounds.end } },
      { "cancellation.cancelledAt": { $gte: bounds.start, $lt: bounds.end } },
      { "checkout.checkedOutAt": { $gte: bounds.start, $lt: bounds.end } },
    ],
  }).lean<booking[]>();

  const transactions = bookings.flatMap((booking) =>
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
        return (transaction.createdBy || booking.staffUsername) === staffUsername;
      })
      .map((transaction) => ({
        ...transaction,
        bookingId: booking.bookingId,
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
  shift: {
    _id?: unknown;
    startedAt: Date;
    endedAt?: Date;
  },
  fallbackEnd = new Date(),
) => {
  const shiftId = String(shift._id);
  const end = shift.endedAt || fallbackEnd;
  const bookings = await Booking.find({
    $or: [
      { "transactions.cashShiftId": shiftId },
      {
        "transactions.createdAt": {
          $gte: shift.startedAt,
          $lt: end,
        },
      },
    ],
  }).lean<booking[]>();

  return bookings.flatMap((booking) =>
    (booking.transactions || [])
      .filter((transaction) => {
        if (transaction.cashShiftId === shiftId) return true;
        if (transaction.cashShiftId) return false;
        const createdAt = new Date(transaction.createdAt || booking.checkIn);
        return createdAt >= shift.startedAt && createdAt < end;
      })
      .map((transaction) => ({
        ...transaction,
        bookingId: booking.bookingId,
        guestName: booking.name,
        staffUsername: transaction.createdBy || booking.staffUsername,
      })),
  );
};

const getUnassignedCashTransactionsBetween = async (start: Date, end: Date) => {
  const bookings = await Booking.find({
    "transactions.createdAt": { $gte: start, $lt: end },
  }).lean<booking[]>();

  return bookings.flatMap((booking) =>
    (booking.transactions || [])
      .filter((transaction) => {
        if (transaction.cashShiftId) return false;
        const createdAt = new Date(transaction.createdAt || booking.checkIn);
        return createdAt >= start && createdAt < end;
      })
      .map((transaction) => ({
        ...transaction,
        bookingId: booking.bookingId,
        guestName: booking.name,
        staffUsername: transaction.createdBy || booking.staffUsername,
      })),
  );
};

const enrichCashShift = async <T extends { toObject?: () => T }>(
  cashShift: T,
) => {
  const shiftObject =
    typeof cashShift.toObject === "function" ? cashShift.toObject() : cashShift;
  const movements = summarizeCashStashes(
    await getShiftTransactions(shiftObject as T & { startedAt: Date }),
  );
  const depositExpectedCash =
    Number((shiftObject as any).depositOpeningCash || 0) +
    movements.depositCashIn -
    movements.depositCashOut +
    Number((shiftObject as any).depositPreparation?.adjustment || 0);
  const operatingExpectedCash =
    Number((shiftObject as any).operatingOpeningCash || 0) +
    movements.operatingCashIn -
    movements.operatingCashOut;

  return {
    ...shiftObject,
    ...movements,
    depositExpectedCash,
    operatingExpectedCash,
  };
};

const attachCashShiftStaffProfiles = async <T extends { staffUsername?: string }>(
  cashShifts: T[],
) => {
  const usernames = [
    ...new Set(cashShifts.map((cashShift) => cashShift.staffUsername)),
  ].filter((username): username is string => Boolean(username));

  const users = await User.find({ username: { $in: usernames } })
    .select("username name profilePictureUrl")
    .lean();
  const usersByUsername = new Map(users.map((user) => [user.username, user]));

  return cashShifts.map((cashShift) => {
    const staff = cashShift.staffUsername
      ? usersByUsername.get(cashShift.staffUsername)
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
    };
  });
};

const getCashPositionForDate = async (businessDate?: string) => {
  const bounds = getBusinessDayBoundsFromKey(businessDate);
  if (!bounds) return null;

  const tomorrowBusinessDate = nextBusinessDateKey(bounds.businessDate);
  const [shifts, openingDepositRequirement, tomorrowDepositRequirement, preparedForToday] =
    await Promise.all([
      CashShift.find({ businessDate: bounds.businessDate }).sort({
        shiftNumber: 1,
      }),
      getDepositRequirementForDate(bounds.businessDate),
      getDepositRequirementForDate(tomorrowBusinessDate),
      CashShift.findOne({
        isFinalDayClose: true,
        "depositPreparation.targetBusinessDate": bounds.businessDate,
      })
        .sort({ endedAt: -1 })
        .select("businessDate shiftNumber depositPreparation endedAt")
        .lean(),
    ]);
  if (!openingDepositRequirement || !tomorrowDepositRequirement) return null;
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
  const currentDepositCash = enrichedActiveShift
    ? enrichedActiveShift.depositExpectedCash
    : (enrichedPreviousShift?.depositActualCash ??
        openingDepositRequirement.total) +
      unassignedMovements.depositCashIn -
      unassignedMovements.depositCashOut;
  const currentOperatingCash = enrichedActiveShift
    ? enrichedActiveShift.operatingExpectedCash
    : (enrichedPreviousShift?.operatingActualCash || 0) +
      unassignedMovements.operatingCashIn -
      unassignedMovements.operatingCashOut;

  return {
    businessDate: bounds.businessDate,
    threshold: CASH_VARIANCE_THRESHOLD,
    activeShift: enrichedActiveShift || null,
    previousShift: enrichedPreviousShift || null,
    current: {
      depositCash: currentDepositCash,
      operatingCash: currentOperatingCash,
    },
    unassignedCash: unassignedMovements,
    openingDepositRequirement,
    tomorrowDepositRequirement,
    preparedForToday: preparedForToday?.depositPreparation
      ? {
          sourceBusinessDate: preparedForToday.businessDate,
          sourceShiftNumber: preparedForToday.shiftNumber,
          ...preparedForToday.depositPreparation,
        }
      : null,
    handoff: {
      depositCash: activeShift
        ? enrichedPreviousShift?.depositActualCash || 0
        : currentDepositCash,
      operatingCash: activeShift
        ? enrichedPreviousShift?.operatingActualCash || 0
        : currentOperatingCash,
      fromShiftId: enrichedPreviousShift
        ? String(enrichedPreviousShift._id)
        : undefined,
      fromShiftNumber: enrichedPreviousShift?.shiftNumber,
    },
    shifts: enrichedShifts,
  };
};

type CashAuditWarning = {
  code:
    | "deposit_variance"
    | "operating_variance"
    | "handoff_mismatch"
    | "open_shift"
    | "flagged_transactions"
    | "unassigned_cash_activity";
  severity: "warning" | "critical";
  message: string;
};

const hasCashMovement = (movements: ReturnType<typeof summarizeCashStashes>) =>
  Object.values(movements).some((amount) => Math.abs(amount) > 0);

const cashMovementTotal = (movements: ReturnType<typeof summarizeCashStashes>) =>
  movements.depositCashIn -
  movements.depositCashOut +
  movements.operatingCashIn -
  movements.operatingCashOut;

const formatCashAuditAmount = (amount: number) =>
  new Intl.NumberFormat("th-TH", { maximumFractionDigits: 2 }).format(amount);

const getCashShiftAuditForDate = async (businessDate?: string) => {
  const bounds = getBusinessDayBoundsFromKey(businessDate);
  if (!bounds) return null;

  const shifts = await CashShift.find({ businessDate: bounds.businessDate }).sort({
    shiftNumber: 1,
  });
  const enrichedShifts = await attachCashShiftStaffProfiles(
    await Promise.all(shifts.map(enrichCashShift)),
  );
  const gaps: Array<{
    from: Date;
    to: Date;
    movements: ReturnType<typeof summarizeCashStashes>;
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
      movements,
      warning: {
        code: "unassigned_cash_activity",
        severity: "critical",
        message: `พบเงินสด ${formatCashAuditAmount(cashMovementTotal(movements))} บาทนอกกะเงินสด`,
      },
    });
  }

  const auditShifts = await Promise.all(
    enrichedShifts.map(async (shift, index) => {
      const shiftTransactions = await getShiftTransactions(shift as { _id?: unknown; startedAt: Date; endedAt?: Date });
      const flaggedTransactions = shiftTransactions.filter(
        (transaction) =>
          transaction.reviewStatus === "needs_review" ||
          Boolean(transaction.reviewFlags?.length),
      );
      const warnings: CashAuditWarning[] = [];
      const depositVariance = Number(shift.depositVariance || 0);
      const operatingVariance = Number(shift.operatingVariance || 0);
      if (
        shift.status === "closed" &&
        Math.abs(depositVariance) > CASH_VARIANCE_THRESHOLD
      ) {
        warnings.push({
          code: "deposit_variance",
          severity: "critical",
          message: `เงินมัดจำต่าง ${formatCashAuditAmount(depositVariance)} บาท`,
        });
      }
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
      if (shift.status === "open") {
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
        const expectedDepositOpening = cashBalanceAfterMovements(
          Number(previousShift.depositActualCash || 0),
          handoffMovements.depositCashIn,
          handoffMovements.depositCashOut,
        );
        const expectedOperatingOpening = cashBalanceAfterMovements(
          Number(previousShift.operatingActualCash || 0),
          handoffMovements.operatingCashIn,
          handoffMovements.operatingCashOut,
        );
        const depositDifference = Number(shift.depositOpeningCash) - expectedDepositOpening;
        const operatingDifference = Number(shift.operatingOpeningCash) - expectedOperatingOpening;
        const mismatch =
          shift.openingMode === "counted" &&
          (Math.abs(depositDifference) > CASH_VARIANCE_THRESHOLD ||
            Math.abs(operatingDifference) > CASH_VARIANCE_THRESHOLD);
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
          expectedDepositOpening,
          expectedOperatingOpening,
          depositDifference,
          operatingDifference,
          movements: handoffMovements,
          mismatch,
        };
      }

      return {
        ...shift,
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
    bookingId: booking.bookingId,
    guestName: booking.name,
    platformId: booking.platformId,
    type: transaction.type,
    label: meta.label,
    color: meta.color,
    icon: meta.icon,
    amount,
    paymentMethod: transaction.paymentMethod,
    direction,
    createdAt: transaction.createdAt,
    createdBy: transaction.createdBy,
    note: transaction.note,
    reference: transaction.reference,
  });

  categories.set(transaction.type, existingCategory);
};

const addPaymentMethodBreakdownTransaction = (
  paymentMethods: Map<PaymentMethod, ExpectedStayRevenuePaymentMethodBreakdown>,
  transaction: transcation,
  booking: booking,
  amount: number,
  direction: NonNullable<transcation["direction"]>,
) => {
  const methodMeta = paymentMethodMeta[transaction.paymentMethod];
  const transactionMeta = expectedStayRevenueTransactionMeta[transaction.type] || {
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
    bookingId: booking.bookingId,
    guestName: booking.name,
    platformId: booking.platformId,
    type: transaction.type,
    label: transactionMeta.label,
    color: transactionMeta.color,
    icon: transactionMeta.icon,
    amount,
    paymentMethod: transaction.paymentMethod,
    direction,
    createdAt: transaction.createdAt,
    createdBy: transaction.createdBy,
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
        const firstTime = first.createdAt ? new Date(first.createdAt).getTime() : 0;
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
        const firstTime = first.createdAt ? new Date(first.createdAt).getTime() : 0;
        const secondTime = second.createdAt
          ? new Date(second.createdAt).getTime()
          : 0;
        return secondTime - firstTime;
      }),
    }))
    .sort((first, second) => second.total - first.total);

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

    const bookings = await Booking.find({
      "transactions.createdAt": { $gte: bounds.start, $lt: bounds.end },
    }).lean<booking[]>();
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
      (booking.transactions || []).forEach((transaction) => {
        if (!transaction.createdAt) return;

        const createdAt = new Date(transaction.createdAt);
        if (createdAt < bounds.start || createdAt >= bounds.end) return;

        const direction = transactionDirection(transaction);
        const amount = Math.abs(transaction.amount || 0);
        if (amount === 0) return;

        if (
          expectedStayRevenueTypes.has(transaction.type) ||
          (transaction.type === "adjustment" && direction === "in")
        ) {
          addBreakdownTransaction(
            categories,
            transaction,
            booking,
            amount,
            direction,
          );
          addPaymentMethodBreakdownTransaction(
            paymentMethods,
            transaction,
            booking,
            amount,
            direction,
          );
          return;
        }

        if (
          expectedStayRevenueReductionTypes.has(transaction.type) ||
          (transaction.type === "adjustment" && direction === "out")
        ) {
          addBreakdownTransaction(
            reductions,
            transaction,
            booking,
            amount,
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
    const expectedStayRevenue = grossStayCharges - reductionTotal;
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

    res.status(200).json({
      period: {
        startDate: formatBusinessDateKey(bounds.start),
        endDate: formatBusinessDateKey(bounds.end),
        basis: "transactionCreatedAt",
      },
      totals: {
        grossStayCharges: Number(grossStayCharges.toFixed(2)),
        expectedStayRevenue: Number(expectedStayRevenue.toFixed(2)),
        reductions: Number(reductionTotal.toFixed(2)),
        netAfterReductions: Number(expectedStayRevenue.toFixed(2)),
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
      categories: finalizedCategories,
      reductions: finalizedReductions,
      paymentMethods: finalizedPaymentMethods,
    });
  } catch (err) {
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

    const bookings = await Booking.find({
      $or: [
        { checkIn: { $gte: bounds.start, $lt: bounds.end } },
        { "transactions.createdAt": { $gte: bounds.start, $lt: bounds.end } },
      ],
    }).lean<booking[]>();
    const todaySummary = calculateTodayRevenueSummary(
      bookings,
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

    bookings.forEach((booking) => {
      const isTodayArrival =
        new Date(booking.checkIn) >= bounds.start &&
        new Date(booking.checkIn) < bounds.end;

      if (isTodayArrival) {
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

      (booking.transactions || []).forEach((transaction) => {
        if (!transaction.createdAt) return;
        const createdAt = new Date(transaction.createdAt);
        if (createdAt < bounds.start || createdAt >= bounds.end) return;

        const direction = transactionDirection(transaction);
        const extrasAmount = transactionTodayExtrasRevenueAmount(transaction);
        if (extrasAmount > 0) {
          addBreakdownTransaction(
            categories,
            transaction,
            booking,
            extrasAmount,
            direction,
          );
          addPaymentMethodBreakdownTransaction(
            paymentMethods,
            transaction,
            booking,
            extrasAmount,
            direction,
          );
        }

        const reductionAmount = transactionTodayReductionAmount(transaction);
        const arrivalReductionAlreadyNetted =
          isTodayArrival &&
          ["cancelled", "noShow"].includes(booking.status) &&
          ["roomRefund", "cancellationRefund"].includes(transaction.type);
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

    res.status(200).json({
      period: {
        startDate: formatBusinessDateKey(bounds.start),
        endDate: formatBusinessDateKey(bounds.end),
        basis: "checkInAndTransactionCreatedAt",
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
      categories: finalizedCategories,
      reductions: finalizedReductions,
      paymentMethods: finalizedPaymentMethods,
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

    const bookings = await Booking.find({
      $or: [
        { checkIn: { $gte: bounds.start, $lt: bounds.end } },
        { "transactions.createdAt": { $gte: bounds.start, $lt: bounds.end } },
      ],
    }).lean<booking[]>();

    res.status(200).json(
      calculateTodayRevenueSummary(bookings, bounds.start, bounds.end),
    );
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
    const cashPosition = await getCashPositionForDate(reconciliation.businessDate);

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
    );

    if (!cashPosition) {
      return res.status(400).json({ message: "Invalid date format" });
    }

    res.status(200).json(cashPosition);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
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
        warningCodes: auditedShift.warnings.map((warning) => warning.code),
      },
    });

    res.status(200).json({ cashShift });
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

    const openingDepositRequirement = previousShift
      ? null
      : await getDepositRequirementForDate(bounds.businessDate);
    const expectedDepositOpening = cashBalanceAfterMovements(
      previousShift
        ? Number(previousShift.depositActualCash || 0)
        : Number(openingDepositRequirement?.total || 0),
      handoffMovements.depositCashIn,
      handoffMovements.depositCashOut,
    );
    const expectedOperatingOpening = cashBalanceAfterMovements(
      previousShift?.operatingActualCash || 0,
      handoffMovements.operatingCashIn,
      handoffMovements.operatingCashOut,
    );
    const depositOpeningCash =
      openingMode === "accepted_handoff"
        ? expectedDepositOpening
        : Number(req.body.depositOpeningCash || 0);
    const operatingOpeningCash =
      openingMode === "accepted_handoff"
        ? expectedOperatingOpening
        : Number(req.body.operatingOpeningCash || 0);

    if (
      !isValidCashCount(depositOpeningCash) ||
      !isValidCashCount(operatingOpeningCash)
    ) {
      return res.status(400).json({ message: "ยอดเงินสดไม่ถูกต้อง" });
    }

    const openingNoteRequired =
      Math.abs(depositOpeningCash - expectedDepositOpening) >
        CASH_VARIANCE_THRESHOLD ||
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
        handoffFromShiftId: previousShift ? String(previousShift._id) : undefined,
        depositOpeningCash,
        operatingOpeningCash,
        depositExpectedCash: depositOpeningCash,
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
        depositOpeningCash,
        operatingOpeningCash,
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

export const closeCashShift = async (req: Request, res: Response) => {
  try {
    if (!req.user?.username) {
      return res.status(401).json({ message: "กรุณาเข้าสู่ระบบใหม่" });
    }
    const closingUsername = req.user.username;

    const cashShift = await CashShift.findById(req.params.shiftId);
    if (!cashShift) {
      return res.status(404).json({ message: "ไม่พบกะเงินสดนี้" });
    }

    if (cashShift.status !== "open") {
      return res.status(409).json({ message: "กะเงินสดนี้ปิดไปแล้ว" });
    }

    if (
      !req.user.admin &&
      cashShift.staffUsername !== req.user.username
    ) {
      return res.status(403).json({
        message: "เฉพาะผู้รับผิดชอบกะหรือผู้ดูแลระบบเท่านั้นที่ปิดกะได้",
      });
    }

    return await withCashShiftMutationLock(cashShift.businessDate, async () => {

    const closeDay = req.body.closeDay === true;
    if (closeDay) {
      const existingFinalClose = await CashShift.findOne({
        businessDate: cashShift.businessDate,
        isFinalDayClose: true,
        _id: { $ne: cashShift._id },
      }).select("_id");
      if (existingFinalClose) {
        return res.status(409).json({ message: "วันนี้ปิดยอดสุดท้ายแล้ว" });
      }
    }

    const depositActualCash = Number(req.body.depositActualCash);
    const operatingActualCash = Number(req.body.operatingActualCash);
    if (
      !isValidCashCount(depositActualCash) ||
      !isValidCashCount(operatingActualCash)
    ) {
      return res.status(400).json({ message: "ยอดเงินสดไม่ถูกต้อง" });
    }

    const movements = summarizeCashStashes(await getShiftTransactions(cashShift));
    const depositExpectedBeforePreparation =
      cashShift.depositOpeningCash +
      movements.depositCashIn -
      movements.depositCashOut;
    const nextBusinessDate = nextBusinessDateKey(cashShift.businessDate);
    const tomorrowDepositRequirement = closeDay
      ? await getDepositRequirementForDate(nextBusinessDate)
      : null;
    if (closeDay && !tomorrowDepositRequirement) {
      return res.status(400).json({ message: "ไม่สามารถคำนวณมัดจำวันพรุ่งนี้ได้" });
    }
    const preparationAdjustment = tomorrowDepositRequirement
      ? depositPreparationAdjustment(
          depositExpectedBeforePreparation,
          tomorrowDepositRequirement.total,
        )
      : 0;
    const depositExpectedCash = tomorrowDepositRequirement
      ? tomorrowDepositRequirement.total
      : depositExpectedBeforePreparation;
    const operatingExpectedCash =
      cashShift.operatingOpeningCash +
      movements.operatingCashIn -
      movements.operatingCashOut;
    const depositVariance = depositActualCash - depositExpectedCash;
    const operatingVariance = operatingActualCash - operatingExpectedCash;

    if (
      (Math.abs(depositVariance) > CASH_VARIANCE_THRESHOLD ||
        Math.abs(operatingVariance) > CASH_VARIANCE_THRESHOLD) &&
      !String(req.body.note || "").trim()
    ) {
      return res.status(400).json({
        message: "กรุณาระบุหมายเหตุเมื่อยอดเงินสดไม่ตรงกัน",
      });
    }

    const closedAt = new Date();
    const depositPreparation = tomorrowDepositRequirement
      ? {
          targetBusinessDate: tomorrowDepositRequirement.businessDate,
          requiredAmount: tomorrowDepositRequirement.total,
          preparedAmount: depositActualCash,
          adjustment: preparationAdjustment,
          checkoutCount: tomorrowDepositRequirement.checkoutCount,
          refundBookingCount: tomorrowDepositRequirement.refundBookingCount,
          bookings: tomorrowDepositRequirement.bookings,
          calculatedAt: tomorrowDepositRequirement.calculatedAt,
          preparedAt: closedAt,
          preparedBy: closingUsername,
        }
      : undefined;
    const closedShift = await withMutationIdempotency(req, () =>
      CashShift.findOneAndUpdate(
        { _id: cashShift._id, status: "open" },
        {
          $set: {
            status: "closed",
            depositCashIn: movements.depositCashIn,
            depositCashOut: movements.depositCashOut,
            operatingCashIn: movements.operatingCashIn,
            operatingCashOut: movements.operatingCashOut,
            depositExpectedCash,
            operatingExpectedCash,
            depositActualCash,
            operatingActualCash,
            depositVariance,
            operatingVariance,
            isFinalDayClose: closeDay,
            depositPreparation,
            note: String(req.body.note || cashShift.note || "").trim(),
            endedAt: closedAt,
            closedBy: req.user?.username,
          },
        },
        { returnDocument: "after" },
      ),
    );

    if (!closedShift) {
      return res.status(409).json({ message: "กะเงินสดนี้ปิดไปแล้ว" });
    }

    await logActivity(req.user!.username, "DAILY_CLOSE", {
      summary: {
        action: "CLOSE_CASH_SHIFT",
        businessDate: cashShift.businessDate,
        shiftNumber: cashShift.shiftNumber,
        depositExpectedCash,
        depositActualCash,
        depositVariance,
        closeDay,
        depositPreparation: depositPreparation
          ? {
              targetBusinessDate: depositPreparation.targetBusinessDate,
              requiredAmount: depositPreparation.requiredAmount,
              preparedAmount: depositPreparation.preparedAmount,
              adjustment: depositPreparation.adjustment,
              checkoutCount: depositPreparation.checkoutCount,
              refundBookingCount: depositPreparation.refundBookingCount,
            }
          : undefined,
        operatingExpectedCash,
        operatingActualCash,
        operatingVariance,
      },
    }).catch((err) => {
      console.error("Failed to log cash shift close", err);
    });

    return res.status(200).json({ cashShift: closedShift });
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

    if (!isValidCashCount(actualCash) || !isValidCashCount(openingCash)) {
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
      openingCash + reconciliation.summary.cashIn - reconciliation.summary.cashOut;
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

    const dailyClose = await withMutationIdempotency(req, () =>
      DailyClose.findOneAndUpdate(
        {
          businessDate: reconciliation.businessDate,
          staffUsername,
        },
        {
          $set: {
            revision: (existingDailyClose?.revision || 0) + 1,
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
          ...(previousRevision
            ? {
                $push: {
                  revisions: previousRevision,
                },
              }
            : {}),
        },
        { returnDocument: "after", upsert: true },
      ),
    );

    await logActivity(requestUsername, "DAILY_CLOSE", {
      summary: {
        businessDate: reconciliation.businessDate,
        staffUsername,
        openingCash,
        expectedCash,
        actualCash,
        variance,
      },
    });

    res.status(200).json({ dailyClose });
  } catch (err) {
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

    const reconciliation = await getTransactionsForBusinessDate(
      req.query.date as string | undefined,
    );

    if (!reconciliation) {
      return res.status(400).json({ message: "Invalid date format" });
    }

    const transactions = reconciliation.transactions.filter(
      (transaction: transcation & { bookingId?: string }) =>
        transaction.reviewStatus !== "reviewed" &&
        (transaction.reviewStatus === "needs_review" ||
          (transaction.reviewFlags || []).length > 0),
    );

    res.status(200).json({
      businessDate: reconciliation.businessDate,
      transactions,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
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
    const booking = await Booking.findOne({ bookingId });

    if (!booking) {
      return res.status(404).json({ message: "ไม่พบ Booking" });
    }

    const transaction = booking.transactions.find(
      (existingTransaction) => String(existingTransaction._id) === transactionId,
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

    const requiresReview =
      transaction.reviewStatus === "needs_review" ||
      (transaction.reviewFlags || []).length > 0;

    if (!requiresReview) {
      return res.status(400).json({
        message: "รายการนี้ไม่จำเป็นต้องตรวจสอบ",
      });
    }

    const reviewedAt = transaction.reviewedAt || new Date();
    transaction.reviewStatus = "reviewed";
    transaction.reviewedBy = transaction.reviewedBy || req.user.username;
    transaction.reviewedAt = reviewedAt;

    booking.markModified("transactions");
    await booking.save();

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
          reviewedBy: transaction.reviewedBy,
          reviewedAt,
        },
      },
      bookingId,
    );

    res.status(200).json({
      transaction,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
};
