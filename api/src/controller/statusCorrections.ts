import crypto from "crypto";
import mongoose from "mongoose";
import type { Request, Response } from "express";
import Activity from "../models/activity";
import Booking, {
  type booking,
  type roomStay,
  type Status,
  type TransactionCorrection,
  type transcation,
} from "../models/booking";
import CashShift from "../models/cashShift";
import StatusCorrection, {
  type StatusCorrectionDepositDecision,
  type StatusCorrectionType,
} from "../models/statusCorrection";
import { transactionRequiresCashShift } from "../services/cashLedgerTransaction";
import {
  bookingRevisionPredicate,
  expectedBookingRevision,
  sendBookingRevisionConflict,
} from "../services/bookingConcurrency";
import { logActivityStrict } from "../services/activityServices";
import { getRoomStayRoomIds } from "../helpers/roomStayHelpers";
import {
  RoomMutationConflictError,
  withRoomMutationLocks,
} from "../services/roomMutationLocks";
import {
  effectiveBookingTransactions,
  snapshotTransaction,
} from "../services/transactionCorrections";

const BUSINESS_TIME_ZONE = "Asia/Bangkok";
const CORRECTION_TYPES: StatusCorrectionType[] = [
  "UNDO_CHECKOUT",
  "UNDO_CANCELLATION",
  "UNDO_NO_SHOW",
];
const DEPOSIT_DECISIONS: StatusCorrectionDepositDecision[] = [
  "not_applicable",
  "not_actually_returned",
  "already_returned",
];
const OTA_PLATFORMS = new Set(["BOOK", "HOST", "TRAV", "AGOD"]);

const CORRECTION_TRANSITIONS: Record<
  StatusCorrectionType,
  { source: Status; restored: Status }
> = {
  UNDO_CHECKOUT: { source: "checkedOut", restored: "checkedIn" },
  UNDO_CANCELLATION: { source: "cancelled", restored: "booked" },
  UNDO_NO_SHOW: { source: "noShow", restored: "booked" },
};

type CorrectionBody = {
  expectedRevision?: number;
  correctionType?: StatusCorrectionType;
  reason?: string;
  depositDecision?: StatusCorrectionDepositDecision;
};

type CorrectionParams = { bookingId: string };
type Blocker = {
  code: string;
  message: string;
  bookingIds?: string[];
  transactionIds?: string[];
  cashShiftIds?: string[];
};

type TerminalAction = {
  actor: string;
  at: Date;
  expectedActivities: string[];
  sourceActions: string[];
};

type ValidatedRequest =
  | {
      error: { status: number; code: string; message: string };
    }
  | {
      error?: never;
      expectedRevision: number;
      correctionType: StatusCorrectionType;
      reason: string;
      depositDecision: StatusCorrectionDepositDecision;
      idempotencyKey: string;
    };

class StatusCorrectionBlockedError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly preview?: Awaited<ReturnType<typeof buildPreview>>,
  ) {
    super(message);
    this.name = "StatusCorrectionBlockedError";
  }
}

class StatusCorrectionShiftRaceError extends Error {
  constructor() {
    super("กะเงินสดที่ได้รับผลกระทบปิดระหว่างแก้ไขสถานะ กรุณาตรวจสอบใหม่");
    this.name = "StatusCorrectionShiftRaceError";
  }
}

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

const businessDateKey = (date: Date) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
};

const transactionId = (transaction: transcation) =>
  String(transaction._id || "");

const roomAssignments = (currentBooking: booking) =>
  (currentBooking.roomStays || []).map((stay) => ({
    roomIds: getRoomStayRoomIds(stay),
    from: new Date(stay.from),
    to: new Date(stay.to),
  }));

const correctionResponse = (record: any) => ({
  correctionId: record.correctionId,
  bookingId: record.bookingId,
  correctionType: record.correctionType,
  sourceStatus: record.sourceStatus,
  restoredStatus: record.restoredStatus,
  originalActionActor: record.originalActionActor,
  originalActionAt: record.originalActionAt,
  correctedBy: record.correctedBy,
  correctedAt: record.correctedAt,
  reason: record.reason,
  affectedRoomAssignments: record.affectedRoomAssignments,
  affectedTransactionIds: record.affectedTransactionIds,
  depositDecision: record.depositDecision,
  affectedCashShiftIds: record.affectedCashShiftIds,
  otaManualFollowUp: record.otaManualFollowUp,
});

