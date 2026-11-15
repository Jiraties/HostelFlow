import { z } from "zod";
import type { booking, TransactionCorrection, transcation } from "../models/booking";
import { effectiveCommercialSegments } from "../helpers/commercialSegmentHelpers";
import {
  bookingTodayArrivalRevenueAmount, bookingTransactionTodayReductionAmount,
  isCheckInRoundingAdjustment, targetSegmentForCheckInRounding, transactionCashStashImpact,
  transactionDirection, transactionSignedAmount, transactionTodayExtrasRevenueAmount,
} from "../helpers/financeHelpers";
import { standaloneSaleBookingView } from "../helpers/todayRevenueBreakdown";
import { withEffectiveTransactions, type EffectiveTransaction } from "../services/transactionCorrections";
import { dateKey, identifier, optionalText, safeEnum, timestamp } from "./bookings";
import { channels, date, inWindow, methods, money, range, ref, satang, sourceActions, ToolError, transactionTypes, windowFor, type Window } from "./contracts";
import { oid, type Reader } from "./store";

type LedgerSource = { kind: "booking" | "standaloneSale"; id: string; original: booking; effective: Omit<booking, "transactions"> & { transactions: EffectiveTransaction[] } };
function source(kind: LedgerSource["kind"], original: booking): LedgerSource {
  const id = identifier(original.bookingId);
  if (!id) throw new ToolError("DATA_INCOMPLETE");
  for (const txn of original.transactions ?? []) satang(txn.amount);
  for (const correction of original.transactionCorrections ?? []) {
    satang(correction.before?.amount);
    satang(correction.after?.amount);
  }
  for (const segment of original.commercialSegments ?? []) satang(segment.amount);
  return { kind, id, original, effective: withEffectiveTransactions(original) };
}
export const bookingSource = (original: booking) => source("booking", original);
async function loadSources(read: Reader, bookingFilter: Record<string, unknown>, saleFilter: Record<string, unknown> | null, max = 650) {
  const [bookings, sales] = await Promise.all([
    read("bookingFinance", bookingFilter, { cap: max }),
    saleFilter ? read("sale", saleFilter, { cap: max }) : Promise.resolve([]),
  ]);
  if (bookings.length + sales.length > max) throw new ToolError("LIMIT_EXCEEDED");
  return [
    ...bookings.map(bookingSource),
    ...sales.map((record) => source("standaloneSale", standaloneSaleBookingView(record))),
  ];
}
export const onReceipts = (read: Reader, w: Window) =>
  loadSources(read, { "transactions.createdAt": range(w) }, { "transactions.createdAt": range(w) });
export const onRevenue = (read: Reader, w: Window) => loadSources(read, {
  voided: { $ne: true },
  $or: [{ checkIn: range(w) }, { "commercialSegments.from": range(w) }, { "transactions.createdAt": range(w) }],
}, { "transactions.createdAt": range(w) });
export const onShifts = (read: Reader, ids: string[]) => ids.length ? loadSources(read, {
  $or: [{ "transactions.cashShiftId": { $in: ids } }, { "transactionCorrections.after.cashShiftId": { $in: ids } },
    { "transactionCorrections.before.cashShiftId": { $in: ids } }],
}, { $or: [{ "transactions.cashShiftId": { $in: ids } }, { "transactionCorrections.after.cashShiftId": { $in: ids } },
  { "transactionCorrections.before.cashShiftId": { $in: ids } }] }) : Promise.resolve([]);
export const byTransaction = (read: Reader, id: string) => loadSources(read, {
  $or: [{ "transactions._id": oid(id) }, { "transactions._id": id }],
}, { $or: [{ "transactions._id": oid(id) }, { "transactions._id": id }] }, 6);

