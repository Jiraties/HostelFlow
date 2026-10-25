"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildAnalytics = exports.percentageChange = void 0;
const roomInventory_1 = require("../config/roomInventory");
const roomStayHelpers_1 = require("../helpers/roomStayHelpers");
const expectedStayRevenueHelpers_1 = require("../helpers/expectedStayRevenueHelpers");
const occupancyHelpers_1 = require("../helpers/occupancyHelpers");
const businessDateHelpers_1 = require("../helpers/businessDateHelpers");
const money = (value) => Number(value.toFixed(2));
const percent = (value) => Number((value * 100).toFixed(2));
const percentageChange = (value, previous) => previous === 0 ? (value === 0 ? 0 : null) : Number(((value - previous) / Math.abs(previous) * 100).toFixed(1));
exports.percentageChange = percentageChange;
const channelNames = {
    BOOK: "Booking.com", HOST: "Hostelworld", WALK: "Walk-In", TRAV: "Traveloka", AGOD: "Agoda",
};
const inventory = (0, roomInventory_1.activeRoomInventory)();
const capacity = inventory.reduce((sum, room) => sum + room.capacity, 0);
const privateIds = new Set(["Balcony", "Window", "Pottery 1", "Pottery 2"]);
/** Full-month ESR, matching the existing financial drilldown, never cash receipts. */
const revenueForMonth = (records, month) => {
    const { start, end } = (0, businessDateHelpers_1.businessMonthBounds)(month);
    return (0, expectedStayRevenueHelpers_1.summarizeExpectedStayRevenue)(records, start, end);
};
const channelSummary = (entries) => {
    const channels = new Map();
    entries.forEach((entry) => {
        const id = entry.segment.platformId;
        const channel = channels.get(id) ?? { ids: new Set(), revenue: 0, nights: 0 };
        channel.ids.add(entry.booking.bookingId);
        channel.revenue += entry.expectedRevenue;
        const plannedEnd = (0, businessDateHelpers_1.businessDateStart)(new Date(entry.segment.to));
        const checkoutEnd = entry.booking.checkout?.earlyCheckOut && entry.booking.checkout.checkedOutAt
            ? (0, businessDateHelpers_1.businessDateStart)(new Date(entry.booking.checkout.checkedOutAt)) : plannedEnd;
        const effectiveEnd = checkoutEnd < plannedEnd ? checkoutEnd : plannedEnd;
        channel.nights += Math.max(0, (effectiveEnd.getTime() - (0, businessDateHelpers_1.businessDateStart)(new Date(entry.segment.from)).getTime()) / businessDateHelpers_1.BUSINESS_DAY_MS);
        channels.set(id, channel);
    });
    return channels;
};
/** No per-room prices are recorded. Allocate mixed-inventory charges by capacity-nights. */
const inventoryRevenue = (entries) => {
    const totals = { dorm: 0, private: 0, unallocated: 0 };
    entries.forEach((entry) => {
        let dorm = 0;
        let privateWeight = 0;
        const start = new Date(entry.segment.from).getTime();
        const end = new Date(entry.segment.to).getTime();
        for (let day = start; day < end; day += businessDateHelpers_1.BUSINESS_DAY_MS) {
            const ids = new Set((entry.booking.roomStays || []).flatMap((stay) => new Date(stay.from).getTime() < Math.min(day + businessDateHelpers_1.BUSINESS_DAY_MS, end) && new Date(stay.to).getTime() > day
                ? (0, roomStayHelpers_1.getRoomStayRoomIds)(stay) : []));
            ids.forEach((id) => {
                const room = inventory.find((item) => item.id === id);
                if (!room)
                    return;
                const weight = room.capacity * Math.min(businessDateHelpers_1.BUSINESS_DAY_MS, end - day) / businessDateHelpers_1.BUSINESS_DAY_MS;
                if (privateIds.has(id))
                    privateWeight += weight;
                else
                    dorm += weight;
            });
        }
        const total = dorm + privateWeight;
        if (!total)
            totals.unallocated += entry.expectedRevenue;
        else {
            const dormAmount = money(entry.expectedRevenue * dorm / total);
            totals.dorm += dormAmount;
            totals.private += entry.expectedRevenue - dormAmount;
        }
    });
    return { dorm: money(totals.dorm), private: money(totals.private), unallocated: money(totals.unallocated) };
};
const buildAnalytics = (records, blocks, month, now = new Date()) => {
    const bounds = (0, businessDateHelpers_1.businessMonthBounds)(month);
    if (!bounds)
        throw new Error("Invalid analytics month");
    const { start, end } = bounds;
    const previousMonth = (0, businessDateHelpers_1.shiftBusinessMonth)(month, -1);
    const previousBounds = (0, businessDateHelpers_1.businessMonthBounds)(previousMonth);
    const nextMonth = (0, businessDateHelpers_1.shiftBusinessMonth)(month, 1);
    const nextBounds = (0, businessDateHelpers_1.businessMonthBounds)(nextMonth);
    const summary = revenueForMonth(records, month);
    const previous = revenueForMonth(records, previousMonth);
    const occupancy = (0, occupancyHelpers_1.occupancySummaryForRange)(records, start, end, blocks);
    const priorOccupancy = (0, occupancyHelpers_1.occupancySummaryForRange)(records, previousBounds.start, previousBounds.end, blocks);
    const roomRevenue = money(summary.entries.reduce((sum, entry) => sum + entry.expectedRevenue, 0));
    const priorRoomRevenue = money(previous.entries.reduce((sum, entry) => sum + entry.expectedRevenue, 0));
    const revpab = money(roomRevenue / occupancy.availableBedNights);
    const priorRevpab = money(priorRoomRevenue / priorOccupancy.availableBedNights);
    const revenueByDay = new Map();
    [...summary.entries, ...summary.serviceEntries].forEach((entry) => {
        const key = (0, businessDateHelpers_1.businessDateKey)(entry.start);
        revenueByDay.set(key, (revenueByDay.get(key) ?? 0) + entry.expectedRevenue);
    });
    const dailyTrend = [];
    for (let time = start.getTime(); time < end.getTime(); time += businessDateHelpers_1.BUSINESS_DAY_MS) {
        const date = new Date(time);
        const key = (0, businessDateHelpers_1.businessDateKey)(date);
        dailyTrend.push({ date: key, revenue: money(revenueByDay.get(key) ?? 0), occupancy: percent((0, occupancyHelpers_1.occupancySummaryForRange)(records, date, new Date(time + businessDateHelpers_1.BUSINESS_DAY_MS), blocks).occupancyRate) });
    }
    const currentChannels = channelSummary(summary.entries);
    const priorChannels = channelSummary(previous.entries);
    const channels = [...new Set([...Object.keys(channelNames), ...currentChannels.keys()])].map((id) => {
        const channel = currentChannels.get(id);
        const bookings = channel?.ids.size ?? 0;
        return { id, name: channelNames[id] ?? id, bookings, revenue: money(channel?.revenue ?? 0), averageNights: bookings ? Number(((channel?.nights ?? 0) / bookings).toFixed(1)) : 0, change: (0, exports.percentageChange)(bookings, priorChannels.get(id)?.ids.size ?? 0) };
    });
    const allocated = inventoryRevenue(summary.entries);
    const priorAllocated = inventoryRevenue(previous.entries);
    const inventoryPerformance = ["dorm", "private"].map((id) => {
        const rooms = inventory.filter((room) => privateIds.has(room.id) === (id === "private"));
        const current = (0, occupancyHelpers_1.occupancySummaryForRange)(records, start, end, blocks, rooms);
        const prior = (0, occupancyHelpers_1.occupancySummaryForRange)(records, previousBounds.start, previousBounds.end, blocks, rooms);
        const days = (end.getTime() - start.getTime()) / businessDateHelpers_1.BUSINESS_DAY_MS;
        const priorDays = (previousBounds.end.getTime() - previousBounds.start.getTime()) / businessDateHelpers_1.BUSINESS_DAY_MS;
        const availableNights = id === "private" ? rooms.length * days : current.availableBedNights;
        const priorAvailableNights = id === "private" ? rooms.length * priorDays : prior.availableBedNights;
        const rate = money(allocated[id] / availableNights);
        const priorRate = money(priorAllocated[id] / priorAvailableNights);
        const trend = dailyTrend.map((day) => ({ date: day.date, value: percent((0, occupancyHelpers_1.occupancySummaryForRange)(records, new Date(`${day.date}T00:00:00+07:00`), new Date(new Date(`${day.date}T00:00:00+07:00`).getTime() + businessDateHelpers_1.BUSINESS_DAY_MS), blocks, rooms).occupancyRate) }));
        return { id, name: id === "private" ? "Private Room" : "Dormitory", occupancy: percent(current.occupancyRate), revenue: allocated[id], rateLabel: id === "private" ? "RevPAR" : "RevPAB", rate, changes: [Number((percent(current.occupancyRate) - percent(prior.occupancyRate)).toFixed(1)), (0, exports.percentageChange)(allocated[id], priorAllocated[id]), (0, exports.percentageChange)(rate, priorRate)], trend };
    });
    const serviceTours = summary.serviceEntries.filter((entry) => ["slowBoat", "joinTour", "trek2D", "onlyWalk"].includes(entry.transaction.type)).reduce((sum, entry) => sum + entry.expectedRevenue, 0);
    const baseCharges = (kind) => money(summary.entries.filter((entry) => entry.segment.kind === kind).reduce((sum, entry) => sum + entry.grossRevenue - entry.chargeAdjustments.reduce((total, adjustment) => total + adjustment.amount, 0), 0));
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
        ...[30, 60, 90].map((days) => ({ title: `${days} Days`, start: end, end: new Date(end.getTime() + days * businessDateHelpers_1.BUSINESS_DAY_MS) })),
    ].map((period) => {
        const totalDays = (period.end.getTime() - period.start.getTime()) / businessDateHelpers_1.BUSINESS_DAY_MS;
        const bars = Array.from({ length: 7 }, (_, index) => {
            const from = new Date(period.start.getTime() + Math.floor(index * totalDays / 7) * businessDateHelpers_1.BUSINESS_DAY_MS);
            const to = new Date(period.start.getTime() + Math.floor((index + 1) * totalDays / 7) * businessDateHelpers_1.BUSINESS_DAY_MS);
            return percent((0, occupancyHelpers_1.occupancySummaryForRange)(records, from, to, blocks).occupancyRate);
        });
        return { title: period.title, startDate: (0, businessDateHelpers_1.businessDateKey)(period.start), endDate: (0, businessDateHelpers_1.businessDateKey)(new Date(period.end.getTime() - businessDateHelpers_1.BUSINESS_DAY_MS)), occupancy: percent((0, occupancyHelpers_1.occupancySummaryForRange)(records, period.start, period.end, blocks).occupancyRate), bars };
    });
    return {
        month, previousMonth, nextMonth, generatedAt: now.toISOString(), capacity,
        revenueBasis: "expected-stay-revenue",
        stats: {
            stayRevenue: summary.expectedStayRevenue, outstandingBalance: summary.unpaidRevenue, occupancy: percent(occupancy.occupancyRate), revpab, forwardOccupancy: outlook[0].occupancy,
            changes: { stayRevenue: (0, exports.percentageChange)(summary.expectedStayRevenue, previous.expectedStayRevenue), outstandingBalance: (0, exports.percentageChange)(summary.unpaidRevenue, previous.unpaidRevenue), occupancy: Number((percent(occupancy.occupancyRate) - percent(priorOccupancy.occupancyRate)).toFixed(1)), revpab: (0, exports.percentageChange)(revpab, priorRevpab) },
        },
        dailyTrend, channels, inventory: inventoryPerformance, unallocatedRoomRevenue: allocated.unallocated, revenueGroups, totalRevenue: summary.expectedStayRevenue, outlook,
    };
};
exports.buildAnalytics = buildAnalytics;
//# sourceMappingURL=analytics.js.map