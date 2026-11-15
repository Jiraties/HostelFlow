import { z } from "zod";
import type { transcation } from "../models/booking";
import { transactionCashStashImpact } from "../helpers/financeHelpers";
import { buildTodayRevenueBreakdown } from "../helpers/todayRevenueBreakdown";
import { dateKey, exactBooking, identifier, optionalText, position, positionSchema, safeEnum, timestamp } from "./bookings";
import { addMoney, channels, date, dates, dateSpan, financeActions, inWindow, keyRange, methods, money, objectId, operationalActions,
  page, pageInput, pagination, range, ref, satang, sourceActions, span, sum, ToolError, transactionTypes, windowFor, type Window } from "./contracts";
import { bookingSource, byTransaction, cashImpact, correctionSchema, correctionView, evidence, evidenceFor, getSource,
  lookupShiftDates, onReceipts, onRevenue, onShifts, shiftDatesFor, sourceSchema, txnView } from "./ledger";
import { definitions, revenueLines } from "./reports";
import type { Register } from "./server";
import { oid, type Reader } from "./store";

const dateOut = date.nullable();
const idOut = ref.nullable();
const timeOut = z.iso.datetime().nullable();
const amountOut = money.nullable();
const term = z.string().max(240).nullable();
const optionalSatang = (value: unknown) => value === undefined || value === null ? null : satang(value);
const windowSchema = z.strictObject(dates);
const shiftSchema = z.strictObject({
  shiftId: ref, businessDate: date, shiftNumber: z.int().positive(), status: z.enum(["open", "closed"]),
  staffUsername: term, closedBy: term, startedAt: timeOut, endedAt: timeOut,
  openingMode: z.enum(["counted", "accepted_handoff"]).nullable(), handoffFromShiftId: idOut,
  openingOperatingCashSatang: money, recordedOperatingCashInSatang: amountOut, recordedOperatingCashOutSatang: amountOut,
  recordedExpectedClosingCashSatang: amountOut, actualCashCountSatang: amountOut, recordedVarianceSatang: amountOut,
  finalClose: z.boolean(), ledgerRevision: z.int().nonnegative().nullable(),
  reopenHistory: z.array(z.strictObject({
    correctionId: idOut, reopenedAt: timeOut, reopenedBy: term, priorClosedAt: timeOut,
    priorActualCashCountSatang: amountOut, priorExpectedClosingCashSatang: amountOut, priorVarianceSatang: amountOut,
  })).max(120),
});
async function loadShifts(read: Reader, w: Window) {
  return read("shift", { businessDate: keyRange(w) }, { cap: 120, sort: { businessDate: 1, shiftNumber: 1, _id: 1 } });
}
async function shiftViews(read: Reader, shifts: Awaited<ReturnType<typeof loadShifts>>) {
  if (!shifts.length) return [];
  const reopen = await read("reopen", { shiftId: { $in: shifts.map((s) => String(s._id)) } }, { cap: 120, sort: { reopenedAt: 1, _id: 1 } });
  return shifts.map((s) => {
    if (s.status !== "open" && s.status !== "closed") throw new ToolError("DATA_INCOMPLETE");
    return {
      shiftId: String(s._id), businessDate: s.businessDate, shiftNumber: s.shiftNumber, status: s.status,
      staffUsername: optionalText(s.staffUsername), closedBy: optionalText(s.closedBy), startedAt: timestamp(s.startedAt), endedAt: timestamp(s.endedAt),
      openingMode: safeEnum(["counted", "accepted_handoff"] as const, s.openingMode), handoffFromShiftId: identifier(s.handoffFromShiftId),
      openingOperatingCashSatang: satang(s.operatingOpeningCash),
      recordedOperatingCashInSatang: optionalSatang(s.operatingCashIn), recordedOperatingCashOutSatang: optionalSatang(s.operatingCashOut),
      recordedExpectedClosingCashSatang: optionalSatang(s.operatingExpectedCash), actualCashCountSatang: optionalSatang(s.operatingActualCash),
      recordedVarianceSatang: optionalSatang(s.operatingVariance), finalClose: s.isFinalDayClose === true,
      ledgerRevision: s.ledgerRevision ?? null,
      reopenHistory: reopen.filter((r) => r.shiftId === String(s._id)).map((r) => ({
        correctionId: identifier(r.correctionId), reopenedAt: timestamp(r.reopenedAt), reopenedBy: optionalText(r.reopenedBy),
        priorClosedAt: timestamp(r.originalClose?.endedAt), priorActualCashCountSatang: optionalSatang(r.originalClose?.operatingActualCash),
        priorExpectedClosingCashSatang: optionalSatang(r.originalClose?.operatingExpectedCash),
        priorVarianceSatang: optionalSatang(r.originalClose?.operatingVariance),
      })),
    };
  });
}
const cashEvidence = z.strictObject({
  ...evidence.shape, signedOperatingCashSatang: money, signedDepositCashSatang: money,
});
const txnSort = (first: z.infer<typeof evidence>, second: z.infer<typeof evidence>) =>
  (second.original.recordedAt ?? "").localeCompare(first.original.recordedAt ?? "") ||
  (first.original.transactionId ?? "").localeCompare(second.original.transactionId ?? "") ||
  first.sourceId.localeCompare(second.sourceId);