const validateRequest = (
  req: Request<CorrectionParams, {}, CorrectionBody>,
  options: { requireReason?: boolean } = {},
): ValidatedRequest => {
  const expectedRevision = expectedBookingRevision(req.body.expectedRevision);
  const correctionType = req.body.correctionType;
  const reason = String(req.body.reason || "").trim();
  const depositDecision = req.body.depositDecision || "not_applicable";
  const idempotencyKey = req.get("Idempotency-Key")?.trim();

  if (expectedRevision === null) {
    return {
      error: {
        status: 400,
        code: "EXPECTED_REVISION_REQUIRED",
        message: "กรุณารีเฟรชข้อมูลการจองก่อนแก้ไขสถานะ",
      },
    };
  }
  if (!correctionType || !CORRECTION_TYPES.includes(correctionType)) {
    return {
      error: {
        status: 400,
        code: "INVALID_STATUS_CORRECTION_TYPE",
        message: "ประเภทการแก้ไขสถานะไม่ถูกต้อง",
      },
    };
  }
  if (options.requireReason !== false && !reason) {
    return {
      error: {
        status: 400,
        code: "STATUS_CORRECTION_REASON_REQUIRED",
        message: "กรุณาระบุเหตุผลที่แก้ไขสถานะ",
      },
    };
  }
  if (reason.length > 500) {
    return {
      error: {
        status: 400,
        code: "STATUS_CORRECTION_REASON_TOO_LONG",
        message: "เหตุผลต้องไม่เกิน 500 ตัวอักษร",
      },
    };
  }
  if (!DEPOSIT_DECISIONS.includes(depositDecision)) {
    return {
      error: {
        status: 400,
        code: "INVALID_DEPOSIT_DECISION",
        message: "กรุณาระบุสิ่งที่เกิดขึ้นจริงกับเงินมัดจำ",
      },
    };
  }
  if (!idempotencyKey) {
    return {
      error: {
        status: 400,
        code: "IDEMPOTENCY_KEY_REQUIRED",
        message: "ไม่พบรหัสป้องกันรายการซ้ำ กรุณาปิดและเปิดหน้าต่างใหม่",
      },
    };
  }

  return {
    expectedRevision,
    correctionType,
    reason,
    depositDecision,
    idempotencyKey,
  };
};

const terminalAction = (
  currentBooking: booking,
  correctionType: StatusCorrectionType,
): TerminalAction | null => {
  if (correctionType === "UNDO_CHECKOUT" && currentBooking.checkout) {
    return {
      actor: currentBooking.checkout.checkedOutByStaffUsername,
      at: new Date(currentBooking.checkout.checkedOutAt),
      expectedActivities: ["CHECK_OUT", "RESOLVE_STAY"],
      sourceActions: ["CHECK_OUT", "RESOLVE_STAY"],
    };
  }
  if (correctionType === "UNDO_CANCELLATION" && currentBooking.cancellation) {
    return {
      actor: currentBooking.cancellation.cancelledByStaffUsername,
      at: new Date(currentBooking.cancellation.cancelledAt),
      expectedActivities: ["CANCEL_BOOKING", "RESOLVE_STAY"],
      sourceActions: ["CANCEL_BOOKING", "RESOLVE_STAY"],
    };
  }
  if (
    correctionType === "UNDO_NO_SHOW" &&
    currentBooking.resolution?.outcome === "no_show" &&
    currentBooking.resolution.finalStatus === "noShow"
  ) {
    return {
      actor: currentBooking.resolution.resolvedByStaffUsername,
      at: new Date(currentBooking.resolution.resolvedAt),
      expectedActivities: ["RESOLVE_STAY"],
      sourceActions: ["RESOLVE_STAY"],
    };
  }
  return null;
};

const roomStaysConflict = (left: roomStay, right: roomStay) =>
  getRoomStayRoomIds(left).some((roomId) =>
    getRoomStayRoomIds(right).includes(roomId),
  ) &&
  new Date(left.from) < new Date(right.to) &&
  new Date(left.to) > new Date(right.from);

const conflictingRoomBookings = async (currentBooking: booking) => {
  const assignments = currentBooking.roomStays || [];
  if (!assignments.length) return [];

  const candidates = await Booking.find({
    bookingId: { $ne: currentBooking.bookingId },
    voided: { $ne: true },
    $and: [
      {
        $or: [
          { status: { $nin: ["cancelled", "checkedOut", "noShow"] } },
          { "cancellation.roomReleaseStatus": "blocked" },
          { "checkout.roomReleaseStatus": "blocked" },
          { "resolution.roomReleaseStatus": "blocked" },
        ],
      },
      {
        $or: assignments.flatMap((assignment) => {
          const roomIds = getRoomStayRoomIds(assignment);
          return [
            {
              roomStays: {
                $elemMatch: {
                  roomIds: { $in: roomIds },
                  from: { $lt: new Date(assignment.to) },
                  to: { $gt: new Date(assignment.from) },
                },
              },
            },
            {
              roomStays: {
                $elemMatch: {
                  roomId: { $in: roomIds },
                  from: { $lt: new Date(assignment.to) },
                  to: { $gt: new Date(assignment.from) },
                },
              },
            },
          ];
        }),
      },
    ],
  })
    .select("bookingId roomStays")
    .lean<booking[]>();

  return candidates.filter((candidate) =>
    candidate.roomStays.some((existing) =>
      assignments.some((incoming) => roomStaysConflict(existing, incoming)),
    ),
  );
};