const term = z.string().max(240).nullable();
const idOut = ref.nullable();
const dateOut = date.nullable();
const timeOut = z.iso.datetime().nullable();
const directions = ["in", "out", "neutral"] as const;
export const sourceSchema = z.strictObject({
  sourceType: z.enum(["booking", "standaloneSale"]), sourceId: ref,
  bookingVoided: z.boolean(), channel: z.enum(channels).nullable(),
});
export const getSource = (item: LedgerSource) => ({
  sourceType: item.kind, sourceId: item.id, bookingVoided: item.kind === "booking" && item.original.voided === true,
  channel: item.kind === "booking" ? safeEnum(channels, item.original.platformId) : null,
});
function segmentFor(record: booking, transaction: transcation) {
  const segments = effectiveCommercialSegments(record);
  const id = identifier(transaction._id);
  if (isCheckInRoundingAdjustment(transaction)) return targetSegmentForCheckInRounding(record, transaction);
  return segments.find((segment) =>
    (!!id && segment.transactionId === id) ||
    (!!transaction.relatedTransactionId && segment.transactionId === transaction.relatedTransactionId) ||
    (!!transaction.commercialSegmentId && identifier(segment._id) === transaction.commercialSegmentId),
  );
}
export function effectivePayment(txn: transcation) {
  // A retained deposit moves between stashes but is not a new external payment.
  if (!safeEnum(methods, txn.paymentMethod)) throw new ToolError("DATA_INCOMPLETE");
  if (txn.paymentMethod === "Unpaid" || txn.type === "depositKept" || txn.type === "roomChargeWriteOff") return 0;
  return satang(transactionSignedAmount(txn));
}
export function cashImpact(txn: transcation) {
  const impact = transactionCashStashImpact(txn);
  return {
    operatingCashInSatang: satang(impact.operatingCashIn), operatingCashOutSatang: satang(impact.operatingCashOut),
    depositCashInSatang: satang(impact.depositCashIn), depositCashOutSatang: satang(impact.depositCashOut),
  };
}
const snapshotFields = {
  type: z.enum(transactionTypes).nullable(), paymentMethod: z.enum(methods).nullable(), amountSatang: money, cashShiftId: idOut,
};
const snapshotSchema = z.strictObject(snapshotFields);
const snapshot = (txn: Pick<transcation, "type" | "paymentMethod" | "amount" | "cashShiftId">) => ({
  type: safeEnum(transactionTypes, txn.type), paymentMethod: safeEnum(methods, txn.paymentMethod),
  amountSatang: satang(txn.amount), cashShiftId: identifier(txn.cashShiftId),
});
const reasons = ["incorrect_amount", "incorrect_payment_method", "incorrect_category", "incorrect_note",
  "manager_discount", "waived_fee", "agreed_rate_correction", "cancelled_service", "guest_compensation", "other"] as const;