const activityActions = [...financeActions, ...operationalActions] as const;

export function registerInvestigations(register: Register) {
  register("get_cash_shifts", "List recorded shift snapshots, including original close evidence if a shift was reopened. Reconcile for effective movement totals.", z.strictObject({
    ...dates, ...pageInput,
  }), z.strictObject({ period: dateSpan, ...pagination(shiftSchema).shape }), async (args, read) => {
    const w = windowFor(args, 14);
    const shifts = await loadShifts(read, w);
    const selection = page(shifts, args);
    return { period: span(w), ...selection, records: await shiftViews(read, selection.records) };
  });

  register("reconcile_cash_shifts", "Reconstruct one shift's effective operating cash and compare the ledger with counted cash. Includes linked deposits and corrected-out movements as separate evidence.", z.strictObject({
    shiftId: objectId, ...pageInput,
  }), z.strictObject({
    shift: shiftSchema, definition: z.string(), effectiveOperatingCashInSatang: money, effectiveOperatingCashOutSatang: money,
    effectiveExpectedClosingCashSatang: money, countedMinusExpectedSatang: amountOut,
    effectiveMinusRecordedExpectedSatang: amountOut, unexplainedDifferenceSatang: amountOut,
    state: z.enum(["reconciled", "unresolved"]), warnings: z.array(z.string()),
    evidence: pagination(cashEvidence), evidenceCount: z.int().nonnegative(),
  }), async ({ shiftId, ...p }, read) => {
    const id = String(oid(shiftId));
    const [raw] = await read("shift", { _id: oid(id) }, { cap: 1 });
    if (!raw) throw new ToolError("NOT_FOUND");
    const [[shift], sources] = await Promise.all([shiftViews(read, [raw]), onShifts(read, [id])]);
    const shiftDates = await shiftDatesFor(read, sources);
    const impacts = sources.flatMap((source) => source.effective.transactions.filter((txn) => txn.cashShiftId === id).map(cashImpact));
    const effectiveOperatingCashInSatang = sum(impacts, (i) => i.operatingCashInSatang);
    const effectiveOperatingCashOutSatang = sum(impacts, (i) => i.operatingCashOutSatang);
    const effectiveExpectedClosingCashSatang = addMoney(addMoney(shift.openingOperatingCashSatang, effectiveOperatingCashInSatang), -effectiveOperatingCashOutSatang);
    const countedMinusExpectedSatang = shift.actualCashCountSatang === null || shift.status !== "closed" ? null :
      addMoney(shift.actualCashCountSatang, -effectiveExpectedClosingCashSatang);
    const effectiveMinusRecordedExpectedSatang = shift.recordedExpectedClosingCashSatang === null ? null :
      addMoney(effectiveExpectedClosingCashSatang, -shift.recordedExpectedClosingCashSatang);
    const evidenceRows = sources.flatMap((source) => evidenceFor(source, shiftDates, (txn, effective) =>
      txn.cashShiftId === id || effective?.cashShiftId === id || (source.original.transactionCorrections || []).some(
        (correction) => correction.targetTransactionId === identifier(txn._id) &&
          [correction.before?.cashShiftId, correction.after?.cashShiftId].includes(id),
      ),
    ).map((row) => {
      const txn = source.effective.transactions.find((candidate) => candidate.originalTransactionId === row.effective?.transactionId && candidate.cashShiftId === id);
      const impact = txn ? cashImpact(txn) : null;
      return { ...row, signedOperatingCashSatang: impact ? addMoney(impact.operatingCashInSatang, -impact.operatingCashOutSatang) : 0,
        signedDepositCashSatang: impact ? addMoney(impact.depositCashInSatang, -impact.depositCashOutSatang) : 0 };
    })).sort(txnSort);
    const warnings = [];
    if (countedMinusExpectedSatang === null) warnings.push("NO_CLOSED_CASH_COUNT");
    if (countedMinusExpectedSatang) warnings.push("COUNTED_CASH_DIFFERS_FROM_EFFECTIVE_LEDGER");
    if (effectiveMinusRecordedExpectedSatang) warnings.push("SHIFT_SNAPSHOT_DIFFERS_FROM_EFFECTIVE_LEDGER");
    if (evidenceRows.some((row) => !row.original.transactionId || (row.effective?.cashShiftId === id && !row.effective.recordedAt))) warnings.push("INCOMPLETE_TRANSACTION_PROVENANCE");
    if (sum(evidenceRows, (row) => row.signedOperatingCashSatang) !== addMoney(effectiveOperatingCashInSatang, -effectiveOperatingCashOutSatang)) warnings.push("MOVEMENTS_MISSING_EVIDENCE");
    return {
      shift, definition: "Opening operating cash plus effective assigned inflows minus outflows; difference is actual counted cash minus effective expected cash. Separate deposit-stash movements do not enter the operating balance.",
      effectiveOperatingCashInSatang, effectiveOperatingCashOutSatang, effectiveExpectedClosingCashSatang,
      countedMinusExpectedSatang, effectiveMinusRecordedExpectedSatang, unexplainedDifferenceSatang: countedMinusExpectedSatang,
      state: warnings.length === 0 ? "reconciled" as const : "unresolved" as const, warnings,
      evidence: page(evidenceRows, p), evidenceCount: evidenceRows.length,
    };
  });

  register("get_booking_financial_history", "Read original and effective transactions side-by-side along with the effective settlement position. Corrections are separately paginated.", z.strictObject({
    bookingId: ref, ...pageInput, correctionOffset: z.int().min(0).max(500).default(0),
  }), z.strictObject({
    ...sourceSchema.shape, financialPosition: positionSchema, transactions: pagination(evidence), corrections: pagination(correctionSchema),
  }), async ({ bookingId, correctionOffset, ...p }, read) => {
    const source = bookingSource(await exactBooking(read, bookingId));
    const shifts = await shiftDatesFor(read, [source]);
    const corrections = (source.original.transactionCorrections || []).map(correctionView)
      .sort((a, b) => (b.correctedAt ?? "").localeCompare(a.correctedAt ?? "") || (a.correctionId ?? "").localeCompare(b.correctionId ?? ""));
    return {
      ...getSource(source), financialPosition: position(source.effective),
      transactions: page(evidenceFor(source, shifts).sort(txnSort), p),
      corrections: page(corrections, { offset: correctionOffset, limit: p.limit }),
    };
  });

  register("query_financial_records", "Search sanitized original/effective records using an exact reference or bounded period. Payment date is real receipt/outflow; recorded date is the original ledger date. Shift ID matches original or effective membership.", z.strictObject({
    ...pageInput, bookingId: ref.optional(), transactionId: objectId.optional(), cashShiftId: objectId.optional(),
    recordedPeriod: windowSchema.optional(), paymentPeriod: windowSchema.optional(),
    transactionType: z.enum(transactionTypes).optional(), paymentMethod: z.enum(methods).optional(),
    sourceAction: z.enum(sourceActions).optional(), channel: z.enum(channels).optional(),
    corrected: z.boolean().optional(), minimumAmountSatang: money.nonnegative().optional(), maximumAmountSatang: money.nonnegative().optional(),
  }), pagination(evidence), async (args, read) => {
    const recorded = args.recordedPeriod && windowFor(args.recordedPeriod);
    const payments = args.paymentPeriod && windowFor(args.paymentPeriod);
    if (!(args.bookingId || args.transactionId || args.cashShiftId || recorded || payments) ||
      (args.minimumAmountSatang ?? 0) > (args.maximumAmountSatang ?? Number.MAX_SAFE_INTEGER)) throw new ToolError("INVALID_FILTER");
    const txid = args.transactionId?.toLowerCase();
    const sid = args.cashShiftId?.toLowerCase();
    let sources = args.bookingId ? [bookingSource(await exactBooking(read, args.bookingId))] :
      txid ? await byTransaction(read, txid) : sid ? await onShifts(read, [sid]) : await onReceipts(read, (recorded || payments)!);
    if (args.channel) sources = sources.filter((source) => getSource(source).channel === args.channel);
    const selected = sources.map((source) => {
      const predicate = (original: transcation, effective?: transcation & { corrected?: boolean }) => {
        const txn = effective || original;
        const amount = Math.abs(satang(txn.amount));
        return (!txid || identifier(original._id) === txid) &&
          (!sid || [original.cashShiftId, txn.cashShiftId].includes(sid)) &&
          (!recorded || inWindow(txn.createdAt, recorded)) &&
          (!payments || (!!txnView(source, txn, new Map()).paymentDate && !!effective && inWindow(txn.createdAt, payments))) &&
          (!args.transactionType || txn.type === args.transactionType) &&
          (!args.paymentMethod || txn.paymentMethod === args.paymentMethod) &&
          (!args.sourceAction || txn.sourceAction === args.sourceAction) &&
          (args.corrected === undefined || Boolean(effective?.corrected || (!effective && original.relatedTransactionId)) === args.corrected) &&
          amount >= (args.minimumAmountSatang ?? 0) && amount <= (args.maximumAmountSatang ?? Number.MAX_SAFE_INTEGER);
      };
      return { source, predicate };
    });
    // Page before resolving shift dates; a broad date-range search never loads thousands of shift IDs.
    const index = selected.flatMap(({ source, predicate }) => evidenceFor(source, new Map(), predicate)
      ).sort(txnSort);
    const selection = page(index, args);
    const shiftDates = await lookupShiftDates(read, selection.records.flatMap((row) =>
      [row.original.cashShiftId, row.effective?.cashShiftId]));

    return { ...selection, records: selection.records.map((row) => ({
      ...row, original: { ...row.original, cashShiftBusinessDate: shiftDates.get(row.original.cashShiftId ?? "") ?? null },
      effective: row.effective && { ...row.effective, cashShiftBusinessDate: shiftDates.get(row.effective.cashShiftId ?? "") ?? null },
    })) };
  });

  register("trace_transaction", "Trace an exact transaction through explicit charge/settlement/refund/correction links and canonically attributed check-in rounding. For a booking reference, list its entire recorded ledger.", z.strictObject({
    bookingId: ref.optional(), transactionId: objectId.optional(), ...pageInput,
  }), z.strictObject({
    ...sourceSchema.shape, anchorTransactionId: idOut, evidenceCount: z.int().nonnegative(),
    ...pagination(evidence).shape, links: z.array(z.strictObject({
      transactionId: ref, relatedId: ref, relationship: z.enum(["recorded_link", "commercial_segment", "attributed_rounding", "correction", "folded_legacy_adjustment"]),
    })).max(150), warnings: z.array(z.string()),
  }), async (args, read) => {
    const txnId = args.transactionId?.toLowerCase();
    if (!args.bookingId && !txnId) throw new ToolError("INVALID_FILTER");
    const sources = args.bookingId ? [bookingSource(await exactBooking(read, args.bookingId))] : await byTransaction(read, txnId!);
    if (sources.length > 1) throw new ToolError("DATA_INCOMPLETE");
    const [source] = sources;
    if (!source) throw new ToolError("NOT_FOUND");
    const shiftDates = await shiftDatesFor(read, [source]);
    const all = evidenceFor(source, shiftDates).sort(txnSort);
    const rawLinks = all.flatMap((row) => {
      const t = row.effective ?? row.original;
      if (!t.transactionId) return [];
      const edge = (relatedId: string | null, relationship: "recorded_link" | "commercial_segment" | "attributed_rounding" | "correction" | "folded_legacy_adjustment") =>
        relatedId ? [{ transactionId: t.transactionId!, relatedId, relationship }] : [];
      const segmentKey = t.segmentId || (t.attributedChargeTransactionId !== t.transactionId ? t.attributedChargeTransactionId : null);
      return [
        ...edge(t.relatedTransactionId, "recorded_link"), ...edge(segmentKey, t.rounding ? "attributed_rounding" : "commercial_segment"),
        ...edge(row.foldedIntoTransactionId, "folded_legacy_adjustment"), ...row.correctionIds.flatMap((id) => edge(id, "correction")),
      ];
    });
    const related = new Set<string>();
    if (txnId) {
      if (!all.some((row) => row.original.transactionId === txnId)) throw new ToolError("NOT_FOUND");
      related.add(txnId);
      let changed: boolean;
      do {
        changed = false;
        for (const link of rawLinks) {
          if (!related.has(link.transactionId) && !related.has(link.relatedId)) continue;
          if (!related.has(link.transactionId) || !related.has(link.relatedId)) changed = true;
          related.add(link.transactionId);
          related.add(link.relatedId);
        }
      } while (changed);
    }
    const filtered = txnId ? all.filter((row) => !!row.original.transactionId && related.has(row.original.transactionId)) : all;
    const rows = page(filtered, args);
    const visible = new Set(rows.records.map((row) => row.original.transactionId));
    const links = rawLinks.filter((link) => visible.has(link.transactionId));
    const warnings = [];
    if (links.length > 150) warnings.push("LINKS_CAPPED");
    if (filtered.some((row) => !row.original.transactionId || (row.effective?.cashShiftId && !row.effective.cashShiftBusinessDate))) warnings.push("INCOMPLETE_TRANSACTION_PROVENANCE");
    if (filtered.length < all.length && all.some((row) => row.original.type === "settlementCharge" && !row.original.relatedTransactionId)) warnings.push("UNLINKED_SETTLEMENTS_MAY_REQUIRE_BOOKING_TRACE");
    return { ...getSource(source), ...rows, anchorTransactionId: txnId ?? null, evidenceCount: filtered.length, links: links.slice(0, 150), warnings };
  });

  register("search_activity_logs", "Find permitted operational or financial audit events. Returns actor, event, timestamp and typed references. Raw change values, notes and identity-document actions are excluded.", z.strictObject({
    ...dates, ...pageInput, staffUsername: ref.optional(), bookingId: ref.optional(),
    category: z.enum(["financial", "operational"]).optional(), action: z.enum(activityActions).optional(),
  }), z.strictObject({ period: dateSpan, ...pagination(z.strictObject({
    eventId: ref, actor: term, timestamp: timeOut, action: z.enum(activityActions), bookingId: idOut,
    category: z.enum(["financial", "operational"]), referenceIds: z.strictObject({
      transactionId: idOut, targetTransactionId: idOut, shiftId: idOut, saleId: idOut, correctionId: idOut,
    }), outcome: z.enum(["succeeded", "failed"]).nullable(),
  })).shape }), async (args, read) => {
    const w = windowFor(args, 14);
    const approved = args.category === "financial" ? financeActions : args.category === "operational" ? operationalActions : activityActions;
    if (args.action && !(approved as readonly string[]).includes(args.action)) throw new ToolError("INVALID_FILTER");
    const records = await read("activity", {
      timestamp: range(w), action: args.action ?? { $in: approved },
      ...(args.staffUsername ? { staffUsername: args.staffUsername } : {}),
      ...(args.bookingId ? { bookingId: args.bookingId } : {}),
    }, { sort: { timestamp: -1, _id: -1 }, skip: args.offset, cap: args.limit + 1 });
    return {
      period: span(w), ...page(records.map((row) => {
        const action = safeEnum(activityActions, row.action);
        if (!action) throw new ToolError("DATA_INCOMPLETE");
        const summary = row.details?.summary;
        const success = (action === "LOGIN" || action === "LOGOUT") ? row.details?.success : undefined;
        return {
          eventId: String(row._id), actor: optionalText(row.staffUsername), action,
          timestamp: timestamp(row.timestamp), bookingId: identifier(row.bookingId),
          category: safeEnum(financeActions, action) ? "financial" as const : "operational" as const,
          referenceIds: {
            transactionId: identifier(summary?.transactionId), targetTransactionId: identifier(summary?.targetTransactionId),
            shiftId: identifier(summary?.shiftId), saleId: identifier(summary?.saleId), correctionId: identifier(summary?.correctionId),
          },
          outcome: success === true ? "succeeded" as const : success === false ? "failed" as const : null,
        };
      }), args, true),
    };
  });
  registerDiscrepancy(register);
}