const terminalTransactions = (
  currentBooking: booking,
  action: TerminalAction,
) =>
  (currentBooking.transactions || []).filter(
    (transaction) =>
      Boolean(transaction.sourceAction) &&
      action.sourceActions.includes(transaction.sourceAction!) &&
      (!transaction.createdAt ||
        Math.abs(
          new Date(transaction.createdAt).getTime() - action.at.getTime(),
        ) <=
          5 * 60_000),
  );

const correctionTypeForStatus = (
  status: Status,
): StatusCorrectionType | null => {
  if (status === "checkedOut") return "UNDO_CHECKOUT";
  if (status === "cancelled") return "UNDO_CANCELLATION";
  if (status === "noShow") return "UNDO_NO_SHOW";
  return null;
};

const statusCorrectionPermission = async ({
  currentBooking,
  correctionType,
  username,
  isAdmin,
}: {
  currentBooking: booking;
  correctionType: StatusCorrectionType;
  username: string;
  isAdmin: boolean;
}) => {
  const transition = CORRECTION_TRANSITIONS[correctionType];
  const action = terminalAction(currentBooking, correctionType);
  const bookingEligible =
    !currentBooking.voided &&
    currentBooking.status === transition.source &&
    Boolean(action);
  const sameBusinessDate =
    Boolean(action) &&
    businessDateKey(action!.at) === businessDateKey(new Date());
  const originalActor = Boolean(action) && action!.actor === username;
  const terminalTx = action ? terminalTransactions(currentBooking, action) : [];
  const affectedCashShiftIds = [
    ...new Set(
      terminalTx
        .map((transaction) => transaction.cashShiftId)
        .filter((value): value is string => Boolean(value)),
    ),
  ];
  const affectedShifts = affectedCashShiftIds.length
    ? await CashShift.find({ _id: { $in: affectedCashShiftIds } })
        .select("_id status")
        .lean()
    : [];
  const hasMissingCashShift =
    terminalTx.some(
      (transaction) =>
        transactionRequiresCashShift(transaction) && !transaction.cashShiftId,
    ) || affectedShifts.length !== affectedCashShiftIds.length;
  const affectedShiftsOpen = affectedShifts.every(
    (shift) => shift.status === "open",
  );
  const requiresAdmin =
    !sameBusinessDate || !originalActor || !affectedShiftsOpen;
  const allowed =
    bookingEligible &&
    !hasMissingCashShift &&
    (isAdmin || !requiresAdmin);

  const message = !bookingEligible
    ? "แก้ไขได้เฉพาะ Booking ที่อยู่ในสถานะปลายทางและมีประวัติครบถ้วน"
    : hasMissingCashShift
      ? "ไม่พบกะเงินสดที่อ้างอิงโดยรายการทางการเงิน ต้องให้ Admin ตรวจสอบ"
      : !allowed
        ? !sameBusinessDate
          ? "พ้นวันทำการกรุงเทพฯ แล้ว ต้องให้ Admin ดำเนินการ"
          : !originalActor
            ? "คุณไม่ใช่ผู้บันทึกสถานะเดิม ต้องให้ Admin ดำเนินการ"
            : "กะเงินสดที่ได้รับผลกระทบปิดแล้ว ต้องให้ Admin ดำเนินการ"
        : null;

  return {
    allowed,
    bookingEligible,
    requiresAdmin,
    sameBusinessDate,
    originalActor,
    affectedShiftsOpen,
    affectedCashShiftIds,
    message,
  };
};

const reversibleTransactions = (
  correctionType: StatusCorrectionType,
  transactions: transcation[],
) => {
  if (correctionType === "UNDO_CHECKOUT") {
    return transactions.filter(
      (transaction) => transaction.type === "depositRefund",
    );
  }
  if (correctionType === "UNDO_CANCELLATION") {
    return transactions.filter(
      (transaction) => transaction.type === "roomChargeWriteOff",
    );
  }
  return [];
};

