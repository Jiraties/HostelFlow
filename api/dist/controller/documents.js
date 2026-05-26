"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getBookingsReport = void 0;
const exceljs_1 = __importDefault(require("exceljs"));
const booking_1 = __importDefault(require("../models/booking"));
const platformMap = {
    BOOK: { label: "Booking.com", color: "003580" },
    HOST: { label: "Hostelworld", color: "F15A24" },
    AGOD: { label: "Agoda", color: "19AC5B" },
    TRAV: { label: "Traveloka", color: "00ADEF" },
    WALK: { label: "Walk-In", color: "F12424" },
};
const transactionMap = {
    deposit: "รับมัดจำ",
    adjustment: "ปรับราคา",
    depositRefund: "คืนมัดจำ",
    cancellationRefund: "คืนเงินยกเลิก",
    towel: "ผ้าเช็ดตัว",
    motorbike: "มอเตอร์ไซค์",
    slowBoat: "Slow Boat",
    joinTour: "Join Tour",
    extraBed: "เตียงเสริม",
    cardSurcharge: "ค่าธรรมเนียมบัตร 3%",
};
const statusMap = {
    booked: {
        label: "ยังไม่ Check-In",
        backgroundColor: "FFFDECEF",
        textColor: "FFFD4169",
    },
    checkedIn: {
        label: "Check-In แล้ว",
        backgroundColor: "FFE9FAF3",
        textColor: "FF1ECB83",
    },
    checkedOut: {
        label: "Check-Out แล้ว",
        backgroundColor: "FFFFF2E6",
        textColor: "FFFFA500",
    },
    cancelled: {
        label: "ถูกยกเลิก",
        backgroundColor: "FFFEE2E2",
        textColor: "FFDC2626",
    },
};
const formatInputDate = (date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1);
    const day = String(date.getDate());
    return `${year}/${month}/${day}`;
};
const transactionTotal = (transactions, type) => transactions
    .filter((transaction) => !type || transaction.type === type)
    .reduce((sum, transaction) => sum + (transaction.amount || 0), 0);