const metrics = ["grossRevenue", "netRevenue", "stayRevenueCashAllocation", "operatingShiftCashIn", "operatingShiftCashOut",
  "shiftExpectedOperatingCash", "shiftActualOperatingCash"] as const;
type Metric = typeof metrics[number];
const metricDefinitions: Record<Metric, string> = {
  grossRevenue: definitions.grossRevenue, netRevenue: definitions.netRevenue,
  stayRevenueCashAllocation: definitions.stayRevenueCashAllocation, operatingShiftCashIn: definitions.operatingShiftCashIn,
  operatingShiftCashOut: definitions.operatingShiftCashOut,
  shiftExpectedOperatingCash: "Sum of recorded expected closing operating cash snapshots for final closed shifts in the period; these are balance snapshots, not inflows.",
  shiftActualOperatingCash: "Sum of recorded counted operating cash snapshots for final closed shifts in the period; these are balance snapshots, not inflows.",
};
const metricItem = z.strictObject({
  sourceType: z.enum(["booking", "standaloneSale", "cashShift"]), sourceId: ref,
  transactionId: idOut, cashShiftId: idOut, correctionId: idOut,
  metricBusinessDate: date, paymentDate: dateOut, revenueAttributionDate: dateOut, cashShiftBusinessDate: dateOut,
  type: z.enum(transactionTypes).nullable(), amountSatang: money,
});
type MetricItem = z.infer<typeof metricItem>;
const explanationKinds = [
  "equal", "revenue_reduction", "cross_date_attribution", "unassigned_operating_cash",
  "voided_booking_cash", "deposit_transfer", "unresolved",
] as const;
const metricGroup = z.strictObject({
  sourceId: ref, transactionId: idOut, itemsA: z.array(metricItem).max(28), itemsB: z.array(metricItem).max(28),
  signedDifferenceSatang: money, explanation: z.enum(explanationKinds),
});
function registerDiscrepancy(register: Register) {
  register("investigate_revenue_discrepancy", "Compare two explicitly defined revenue or shift metrics. Use Cash allocation versus shift cash inflows for date attribution investigations. Inspect residuals and continue paging evidence.", z.strictObject({
    ...dates, ...pageInput, metricA: z.enum(metrics), metricB: z.enum(metrics),
  }), z.strictObject({
    period: dateSpan, metricA: z.enum(metrics), metricB: z.enum(metrics), definitionA: z.string(), definitionB: z.string(),
    totalASatang: money, totalBSatang: money, differenceSatang: money, explainedDifferenceSatang: money,
    residualUnexplainedSatang: money, state: z.enum(["reconciled", "unresolved"]), warnings: z.array(z.string()),
    evidenceCount: z.int().nonnegative(), evidence: pagination(metricGroup),
  }), async (args, read, signal) => {
    if (args.metricA === args.metricB) throw new ToolError("INVALID_FILTER");
    const window = windowFor(args, 7);
    const cashAllocation = [args.metricA, args.metricB].includes("stayRevenueCashAllocation");
    const movement = [args.metricA, args.metricB].some((m) => m === "operatingShiftCashIn" || m === "operatingShiftCashOut");
    const snapshots = [args.metricA, args.metricB].some((m) => m === "shiftExpectedOperatingCash" || m === "shiftActualOperatingCash");
    const revenue = [args.metricA, args.metricB].some((m) => m === "grossRevenue" || m === "netRevenue" || m === "stayRevenueCashAllocation");
    const [shifts, revenueSources, receivingSources] = await Promise.all([
      movement || snapshots ? loadShifts(read, window) : Promise.resolve([]),
      revenue ? onRevenue(read, window) : Promise.resolve([]),
      movement && cashAllocation ? onReceipts(read, window) : Promise.resolve([]),
    ]);
    const lines = revenueLines(revenueSources, window, signal);
    const shiftMap = new Map(shifts.map((s) => [String(s._id), s]));
    const assigned = movement ? await onShifts(read, [...shiftMap.keys()]) : [];
    const sourceMap = new Map([...receivingSources, ...assigned].map((s) => [s.kind + "|" + s.id, s]));
    // Resolve contributing charge/settlement records outside the requested day as needed.
    for (const s of revenueSources) {
      const key = s.kind + "|" + s.id;
      if (!sourceMap.has(key)) sourceMap.set(key, s);
    }
    const relevantIds = new Set(lines.filter((line) => line.transactionId).map((line) =>
      line.sourceType + "|" + line.sourceId + "|" + line.transactionId));
    const shiftDates = await lookupShiftDates(read, [...sourceMap.values()].flatMap((source) =>
      source.effective.transactions.filter((txn) => relevantIds.has(source.kind + "|" + source.id + "|" + identifier(txn._id)))
        .map((txn) => txn.cashShiftId)));

    const relevantRevenue = new Map<string, boolean>();
    const keyOf = (kind: string, id: string, txnId: string | null) => kind + "|" + id + "|" + (txnId ?? "-");
    const txns = new Map<string, { source: typeof assigned[number]; txn: typeof assigned[number]["effective"]["transactions"][number] }>();
    for (const source of sourceMap.values()) for (const txn of source.effective.transactions) {
      const id = identifier(txn._id);
      if (id) txns.set(keyOf(source.kind, source.id, id), { source, txn });
    }
    const warnings = new Set<string>();
    if ((movement || snapshots) && shifts.length === 0) warnings.add("NO_SHIFT_RECORDS");
    if (snapshots) {
      const closed = shifts.filter((s) => s.status === "closed" && s.isFinalDayClose);
      if (closed.length !== (+window.end - +window.start) / 86400000 ||
        new Set(closed.map((s) => s.businessDate)).size !== closed.length) warnings.add("MISSING_OR_AMBIGUOUS_FINAL_CLOSE_SNAPSHOTS");
    }
    const between = (key: string) => key >= window.startDate && key <= window.endDate;
    if (movement && cashAllocation && receivingSources.some((s) => s.effective.transactions.some((txn) =>
      inWindow(txn.createdAt, window) && !txn.cashShiftId && transactionCashStashImpact(txn).operatingCashIn > 0
    ))) warnings.add("UNASSIGNED_CASH_EXCLUDED_FROM_SHIFT_TOTAL");
    const produces = (metric: Metric): MetricItem[] => {
      if (metric === "shiftExpectedOperatingCash" || metric === "shiftActualOperatingCash") {
        return shifts.filter((s) => s.status === "closed" && s.isFinalDayClose).flatMap((s) => {
          const value = optionalSatang(metric === "shiftExpectedOperatingCash" ? s.operatingExpectedCash : s.operatingActualCash);
          if (value === null) { warnings.add("MISSING_FINAL_CLOSE_AMOUNT"); return []; }
          const id = String(s._id);
          return [{
            sourceType: "cashShift" as const, sourceId: id, transactionId: null, cashShiftId: id, correctionId: null,
            metricBusinessDate: s.businessDate, paymentDate: null, revenueAttributionDate: null, cashShiftBusinessDate: s.businessDate,
            type: null, amountSatang: value,
          }];
        });
      }
      if (metric === "operatingShiftCashIn" || metric === "operatingShiftCashOut") {
        return assigned.flatMap((source) => source.effective.transactions.flatMap((txn) => {
          const sid = identifier(txn.cashShiftId);
          const shift = sid && shiftMap.get(sid);
          if (!shift) return [];
          const impact = cashImpact(txn);
          const value = metric === "operatingShiftCashIn" ? impact.operatingCashInSatang : impact.operatingCashOutSatang;
          if (!value) return [];
          const t = txnView(source, txn, shiftDates);
          if (!t.transactionId || !t.recordedAt) warnings.add("INCOMPLETE_TRANSACTION_PROVENANCE");
          return [{
            sourceType: source.kind, sourceId: source.id, transactionId: t.transactionId, cashShiftId: sid,
            correctionId: identifier(txn.latestCorrectionId), metricBusinessDate: shift.businessDate, paymentDate: t.paymentDate,
            revenueAttributionDate: t.revenueAttributionDate, cashShiftBusinessDate: shift.businessDate, type: t.type, amountSatang: value,
          }];
        }));
      }
      return lines.flatMap((line) => {
        const eligible = metric === "stayRevenueCashAllocation" ? line.kind === "allocation" && line.method === "Cash" :
          line.kind !== "allocation" && (metric === "netRevenue" || line.kind !== "reduction");
        if (!eligible || !line.amount) return [];
        const context = txns.get(keyOf(line.sourceType, line.sourceId, line.transactionId));
        const t = context && txnView(context.source, context.txn, shiftDates);
        // Never assume a charge's timestamp is a receipt if it lacks concrete ledger evidence.
        return [{
          sourceType: line.sourceType, sourceId: line.sourceId, transactionId: line.transactionId,
          cashShiftId: t?.cashShiftId ?? null, correctionId: identifier(context?.txn.latestCorrectionId),
          metricBusinessDate: line.day, paymentDate: t?.paymentDate ?? null, revenueAttributionDate: line.day,
          cashShiftBusinessDate: t?.cashShiftBusinessDate ?? null,
          type: safeEnum(transactionTypes, line.type), amountSatang: line.kind === "reduction" ? -line.amount : line.amount,
        }];
      });
    };
    const aRows = produces(args.metricA), bRows = produces(args.metricB);
    const grouped = new Map<string, { itemsA: MetricItem[]; itemsB: MetricItem[] }>();
    function add(items: MetricItem[], side: "itemsA" | "itemsB") {
      for (const item of items) {
        const key = keyOf(item.sourceType, item.sourceId, item.transactionId);
        const found = grouped.get(key) || { itemsA: [], itemsB: [] };
        found[side].push(item);
        grouped.set(key, found);
      }
    }
    add(aRows, "itemsA");
    add(bRows, "itemsB");
    const expectedVsActual = [args.metricA, args.metricB].includes("shiftActualOperatingCash") && [args.metricA, args.metricB].includes("shiftExpectedOperatingCash");
    const netVsGross = [args.metricA, args.metricB].includes("netRevenue") && [args.metricA, args.metricB].includes("grossRevenue");
    const cashInVsAllocation = [args.metricA, args.metricB].includes("operatingShiftCashIn") && cashAllocation;
    const evidenceRows = [...grouped].map(([key, group]) => {
      const rows = [...group.itemsA, ...group.itemsB];
      if (group.itemsA.length > 28 || group.itemsB.length > 28) throw new ToolError("LIMIT_EXCEEDED");
      const [one] = rows;
      const signedDifferenceSatang = addMoney(sum(group.itemsA, (r) => r.amountSatang), -sum(group.itemsB, (r) => r.amountSatang));
      const context = txns.get(key);
      let explanation: typeof explanationKinds[number] = "unresolved";
      if (signedDifferenceSatang === 0) explanation = "equal";
      else if (netVsGross && rows.some((r) => r.amountSatang < 0) && one.transactionId) explanation = "revenue_reduction";
      else if (!expectedVsActual && cashInVsAllocation && context && rows.length === 1) {
        const impact = cashImpact(context.txn);
        const isCashAllocation = lines.some((line) => line.kind === "allocation" && line.method === "Cash" &&
          line.day === one.metricBusinessDate && keyOf(line.sourceType, line.sourceId, line.transactionId) === key);
        if (impact.operatingCashInSatang === one.amountSatang) {
          // Only attribute a mismatch to timing when an identifier and exact money prove it.
          if (isCashAllocation) {
            if (!one.cashShiftId && one.paymentDate) explanation = "unassigned_operating_cash";
            else if (one.cashShiftBusinessDate && !between(one.cashShiftBusinessDate)) explanation = "cross_date_attribution";
          } else if (context.source.original.voided) explanation = "voided_booking_cash";
          else if (one.type === "depositKept" && one.paymentDate === null &&
            one.cashShiftBusinessDate && one.metricBusinessDate === one.cashShiftBusinessDate) explanation = "deposit_transfer";
          else {
            const date = one.revenueAttributionDate;
            if (date && !between(date)) {
              let same = relevantRevenue.get(key);
              if (same === undefined) {
                const d = windowFor({ startDate: date, endDate: date }, 1);
                same = buildTodayRevenueBreakdown([context.source.effective], d).finalizedPaymentMethods
                  .some((method) => method.paymentMethod === "Cash" && method.transactions.some((tx) =>
                    tx.transactionId === one.transactionId && satang(tx.amount) === one.amountSatang,
                  ));
                relevantRevenue.set(key, same);
              }
              if (same) explanation = "cross_date_attribution";
            }
          }
        }
      }
      return { ...group, sourceId: one.sourceId, transactionId: one.transactionId, signedDifferenceSatang, explanation };
    }).sort((a, b) => Math.abs(b.signedDifferenceSatang) - Math.abs(a.signedDifferenceSatang) ||
      a.sourceId.localeCompare(b.sourceId) || (a.transactionId ?? "").localeCompare(b.transactionId ?? ""));
    const evidence = page(evidenceRows, args);
    const totalASatang = sum(aRows, (r) => r.amountSatang);
    const totalBSatang = sum(bRows, (r) => r.amountSatang);
    const differenceSatang = addMoney(totalASatang, -totalBSatang);
    const explainedDifferenceSatang = sum(evidenceRows, (r) => r.explanation === "unresolved" ? 0 : r.signedDifferenceSatang);
    const unresolved = evidenceRows.some((row) => row.explanation === "unresolved" || (!row.transactionId && row.itemsA.concat(row.itemsB).some((r) => r.sourceType !== "cashShift")));
    if (unresolved) warnings.add("SOME_ITEMS_LACK_A_PROVEN_EXPLANATION_OR_TRANSACTION_ID");
    if (evidenceRows.length > 501) warnings.add("EVIDENCE_PAGINATION_CAPPED");
    return {
      period: span(window), metricA: args.metricA, metricB: args.metricB, definitionA: metricDefinitions[args.metricA],
      definitionB: metricDefinitions[args.metricB], totalASatang, totalBSatang, differenceSatang, explainedDifferenceSatang,
      residualUnexplainedSatang: addMoney(differenceSatang, -explainedDifferenceSatang),
      state: unresolved || [...warnings].some((w) => w !== "UNASSIGNED_CASH_EXCLUDED_FROM_SHIFT_TOTAL") ? "unresolved" as const : "reconciled" as const,
      warnings: [...warnings], evidence, evidenceCount: evidenceRows.length,
    };
  });
}
