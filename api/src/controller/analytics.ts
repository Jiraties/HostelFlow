import type { Request, Response } from "express";
import Booking, { type booking } from "../models/booking";
import StandaloneSale from "../models/standaloneSale";
import RoomBlock from "../models/roomBlock";
import { businessDateKey, businessMonthBounds, BUSINESS_DAY_MS, shiftBusinessMonth } from "../helpers/businessDateHelpers";
import { expectedStayRevenueBookingQuery, EXPECTED_STAY_REVENUE_SERVICE_TYPES } from "../helpers/expectedStayRevenueHelpers";
import { buildAnalytics } from "../services/analytics";

export const getAnalytics = async (req: Request, res: Response) => {
  // Same financial visibility as the existing monthly revenue drilldown.
  if (!req.user?.admin) return res.status(403).json({ message: "เฉพาะผู้ดูแลระบบเท่านั้นที่สามารถดู Analytics ได้" });
  const month = req.query.month === undefined ? businessDateKey(new Date()).slice(0, 7) : req.query.month;
  if (typeof month !== "string" || !businessMonthBounds(month) || month < "1901-01" || month > "9997-12") {
    return res.status(400).json({ message: "กรุณาระบุเดือนในรูปแบบ YYYY-MM" });
  }
  const { end } = businessMonthBounds(month)!;
  const { start } = businessMonthBounds(shiftBusinessMonth(month, -1))!;
  const nextMonthEnd = businessMonthBounds(shiftBusinessMonth(month, 1))!.end;
  const outlookEnd = new Date(Math.max(end.getTime() + 90 * BUSINESS_DAY_MS, nextMonthEnd.getTime()));
  try {
    const [bookings, sales, blocks] = await Promise.all([
      Booking.find({ $or: [expectedStayRevenueBookingQuery(start, end), { roomStays: { $elemMatch: { from: { $lt: outlookEnd }, to: { $gt: start } } } }] })
        .select("bookingId platformId status voided checkIn checkOut roomStays commercialSegments transactions transactionCorrections checkout")
        .maxTimeMS(10000).lean<booking[]>(),
      StandaloneSale.find({ transactions: { $elemMatch: { type: { $in: EXPECTED_STAY_REVENUE_SERVICE_TYPES }, createdAt: { $gte: start, $lt: end } } } })
        .select("saleId transactions").maxTimeMS(10000).lean(),
      RoomBlock.find({ from: { $lt: outlookEnd }, to: { $gt: start } })
        .select("roomId roomIds from to reason reasonType releasedAt").maxTimeMS(10000).lean(),
    ]);
    const standaloneRecords = sales.map((sale) => ({ bookingId: sale.saleId, platformId: "WALK", checkIn: new Date(0), checkOut: new Date(0), transactions: sale.transactions, roomStays: [], commercialSegments: [], status: "checkedOut" } as unknown as booking));
    res.setHeader("Cache-Control", "no-store");
    return res.json(buildAnalytics([...bookings, ...standaloneRecords], blocks, month));
  } catch {
    return res.status(500).json({ message: "ไม่สามารถโหลดข้อมูล Analytics ได้ กรุณาลองใหม่อีกครั้ง" });
  }
};