const buildPreview = async ({
  currentBooking,
  body,
  username,
  isAdmin,
}: {
  currentBooking: booking;
  body: Required<
    Pick<CorrectionBody, "correctionType" | "reason" | "depositDecision">
  >;
  username: string;
  isAdmin: boolean;
}) => {
  const blockers: Blocker[] = [];
  const warnings: { code: string; message: string }[] = [];
  const transition = CORRECTION_TRANSITIONS[body.correctionType];
  const action = terminalAction(currentBooking, body.correctionType);
  const assignments = roomAssignments(currentBooking);

  if (
    currentBooking.voided ||
    currentBooking.status !== transition.source ||
    !action
  ) {
    blockers.push({
      code: "STATUS_CORRECTION_NOT_ALLOWED",
      message: `แก้ไขนี้ใช้ได้เฉพาะ Booking สถานะ ${transition.source} ที่มีประวัติการปิดครบถ้วน`,
    });
  }

  const sameBusinessDate =
    Boolean(action) &&
    businessDateKey(action!.at) === businessDateKey(new Date());
  const originalActor = Boolean(action) && action!.actor === username;

  if (!isAdmin && action && !sameBusinessDate) {
    blockers.push({
      code: "ADMIN_APPROVAL_REQUIRED",
      message: "พ้นวันทำการกรุงเทพฯ ที่บันทึกสถานะแล้ว ต้องให้ Admin ดำเนินการ",
    });
  }
  if (!isAdmin && action && !originalActor) {
    blockers.push({
      code: "ADMIN_APPROVAL_REQUIRED",
      message: "เฉพาะผู้บันทึกสถานะเดิมหรือ Admin เท่านั้นที่แก้ไขได้",
    });
  }

  const terminalTx = action ? terminalTransactions(currentBooking, action) : [];
  const terminalTransactionIds = terminalTx.map(transactionId).filter(Boolean);
  const reversibleTx = reversibleTransactions(
    body.correctionType,
    terminalTx,
  );
  const reversibleTransactionIds = reversibleTx
    .map(transactionId)
    .filter(Boolean);
  const affectedCashShiftIds = [
    ...new Set(
      terminalTx
        .map((transaction) => transaction.cashShiftId)
        .filter((value): value is string => Boolean(value)),
    ),
  ];
  const cashTransactionsMissingShift = terminalTx.filter(
    (transaction) =>
      transactionRequiresCashShift(transaction) && !transaction.cashShiftId,
  );
  if (cashTransactionsMissingShift.length) {
    blockers.push({
      code: "AFFECTED_CASH_SHIFT_MISSING",
      message:
        "พบรายการเงินสดที่ไม่อ้างอิงกะเงินสด จึงไม่สามารถย้อนสถานะอัตโนมัติได้",
      transactionIds: cashTransactionsMissingShift
        .map(transactionId)
        .filter(Boolean),
    });
  }

  const affectedShifts = affectedCashShiftIds.length
    ? await CashShift.find({ _id: { $in: affectedCashShiftIds } })
        .select("_id status")
        .lean()
    : [];
  if (affectedShifts.length !== affectedCashShiftIds.length) {
    blockers.push({
      code: "AFFECTED_CASH_SHIFT_NOT_FOUND",
      message:
        "ไม่พบกะเงินสดที่อ้างอิงโดยรายการทางการเงิน จึงไม่สามารถย้อนสถานะอัตโนมัติได้",
      cashShiftIds: affectedCashShiftIds.filter(
        (cashShiftId) =>
          !affectedShifts.some(
            (affectedShift) => String(affectedShift._id) === cashShiftId,
          ),
      ),
    });
  }
  const closedAffectedCashShiftIds = affectedShifts
    .filter((shift) => shift.status !== "open")
    .map((shift) => String(shift._id));
  const openAffectedCashShiftIds = affectedShifts
    .filter((shift) => shift.status === "open")
    .map((shift) => String(shift._id));
  if (!isAdmin && closedAffectedCashShiftIds.length) {
    blockers.push({
      code: "ADMIN_APPROVAL_REQUIRED",
      message: "กะเงินสดที่ได้รับผลกระทบปิดแล้ว ต้องให้ Admin ดำเนินการ",
      cashShiftIds: closedAffectedCashShiftIds,
    });
  }

  if (action) {
    const laterTransactions = (currentBooking.transactions || []).filter(
      (transaction) =>
        !terminalTransactionIds.includes(transactionId(transaction)) &&
        Boolean(transaction.createdAt) &&
        new Date(transaction.createdAt!).getTime() > action.at.getTime(),
    );
    if (laterTransactions.length) {
      blockers.push({
        code: "LATER_TRANSACTIONS_EXIST",
        message: "มีรายการทางการเงินหลังการปิด Booking จึงไม่ปลอดภัยที่จะย้อนอัตโนมัติ",
        transactionIds: laterTransactions.map(transactionId).filter(Boolean),
      });
    }

    const laterCorrections = (currentBooking.transactionCorrections || []).filter(
      (correction) =>
        new Date(correction.correctedAt).getTime() > action.at.getTime(),
    );
    if (laterCorrections.length) {
      blockers.push({
        code: "LATER_FINANCIAL_CORRECTION_EXISTS",
        message: "มีการแก้ไขรายการทางการเงินหลังการปิด Booking",
        transactionIds: laterCorrections.map(
          (correction) => correction.targetTransactionId,
        ),
      });
    }

    const laterDependentActivity = await Activity.findOne({
      bookingId: currentBooking.bookingId,
      timestamp: { $gt: action.at },
      action: {
        $in: [
          "EXTEND_BOOKING",
          "MANAGE_ROOM_STAYS",
          "CHECK_IN",
          "CORRECT_CHECK_IN",
          "CHECK_OUT",
          "CANCEL_BOOKING",
          "RESOLVE_STAY",
          "POST_CLOSE_ADJUSTMENT",
          "CORRECT_TRANSACTION",
          "CORRECT_BOOKING_STATUS",
        ].filter(
          (activity) => !action.expectedActivities.includes(activity),
        ),
      },
    }).lean();
    if (laterDependentActivity) {
      blockers.push({
        code: "LATER_BOOKING_ACTION_EXISTS",
        message: "มีการเปลี่ยนแปลง Booking หลังสถานะที่ต้องการแก้ไข",
      });
    }
  }

  const conflicts = await conflictingRoomBookings(currentBooking);
  if (conflicts.length) {
    blockers.push({
      code: "ROOM_ASSIGNMENT_CONFLICT",
      message:
        "ห้องหรือเตียงเดิมถูกจัดให้ Booking อื่นแล้ว ต้องแก้การจัดห้องก่อน",
      bookingIds: conflicts.map((conflict) => conflict.bookingId),
    });
  }

  const depositReturnAmount =
    body.correctionType === "UNDO_CHECKOUT"
      ? Number(currentBooking.checkout?.depositRefundAmount || 0)
      : 0;
  const reversibleDepositAmount = reversibleTx
    .filter((transaction) => transaction.type === "depositRefund")
    .reduce((total, transaction) => total + Math.abs(transaction.amount || 0), 0);
  const depositDecisionRequired = depositReturnAmount > 0;

  if (
    body.correctionType !== "UNDO_CHECKOUT" &&
    body.depositDecision !== "not_applicable"
  ) {
    blockers.push({
      code: "DEPOSIT_DECISION_NOT_APPLICABLE",
      message: "การแก้ไขสถานะนี้ไม่มีการตัดสินใจเรื่องคืนมัดจำ",
    });
  } else if (
    body.correctionType === "UNDO_CHECKOUT" &&
    depositDecisionRequired &&
    body.depositDecision === "not_applicable"
  ) {
    blockers.push({
      code: "DEPOSIT_DECISION_REQUIRED",
      message: "กรุณาระบุว่าได้คืนมัดจำให้แขกจริงแล้วหรือไม่",
    });
  } else if (
    body.correctionType === "UNDO_CHECKOUT" &&
    !depositDecisionRequired &&
    body.depositDecision !== "not_applicable"
  ) {
    blockers.push({
      code: "DEPOSIT_DECISION_MISMATCH",
      message: "Checkout นี้ไม่มีรายการคืนมัดจำ",
    });
  } else if (
    body.correctionType === "UNDO_CHECKOUT" &&
    body.depositDecision === "not_actually_returned" &&
    reversibleDepositAmount !== depositReturnAmount
  ) {
    blockers.push({
      code: "DEPOSIT_RETURN_NOT_REVERSIBLE",
      message:
        "ไม่พบรายการคืนมัดจำที่ระบบสร้างไว้อย่างครบถ้วน จึงย้อนผลทางบัญชีอัตโนมัติไม่ได้",
      transactionIds: reversibleTransactionIds,
    });
  }

  const terminalActionKey = action
    ? sha256(
        `${currentBooking.bookingId}:${transition.source}:${action.at.toISOString()}`,
      )
    : "";
  if (
    terminalActionKey &&
    (await StatusCorrection.exists({ terminalActionKey }))
  ) {
    blockers.push({
      code: "STATUS_CORRECTION_ALREADY_COMPLETED",
      message: "สถานะปลายทางรายการนี้ถูกแก้ไขไปแล้ว",
    });
  }

  const otaManualFollowUp = OTA_PLATFORMS.has(currentBooking.platformId);
  if (otaManualFollowUp) {
    warnings.push({
      code: "OTA_MANUAL_FOLLOW_UP_REQUIRED",
      message:
        "HostelFlow เท่านั้นที่จะถูกแก้ไข กรุณาตรวจสอบและแก้สถานะใน OTA ด้วยตนเอง",
    });
  }

  const preservedFinancialIds = terminalTx
    .filter(
      (transaction) =>
        !reversibleTransactionIds.includes(transactionId(transaction)),
    )
    .map(transactionId)
    .filter(Boolean);
  const compensationIds =
    body.depositDecision === "already_returned"
      ? body.correctionType === "UNDO_CANCELLATION"
        ? reversibleTransactionIds
        : []
      : reversibleTransactionIds;

  return {
    eligible: blockers.length === 0,
    requiresAdmin:
      Boolean(action) &&
      (!sameBusinessDate ||
        !originalActor ||
        closedAffectedCashShiftIds.length > 0),
    correctionType: body.correctionType,
    booking: {
      bookingId: currentBooking.bookingId,
      name: currentBooking.name,
      currentStatus: currentBooking.status,
      restoredStatus: transition.restored,
      originalActionActor: action?.actor || null,
      originalActionAt: action?.at || null,
      revision: currentBooking.revision,
    },
    roomEffect: {
      assignments,
      message: conflicts.length
        ? "ไม่สามารถคืนการครอบครองห้องเดิมได้"
        : transition.restored === "checkedIn"
          ? "ห้องหรือเตียงเดิมจะกลับมาเป็นห้องที่มีผู้เข้าพัก"
          : "ห้องหรือเตียงเดิมจะกลับมาเป็นรายการจอง",
    },
    financialEffect: {
      depositReturnAmount,
      depositDecisionRequired,
      depositDecision: body.depositDecision,
      reversibleTransactionIds: compensationIds,
      preservedTransactionIds: preservedFinancialIds,
      message:
        body.correctionType === "UNDO_CHECKOUT" && depositReturnAmount > 0
          ? body.depositDecision === "not_actually_returned"
            ? "รายการคืนมัดจำที่บันทึกผิดจะถูกชดเชย โดยไม่ลบรายการเดิม"
            : body.depositDecision === "already_returned"
              ? "รายการคืนมัดจำจะคงอยู่ และ Booking จะไม่มีมัดจำคงถือ"
              : "ต้องระบุว่าได้คืนมัดจำจริงหรือไม่"
          : body.correctionType === "UNDO_CANCELLATION" &&
              reversibleTransactionIds.length
            ? "คืนสถานะรายการค้างชำระที่ระบบตัดออกตอนยกเลิก โดยคง Refund ที่จ่ายจริง"
            : "คงรายการรับเงิน คืนเงิน และค่าธรรมเนียมเดิมทั้งหมด",
    },
    ota: {
      requiresManualFollowUp: otaManualFollowUp,
      message: otaManualFollowUp
        ? "ต้องตรวจสอบ Booking.com/Hostelworld หรือ OTA ต้นทางด้วยตนเอง"
        : "ไม่ต้องติดตามแก้สถานะกับ OTA",
    },
    affectedCashShiftIds,
    openAffectedCashShiftIds,
    terminalActionKey,
    reversibleTransactions: reversibleTx,
    blockers,
    warnings,
  };
};

