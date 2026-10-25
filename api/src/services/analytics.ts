import type { booking } from "../models/booking";
import { activeRoomInventory } from "../config/roomInventory";
import { getRoomStayRoomIds } from "../helpers/roomStayHelpers";
import { summarizeExpectedStayRevenue, type ExpectedStayRevenueEntry } from "../helpers/expectedStayRevenueHelpers";
import { occupancySummaryForRange, type OccupancyRoomBlock } from "../helpers/occupancyHelpers";
import { BUSINESS_DAY_MS, businessDateKey, businessDateStart, businessMonthBounds, shiftBusinessMonth } from "../helpers/businessDateHelpers";

const money = (value: number) => Number(value.toFixed(2));
const percent = (value: number) => Number((value * 100).toFixed(2));
export const percentageChange = (value: number, previous: number) =>
  previous === 0 ? (value === 0 ? 0 : null) : Number(((value - previous) / Math.abs(previous) * 100).toFixed(1));
const channelNames: Record<string, string> = {
  BOOK: "Booking.com", HOST: "Hostelworld", WALK: "Walk-In", TRAV: "Traveloka", AGOD: "Agoda",
};
const inventory = activeRoomInventory();
const capacity = inventory.reduce((sum, room) => sum + room.capacity, 0);
const privateIds = new Set(["Balcony", "Window", "Pottery 1", "Pottery 2"]);

/** Full-month ESR, matching the existing financial drilldown, never cash receipts. */
const revenueForMonth = (records: booking[], month: string) => {
  const { start, end } = businessMonthBounds(month)!;
  return summarizeExpectedStayRevenue(records, start, end);
};

const channelSummary = (entries: ExpectedStayRevenueEntry[]) => {
  const channels = new Map<string, { ids: Set<string>; revenue: number; nights: number }>();
  entries.forEach((entry) => {
    const id = entry.segment.platformId;
    const channel = channels.get(id) ?? { ids: new Set<string>(), revenue: 0, nights: 0 };
    channel.ids.add(entry.booking.bookingId);
    channel.revenue += entry.expectedRevenue;
    const plannedEnd = businessDateStart(new Date(entry.segment.to));
    const checkoutEnd = entry.booking.checkout?.earlyCheckOut && entry.booking.checkout.checkedOutAt
      ? businessDateStart(new Date(entry.booking.checkout.checkedOutAt)) : plannedEnd;
    const effectiveEnd = checkoutEnd < plannedEnd ? checkoutEnd : plannedEnd;
    channel.nights += Math.max(0, (effectiveEnd.getTime() - businessDateStart(new Date(entry.segment.from)).getTime()) / BUSINESS_DAY_MS);
    channels.set(id, channel);
  });
  return channels;
};

/** No per-room prices are recorded. Allocate mixed-inventory charges by capacity-nights. */
const inventoryRevenue = (entries: ExpectedStayRevenueEntry[]) => {
  const totals = { dorm: 0, private: 0, unallocated: 0 };
  entries.forEach((entry) => {
    let dorm = 0;
    let privateWeight = 0;
    const start = new Date(entry.segment.from).getTime();
    const end = new Date(entry.segment.to).getTime();
    for (let day = start; day < end; day += BUSINESS_DAY_MS) {
      const ids = new Set((entry.booking.roomStays || []).flatMap((stay) =>
        new Date(stay.from).getTime() < Math.min(day + BUSINESS_DAY_MS, end) && new Date(stay.to).getTime() > day
          ? getRoomStayRoomIds(stay) : []));
      ids.forEach((id) => {
        const room = inventory.find((item) => item.id === id);
        if (!room) return;
        const weight = room.capacity * Math.min(BUSINESS_DAY_MS, end - day) / BUSINESS_DAY_MS;
        if (privateIds.has(id)) privateWeight += weight;
        else dorm += weight;
      });
    }
    const total = dorm + privateWeight;
    if (!total) totals.unallocated += entry.expectedRevenue;
    else {
      const dormAmount = money(entry.expectedRevenue * dorm / total);
      totals.dorm += dormAmount;
      totals.private += entry.expectedRevenue - dormAmount;
    }
  });
  return { dorm: money(totals.dorm), private: money(totals.private), unallocated: money(totals.unallocated) };
};