export const correctionSchema = z.strictObject({
  correctionId: idOut, targetTransactionId: idOut, type: z.enum(["recorded_mistake", "charge_change"]).nullable(),
  reasonCode: z.enum(reasons).nullable(), correctedBy: term, correctedAt: timeOut, originalBusinessDate: dateOut,
  affectedCashShiftId: idOut, financialChange: z.boolean(), before: snapshotSchema, after: snapshotSchema,
});
export function correctionView(record: TransactionCorrection) {
  return {
    correctionId: identifier(record._id), targetTransactionId: identifier(record.targetTransactionId),
    type: safeEnum(["recorded_mistake", "charge_change"] as const, record.correctionType),
    reasonCode: safeEnum(reasons, record.reasonCode), correctedBy: optionalText(record.correctedBy),
    correctedAt: timestamp(record.correctedAt), originalBusinessDate: date.safeParse(record.originalBusinessDate).data ?? null,
    affectedCashShiftId: identifier(record.affectedCashShiftId), financialChange: record.financialChange === true,
    before: snapshot(record.before), after: snapshot(record.after),
  };
}
export const txnSchema = z.strictObject({
  transactionId: idOut, ...snapshotFields, sourceAction: z.enum(sourceActions).nullable(),
  direction: z.enum(directions), signedPaymentSatang: money, recordedAt: timeOut,
  recordedBusinessDate: dateOut, paymentDate: dateOut,
  revenueAttributionDate: dateOut, segmentId: idOut, attributedChargeTransactionId: idOut, stayStartDate: dateOut, stayEndDate: dateOut,
  relatedTransactionId: idOut, relatedTransactionType: z.enum(transactionTypes).nullable(),
  cashShiftBusinessDate: dateOut, cashMovementDate: dateOut, cashier: term, rounding: z.boolean(),
});
type ShiftDates = Map<string, string>;
export function txnView(record: LedgerSource, txn: transcation, shiftDates: ShiftDates) {
  const linked = record.kind === "booking" ? segmentFor(record.effective, txn) : undefined;
  const recordedBusinessDate = dateKey(txn.createdAt);
  const signedPaymentSatang = effectivePayment(txn);
  const cashShiftId = identifier(txn.cashShiftId);
  const cashShiftBusinessDate = cashShiftId ? shiftDates.get(cashShiftId) || null : null;
  const impact = cashImpact(txn);
  const retainedArrival = ["cancelled", "noShow"].includes(record.effective.status);
  let revenueAttributionDate: string | null = null;
  if (!record.effective.voided) {
    if (recordedBusinessDate && transactionTodayExtrasRevenueAmount(txn) > 0) {
      revenueAttributionDate = recordedBusinessDate;
    } else if (recordedBusinessDate && bookingTransactionTodayReductionAmount(record.effective, txn,
      windowFor({ startDate: recordedBusinessDate, endDate: recordedBusinessDate }, 1).end) > 0 &&
      !(retainedArrival && dateKey(record.effective.checkIn) === recordedBusinessDate &&
        ["roomRefund", "roomChargeWriteOff", "cancellationRefund"].includes(txn.type))) {
      revenueAttributionDate = recordedBusinessDate;
    } else if (!retainedArrival && linked && (txn.type === "roomCharge" || txn.type === "settlementCharge" ||
      txn.type === "paymentCorrection" || isCheckInRoundingAdjustment(txn))) {
      revenueAttributionDate = dateKey(linked.from);
    } else if (retainedArrival && txn.type === "roomCharge" && txn.sourceAction !== "EXTEND_BOOKING" &&
      bookingTodayArrivalRevenueAmount(record.effective) > 0) {
      revenueAttributionDate = dateKey(record.effective.checkIn);
    }
  }
  return {
    transactionId: identifier(txn._id), ...snapshot(txn), sourceAction: safeEnum(sourceActions, txn.sourceAction),
    direction: transactionDirection(txn), signedPaymentSatang, recordedAt: timestamp(txn.createdAt), recordedBusinessDate,
    paymentDate: signedPaymentSatang ? recordedBusinessDate : null,
    revenueAttributionDate,
    segmentId: identifier(linked?._id), attributedChargeTransactionId: identifier(linked?.transactionId), stayStartDate: dateKey(linked?.from), stayEndDate: dateKey(linked?.to),
    relatedTransactionId: identifier(txn.relatedTransactionId), relatedTransactionType: safeEnum(transactionTypes, txn.relatedTransactionType),
    cashShiftBusinessDate,
    cashMovementDate: Object.values(impact).some((amount) => amount > 0) ? recordedBusinessDate : null,
    cashier: optionalText(txn.createdBy),
    rounding: txn.type === "adjustment" && txn.reasonOfAdjustment === "rounding",
  };
}
export const evidence = z.strictObject({
  ...sourceSchema.shape, original: txnSchema, effective: txnSchema.nullable(),
  correctionCount: z.int().nonnegative(), latestCorrectionId: idOut,
  foldedIntoTransactionId: idOut, correctionIds: z.array(ref).max(300),
});
export function evidenceFor(item: LedgerSource, shifts: ShiftDates, select: (txn: transcation, effective?: EffectiveTransaction) => boolean = () => true) {
  const effectiveMap = new Map(item.effective.transactions.map((txn) => [txn.originalTransactionId, txn]));
  return (item.original.transactions || []).flatMap((txn) => {
    const originalId = identifier(txn._id);
    const effective = originalId ? effectiveMap.get(originalId) : undefined;
    if (!select(txn, effective)) return [];
    const correctionIds = (item.original.transactionCorrections || []).filter((c) => c.targetTransactionId === originalId)
      .map((c) => identifier(c._id)).filter((id): id is string => !!id);
    return [{
      ...getSource(item), original: txnView(item, txn, shifts), effective: effective ? txnView(item, effective, shifts) : null,
      correctionCount: effective?.correctionCount ?? correctionIds.length, latestCorrectionId: identifier(effective?.latestCorrectionId),
      foldedIntoTransactionId: !effective && txn.type === "adjustment" ? identifier(txn.relatedTransactionId) : null,
      correctionIds,
    }];
  });
}
export const selectReceipts = (item: LedgerSource, w: Window) => item.effective.transactions.filter((txn) => inWindow(txn.createdAt, w));
export const shiftDatesFor = (read: Reader, items: LedgerSource[]): Promise<ShiftDates> =>
  lookupShiftDates(read, items.flatMap(({ original, effective }) => [...(original.transactions || []), ...effective.transactions])
    .map((txn) => txn.cashShiftId));

export async function lookupShiftDates(read: Reader, candidates: (string | undefined | null)[]): Promise<ShiftDates> {
  const ids = [...new Set(candidates.filter((id): id is string => typeof id === "string" && /^[a-f0-9]{24}$/i.test(id)))];
  if (!ids.length) return new Map();
  const shifts = await read("shift", { _id: { $in: ids.map(oid) } }, { cap: 180 });
  return new Map(shifts.flatMap((shift) => {
    const dateResult = date.safeParse(shift.businessDate);
    return dateResult.success ? [[String(shift._id), dateResult.data] as const] : [];
  }));
}