export const getStatusCorrectionEligibility = async (
  req: Request<CorrectionParams>,
  res: Response,
) => {
  try {
    const currentBooking = await Booking.findOne({
      bookingId: req.params.bookingId,
    }).lean<booking>();
    if (!currentBooking) {
      return res
        .status(404)
        .json({ error: "BOOKING_NOT_FOUND", message: "ไม่พบ booking นี้" });
    }

    const correctionType = correctionTypeForStatus(currentBooking.status);
    if (!correctionType) {
      return res.status(200).json({
        allowed: false,
        correctionType: null,
        requiresAdmin: false,
        sameBusinessDate: false,
        affectedShiftsOpen: false,
        message: "Booking นี้ไม่มีสถานะปลายทางที่แก้ไขได้",
      });
    }

    const permission = await statusCorrectionPermission({
      currentBooking,
      correctionType,
      username: req.user?.username || "",
      isAdmin: req.user?.admin === true,
    });
    return res.status(200).json({
      allowed: permission.allowed,
      correctionType,
      requiresAdmin: permission.requiresAdmin,
      sameBusinessDate: permission.sameBusinessDate,
      affectedShiftsOpen: permission.affectedShiftsOpen,
      affectedCashShiftIds: permission.affectedCashShiftIds,
      message: permission.message,
    });
  } catch (err) {
    console.error("Status correction eligibility failed", {
      bookingId: req.params.bookingId,
      error: err instanceof Error ? err.message : "Unknown error",
    });
    return res.status(500).json({
      error: "STATUS_CORRECTION_ELIGIBILITY_FAILED",
      message: "ไม่สามารถตรวจสอบสิทธิ์แก้ไขสถานะได้",
    });
  }
};

