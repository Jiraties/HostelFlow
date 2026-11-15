import { z } from "zod";
import { buildTodayRevenueBreakdown, type ExpectedStayRevenueBreakdownTransaction } from "../helpers/todayRevenueBreakdown";
import { occupancyFor, occupancySchema, identifier, safeEnum } from "./bookings";
import { addMoney, channels, date, dates, dateSpan, days, inWindow, methods, money, satang, span, sum, ToolError, transactionTypes, windowFor, type Window } from "./contracts";
import { cashImpact, effectivePayment, onReceipts, onRevenue, selectReceipts } from "./ledger";
import type { Register } from "./server";
import type { Reader } from "./store";

export const definitions = {
  grossRevenue: "HostelFlow Today's Revenue gross: accommodation at Bangkok commercial segment start (including attributed check-in rounding and retained cancellation/no-show value); qualifying extras on transaction date. Voided bookings excluded.",
  netRevenue: "Today's Revenue gross minus daily recognized reductions, excluding cancellation/no-show reductions already netted into retained value.",
  stayRevenueCashAllocation: "Today's Revenue payment-method breakdown Cash allocation, attributed to the revenue day. It is an allocation, not a receipt total. Some charges' allocation is net of linked reductions.",
  operatingShiftCashIn: "Effective operating-stash cash inflows assigned to shifts with business dates in the period; includes retained deposit transfers and excludes deposits held in the separate stash. Excludes unassigned cash.",
  operatingShiftCashOut: "Effective operating-stash cash outflows assigned to shifts with business dates in the period. Excludes separate deposit returns and unassigned cash.",
  payment: "Effective recorded payments at the original transaction timestamp in Bangkok. OTA entries are ledger records, not proof of bank remittance. Deposits and returns are separate; retained deposits are internal transfers. Voided bookings retain historical movements.",
};
const revenueShape = {
  accommodationRevenueSatang: money, serviceRevenueSatang: money, grossRevenueSatang: money,
  reductionsSatang: money, netRevenueSatang: money,
};
type RevenueTotals = z.infer<typeof revenueTotals>;
const revenueTotals = z.strictObject(revenueShape);
type RevenueLine = {
  day: string; kind: "accommodation" | "service" | "reduction" | "allocation"; amount: number;
  type: string | null; channel: string | null; method: string | null; transactionId: string | null;
  sourceType: "booking" | "standaloneSale"; sourceId: string;
};
const makeLine = (row: ExpectedStayRevenueBreakdownTransaction, day: string, kind: RevenueLine["kind"]): RevenueLine => {
  const sourceId = identifier(row.saleId || row.bookingId);
  if (!sourceId) throw new ToolError("DATA_INCOMPLETE");
  return {
    day, kind, sourceId, amount: satang(row.amount), type: safeEnum(transactionTypes, row.type),
    channel: safeEnum(channels, row.platformId), method: safeEnum(methods, row.paymentMethod),
    transactionId: identifier(row.transactionId), sourceType: row.sourceType === "standaloneSale" ? "standaloneSale" : "booking",
  };
};
export function amountsFor(lines: RevenueLine[]): RevenueTotals {
  const accommodationRevenueSatang = sum(lines, (row) => row.kind === "accommodation" ? row.amount : 0);
  const serviceRevenueSatang = sum(lines, (row) => row.kind === "service" ? row.amount : 0);
  const grossRevenueSatang = addMoney(accommodationRevenueSatang, serviceRevenueSatang);
  const reductionsSatang = sum(lines, (row) => row.kind === "reduction" ? row.amount : 0);
  return { accommodationRevenueSatang, serviceRevenueSatang, grossRevenueSatang, reductionsSatang,
    netRevenueSatang: addMoney(grossRevenueSatang, -reductionsSatang) };
}
export function revenueLines(sources: Awaited<ReturnType<typeof onRevenue>>, window: Window, signal: AbortSignal) {
  const records = sources.map((record) => record.effective);
  const lines: RevenueLine[] = [];
  for (const day of days(window)) {
    if (signal.aborted) throw new ToolError("CANCELLED");
    const result = buildTodayRevenueBreakdown(records, day);
    const contributions = result.finalizedCategories.flatMap((group) => group.transactions.map((row) =>
      makeLine(row, day.startDate, row.stayStartDate || row.type === "roomCharge" ? "accommodation" : "service"),
    ));
    const reductions = result.finalizedReductions.flatMap((group) => group.transactions.map((row) => makeLine(row, day.startDate, "reduction")));
    const allocations = result.finalizedPaymentMethods.flatMap((group) => group.transactions.map((row) => makeLine(row, day.startDate, "allocation")));
    if (amountsFor([...contributions, ...reductions]).netRevenueSatang !== satang(Number(result.todayRevenue.toFixed(2)))) {
      // Legacy bookings can retain value with no linkable charge. Never report an evidence-free total.
      throw new ToolError("DATA_INCOMPLETE");
    }
    lines.push(...contributions, ...reductions, ...allocations);
  }
  return lines;
}
export async function revenueFor(read: Reader, window: Window, signal: AbortSignal) {
  return revenueLines(await onRevenue(read, window), window, signal);
}
function weeklyKey(day: string) {
  const d = new Date(day + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}
const groups = <T>(items: T[], key: (item: T) => string) => {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const value = key(item);
    const existing = map.get(value);
    if (existing) existing.push(item);
    else map.set(value, [item]);
  }
  return [...map].sort(([a], [b]) => a.localeCompare(b));
};
const allocationSchema = z.strictObject({ paymentMethod: z.enum(methods), amountSatang: money });
function allocationsFor(lines: RevenueLine[]) {
  return methods.map((paymentMethod) => ({
    paymentMethod, amountSatang: sum(lines, (line) => line.kind === "allocation" && line.method === paymentMethod ? line.amount : 0),
  }));
}
const paymentTotals = z.strictObject({
  operatingReceiptsSatang: money, operatingRefundsAndOutflowsSatang: money, netOperatingPaymentsSatang: money,
  depositReceiptsSatang: money, depositReturnsSatang: money, depositTransfersToOperatingSatang: money,
  cashStashInSatang: money, cashStashOutSatang: money, transactionCount: z.int().nonnegative(),
});
const searchFilters = { channel: z.enum(channels).optional() };
export function registerReports(register: Register) {
  register("get_revenue_summary", "Report Today's Revenue using the Bangkok commercial segment start and service dates. The Cash allocation is distinct from payments and shift cash.", z.strictObject({
    ...dates, ...searchFilters, groupBy: z.enum(["day", "week", "month", "channel", "category", "paymentMethod"]).default("day"),
  }), z.strictObject({
    period: dateSpan, grossDefinition: z.string(), netDefinition: z.string(), cashAllocationDefinition: z.string(),
    totals: revenueTotals, methodAllocations: z.array(allocationSchema),
    groups: z.array(z.strictObject({ key: z.string(), ...revenueShape })).max(40),
  }), async (args, read, signal) => {
    const window = windowFor(args);
    const lines = (await revenueFor(read, window, signal)).filter((line) => !args.channel || (line.sourceType === "booking" && line.channel === args.channel));
    const main = lines.filter((line) => line.kind !== "allocation");
    const key = (row: RevenueLine) => ({
      day: row.day, week: weeklyKey(row.day), month: row.day.slice(0, 7), channel: row.sourceType === "standaloneSale" ? "standaloneSale" : (row.channel ?? "unknown"),
      category: row.type ?? "unknown",
    });
    return {
      period: span(window), grossDefinition: definitions.grossRevenue, netDefinition: definitions.netRevenue,
      cashAllocationDefinition: definitions.stayRevenueCashAllocation,
      totals: amountsFor(main), methodAllocations: allocationsFor(lines),
      groups: args.groupBy === "paymentMethod" ? [] : groups(main, (row) => key(row)[args.groupBy as Exclude<typeof args.groupBy, "paymentMethod">])
        .map(([key, rows]) => ({ key, ...amountsFor(rows) })),
    };
  });

  register("get_payment_summary", "Summarize recorded payments and refunds by actual Bangkok transaction date and method, separating deposits and internal cash transfers.", z.strictObject({
    ...dates, paymentMethod: z.enum(methods).exclude(["Unpaid"]).optional(),
  }), z.strictObject({
    period: dateSpan, definition: z.string(), byPaymentMethod: z.array(z.strictObject({
      method: z.enum(methods).exclude(["Unpaid"]), ...paymentTotals.shape,
    })), totals: paymentTotals, voidedBookingPaymentCount: z.int().nonnegative(),
  }), async (args, read) => {
    const w = windowFor(args);
    const sources = await onReceipts(read, w);
    const values = sources.flatMap((source) => selectReceipts(source, w).map((txn) => ({
      txn, source, signed: effectivePayment(txn), impact: cashImpact(txn),
    }))).filter(({ txn, signed }) => (!args.paymentMethod || txn.paymentMethod === args.paymentMethod) &&
      (signed !== 0 || txn.type === "depositKept" && txn.paymentMethod === "Cash"));
    const summarize = (rows: typeof values) => {
      const deposits = rows.filter(({ txn }) => txn.type === "deposit" || txn.type === "depositRefund");
      const operating = rows.filter(({ txn }) => !["deposit", "depositRefund", "depositKept"].includes(txn.type));
      return {
        operatingReceiptsSatang: sum(operating, (row) => Math.max(0, row.signed)),
        operatingRefundsAndOutflowsSatang: sum(operating, (row) => Math.max(0, -row.signed)),
        netOperatingPaymentsSatang: sum(operating, (row) => row.signed),
        depositReceiptsSatang: sum(deposits, (row) => Math.max(0, row.signed)),
        depositReturnsSatang: sum(deposits, (row) => Math.max(0, -row.signed)),
        depositTransfersToOperatingSatang: sum(rows, (row) => row.txn.type === "depositKept" ? row.impact.operatingCashInSatang : 0),
        cashStashInSatang: sum(rows, (row) => row.impact.operatingCashInSatang),
        cashStashOutSatang: sum(rows, (row) => row.impact.operatingCashOutSatang),
        transactionCount: rows.length,
      };
    };
    return {
      period: span(w), definition: definitions.payment, totals: summarize(values),
      byPaymentMethod: methods.filter((m): m is Exclude<typeof m, "Unpaid"> => m !== "Unpaid" && (!args.paymentMethod || args.paymentMethod === m))
        .map((method) => ({ method, ...summarize(values.filter(({ txn }) => txn.paymentMethod === method)) })),
      voidedBookingPaymentCount: values.filter(({ source, signed }) => source.original.voided && signed !== 0).length,
    };
  });

  const periodReport = z.strictObject({
    period: dateSpan, revenue: revenueTotals, occupancy: occupancySchema, scheduledBookingArrivals: z.int().nonnegative(),
    channelMix: z.array(z.strictObject({ channel: z.enum(channels).nullable(), bookingCount: z.int().nonnegative() })),
  });
  register("compare_periods", "Compare Today's Revenue, booked bed-night occupancy and non-void scheduled arrivals by original channel, excluding cancelled and no-show arrivals.", z.strictObject({
    first: dateSpan, second: dateSpan,
  }), z.strictObject({
    first: periodReport, second: periodReport,
    secondMinusFirst: z.strictObject({ netRevenueSatang: money, bookedOccupancyPercentagePoints: z.number(), scheduledBookingArrivals: z.int() }),
  }), async (args, read, signal) => {
    const periods = [windowFor(args.first), windowFor(args.second)];
    const calculate = async (w: Window) => {
      const [lines, occupancy, arrivals] = await Promise.all([
        revenueFor(read, w, signal), occupancyFor(read, w),
        read("occupancy", { checkIn: { $gte: w.start, $lt: w.end }, voided: { $ne: true }, status: { $in: ["booked", "checkedIn", "checkedOut"] } }),
      ]);
      const channelsToCounts = new Map<(typeof channels)[number] | null, number>();
      arrivals.forEach((record) => {
        if (!inWindow(record.checkIn, w)) return;
        const channel = safeEnum(channels, record.platformId);
        channelsToCounts.set(channel, (channelsToCounts.get(channel) ?? 0) + 1);
      });
      return { period: span(w), revenue: amountsFor(lines), occupancy, scheduledBookingArrivals: arrivals.length,
        channelMix: Array.from(channelsToCounts, ([channel, bookingCount]) => ({ channel, bookingCount })) };
    };
    const first = await calculate(periods[0]);
    const second = await calculate(periods[1]);
    return {
      first, second, secondMinusFirst: {
        netRevenueSatang: addMoney(second.revenue.netRevenueSatang, -first.revenue.netRevenueSatang),
        bookedOccupancyPercentagePoints: (second.occupancy.occupancyRate - first.occupancy.occupancyRate) * 100,
        scheduledBookingArrivals: second.scheduledBookingArrivals - first.scheduledBookingArrivals,
      },
    };
  });
}