export const buildAnalytics = (records: booking[], blocks: OccupancyRoomBlock[], month: string, now = new Date()) => {
  const bounds = businessMonthBounds(month);
  if (!bounds) throw new Error("Invalid analytics month");
  const { start, end } = bounds;
  const previousMonth = shiftBusinessMonth(month, -1);
  const previousBounds = businessMonthBounds(previousMonth)!;
  const nextMonth = shiftBusinessMonth(month, 1);
  const nextBounds = businessMonthBounds(nextMonth)!;
  const summary = revenueForMonth(records, month);
  const previous = revenueForMonth(records, previousMonth);
  const occupancy = occupancySummaryForRange(records, start, end, blocks);
  const priorOccupancy = occupancySummaryForRange(records, previousBounds.start, previousBounds.end, blocks);
  const roomRevenue = money(summary.entries.reduce((sum, entry) => sum + entry.expectedRevenue, 0));
  const priorRoomRevenue = money(previous.entries.reduce((sum, entry) => sum + entry.expectedRevenue, 0));
  const revpab = money(roomRevenue / occupancy.availableBedNights);
  const priorRevpab = money(priorRoomRevenue / priorOccupancy.availableBedNights);
  const revenueByDay = new Map<string, number>();
  [...summary.entries, ...summary.serviceEntries].forEach((entry) => {
    const key = businessDateKey(entry.start);
    revenueByDay.set(key, (revenueByDay.get(key) ?? 0) + entry.expectedRevenue);
  });
  const dailyTrend: { date: string; revenue: number; occupancy: number }[] = [];
  for (let time = start.getTime(); time < end.getTime(); time += BUSINESS_DAY_MS) {
    const date = new Date(time);
    const key = businessDateKey(date);
    dailyTrend.push({ date: key, revenue: money(revenueByDay.get(key) ?? 0), occupancy: percent(occupancySummaryForRange(records, date, new Date(time + BUSINESS_DAY_MS), blocks).occupancyRate) });
  }
  const currentChannels = channelSummary(summary.entries);
  const priorChannels = channelSummary(previous.entries);
  const channels = [...new Set([...Object.keys(channelNames), ...currentChannels.keys()])].map((id) => {
    const channel = currentChannels.get(id);
    const bookings = channel?.ids.size ?? 0;
    return { id, name: channelNames[id] ?? id, bookings, revenue: money(channel?.revenue ?? 0), averageNights: bookings ? Number(((channel?.nights ?? 0) / bookings).toFixed(1)) : 0, change: percentageChange(bookings, priorChannels.get(id)?.ids.size ?? 0) };
  });
  const allocated = inventoryRevenue(summary.entries);
  const priorAllocated = inventoryRevenue(previous.entries);
  const inventoryPerformance = (["dorm", "private"] as const).map((id) => {
    const rooms = inventory.filter((room) => privateIds.has(room.id) === (id === "private"));
    const current = occupancySummaryForRange(records, start, end, blocks, rooms);
    const prior = occupancySummaryForRange(records, previousBounds.start, previousBounds.end, blocks, rooms);
    const days = (end.getTime() - start.getTime()) / BUSINESS_DAY_MS;
    const priorDays = (previousBounds.end.getTime() - previousBounds.start.getTime()) / BUSINESS_DAY_MS;
    const availableNights = id === "private" ? rooms.length * days : current.availableBedNights;
    const priorAvailableNights = id === "private" ? rooms.length * priorDays : prior.availableBedNights;
    const rate = money(allocated[id] / availableNights);
    const priorRate = money(priorAllocated[id] / priorAvailableNights);
    const trend = dailyTrend.map((day) => ({ date: day.date, value: percent(occupancySummaryForRange(records, new Date(`${day.date}T00:00:00+07:00`), new Date(new Date(`${day.date}T00:00:00+07:00`).getTime() + BUSINESS_DAY_MS), blocks, rooms).occupancyRate) }));
    return { id, name: id === "private" ? "Private Room" : "Dormitory", occupancy: percent(current.occupancyRate), revenue: allocated[id], rateLabel: id === "private" ? "RevPAR" : "RevPAB", rate, changes: [Number((percent(current.occupancyRate) - percent(prior.occupancyRate)).toFixed(1)), percentageChange(allocated[id], priorAllocated[id]), percentageChange(rate, priorRate)], trend };
  });
  const serviceTours = summary.serviceEntries.filter((entry) => ["slowBoat", "joinTour", "trek2D", "onlyWalk"].includes(entry.transaction.type)).reduce((sum, entry) => sum + entry.expectedRevenue, 0);
  const baseCharges = (kind: "original" | "extension") => money(summary.entries.filter((entry) => entry.segment.kind === kind).reduce((sum, entry) => sum + entry.grossRevenue - entry.chargeAdjustments.reduce((total, adjustment) => total + adjustment.amount, 0), 0));
  const chargeAdjustments = summary.entries.reduce((sum, entry) => sum + entry.chargeAdjustments.reduce((total, adjustment) => total + adjustment.amount, 0), 0);
  const revenueGroups = [
    { label: "Accommodation", amount: baseCharges("original"), color: "#67cbd5", groupKey: "roomCharge-original" },
    { label: "Extensions (Extra Nights)", amount: baseCharges("extension"), color: "#94d4ef", groupKey: "roomCharge-extension" },
    { label: "Slow Boat / Tours", amount: money(serviceTours), color: "#f7c782", groupKey: null },
    { label: "Other Services", amount: money(summary.grossServiceRevenue - serviceTours), color: "#b7a1e8", groupKey: null },
    { label: "Refunds / Adjustments", amount: money(chargeAdjustments - summary.reductions), color: "#e791b1", groupKey: null },
  ];
  const outlook = [
    { title: "Next Month", start: nextBounds.start, end: nextBounds.end },
    ...[30, 60, 90].map((days) => ({ title: `${days} Days`, start: end, end: new Date(end.getTime() + days * BUSINESS_DAY_MS) })),
  ].map((period) => {
    const totalDays = (period.end.getTime() - period.start.getTime()) / BUSINESS_DAY_MS;
    const bars = Array.from({ length: 7 }, (_, index) => {
      const from = new Date(period.start.getTime() + Math.floor(index * totalDays / 7) * BUSINESS_DAY_MS);
      const to = new Date(period.start.getTime() + Math.floor((index + 1) * totalDays / 7) * BUSINESS_DAY_MS);
      return percent(occupancySummaryForRange(records, from, to, blocks).occupancyRate);
    });
    return { title: period.title, startDate: businessDateKey(period.start), endDate: businessDateKey(new Date(period.end.getTime() - BUSINESS_DAY_MS)), occupancy: percent(occupancySummaryForRange(records, period.start, period.end, blocks).occupancyRate), bars };
  });
  return {
    month, previousMonth, nextMonth, generatedAt: now.toISOString(), capacity,
    revenueBasis: "expected-stay-revenue" as const,
    stats: {
      stayRevenue: summary.expectedStayRevenue, outstandingBalance: summary.unpaidRevenue, occupancy: percent(occupancy.occupancyRate), revpab, forwardOccupancy: outlook[0].occupancy,
      changes: { stayRevenue: percentageChange(summary.expectedStayRevenue, previous.expectedStayRevenue), outstandingBalance: percentageChange(summary.unpaidRevenue, previous.unpaidRevenue), occupancy: Number((percent(occupancy.occupancyRate) - percent(priorOccupancy.occupancyRate)).toFixed(1)), revpab: percentageChange(revpab, priorRevpab) },
    },
    dailyTrend, channels, inventory: inventoryPerformance, unallocatedRoomRevenue: allocated.unallocated, revenueGroups, totalRevenue: summary.expectedStayRevenue, outlook,
  };
};
