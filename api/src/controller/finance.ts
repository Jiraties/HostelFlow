import { Request, Response } from "express";
import Booking from "../models/booking";
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
  summarizeTransactions,
  transactionDirection,
  transactionFallsOnBusinessDate,
} from "../helpers/financeHelpers";
import {
  IdempotencyConflictError,
  withMutationIdempotency,
} from "../services/mutationIdempotency";

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
  adjustment: { label: "ปรับราคา", color: "#a78bfa", icon: "bx-edit-alt" },
  towel: { label: "ผ้าเช็ดตัว", color: "#38bdf8", icon: "bx-bath" },
  motorbike: { label: "มอเตอร์ไซค์", color: "#fb923c", icon: "bx-cycling" },
  slowBoat: { label: "Slow Boat", color: "#2dd4bf", icon: "bx-water" },
  joinTour: { label: "Join Tour", color: "#22c55e", icon: "bx-map" },
  extraBed: { label: "เตียงเสริม", color: "#ec4899", icon: "bx-bed" },
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
  ].filter(Boolean);

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

    res.status(200).json({
      businessDate: reconciliation.businessDate,
      threshold: CASH_VARIANCE_THRESHOLD,
      summary: reconciliation.summary,
      transactions: reconciliation.transactions,
      dailyCloses: dailyClosesWithStaff,
    });
  } catch (err) {
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

    if (!Number.isFinite(actualCash) || !Number.isFinite(openingCash)) {
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
      typeof req.body.note !== "string"
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