const sendStoredResult = async (res: Response, record: any) => {
  const currentBooking = await Booking.findOne({ bookingId: record.bookingId });
  return res.status(200).json({
    message: "รายการนี้ดำเนินการสำเร็จแล้ว",
    duplicate: true,
    correction: correctionResponse(record),
    booking: currentBooking,
  });
};

export const previewStatusCorrection = async (
  req: Request<CorrectionParams, {}, CorrectionBody>,
  res: Response,
) => {
  try {
    const validated = validateRequest(req, { requireReason: false });
    if (validated.error) {
      return res.status(validated.error.status).json({
        error: validated.error.code,
        message: validated.error.message,
      });
    }

    const currentBooking = await Booking.findOne({
      bookingId: req.params.bookingId,
    }).lean<booking>();
    if (!currentBooking) {
      return res
        .status(404)
        .json({ error: "BOOKING_NOT_FOUND", message: "ไม่พบ booking นี้" });
    }
    if (Number(currentBooking.revision || 0) !== validated.expectedRevision) {
      return sendBookingRevisionConflict(res, req.params.bookingId);
    }

    const preview = await buildPreview({
      currentBooking,
      body: validated,
      username: req.user?.username || "",
      isAdmin: req.user?.admin === true,
    });
    return res.status(200).json(preview);
  } catch (err) {
    console.error("Status correction preview failed", {
      bookingId: req.params.bookingId,
      error: err instanceof Error ? err.message : "Unknown error",
    });
    return res.status(500).json({
      error: "STATUS_CORRECTION_PREVIEW_FAILED",
      message: "ไม่สามารถตรวจสอบการแก้ไขสถานะได้",
    });
  }
};

