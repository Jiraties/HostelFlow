import { Request, Response } from "express";
import Booking from "../models/booking";
import DailyClose from "../models/dailyClose";
import User from "../models/user";
import type { booking, transcation } from "../models/booking";
import { logActivity } from "../services/activityServices";
import {
  CASH_VARIANCE_THRESHOLD,
  summarizeTransactions,
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
