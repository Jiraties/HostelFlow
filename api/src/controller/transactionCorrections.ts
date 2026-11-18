import crypto from "crypto";
import mongoose from "mongoose";
import type { Request, Response } from "express";
import Booking, {
  type PaymentMethod,
  type transcation,
  type TransactionCorrection,
  type TransactionCorrectionReason,
  type TransactionCorrectionType,
  type TransactionType,
} from "../models/booking";
import StandaloneSale from "../models/standaloneSale";
import FinancialCorrectionRequest from "../models/financialCorrectionRequest";
import { withCashShiftMutationLock } from "../services/cashShiftMutationLock";
import { logActivityStrict } from "../services/activityServices";
import CashShift from "../models/cashShift";
import DailyClose from "../models/dailyClose";
import {
  bookingRevisionPredicate,
  expectedBookingRevision,
  sendBookingRevisionConflict,
} from "../services/bookingConcurrency";
import {
  CashShiftLedgerConflictError,
  withCashLedgerTransaction,
} from "../services/cashLedgerTransaction";
import {
  IdempotencyConflictError,
  withMutationIdempotency,
} from "../services/mutationIdempotency";
import {
  correctionChangesFinancialFields,
  editableCategoryOptions,
  editableTransactionTypes,
  effectiveBookingTransactions,
  projectEffectiveTransactions,
  snapshotTransaction,
  summarizeBookingFinancialPosition,
  transactionIsCharge,
} from "../services/transactionCorrections";
import {
  ROUNDING_ADJUSTMENT_REVIEW_THRESHOLD,
  isCheckInRoundingAdjustment,
  transactionCorrectionNeedsReview,
  transactionDirection,
  transactionSignedAmount,
} from "../helpers/financeHelpers";
import {
  assessOrdinaryRefundEntitlements,
  isOrdinaryRefund,
  isOrdinaryRefundableReceipt,
} from "../services/refundEntitlement";

const PAYMENT_METHODS: PaymentMethod[] = [
  "OTA",
  "Cash",
  "Card",
  "Transfer",
  "Unpaid",
];
const CORRECTION_TYPES: TransactionCorrectionType[] = [
  "recorded_mistake",
  "charge_change",
];
const CORRECTION_REASONS: TransactionCorrectionReason[] = [
  "incorrect_amount",
  "incorrect_payment_method",
  "incorrect_category",
  "incorrect_note",
  "manager_discount",
  "waived_fee",
  "agreed_rate_correction",
  "cancelled_service",
  "guest_compensation",
  "other",
];
const CHARGE_CHANGE_REASONS = new Set<TransactionCorrectionReason>([
  "manager_discount",
  "waived_fee",
  "agreed_rate_correction",
  "cancelled_service",
  "guest_compensation",
  "other",
]);
const BUSINESS_TIME_ZONE = "Asia/Bangkok";

const businessDateKey = (date: Date) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
};

type CorrectionBody = {
  expectedRevision?: number;
  correctedAmount?: number;
  correctedPaymentMethod?: PaymentMethod;
  correctedCategory?: TransactionType;
  correctedNote?: string;
  correctionType?: TransactionCorrectionType;
  reasonCode?: TransactionCorrectionReason;
  note?: string;
};

type CorrectionParams = {
  bookingId: string;
  transactionId: string;
};

class TransactionCorrectionConflictError extends Error {}

const findLinkedCardSurcharge = (
  transactions: transcation[],
  targetTransactionId: string,
) => {
  const targetIndex = transactions.findIndex(
    (transaction) => String(transaction._id) === targetTransactionId,
  );
  return transactions.find(
    (transaction, index) =>
      transaction.type === "cardSurcharge" &&
      (transaction.relatedTransactionId === targetTransactionId ||
        (!transaction.relatedTransactionId && index === targetIndex + 1)),
  );
};

const findLinkedCheckInRoundingAdjustment = (
  transactions: Array<transcation & { originalTransactionId?: string }>,
  targetTransactionId: string,
) => {
  const targetIndex = transactions.findIndex(
    (transaction) =>
      (transaction.originalTransactionId || String(transaction._id)) ===
      targetTransactionId,
  );
  if (targetIndex < 0) return undefined;

  const target = transactions[targetIndex];
  if (
    target.type !== "settlementCharge" ||
    target.relatedTransactionType !== "roomCharge"
  ) {
    return undefined;
  }

  const adjacentCandidates = [
    transactions[targetIndex - 1],
    transactions[targetIndex + 1],
  ].filter(
    (
      candidate,
    ): candidate is transcation & { originalTransactionId?: string } =>
      candidate !== undefined &&
      isCheckInRoundingAdjustment(candidate) &&
      (candidate.sourceAction === "CHECK_IN" ||
        target.sourceAction === "CHECK_IN"),
  );
  const activeAdjacent = adjacentCandidates.find(
    (candidate) => Math.abs(candidate.amount || 0) > 0,
  );
  if (activeAdjacent) return activeAdjacent;
  if (adjacentCandidates[0]) return adjacentCandidates[0];

  if (target.sourceAction === "CHECK_IN") {
    const checkInCandidates = transactions.filter(
      (candidate) =>
        isCheckInRoundingAdjustment(candidate) &&
        candidate.sourceAction === "CHECK_IN",
    );
    return (
      checkInCandidates.find(
        (candidate) => Math.abs(candidate.amount || 0) > 0,
      ) || checkInCandidates[0]
    );
  }

  return undefined;
};