export const correctStatus = async (
  req: Request<CorrectionParams, {}, CorrectionBody>,
  res: Response,
) => {
  try {
    const validated = validateRequest(req);
    if (validated.error) {
      return res.status(validated.error.status).json({
        error: validated.error.code,
        message: validated.error.message,
      });
    }
    const username = req.user?.username;
    if (!username) {
      return res.status(401).json({ message: "กรุณาเข้าสู่ระบบใหม่" });
    }

    const operationKeyHash = sha256(
      `${username}:${req.method}:${req.originalUrl}:${validated.idempotencyKey}`,
    );
    const requestHash = sha256(stableStringify(req.body));
    const existing = await StatusCorrection.findOne({
      operationKeyHash,
    }).select("+operationKeyHash +requestHash");
    if (existing) {
      if (existing.requestHash !== requestHash) {
        return res.status(409).json({
          error: "IDEMPOTENCY_KEY_REUSED",
          message: "รหัสรายการนี้ถูกใช้กับข้อมูลอื่นแล้ว กรุณาเปิดหน้าต่างใหม่",
        });
      }
      return sendStoredResult(res, existing);
    }

    const initial = await Booking.findOne({
      bookingId: req.params.bookingId,
    }).lean<booking>();
    if (!initial) {
      return res
        .status(404)
        .json({ error: "BOOKING_NOT_FOUND", message: "ไม่พบ booking นี้" });
    }
    if (Number(initial.revision || 0) !== validated.expectedRevision) {
      return sendBookingRevisionConflict(res, req.params.bookingId);
    }

    const result = await withRoomMutationLocks(initial.roomStays || [], async () => {
      const currentBooking = await Booking.findOne({
        bookingId: req.params.bookingId,
      }).lean<booking>();
      if (
        !currentBooking ||
        Number(currentBooking.revision || 0) !== validated.expectedRevision
      ) {
        return null;
      }

      const preview = await buildPreview({
        currentBooking,
        body: validated,
        username,
        isAdmin: req.user?.admin === true,
      });
      if (!preview.eligible) {
        const adminBlocker = preview.blockers.find(
          (blocker) => blocker.code === "ADMIN_APPROVAL_REQUIRED",
        );
        throw new StatusCorrectionBlockedError(
          adminBlocker ? 403 : 409,
          adminBlocker?.code || "STATUS_CORRECTION_BLOCKED",
          adminBlocker?.message || "ยังไม่สามารถแก้ไขสถานะนี้ได้",
          preview,
        );
      }

      const session = await mongoose.startSession();
      try {
        return await session.withTransaction(async () => {
          for (const cashShiftId of preview.openAffectedCashShiftIds) {
            const shiftGuard = await CashShift.updateOne(
              { _id: cashShiftId, status: "open" },
              { $inc: { ledgerRevision: 1 } },
              { session },
            );
            if (shiftGuard.modifiedCount !== 1) {
              throw new StatusCorrectionShiftRaceError();
            }
          }

          const correctedAt = new Date();
          const corrections: TransactionCorrection[] =
            preview.reversibleTransactions
              .filter(
                (transaction) =>
                  !(
                    validated.correctionType === "UNDO_CHECKOUT" &&
                    validated.depositDecision === "already_returned"
                  ),
              )
              .map((transaction) => {
                const before = snapshotTransaction(transaction);
                return {
                  _id: String(new mongoose.Types.ObjectId()),
                  targetTransactionId: transactionId(transaction),
                  before,
                  after: { ...before, amount: 0 },
                  correctionType: "recorded_mistake",
                  reasonCode: "incorrect_amount",
                  note: validated.reason,
                  correctedBy: username,
                  correctedByName: req.user?.name,
                  correctedAt,
                  financialChange: true,
                  originalBusinessDate: businessDateKey(
                    new Date(transaction.createdAt || preview.booking.originalActionAt!),
                  ),
                  affectedCashShiftId: before.cashShiftId,
                };
              });

          const updatedBooking = await Booking.findOneAndUpdate(
            {
              bookingId: req.params.bookingId,
              status: CORRECTION_TRANSITIONS[validated.correctionType].source,
              voided: { $ne: true },
              ...bookingRevisionPredicate(validated.expectedRevision),
            },
            {
              $set: {
                status:
                  CORRECTION_TRANSITIONS[validated.correctionType].restored,
              },
              ...(corrections.length
                ? { $push: { transactionCorrections: { $each: corrections } } }
                : {}),
              $inc: { revision: 1 },
            },
            { returnDocument: "after", runValidators: true, session },
          );
          if (!updatedBooking) return null;

          const affectedTransactionIds = corrections.map(
            (correction) => correction.targetTransactionId,
          );
          const correctionId = crypto.randomUUID();
          const record = await new StatusCorrection({
            correctionId,
            bookingId: currentBooking.bookingId,
            correctionType: validated.correctionType,
            sourceStatus:
              CORRECTION_TRANSITIONS[validated.correctionType].source,
            restoredStatus:
              CORRECTION_TRANSITIONS[validated.correctionType].restored,
            originalActionActor: preview.booking.originalActionActor,
            originalActionAt: preview.booking.originalActionAt,
            correctedBy: username,
            correctedAt,
            reason: validated.reason,
            affectedRoomAssignments: preview.roomEffect.assignments,
            affectedTransactionIds,
            depositDecision: validated.depositDecision,
            affectedCashShiftIds: preview.affectedCashShiftIds,
            otaManualFollowUp: preview.ota.requiresManualFollowUp,
            terminalActionKey: preview.terminalActionKey,
            operationKeyHash,
            requestHash,
          }).save({ session });

          await logActivityStrict(
            username,
            "CORRECT_BOOKING_STATUS",
            {
              changes: {
                status: {
                  before:
                    CORRECTION_TRANSITIONS[validated.correctionType].source,
                  after:
                    CORRECTION_TRANSITIONS[validated.correctionType].restored,
                },
              },
              summary: {
                correctionId,
                correctionType: validated.correctionType,
                reason: validated.reason,
                originalActionActor: preview.booking.originalActionActor,
                originalActionAt: preview.booking.originalActionAt,
                affectedRoomAssignments: preview.roomEffect.assignments,
                affectedTransactionIds,
                affectedCashShiftIds: preview.affectedCashShiftIds,
                depositDecision: validated.depositDecision,
                otaManualFollowUp: preview.ota.requiresManualFollowUp,
              },
            },
            currentBooking.bookingId,
            session,
          );

          return { updatedBooking, record, warnings: preview.warnings };
        });
      } finally {
        await session.endSession();
      }
    });

    if (!result) {
      return sendBookingRevisionConflict(res, req.params.bookingId);
    }
    return res.status(200).json({
      message: "แก้ไขสถานะที่บันทึกผิดเรียบร้อย",
      correction: correctionResponse(result.record),
      booking: result.updatedBooking,
      warnings: result.warnings,
    });
  } catch (err: any) {
    if (err instanceof StatusCorrectionBlockedError) {
      return res.status(err.status).json({
        error: err.code,
        message: err.message,
        preview: err.preview,
      });
    }
    if (err instanceof StatusCorrectionShiftRaceError) {
      return res.status(409).json({
        error: "CASH_SHIFT_CLOSED_DURING_CORRECTION",
        message: err.message,
      });
    }
    if (err instanceof RoomMutationConflictError) {
      return res.status(409).json({
        error: "ROOM_MUTATION_CONFLICT",
        message: "ห้องนี้กำลังถูกแก้ไขโดยผู้ใช้อื่น กรุณาลองอีกครั้ง",
      });
    }
    if (err?.code === 11000) {
      const username = req.user?.username || "";
      const idempotencyKey = req.get("Idempotency-Key")?.trim() || "";
      const operationKeyHash = sha256(
        `${username}:${req.method}:${req.originalUrl}:${idempotencyKey}`,
      );
      const existing = await StatusCorrection.findOne({
        operationKeyHash,
      }).select("+operationKeyHash +requestHash");
      if (
        existing &&
        existing.requestHash === sha256(stableStringify(req.body))
      ) {
        return sendStoredResult(res, existing);
      }
      return res.status(409).json({
        error: "STATUS_CORRECTION_ALREADY_COMPLETED",
        message: "สถานะปลายทางรายการนี้ถูกแก้ไขไปแล้ว",
      });
    }
    console.error("Status correction failed", {
      bookingId: req.params.bookingId,
      error: err instanceof Error ? err.message : "Unknown error",
    });
    return res.status(500).json({
      error: "STATUS_CORRECTION_FAILED",
      message: "ไม่สามารถแก้ไขสถานะได้ กรุณาลองใหม่",
    });
  }
};