const cellBorder = {
    top: { style: "thin", color: { argb: "FFE5E7EB" } },
    left: { style: "thin", color: { argb: "FFE5E7EB" } },
    bottom: { style: "thin", color: { argb: "FFE5E7EB" } },
    right: { style: "thin", color: { argb: "FFE5E7EB" } },
};
const applyRowSpacing = (row) => {
    row.height = 24;
    row.eachCell((cell) => {
        cell.alignment = { vertical: "middle" };
        cell.border = cellBorder;
    });
};
const makeCellBold = (row, key) => {
    const cell = row.getCell(key);
    cell.font = { ...cell.font, bold: true };
};
const applyImportantCellStyle = (row) => {
    ["name", "rooms", "roomCharge", "total", "paymentMethods"].forEach((key) => makeCellBold(row, key));
};
const applyStatusCellStyle = (row, status) => {
    const statusMeta = statusMap[status];
    const statusCell = row.getCell("status");
    if (!statusMeta)
        return;
    statusCell.value = statusMeta.label;
    statusCell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: statusMeta.backgroundColor },
    };
    statusCell.font = { color: { argb: statusMeta.textColor }, bold: true };
    statusCell.alignment = { vertical: "middle", horizontal: "center" };
};
const getBookingsReport = async (req, res) => {
    try {
        const month = req.query.month;
        const bookingChannel = req.query.bookingChannel;
        const bookingStatus = req.query.bookingStatus;
        const paymentMethod = req.query.paymentMethod;
        if (!/^\d{4}-\d{2}$/.test(month)) {
            return res.status(400).json({ message: "Invalid month format" });
        }
        const [year, monthNumber] = month.split("-").map(Number);
        const firstDayOfNextMonth = new Date(year, monthNumber, 1);
        const firstDayOfMonth = new Date(year, monthNumber - 1, 1);
        const query = {
            checkIn: { $lt: firstDayOfNextMonth },
            checkOut: { $gt: firstDayOfMonth },
        };
        if (bookingChannel) {
            query.platformId = bookingChannel;
        }
        if (bookingStatus && bookingStatus !== "all") {
            query.status = bookingStatus;
        }
        if (paymentMethod && paymentMethod !== "all") {
            query["transactions.paymentMethod"] = paymentMethod;
        }
        const bookings = await booking_1.default.find(query).sort({
            checkIn: 1,
            name: 1,
        });
        if (!bookings)
            return res.status(400).json({ message: "ไมพบการจอง" });
        const workbook = new exceljs_1.default.Workbook();
        const sheet = workbook.addWorksheet("Bookings");
        sheet.columns = [
            { header: "Booking ID", key: "bookingId", width: 18 },
            { header: "วันที่เข้า", key: "checkIn", width: 14 },
            { header: "วันที่ออก", key: "checkOut", width: 14 },
            { header: "คืน", key: "nights", width: 8 },
            { header: "ชื่อแขก", key: "name", width: 28 },
            { header: "จองจาก", key: "platformId", width: 12 },
            { header: "สถานะ", key: "status", width: 14 },
            { header: "ห้อง", key: "rooms", width: 24 },
            { header: "ค่าห้อง", key: "roomCharge", width: 14 },
            { header: "ยอดรวม", key: "total", width: 14 },
            { header: "ชำระเงิน", key: "paymentMethods", width: 20 },
            { header: "Staff", key: "staffUsername", width: 18 },
            { header: "Note", key: "note", width: 30 },
        ];
        sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
        sheet.getRow(1).fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FF51D1DC" },
        };
        sheet.getRow(1).alignment = { vertical: "middle", horizontal: "center" };
        sheet.getRow(1).height = 26;
        sheet.getRow(1).eachCell((cell) => {
            cell.border = cellBorder;
        });
        bookings.forEach((booking) => {
            const transactions = booking.transactions || [];
            const platform = platformMap[booking.platformId] || {
                label: booking.platformId,
                color: "94A3B8",
            };
            const paymentMethods = [
                ...new Set(transactions.map((transaction) => transaction.paymentMethod)),
            ].join(", ");
            const row = sheet.addRow({
                bookingId: booking.bookingId,
                checkIn: formatInputDate(booking.checkIn),
                checkOut: formatInputDate(booking.checkOut),
                nights: booking.nights,
                name: booking.name,
                platformId: platform.label,
                status: booking.status,
                rooms: booking.roomStays.map((roomStay) => roomStay.roomId).join(", "),
                roomCharge: transactionTotal(transactions, "roomCharge"),
                total: transactionTotal(transactions),
                paymentMethods,
                staffUsername: booking.staffUsername,
                note: booking.note || "",
            });
            const platformCell = row.getCell("platformId");
            applyRowSpacing(row);
            applyImportantCellStyle(row);
            applyStatusCellStyle(row, booking.status);
            platformCell.font = { color: { argb: `FF${platform.color}` }, bold: true };
            platformCell.alignment = { vertical: "middle", horizontal: "center" };
            transactions
                .filter((transaction) => transaction.type !== "roomCharge")
                .forEach((transaction) => {
                const transactionLabel = transactionMap[transaction.type] || transaction.type;
                const transactionRow = sheet.addRow({
                    bookingId: booking.bookingId,
                    checkIn: formatInputDate(booking.checkIn),
                    checkOut: formatInputDate(booking.checkOut),
                    nights: booking.nights,
                    name: booking.name,
                    platformId: "Misc",
                    status: booking.status,
                    rooms: transactionLabel,
                    roomCharge: "",
                    total: transaction.amount,
                    paymentMethods: transaction.paymentMethod,
                    staffUsername: booking.staffUsername,
                    note: "",
                });
                transactionRow.eachCell((cell, colNumber) => {
                    cell.font = { color: { argb: "FF000000" } };
                    if (colNumber !== 6 && colNumber !== 10) {
                        cell.fill = {
                            type: "pattern",
                            pattern: "solid",
                            fgColor: { argb: "FFF3F4F6" },
                        };
                    }
                });
                applyRowSpacing(transactionRow);
                applyImportantCellStyle(transactionRow);
                applyStatusCellStyle(transactionRow, booking.status);
                transactionRow.getCell("platformId").font = {
                    color: { argb: "FF94A3B8" },
                    bold: true,
                };
                transactionRow.getCell("platformId").alignment = {
                    vertical: "middle",
                    horizontal: "center",
                };
            });
        });
        sheet.getColumn("roomCharge").numFmt = '#,##0 "บาท"';
        sheet.getColumn("total").numFmt = '#,##0 "บาท"';
        sheet.views = [{ state: "frozen", ySplit: 1 }];
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.setHeader("Content-Disposition", `attachment; filename=bookings-${month}.xlsx`);
        await workbook.xlsx.write(res);
        res.end();
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to create bookings report" });
    }
};
exports.getBookingsReport = getBookingsReport;
//# sourceMappingURL=documents.js.map