const resolveSettlementPrincipalAmount = (
  effectiveTransactions: Array<
    transcation & { originalTransactionId?: string }
  >,
  currentSettlement: transcation & { originalTransactionId?: string },
  currentSettlementId: string,
  linkedRoundingId?: string,
) => {
  const relatedRoomCharge = currentSettlement.relatedTransactionId
    ? effectiveTransactions.find(
        (candidate) =>
          (candidate.originalTransactionId || String(candidate._id || "")) ===
            currentSettlement.relatedTransactionId &&
          candidate.type === "roomCharge",
      )
    : currentSettlement.commercialSegmentId
      ? effectiveTransactions.find(
          (candidate) =>
            candidate.type === "roomCharge" &&
            candidate.commercialSegmentId ===
              currentSettlement.commercialSegmentId,
        )
      : effectiveTransactions.find(
          (candidate) =>
            candidate.type === "roomCharge" &&
            candidate.sourceAction !== "EXTEND_BOOKING",
        );
  if (!relatedRoomCharge) return undefined;

  const relatedRoomChargeId =
    relatedRoomCharge.originalTransactionId ||
    String(relatedRoomCharge._id || "");
  const isOriginalRoomCharge =
    relatedRoomCharge.sourceAction !== "EXTEND_BOOKING";
  let netRoomCharge = Math.abs(relatedRoomCharge.amount || 0);
  let otherPaymentsReceived =
    relatedRoomCharge.paymentMethod !== "Unpaid"
      ? transactionSignedAmount(relatedRoomCharge)
      : 0;

  effectiveTransactions.forEach((candidate) => {
    const candidateId =
      candidate.originalTransactionId || String(candidate._id || "");
    if (
      candidateId === currentSettlementId ||
      candidateId === relatedRoomChargeId ||
      (linkedRoundingId && candidateId === linkedRoundingId)
    ) {
      return;
    }

    const targetsExplicitly =
      (Boolean(relatedRoomChargeId) &&
        candidate.relatedTransactionId === relatedRoomChargeId) ||
      (Boolean(relatedRoomCharge.commercialSegmentId) &&
        candidate.commercialSegmentId ===
          relatedRoomCharge.commercialSegmentId);
    const targetsOriginalImplicitly =
      isOriginalRoomCharge &&
      !candidate.relatedTransactionId &&
      !candidate.commercialSegmentId &&
      candidate.relatedTransactionType === "roomCharge";

    if (!targetsExplicitly && !targetsOriginalImplicitly) return;

    if (candidate.type === "roomChargeWriteOff") {
      netRoomCharge -= Math.abs(candidate.amount || 0);
      return;
    }

    if (
      candidate.type === "adjustment" &&
      candidate.reasonOfAdjustment !== "rounding"
    ) {
      const signedAdjustment =
        transactionDirection(candidate) === "out"
          ? -Math.abs(candidate.amount || 0)
          : Math.abs(candidate.amount || 0);
      netRoomCharge += signedAdjustment;
      if (candidate.paymentMethod !== "Unpaid") {
        otherPaymentsReceived += transactionSignedAmount(candidate);
      }
      return;
    }

    if (
      ["settlementCharge", "paymentCorrection"].includes(candidate.type) &&
      candidate.paymentMethod !== "Unpaid"
    ) {
      otherPaymentsReceived += transactionSignedAmount(candidate);
    }
  });

  return Math.max(
    Number((netRoomCharge - otherPaymentsReceived).toFixed(2)),
    0,
  );
};

const correctionRecord = ({
  targetTransactionId,
  before,
  after,
  correctionType,
  reasonCode,
  note,
  correctedBy,
  correctedByName,
  originalBusinessDate,
  reviewFlags = [],
}: {
  targetTransactionId: string;
  before: ReturnType<typeof snapshotTransaction>;
  after: ReturnType<typeof snapshotTransaction>;
  correctionType: TransactionCorrectionType;
  reasonCode: TransactionCorrectionReason;
  note: string;
  correctedBy: string;
  correctedByName?: string;
  originalBusinessDate: string;
  reviewFlags?: string[];
}): TransactionCorrection => ({
  _id: String(new mongoose.Types.ObjectId()),
  targetTransactionId,
  before,
  after,
  correctionType,
  reasonCode,
  note,
  correctedBy,
  correctedByName,
  correctedAt: new Date(),
  financialChange: correctionChangesFinancialFields(before, after),
  originalBusinessDate,
  affectedCashShiftId: before.cashShiftId || after.cashShiftId,
  reviewFlags,
  reviewStatus: reviewFlags.length ? "needs_review" : "none",
});

