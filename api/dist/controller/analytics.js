"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAnalytics = void 0;
const booking_1 = __importDefault(require("../models/booking"));
const standaloneSale_1 = __importDefault(require("../models/standaloneSale"));
const roomBlock_1 = __importDefault(require("../models/roomBlock"));
const businessDateHelpers_1 = require("../helpers/businessDateHelpers");
const expectedStayRevenueHelpers_1 = require("../helpers/expectedStayRevenueHelpers");
const analytics_1 = require("../services/analytics");
const getAnalytics = async (req, res) => {
    // Same financial visibility as the existing monthly revenue drilldown.
    if (!req.user?.admin)
        return res.status(403).json({ message: "เฉพาะผู้ดูแลระบบเท่านั้นที่สามารถดู Analytics ได้" });
    const month = req.query.month === undefined ? (0, businessDateHelpers_1.businessDateKey)(new Date()).slice(0, 7) : req.query.month;
    if (typeof month !== "string" || !(0, businessDateHelpers_1.businessMonthBounds)(month) || month < "1901-01" || month > "9997-12") {
        return res.status(400).json({ message: "กรุณาระบุเดือนในรูปแบบ YYYY-MM" });
    }
    const { end } = (0, businessDateHelpers_1.businessMonthBounds)(month);
    const { start } = (0, businessDateHelpers_1.businessMonthBounds)((0, businessDateHelpers_1.shiftBusinessMonth)(month, -1));
    const nextMonthEnd = (0, businessDateHelpers_1.businessMonthBounds)((0, businessDateHelpers_1.shiftBusinessMonth)(month, 1)).end;
    const outlookEnd = new Date(Math.max(end.getTime() + 90 * businessDateHelpers_1.BUSINESS_DAY_MS, nextMonthEnd.getTime()));
    try {
        const [bookings, sales, blocks] = await Promise.all([
            booking_1.default.find({ $or: [(0, expectedStayRevenueHelpers_1.expectedStayRevenueBookingQuery)(start, end), { roomStays: { $elemMatch: { from: { $lt: outlookEnd }, to: { $gt: start } } } }] })
                .select("bookingId platformId status voided checkIn checkOut roomStays commercialSegments transactions transactionCorrections checkout")
                .maxTimeMS(10000).lean(),
            standaloneSale_1.default.find({ transactions: { $elemMatch: { type: { $in: expectedStayRevenueHelpers_1.EXPECTED_STAY_REVENUE_SERVICE_TYPES }, createdAt: { $gte: start, $lt: end } } } })
                .select("saleId transactions").maxTimeMS(10000).lean(),
            roomBlock_1.default.find({ from: { $lt: outlookEnd }, to: { $gt: start } })
                .select("roomId roomIds from to reason reasonType releasedAt").maxTimeMS(10000).lean(),
        ]);
        const standaloneRecords = sales.map((sale) => ({ bookingId: sale.saleId, platformId: "WALK", checkIn: new Date(0), checkOut: new Date(0), transactions: sale.transactions, roomStays: [], commercialSegments: [], status: "checkedOut" }));
        res.setHeader("Cache-Control", "no-store");
        return res.json((0, analytics_1.buildAnalytics)([...bookings, ...standaloneRecords], blocks, month));
    }
    catch {
        return res.status(500).json({ message: "ไม่สามารถโหลดข้อมูล Analytics ได้ กรุณาลองใหม่อีกครั้ง" });
    }
};
exports.getAnalytics = getAnalytics;
//# sourceMappingURL=analytics.js.map