const isCorrectionPeriodClosed = async (
  businessDate: string,
  cashShiftId?: string,
) => {
  const [cashShift, dailyClose, finalDayClose] = await Promise.all([
    cashShiftId ? CashShift.findById(cashShiftId).lean() : null,
    DailyClose.findOne({ businessDate }).lean(),
    CashShift.findOne({ businessDate, isFinalDayClose: true }).lean(),
  ]);
  return Boolean(cashShift?.status === "closed" || dailyClose || finalDayClose);
};

export const runTransactionCorrection = async (
  req: Request<CorrectionParams, {}, CorrectionBody>,
  res: Response,
  context: {
    mode?: "initial" | "preview" | "request";
    sourceType?: "booking" | "standaloneSale";
    requestId?: string;
    legacyRequestedAmount?: boolean;
  } = {},
) => {
  try {
    const { bookingId, transactionId } = req.params;
    const correctedByName =
      typeof req.user?.name === "string" && req.user.name.trim()
        ? req.user.name.trim()
        : undefined;
    const expectedRevision = expectedBookingRevision(req.body.expectedRevision);
    const correctionType = req.body.correctionType;
    const reasonCode = req.body.reasonCode;
    const auditNote = req.body.note?.trim();

    if (expectedRevision === null) {
      return res.status(400).json({
        error: "EXPECTED_REVISION_REQUIRED",
        message: "กรุณารีเฟรชข้อมูลการจองก่อนแก้ไขรายการ",
      });
    }

    const standalone = context.sourceType === "standaloneSale";
    const sale = standalone
      ? await StandaloneSale.findOne({ saleId: bookingId }).lean()
      : null;
    const booking = standalone
      ? sale
        ? {
            ...sale,
            bookingId: sale.saleId,
            name: sale.customerName || "ลูกค้าทั่วไป",
            status: "checkedOut",
            checkIn: sale.createdAt,
            voided: false,
          }
        : null
      : await Booking.findOne({ bookingId }).lean();
    if (!booking) {
      return res.status(404).json({
        error: "BOOKING_NOT_FOUND",
        message: "ไม่พบ booking นี้",
      });
    }
    if (
      !context.mode &&
      booking.voided &&
      (!req.user?.admin || correctionType !== "recorded_mistake")
    ) {
      return res.status(409).json({
        error: "BOOKING_VOIDED",
        message: !req.user?.admin
          ? "Booking ที่ถูก void แล้วต้องให้ Admin เป็นผู้แก้ไขรายการที่บันทึกผิด"
          : "Booking ที่ถูก void แล้วสามารถแก้ไขได้เฉพาะรายการที่บันทึกผิด (recorded_mistake)",
      });
    }
    if (Number(booking.revision || 0) !== expectedRevision) {
      return sendBookingRevisionConflict(res, bookingId);
    }

    const effectiveTransactions = effectiveBookingTransactions(booking);
    const current = effectiveTransactions.find(
      (transaction) => transaction.originalTransactionId === transactionId,
    );
    if (!current) {
      return res.status(404).json({
        error: "TRANSACTION_NOT_FOUND",
        message: "ไม่พบรายการที่ต้องการแก้ไข",
      });
    }
    if (!editableTransactionTypes.has(current.type)) {
      return res.status(400).json({
        error: "TRANSACTION_NOT_EDITABLE",
        message: "รายการประเภทนี้ต้องใช้ขั้นตอนเฉพาะ ไม่สามารถแก้ไขโดยตรงได้",
      });
    }

    const before = snapshotTransaction(current);
    const originalBusinessDate = businessDateKey(
      new Date(current.createdAt || booking.checkIn),
    );
    const affectedCashShiftId =
      before.cashShiftId ||
      booking.transactions.find((t) => String(t._id) === transactionId)
        ?.cashShiftId ||
      [...(booking.transactionCorrections || [])]
        .reverse()
        .find(
          (c) =>
            c.targetTransactionId === transactionId && c.affectedCashShiftId,
        )?.affectedCashShiftId;
    const isPendingFutureRoomCharge =
      booking.status === "booked" &&
      current.type === "roomCharge" &&
      ["OTA", "Unpaid"].includes(current.paymentMethod) &&
      businessDateKey(new Date(booking.checkIn)) >= businessDateKey(new Date());
    const canBeHistorical = current.type !== "deposit";
    if (context.mode === "initial") {
      const historical =
        canBeHistorical &&
        !isPendingFutureRoomCharge &&
        await isCorrectionPeriodClosed(originalBusinessDate, affectedCashShiftId);
      return res.json({ historical });
    }

    if (!correctionType || !CORRECTION_TYPES.includes(correctionType)) {
      return res.status(400).json({
        error: "INVALID_CORRECTION_TYPE",
        message: "กรุณาเลือกประเภทการแก้ไข",
      });
    }
    if (!reasonCode || !CORRECTION_REASONS.includes(reasonCode)) {
      return res.status(400).json({
        error: "INVALID_CORRECTION_REASON",
        message: "กรุณาเลือกเหตุผลที่แก้ไข",
      });
    }
    if (!auditNote) {
      return res.status(400).json({
        error: "CORRECTION_NOTE_REQUIRED",
        message: "กรุณาระบุหมายเหตุเพื่อเก็บในประวัติ",
      });
    }
    if (
      correctionType === "charge_change" &&
      !CHARGE_CHANGE_REASONS.has(reasonCode)
    ) {
      return res.status(400).json({
        error: "INVALID_CHARGE_CHANGE_REASON",
        message: "เหตุผลนี้ไม่ตรงกับการปรับยอดเรียกเก็บ",
      });
    }

    const correctedAmount =
      req.body.correctedAmount === undefined ||
      String(req.body.correctedAmount).trim() === ""
        ? NaN
        : Number(req.body.correctedAmount);
    const correctedPaymentMethod = req.body.correctedPaymentMethod;
    const correctedCategory = req.body.correctedCategory;
    if (!Number.isFinite(correctedAmount) || correctedAmount < 0) {
      return res.status(400).json({
        error: "INVALID_CORRECTED_AMOUNT",
        message: "ยอดที่ถูกต้องต้องไม่ติดลบ",
      });
    }
    if (
      !correctedPaymentMethod ||
      !PAYMENT_METHODS.includes(correctedPaymentMethod)
    ) {
      return res.status(400).json({
        error: "INVALID_PAYMENT_METHOD",
        message: "ช่องทางการชำระเงินไม่ถูกต้อง",
      });
    }
    if (
      !correctedCategory ||
      !editableCategoryOptions(current.type).includes(correctedCategory)
    ) {
      return res.status(400).json({
        error: "INVALID_CORRECTED_CATEGORY",
        message: "ไม่สามารถเปลี่ยนเป็นประเภทรายการนี้ได้",
      });
    }
    if (
      current.paymentMethod !== "Unpaid" &&
      correctedPaymentMethod === "Unpaid"
    ) {
      return res.status(400).json({
        error: "PAID_TRANSACTION_CANNOT_BECOME_UNPAID",
        message:
          "รายการที่ชำระแล้วไม่สามารถแก้เป็น Unpaid ได้ หากสร้าง booking ผิดกรุณายกเลิกหรือ void booking เดิม",
      });
    }
    if (
      current.type === "deposit" &&
      correctedPaymentMethod !== current.paymentMethod
    ) {
      return res.status(400).json({
        error: "DEPOSIT_PAYMENT_METHOD_IMMUTABLE",
        message: "แก้ไขมัดจำได้เฉพาะจำนวนเงิน ช่องทางรับมัดจำต้องคงเดิม",
      });
    }
    if (
      correctionType === "charge_change" &&
      !transactionIsCharge(current.type)
    ) {
      return res.status(400).json({
        error: "INVALID_CHARGE_CHANGE_TARGET",
        message: "การปรับยอดเรียกเก็บใช้ได้เฉพาะรายการค่าห้องหรือค่าบริการ",
      });
    }

    const requestedAmount = Number(correctedAmount.toFixed(2));
    const after = {
      ...before,
      type: correctedCategory,
      paymentMethod: correctedPaymentMethod,
      amount: requestedAmount,
      note: req.body.correctedNote?.trim() || undefined,
    };
    if (correctedPaymentMethod !== "Cash") delete after.cashShiftId;

    const linkedRounding = findLinkedCheckInRoundingAdjustment(
      effectiveTransactions,
      transactionId,
    );
    if (
      context.legacyRequestedAmount &&
      context.requestId &&
      linkedRounding &&
      correctedPaymentMethod === "Cash" &&
      correctedCategory === current.type &&
      requestedAmount === resolveSettlementPrincipalAmount(
        effectiveTransactions,
        current,
        transactionId,
        linkedRounding.originalTransactionId || String(linkedRounding._id || ""),
      )
    ) {
      // A legacy proposal may have stored only the principal, losing the intended rounding.
      const message = "คำขอเดิมไม่มีข้อมูลยอดปัดเศษ กรุณาส่งคำขอใหม่";
      await FinancialCorrectionRequest.updateOne(
        { _id: context.requestId, status: "pending" },
        { $set: { status: "stale", decidedAt: new Date(), decidedBy: req.user?.username, decisionReason: message } },
      );
      return res.status(409).json({ error: "CORRECTION_REQUEST_STALE", message });
    }
    const roundingBefore = linkedRounding
      ? snapshotTransaction(linkedRounding)
      : undefined;
    let roundingAfter = roundingBefore ? { ...roundingBefore } : undefined;

    if (
      linkedRounding &&
      roundingBefore &&
      roundingAfter &&
      correctionChangesFinancialFields(before, after)
    ) {
      const combinedCashBefore = Number(
        (before.amount + roundingBefore.amount).toFixed(2),
      );
      if (
        before.paymentMethod === "Cash" &&
        correctedPaymentMethod === "Cash" &&
        correctedCategory === current.type &&
        requestedAmount === combinedCashBefore
      ) {
        return res.status(409).json({
          error: "ROUNDING_ALREADY_INCLUDED",
          message: `ยอดรับเงินสดรวมปัดเศษเป็น ${requestedAmount.toLocaleString("th-TH")} บาทอยู่แล้ว (${before.amount.toLocaleString("th-TH")} + ปัดเศษ ${roundingBefore.amount.toLocaleString("th-TH")} บาท) ไม่ต้องแก้ซ้ำ`,
        });
      }

      const linkedRoundingIdForPrincipal =
        linkedRounding.originalTransactionId ||
        String(linkedRounding._id || "");
      const settlementPrincipalAmount = resolveSettlementPrincipalAmount(
        effectiveTransactions,
        current,
        transactionId,
        linkedRoundingIdForPrincipal,
      );
      const roundingDeltaAbovePrincipal =
        settlementPrincipalAmount !== undefined
          ? Number((requestedAmount - settlementPrincipalAmount).toFixed(2))
          : undefined;

      if (
        correctedPaymentMethod === "Cash" &&
        correctedCategory === current.type &&
        settlementPrincipalAmount !== undefined &&
        roundingDeltaAbovePrincipal !== undefined &&
        roundingDeltaAbovePrincipal > 0 &&
        roundingDeltaAbovePrincipal <= ROUNDING_ADJUSTMENT_REVIEW_THRESHOLD
      ) {
        after.amount = settlementPrincipalAmount;
        roundingAfter = {
          ...roundingBefore,
          paymentMethod: "Cash",
          amount: roundingDeltaAbovePrincipal,
        };
      } else {
        roundingAfter = {
          ...roundingBefore,
          amount: 0,
        };
        delete roundingAfter.cashShiftId;
      }
    }

    const isStaffEditablePendingRoomCharge =
      isPendingFutureRoomCharge &&
      correctedCategory === current.type &&
      correctedPaymentMethod === current.paymentMethod;

    if (
      correctionType === "charge_change" &&
      !req.user?.admin &&
      !context.mode &&
      !isStaffEditablePendingRoomCharge
    ) {
      return res.status(403).json({
        error: "ADMIN_APPROVAL_REQUIRED",
        message: "การปรับยอดเรียกเก็บต้องให้ Admin ดำเนินการ",
      });
    }

    const roundingFinancialChange = Boolean(
      roundingBefore &&
      roundingAfter &&
      correctionChangesFinancialFields(roundingBefore, roundingAfter),
    );
    const roundingChange = roundingFinancialChange && roundingBefore && roundingAfter
      ? { before: roundingBefore.amount, after: roundingAfter.amount }
      : undefined;
    const financialChange =
      correctionChangesFinancialFields(before, after) ||
      roundingFinancialChange;
    const linkedRoundingId = linkedRounding
      ? linkedRounding.originalTransactionId || String(linkedRounding._id)
      : undefined;
    const previewTransactions = effectiveTransactions.map((transaction) => {
      if (transaction.originalTransactionId === transactionId) {
        return { ...transaction, ...after, _id: transaction._id };
      }
      if (
        linkedRoundingId &&
        roundingAfter &&
        transaction.originalTransactionId === linkedRoundingId
      ) {
        return { ...transaction, ...roundingAfter, _id: transaction._id };
      }
      return transaction;
    });
    const currentRefundAssessment = assessOrdinaryRefundEntitlements(
      effectiveTransactions,
    );
    const previewRefundAssessment =
      assessOrdinaryRefundEntitlements(previewTransactions);
    if (
      previewRefundAssessment.excessRefundAmount >
      currentRefundAssessment.excessRefundAmount
    ) {
      if (isOrdinaryRefund(current)) {
        const linkedEntitlement = current.relatedTransactionId
          ? currentRefundAssessment.entitlements.find(
              (entitlement) =>
                entitlement.originalTransactionId ===
                current.relatedTransactionId,
            )
          : undefined;
        const maximumRefundAmount = Number(
          (
            Math.abs(current.amount || 0) +
            (linkedEntitlement?.remainingAmount ??
              currentRefundAssessment.entitlements.reduce(
                (sum, entitlement) => sum + entitlement.remainingAmount,
                0,
              ))
          ).toFixed(2),
        );
        return res.status(409).json({
          error: "REFUND_EXCEEDS_AVAILABLE_BALANCE",
          message: `แก้ยอดคืนได้ไม่เกิน ${maximumRefundAmount.toLocaleString("th-TH")} บาท`,
          remainingRefundableAmount: Math.max(
            Number(
              (maximumRefundAmount - Math.abs(current.amount || 0)).toFixed(2),
            ),
            0,
          ),
          maximumRefundAmount,
        });
      }

      if (isOrdinaryRefundableReceipt(current)) {
        const currentEntitlement = currentRefundAssessment.entitlements.find(
          (entitlement) => entitlement.originalTransactionId === transactionId,
        );
        return res.status(409).json({
          error: "PAYMENT_CORRECTION_CONFLICTS_WITH_REFUNDS",
          message: "ยอดรับเงินที่แก้ไขต่ำกว่ายอดที่คืนไปแล้ว กรุณาตรวจสอบประวัติการคืนเงิน",
          alreadyRefundedAmount: currentEntitlement?.consumedAmount || 0,
          minimumReceivedAmount: currentEntitlement?.consumedAmount || 0,
        });
      }

      return res.status(409).json({
        error: "REFUND_ENTITLEMENT_CONFLICT",
        message: "การแก้ไขนี้ทำให้ยอดคืนเงินเกินยอดรับเงิน กรุณาตรวจสอบประวัติ",
      });
    }
    const depositCollected = previewTransactions.reduce(
      (total, transaction) =>
        transaction.type === "deposit"
          ? total + Math.abs(transaction.amount || 0)
          : total,
      0,
    );
    const depositDisposed = previewTransactions.reduce(
      (total, transaction) =>
        ["depositRefund", "depositKept"].includes(transaction.type)
          ? total + Math.abs(transaction.amount || 0)
          : total,
      0,
    );
    if (depositDisposed > depositCollected) {
      return res.status(409).json({
        error: "CORRECTION_EXCEEDS_DEPOSIT_BALANCE",
        message: "ยอดที่แก้ไขทำให้ยอดคืนหรือยอดเก็บมัดจำเกินมัดจำที่รับไว้",
      });
    }
    const correctionReviewFlags = transactionCorrectionNeedsReview(
      before,
      after,
      current.correctionCount || 0,
    );

    const historical =
      financialChange &&
      canBeHistorical &&
      !isStaffEditablePendingRoomCharge &&
      await isCorrectionPeriodClosed(originalBusinessDate, affectedCashShiftId);
    if (historical && after.paymentMethod === "Cash" && affectedCashShiftId)
      after.cashShiftId = affectedCashShiftId;
    const requiresApproval =
      financialChange &&
      (historical ||
        booking.voided ||
        ["checkedOut", "cancelled", "noShow"].includes(booking.status) ||
        (correctionType === "charge_change" &&
          !isStaffEditablePendingRoomCharge));
    if (historical && correctionType !== "recorded_mistake") {
      return res.status(409).json({
        error: "USE_FINANCIAL_ACTION",
        message:
          "การเปลี่ยนราคาใหม่ไม่ใช่การแก้ข้อมูลเดิม กรุณาใช้รายการปรับยอด รับชำระ หรือคืนเงิน",
      });
    }
    const proposal = correctionRecord({
      targetTransactionId: transactionId,
      before,
      after,
      correctionType,
      reasonCode,
      note: auditNote,
      correctedBy: req.user?.username || "system",
      originalBusinessDate,
      reviewFlags: correctionReviewFlags,
    });
    if (context.mode === "preview") {
      return res.json({
        requiresApproval,
        historical,
        before,
        after,
        roundingChange,
        cashDelta:
          (after.paymentMethod === "Cash" ? after.amount : 0) -
          (before.paymentMethod === "Cash" ? before.amount : 0) +
          (roundingChange ? roundingChange.after - roundingChange.before : 0),
        cashMovementToday: historical ? 0 : undefined,
        financialSummary:
          summarizeBookingFinancialPosition(previewTransactions),
      });
    }
    if (context.mode === "request") {
      if (correctionType !== "recorded_mistake")
        return res.status(409).json({ error: "USE_FINANCIAL_ACTION" });
      if (!req.get("Idempotency-Key"))
        return res.status(400).json({ error: "IDEMPOTENCY_KEY_REQUIRED" });
      proposal.historical = historical;
      proposal.financialChange = financialChange;
      const request = await withMutationIdempotency(req, () =>
        FinancialCorrectionRequest.create({
          sourceType: standalone ? "standaloneSale" : "booking",
          sourceId: bookingId,
          transactionId,
          sourceLabel: booking.name,
          expectedRevision,
          requestedAmount,
          roundingChange,
          proposal,
          requestedBy: req.user!.username,
        }),
      );
      return res.status(201).json({ request });
    }
    if (historical && process.env.FINANCIAL_CORRECTIONS_ENABLED === "false")
      return res.status(409).json({ error: "FINANCIAL_PERIOD_CLOSED" });
    if (requiresApproval && !req.user?.admin) {
      return res.status(403).json({
        error: "ADMIN_APPROVAL_REQUIRED",
        message: "กรุณาส่งคำขอให้ Admin อนุมัติ",
      });
    }

    const linkedSurcharge = findLinkedCardSurcharge(
      effectiveTransactions,
      transactionId,
    );
    const needsGeneratedSurcharge =
      financialChange &&
      correctedPaymentMethod === "Card" &&
      !linkedSurcharge &&
      ![
        "depositRefund",
        "cancellationRefund",
        "roomRefund",
        "compensation",
      ].includes(current.type);
    const requiresCashLedgerLock =
      !historical &&
      financialChange &&
      (before.paymentMethod === "Cash" || correctedPaymentMethod === "Cash") &&
      current.type !== "deposit" &&
      current.type !== "depositRefund";
    const requiresNewCashShift =
      requiresCashLedgerLock &&
      correctedPaymentMethod === "Cash" &&
      !before.cashShiftId;
    const cashProbe: transcation[] = requiresCashLedgerLock
      ? [
          {
            type: "paymentCorrection",
            paymentMethod: "Cash",
            amount: Math.abs(after.amount),
            direction: "in",
          },
        ]
      : [];

    const execute = async (
      assigned: transcation[],
      session?: mongoose.ClientSession,
    ) => {
      if (
        requiresCashLedgerLock &&
        before.cashShiftId &&
        assigned[0]?.cashShiftId !== before.cashShiftId
      ) {
        throw new CashShiftLedgerConflictError(
          "กะเงินสดของรายการเดิมไม่ใช่กะที่เปิดอยู่ กรุณารีเฟรชและตรวจสอบกะเงินสด",
        );
      }
      if (requiresNewCashShift) after.cashShiftId = assigned[0]?.cashShiftId;
      if (roundingAfter) {
        if (correctedPaymentMethod === "Cash" && roundingAfter.amount > 0) {
          roundingAfter.paymentMethod = "Cash";
          roundingAfter.cashShiftId =
            after.cashShiftId ||
            roundingBefore?.cashShiftId ||
            assigned[0]?.cashShiftId;
        } else if (
          correctedPaymentMethod !== "Cash" ||
          roundingAfter.amount === 0
        ) {
          delete roundingAfter.cashShiftId;
        }
      }

      const corrections: TransactionCorrection[] = [
        correctionRecord({
          targetTransactionId: transactionId,
          before,
          after,
          correctionType,
          reasonCode,
          note: auditNote,
          correctedBy: req.user?.username || "system",
          correctedByName,
          originalBusinessDate,
          reviewFlags: correctionReviewFlags,
        }),
      ];
      const generatedTransactions: transcation[] = [];

      if (financialChange && linkedSurcharge) {
        const surchargeBefore = snapshotTransaction(linkedSurcharge);
        const surchargeAfter = {
          ...surchargeBefore,
          amount:
            correctedPaymentMethod === "Card"
              ? Number((after.amount * 0.03).toFixed(2))
              : 0,
        };
        if (correctionChangesFinancialFields(surchargeBefore, surchargeAfter)) {
          corrections.push(
            correctionRecord({
              targetTransactionId: String(linkedSurcharge._id),
              before: surchargeBefore,
              after: surchargeAfter,
              correctionType,
              reasonCode,
              note: `ปรับค่าธรรมเนียมบัตรตามรายการที่แก้ไข: ${auditNote}`,
              correctedBy: req.user?.username || "system",
              correctedByName,
              originalBusinessDate: businessDateKey(
                new Date(
                  linkedSurcharge.createdAt ||
                    current.createdAt ||
                    booking.checkIn,
                ),
              ),
            }),
          );
        }
      } else if (needsGeneratedSurcharge) {
        generatedTransactions.push({
          _id: String(new mongoose.Types.ObjectId()),
          type: "cardSurcharge",
          paymentMethod: "Card",
          amount: Number((after.amount * 0.03).toFixed(2)),
          relatedTransactionType:
            after.type === "cardSurcharge" ? undefined : after.type,
          relatedTransactionId: transactionId,
          direction: "in",
          createdBy: req.user?.username || "system",
          createdAt: historical
            ? new Date(current.createdAt || booking.checkIn)
            : new Date(),
          sourceAction: "CORRECT_TRANSACTION",
          note: `สร้างค่าธรรมเนียมบัตรจากการแก้ไขรายการ: ${auditNote}`,
        });
      }

      if (
        roundingFinancialChange &&
        linkedRounding &&
        linkedRoundingId &&
        roundingBefore &&
        roundingAfter
      ) {
        corrections.push(
          correctionRecord({
            targetTransactionId: linkedRoundingId,
            before: roundingBefore,
            after: roundingAfter,
            correctionType,
            reasonCode,
            note: `ปรับยอดปัดเศษเงินสดตามรายการรับชำระที่แก้ไข: ${auditNote}`,
            correctedBy: req.user?.username || "system",
            correctedByName,
            originalBusinessDate: businessDateKey(
              new Date(
                linkedRounding.createdAt ||
                  current.createdAt ||
                  booking.checkIn,
              ),
            ),
          }),
        );
      }

      const update: Record<string, unknown> = {
        $push: {
          transactionCorrections: { $each: corrections },
          ...(generatedTransactions.length
            ? { transactions: { $each: generatedTransactions } }
            : {}),
        },
        $inc: { revision: 1 },
      };
      corrections.forEach((correction) => {
        correction.historical = historical;
        correction.requestId = context.requestId;
        correction.affectedCashShiftId ||= booking.transactions.find(
          (t) => String(t._id) === correction.targetTransactionId,
        )?.cashShiftId;
        correction.affectedCashShiftId ||= affectedCashShiftId;
        if (context.requestId) {
          correction.reviewStatus = "reviewed";
          correction.reviewedBy = req.user!.username;
          correction.reviewedAt = new Date();
        }
      });
      const result = standalone
        ? await StandaloneSale.findOneAndUpdate(
            { saleId: bookingId, revision: expectedRevision },
            update,
            { returnDocument: "after", runValidators: true, session },
          )
        : await Booking.findOneAndUpdate(
            { bookingId, ...bookingRevisionPredicate(expectedRevision) },
            update,
            { returnDocument: "after", runValidators: true, session },
          );
      if (!result) throw new TransactionCorrectionConflictError();
      if (context.requestId) {
        const decision = await FinancialCorrectionRequest.updateOne(
          { _id: context.requestId, status: "pending" },
          {
            $set: {
              status: "approved",
              decidedBy: req.user!.username,
              decidedAt: new Date(),
              appliedCorrectionId: corrections[0]._id,
            },
          },
          { session },
        );
        if (decision.modifiedCount !== 1)
          throw new TransactionCorrectionConflictError();
      }
      await FinancialCorrectionRequest.updateMany(
        {
          sourceType: standalone ? "standaloneSale" : "booking",
          sourceId: bookingId,
          status: "pending",
        },
        {
          $set: {
            status: "stale",
            decidedBy: req.user!.username,
            decidedAt: new Date(),
            decisionReason: "รายการมีการเปลี่ยนแปลง กรุณาตรวจสอบและส่งคำขอใหม่",
          },
        },
        { session },
      );
      await logActivityStrict(
        req.user?.username,
        "CORRECT_TRANSACTION",
        {
          changes: { transaction: { before, after } },
          summary: {
            sourceType: standalone ? "standaloneSale" : "booking",
            transactionId,
            requestId: context.requestId,
            historical,
            correctionId: corrections[0]._id,
          },
        },
        bookingId,
        session,
      );
      return result;
    };
    const updatedBooking = await withMutationIdempotency(req, () =>
      withCashShiftMutationLock(originalBusinessDate, async () => {
        const stillHistorical =
          financialChange &&
          canBeHistorical &&
          !isStaffEditablePendingRoomCharge &&
          await isCorrectionPeriodClosed(originalBusinessDate, affectedCashShiftId);
        if (historical !== stillHistorical)
          throw new CashShiftLedgerConflictError(
            "รอบการเงินเปลี่ยนแล้ว กรุณารีเฟรชและตรวจสอบอีกครั้ง",
          );
        if (requiresCashLedgerLock)
          return withCashLedgerTransaction(cashProbe, execute);
        const session = await mongoose.startSession();
        try {
          return (await session.withTransaction(() => execute([], session)))!;
        } finally {
          await session.endSession();
        }
      }),
    );

    const projectedTransactions = projectEffectiveTransactions(
      updatedBooking.transactions,
      updatedBooking.transactionCorrections,
      !standalone,
    );
    const effectiveTransaction = projectedTransactions.find(
      (transaction) => transaction.originalTransactionId === transactionId,
    );
    const correction =
      [...updatedBooking.transactionCorrections]
        .reverse()
        .find((item) => item.targetTransactionId === transactionId) ||
      updatedBooking.transactionCorrections[
        updatedBooking.transactionCorrections.length - 1
      ];

    return res.status(200).json({
      message: "แก้ไขรายการสำเร็จ โดยเก็บข้อมูลเดิมไว้ในประวัติ",
      booking: standalone ? undefined : updatedBooking,
      sale: standalone ? updatedBooking : undefined,
      effectiveTransaction,
      correction,
      financialSummary: summarizeBookingFinancialPosition(
        projectedTransactions,
      ),
    });
  } catch (err) {
    if ((err as { code?: number }).code === 11000)
      return res.status(409).json({
        error: "PENDING_CORRECTION_EXISTS",
        message: "มีคำขอรออนุมัติสำหรับรายการนี้แล้ว",
      });
    if (err instanceof Error && err.message === "CASH_SHIFT_MUTATION_CONFLICT")
      return res.status(409).json({ error: err.message });
    if (err instanceof TransactionCorrectionConflictError) {
      return sendBookingRevisionConflict(res, req.params.bookingId);
    }
    if (err instanceof IdempotencyConflictError) {
      return res.status(409).json({
        error: "DUPLICATE_REQUEST",
        message: "คำขอนี้ถูกส่งซ้ำ กรุณารีเฟรชข้อมูลก่อนลองอีกครั้ง",
      });
    }
    if (err instanceof CashShiftLedgerConflictError) {
      return res.status(409).json({ error: err.code, message: err.message });
    }

    console.error("Failed to correct transaction", {
      bookingId: req.params.bookingId,
      transactionId: req.params.transactionId,
      requestId: crypto.randomUUID(),
      error: err instanceof Error ? err.message : "Unknown error",
    });
    return res.status(500).json({
      error: "TRANSACTION_CORRECTION_FAILED",
      message: "ไม่สามารถแก้ไขรายการได้ กรุณาลองใหม่",
    });
  }
};

export const correctTransaction = (
  req: Request<CorrectionParams, {}, CorrectionBody>,
  res: Response,
) => runTransactionCorrection(req, res);
