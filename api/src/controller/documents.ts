import ExcelJs from "exceljs";
import Booking, { PASSPORT_SENSITIVE_SELECT } from "../models/booking";
import User from "../models/user";
import crypto from "crypto";
import path from "path";
import {
  formatDestinationCountryForReport,
  formatNationalityToIcao,
  formatNationalityToReportThaiName,
  formatNationalityToReportNumber,
  formatRoomIdToReportNumber,
  isThaiNationality,
  nationalitySheetName,
  splitPassportName,
} from "../helpers/passportHelpers";

import type { Request, Response } from "express";
import type { EncryptedField } from "../models/booking";
import { formatDateAD } from "../helpers/dateHelpers";
import {
  bookingsReportDepositCollectedTotal,
  bookingsReportTransactionAmount,
} from "../helpers/bookingsReportHelpers";
import { getPrimaryRoomId } from "../helpers/roomStayHelpers";
import { logActivityStrict } from "../services/activityServices";
import {
  commercialRoomSlices,
  effectiveCommercialSegments,
  transactionPlatformId,
} from "../helpers/commercialSegmentHelpers";
import {
  effectiveBookingTransactions,
} from "../services/transactionCorrections";

const setSensitiveDownloadHeaders = (res: Response) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
};

const platformMap: Record<string, { label: string; color: string }> = {
  BOOK: { label: "Booking.com", color: "003580" },
  HOST: { label: "Hostelworld", color: "F15A24" },
  AGOD: { label: "Agoda", color: "19AC5B" },
  TRAV: { label: "Traveloka", color: "00ADEF" },
  WALK: { label: "Walk-In", color: "F12424" },
};

const transactionMap: Record<string, string> = {
  deposit: "รับมัดจำ",
  adjustment: "ปรับราคา",
  depositRefund: "คืนมัดจำ",
  cancellationRefund: "คืนเงินยกเลิก",
  roomRefund: "คืนค่าห้อง",
  roomChargeWriteOff: "ปิดยอดค่าห้องที่เหลือ",
  settlementCharge: "Settlement Charge",
  compensation: "ชดเชยลูกค้า",
  depositKept: "เก็บมัดจำเป็นรายได้",
  paymentCorrection: "แก้ไขการชำระเงิน",
  towel: "Towel",
  motorbike: "Motorbike",
  slowBoat: "Slow Boat",
  joinTour: "Join Tour",
  extraBed: "Extra Bed",
  pickACraft: "Pick A Craft",
  trek2D: "Trek 2D",
  setMenu: "Set Menu",
  sleeperBus: "Sleeper Bus",
  onlyWalk: "Only Walk",
  laundry: "Laundry",
  bicycle: "Bicycle",
  car: "Car",
  misc: "Misc",
  rainCoat: "Rain Coat",
  passwordLock: "Password Lock",
  cooking: "Cooking",
  cardSurcharge: "ค่าธรรมเนียมบัตร 3%",
};

const hotelAccommodationHeaders = [
  "ลำดับ",
  "วันที่เข้าพัก",
  "เวลาเข้าพัก",
  "ห้องพัก",
  "คำนำหน้าชื่อไทย",
  "ชื่อไทย",
  "ชื่อกลางไทย",
  "นามสกุลไทย",
  "คำนำหน้าชื่ออังกฤษ",
  "ชื่ออังกฤษ",
  "ชื่อกลางอังกฤษ",
  "นามสกุลอังกฤษ",
  "สัญชาติ",
  "เลขหนังสือเดินทาง",
  "ออกให้โดย",
  "ที่อยู่",
  "ประเทศที่อยู่",
  "อาชีพ",
  "มาจาก",
  "มาจากประเทศ",
  "จะไปที่อำเภอจังหวัดหรือประเทศใด",
  "จะไปประเทศ",
  "วันที่ออก",
  "เวลาออก",
  "สถานะข้อมูล",
  "หมายเหตุ",
];

const statusMap: Record<
  string,
  { label: string; backgroundColor: string; textColor: string }
> = {
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
  noShow: {
    label: "No-Show",
    backgroundColor: "FFF3F4F6",
    textColor: "FF4B5563",
  },
};

const formatInputDate = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1);
  const day = String(date.getDate());

  return `${year}/${month}/${day}`;
};

const formatReportTime = (date?: Date) => {
  if (!date) return "";

  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");

  return `${hours}.${minutes}`;
};

const dateQuery = (date: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;

  const start = new Date(`${date}T00:00:00`);
  const end = new Date(start);
  end.setDate(start.getDate() + 1);

  return { start, end };
};

const thaiNationalityValues = ["TH", "THA", "th", "tha", "ไทย"];

const immigrationDateQuery = (date: string) => {
  const bounds = dateQuery(date);
  if (!bounds) return null;

  return {
    status: { $ne: "cancelled" },
    checkIn: { $gte: bounds.start, $lt: bounds.end },
    "passport.nationality": { $nin: thaiNationalityValues },
  };
};

const hotelAccommodationDateQuery = (date: string) => {
  const bounds = dateQuery(date);
  if (!bounds) return null;

  return {
    status: { $ne: "cancelled" },
    $or: [
      { checkedInAt: { $gte: bounds.start, $lt: bounds.end } },
      {
        checkedInAt: { $exists: false },
        checkIn: { $gte: bounds.start, $lt: bounds.end },
      },
    ],
  };
};

const passportInfoIsComplete = (
  passport:
    | {
        namePrefix?: string;
        nationality?: string;
        passportNo?: EncryptedField;
        passportName?: EncryptedField;
      }
    | undefined,
) =>
  !!passport?.namePrefix &&
  !!passport.nationality &&
  !!passport.passportName &&
  !!passport.passportNo;

const hotelPassportInfoIssue = (
  passport:
    | {
        namePrefix?: string;
        nationality?: string;
        nextDestinationCountry?: string;
        passportNo?: EncryptedField;
        passportName?: EncryptedField;
      }
    | undefined,
) => {
  if (!passport?.namePrefix) return "ขาดคำนำหน้าชื่อ";
  if (!passport.nationality) return "ขาดสัญชาติ";
  if (!passport.nextDestinationCountry) return "ขาดประเทศปลายทางถัดไป";
  if (!passport.passportName)
    return isThaiNationality(passport.nationality)
      ? "ขาดชื่อ-นามสกุลภาษาไทย"
      : "ขาดชื่อบน Passport";
  if (!passport.passportNo)
    return isThaiNationality(passport.nationality)
      ? "ขาดเลขประจำตัวประชาชน"
      : "ขาดเลข Passport";

  if (!formatDestinationCountryForReport(passport.nextDestinationCountry)) {
    return `ไม่มีรหัสประเทศปลายทางสำหรับ ${passport.nextDestinationCountry}`;
  }

  if (formatNationalityToReportNumber(passport.nationality) === "") {
    return `ไม่มีรหัสสัญชาติสำหรับ ${passport.nationality}`;
  }

  return null;
};

const formatPassport = (
  rawPassport:
    | {
        namePrefix?: string;
        nationality?: string;
        passportNo?: EncryptedField;
        passportName?: EncryptedField;
      }
    | undefined,
  nationalitySheet?: ExcelJs.Worksheet,
  options: { nationalityFormat?: "icao" | "number" } = {},
) => {
  const emptyPassport: {
    namePrefix: string;
    nationality: string | number;
    passportNo: string;
    passportName: string;
  } = {
    namePrefix: "",
    nationality: "",
    passportNo: "",
    passportName: "",
  };

  if (!rawPassport) return emptyPassport;

  const decrypt = ({ cipherText, iv, authTag }: EncryptedField) => {
    const key = Buffer.from(process.env.CRYPTO_SECRET!, "hex");

    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(iv, "hex"),
    );

    decipher.setAuthTag(Buffer.from(authTag, "hex"));

    let decrypted = decipher.update(cipherText, "hex", "utf8");
    decrypted += decipher.final("utf8");

    return decrypted;
  };

  return {
    namePrefix: rawPassport.namePrefix || "",
    nationality: rawPassport.nationality
      ? options.nationalityFormat === "number"
        ? formatNationalityToReportNumber(rawPassport.nationality)
        : nationalitySheet
          ? formatNationalityToIcao(rawPassport.nationality, nationalitySheet)
          : ""
      : "",
    passportNo: rawPassport.passportNo ? decrypt(rawPassport.passportNo) : "",
    passportName: rawPassport.passportName
      ? decrypt(rawPassport.passportName)
      : "",
  };
};

const createHotelAccommodationSheet = (
  workbook: ExcelJs.Workbook,
  date: string,
) => {
  const sheet = workbook.addWorksheet("Sheet1");

  sheet.getCell(1, 1).value = `Hotel Accommodation Report ${date}`;
  sheet.mergeCells(1, 1, 1, hotelAccommodationHeaders.length);

  const titleRow = sheet.getRow(1);
  titleRow.font = { bold: true, size: 14 };
  titleRow.alignment = { horizontal: "center" };

  const headerRow = sheet.getRow(4);
  headerRow.values = ["", ...hotelAccommodationHeaders];
  headerRow.font = { bold: true };
  headerRow.alignment = { horizontal: "center", vertical: "middle" };

  hotelAccommodationHeaders.forEach((header, index) => {
    const column = sheet.getColumn(index + 1);
    column.width = Math.max(12, Math.min(header.length + 4, 28));
  });

  return sheet;
};

const getHotelAccommodationWorkbook = async (
  templatePath: string,
  date: string,
) => {
  const workbook = new ExcelJs.Workbook();

  try {
    await workbook.xlsx.readFile(templatePath);

    const sheet = workbook.getWorksheet("Sheet1") || workbook.worksheets[0];
    if (sheet) return { workbook, sheet };
  } catch (err) {
    console.warn("Unable to read hotel accommodation template", err);
  }

  const fallbackWorkbook = new ExcelJs.Workbook();
  return {
    workbook: fallbackWorkbook,
    sheet: createHotelAccommodationSheet(fallbackWorkbook, date),
  };
};

const cellBorder = {
  top: { style: "thin" as const, color: { argb: "FFE5E7EB" } },
  left: { style: "thin" as const, color: { argb: "FFE5E7EB" } },
  bottom: { style: "thin" as const, color: { argb: "FFE5E7EB" } },
  right: { style: "thin" as const, color: { argb: "FFE5E7EB" } },
};

const applyRowSpacing = (row: ExcelJs.Row) => {
  row.height = 24;
  row.eachCell((cell) => {
    cell.alignment = { vertical: "middle" };
    cell.border = cellBorder;
  });
};

const makeCellBold = (row: ExcelJs.Row, key: string) => {
  const cell = row.getCell(key);
  cell.font = { ...cell.font, bold: true };
};

const applyImportantCellStyle = (row: ExcelJs.Row) => {
  ["name", "rooms", "amount", "depositCollected", "paymentMethods"].forEach(
    (key) => makeCellBold(row, key),
  );
};

const applyStatusCellStyle = (row: ExcelJs.Row, status: string) => {
  const statusMeta = statusMap[status];
  const statusCell = row.getCell("status");

  if (!statusMeta) return;

  statusCell.value = statusMeta.label;
  statusCell.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: statusMeta.backgroundColor },
  };
  statusCell.font = { color: { argb: statusMeta.textColor }, bold: true };
  statusCell.alignment = { vertical: "middle", horizontal: "center" };
};

export const getBookingsReport = async (req: Request, res: Response) => {
  try {
    const month = req.query.month as string;
    const bookingChannel = req.query.bookingChannel as string | undefined;
    const bookingStatus = req.query.bookingStatus as string | undefined;
    const paymentMethod = req.query.paymentMethod as string | undefined;

    if (!/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ message: "Invalid month format" });
    }

    const [year, monthNumber] = month.split("-").map(Number);

    const firstDayOfNextMonth = new Date(year, monthNumber, 1);
    const firstDayOfMonth = new Date(year, monthNumber - 1, 1);

    const query: Record<string, unknown> = {
      checkIn: { $lt: firstDayOfNextMonth },
      checkOut: { $gt: firstDayOfMonth },
    };

    if (bookingChannel) {
      query.$or = [
        { platformId: bookingChannel },
        { "commercialSegments.platformId": bookingChannel },
      ];
    }

    if (bookingStatus && bookingStatus !== "all") {
      query.status = bookingStatus;
    }

    const bookingRecords = await Booking.find(query).sort({
      checkIn: 1,
      name: 1,
    });
    const bookings = bookingRecords.filter(
      (booking) =>
        !paymentMethod ||
        paymentMethod === "all" ||
        effectiveBookingTransactions(booking).some(
          (transaction) => transaction.paymentMethod === paymentMethod,
        ),
    );

    if (!bookings) return res.status(400).json({ message: "ไมพบการจอง" });

    const staffUsernames = [
      ...new Set(
        bookings.flatMap((booking) => [
          booking.staffUsername,
          ...(booking.commercialSegments || []).map(
            (segment) => segment.createdBy,
          ),
          ...(booking.transactions || []).map(
            (transaction) => transaction.createdBy,
          ),
        ]),
      ),
    ].filter((username): username is string => Boolean(username));
    const staff = await User.find({ username: { $in: staffUsernames } })
      .select("username name")
      .lean();
    const staffNames = new Map(
      staff.map((member) => [member.username, member.name]),
    );
    const displayStaffName = (username?: string) =>
      (username && staffNames.get(username)) || "ไม่ทราบชื่อพนักงาน";

    const workbook = new ExcelJs.Workbook();
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
      { header: "ยอดเงิน", key: "amount", width: 14 },
      { header: "เงินมัดจำที่รับ", key: "depositCollected", width: 16 },
      { header: "ชำระเงิน", key: "paymentMethods", width: 20 },
      { header: "Staff", key: "staffName", width: 18 },
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
      const transactions = effectiveBookingTransactions(booking);
      const financialBooking = { ...booking.toObject(), transactions };
      const roomSlices = commercialRoomSlices(financialBooking);
      effectiveCommercialSegments(financialBooking)
        .filter(
          (segment) =>
            !bookingChannel || segment.platformId === bookingChannel,
        )
        .forEach((segment) => {
          const platform = platformMap[segment.platformId] || {
            label: segment.platformId,
            color: "94A3B8",
          };
          const linkedTransaction = transactions.find(
            (transaction) => String(transaction._id) === segment.transactionId,
          );
          const rooms = Array.from(
            new Set(
              roomSlices
                .filter(
                  (slice) =>
                    new Date(slice.from) < new Date(segment.to) &&
                    new Date(slice.to) > new Date(segment.from),
                )
                .flatMap((slice) => slice.roomIds),
            ),
          ).join(", ");
          const nights = Math.round(
            (new Date(segment.to).getTime() -
              new Date(segment.from).getTime()) /
              86400000,
          );
          const row = sheet.addRow({
            bookingId: segment.channelBookingId || booking.bookingId,
            checkIn: formatInputDate(new Date(segment.from)),
            checkOut: formatInputDate(new Date(segment.to)),
            nights,
            name: booking.name,
            platformId: platform.label,
            status: booking.status,
            rooms,
            amount: linkedTransaction?.amount ?? segment.amount,
            depositCollected:
              segment.kind === "original"
                ? bookingsReportDepositCollectedTotal(transactions)
                : "",
            paymentMethods: linkedTransaction?.paymentMethod || "",
            staffName: displayStaffName(
              segment.createdBy || booking.staffUsername,
            ),
            note: segment.note || booking.note || "",
          });

          const platformCell = row.getCell("platformId");
          applyRowSpacing(row);
          applyImportantCellStyle(row);
          applyStatusCellStyle(row, booking.status);
          platformCell.font = {
            color: { argb: `FF${platform.color}` },
            bold: true,
          };
          platformCell.alignment = {
            vertical: "middle",
            horizontal: "center",
          };
        });

      transactions
        .map((transaction) => ({
          transaction,
          amount: bookingsReportTransactionAmount(transaction),
        }))
        .filter(
          ({ transaction, amount }) =>
            transaction.type !== "roomCharge" && amount !== 0,
        )
        .forEach(({ transaction, amount }) => {
          const transactionLabel =
            transactionMap[transaction.type] || transaction.type;
          const transactionRow = sheet.addRow({
            bookingId: booking.bookingId,
            checkIn: formatInputDate(booking.checkIn),
            checkOut: formatInputDate(booking.checkOut),
            nights: booking.nights,
            name: booking.name,
            platformId:
              platformMap[transactionPlatformId(financialBooking, transaction)]
                ?.label || transactionPlatformId(financialBooking, transaction),
            status: booking.status,
            rooms: transactionLabel,
            amount,
            depositCollected: "",
            paymentMethods: transaction.paymentMethod,
            staffName: displayStaffName(
              transaction.createdBy || booking.staffUsername,
            ),
            note: "",
          });

          transactionRow.eachCell((cell, colNumber) => {
            cell.font = { color: { argb: "FF000000" } };

            if (colNumber !== 6 && colNumber !== 9) {
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

    sheet.getColumn("amount").numFmt = '#,##0 "บาท"';
    sheet.getColumn("depositCollected").numFmt = '#,##0 "บาท"';
    sheet.views = [{ state: "frozen", ySplit: 1 }];

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=bookings-${month}.xlsx`,
    );

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to create bookings report" });
  }
};

export const getImmigrationReportStatus = async (
  req: Request,
  res: Response,
) => {
  try {
    const date = (req.query.date || req.query.month) as string;
    const query = immigrationDateQuery(date);

    if (!query) {
      return res.status(400).json({ message: "Invalid date format" });
    }

    const bookings = await Booking.find(query)
      .select(
        `bookingId name checkOut passport.namePrefix passport.nationality ${PASSPORT_SENSITIVE_SELECT}`,
      )
      .sort({
        checkIn: 1,
        name: 1,
      })
      .lean();

    const missingBookings = bookings
      .filter((booking) => !passportInfoIsComplete(booking.passport))
      .map((booking) => ({
        bookingId: booking.bookingId,
        name: booking.name,
        checkOut: booking.checkOut,
      }));

    res.status(200).json({
      total: bookings.length,
      complete: bookings.length - missingBookings.length,
      missing: missingBookings.length,
      missingBookings,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch immigration status" });
  }
};

export const getImmigrationReport = async (req: Request, res: Response) => {
  try {
    const date = (req.query.date || req.query.month) as string;
    const query = immigrationDateQuery(date);

    if (!query) {
      return res.status(400).json({ message: "Invalid date format" });
    }

    const bookings = await Booking.find(query)
      .select(
        `bookingId name checkOut passport.namePrefix passport.nationality ${PASSPORT_SENSITIVE_SELECT}`,
      )
      .sort({
        checkIn: 1,
        name: 1,
      });

    if (bookings.length === 0)
      return res.status(400).json({ message: "ไม่พบรายการจองในวันที่กำหนด" });

    const workbook = new ExcelJs.Workbook();

    const templatePath = path.resolve(
      process.cwd(),
      "uploads",
      "document-templates",
      "Immigration.xlsx",
    );

    await workbook.xlsx.readFile(templatePath);

    const sheet = workbook.getWorksheet("แบบแจ้งที่พัก Inform Accom");
    if (!sheet) return res.status(404).json({ message: "ไม่พบ template ตม" });

    const nationalitySheet = workbook.getWorksheet(nationalitySheetName);
    if (!nationalitySheet) {
      return res.status(404).json({ message: "ไม่พบ worksheet สัญชาติ" });
    }

    const startRow = 2;

    const determineGender = (namePrefix?: string) => {
      if (namePrefix === "Mr") return "M";
      if (["Ms", "Mrs", "Miss"].includes(namePrefix || "")) return "F";
      return "";
    };

    bookings.forEach((booking, index) => {
      const row = sheet.getRow(startRow + index);

      const formattedPassport = formatPassport(
        booking.passport,
        nationalitySheet,
      );

      const splittedPassportName = splitPassportName(
        formattedPassport.passportName,
      );
      const missingPassportInfo =
        !formattedPassport.passportName ||
        !formattedPassport.passportNo ||
        !formattedPassport.nationality;

      if (missingPassportInfo) {
        const missingCell = row.getCell(1);
        missingCell.value = `MISSING ${booking.name} ${booking.bookingId}`;
        missingCell.font = {
          ...missingCell.font,
          color: { argb: "FFFF0000" },
        };
      } else {
        row.getCell(1).value = splittedPassportName.firstName;
        row.getCell(2).value = splittedPassportName.middleName;
        row.getCell(3).value = splittedPassportName.lastName;
      }
      row.getCell(4).value = determineGender(booking.passport?.namePrefix);
      row.getCell(5).value = formattedPassport.passportNo;
      row.getCell(6).value = formattedPassport.nationality;
      row.getCell(8).value = formatDateAD(booking.checkOut);

      row.commit();
    });

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );

    res.setHeader(
      "Content-Disposition",
      `attachment; filename=immigration-${date}.xlsx`,
    );

    await logActivityStrict(req.user?.username, "EXPORT_PASSPORT_REPORT", {
      summary: {
        reportType: "immigration",
        businessDate: date,
        bookingCount: bookings.length,
      },
    });
    setSensitiveDownloadHeaders(res);

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to create immigration report" });
  }
};

export const getHotelAccomodationReport = async (
  req: Request,
  res: Response,
) => {
  try {
    const date = req.query.date as string;
    const query = hotelAccommodationDateQuery(date);

    if (!query) {
      return res.status(400).json({ message: "Invalid date format" });
    }

    if (
      req.query.randomizeDestination !== undefined ||
      req.query.destinationCountry !== undefined
    ) {
      return res.status(400).json({
        code: "DESTINATION_OVERRIDE_NOT_ALLOWED",
        message:
          "รายงาน รร. ต้องใช้ประเทศปลายทางที่บันทึกไว้สำหรับผู้เข้าพักแต่ละราย",
      });
    }

    const bookings = await Booking.find(query)
      .select(
        `bookingId checkIn checkOut checkedInAt roomStays name passport.namePrefix passport.nationality passport.nextDestinationCountry ${PASSPORT_SENSITIVE_SELECT}`,
      )
      .sort({ checkIn: 1, name: 1 });

    if (bookings.length === 0)
      return res.status(400).json({ message: "ไม่พบรายการจองในวันที่กำหนด" });

    const missingBookings = bookings
      .map((booking) => ({
        bookingId: booking.bookingId,
        name: booking.name,
        reason: hotelPassportInfoIssue(booking.passport),
      }))
      .filter(({ reason }) => reason);

    const templatePath = path.resolve(
      process.cwd(),
      "uploads",
      "document-templates",
      "HotelAccommodation.xlsx",
    );

    const { workbook, sheet } = await getHotelAccommodationWorkbook(
      templatePath,
      date,
    );

    sheet.getCell("N2").value = formatDateAD(new Date(`${date}T00:00:00`));

    const startRow = 5;

    bookings.forEach((booking, index) => {
      const row = sheet.getRow(startRow + index);

      const formattedPassport = formatPassport(booking.passport, undefined, {
        nationalityFormat: "number",
      });

      const splittedPassportName = splitPassportName(
        formattedPassport.passportName,
      );
      const thaiGuest = isThaiNationality(
        booking.passport?.nationality || "",
      );

      const destination = formatDestinationCountryForReport(
        booking.passport?.nextDestinationCountry || "",
      );
      const indexCell = row.getCell(1);
      indexCell.value = index + 1;
      row.getCell(2).value = formatDateAD(booking.checkIn);
      row.getCell(3).value = formatReportTime(
        booking.checkedInAt || booking.checkIn,
      );
      row.getCell(4).value = formatRoomIdToReportNumber(
        getPrimaryRoomId(booking.roomStays[0] || {}),
      );
      row.getCell(5).value = thaiGuest ? formattedPassport.namePrefix : "";
      row.getCell(6).value = thaiGuest
        ? splittedPassportName.firstName
        : "";
      row.getCell(7).value = thaiGuest
        ? splittedPassportName.middleName
        : "";
      row.getCell(8).value = thaiGuest
        ? splittedPassportName.lastName
        : "";
      row.getCell(9).value = thaiGuest ? "" : formattedPassport.namePrefix;
      row.getCell(10).value = thaiGuest
        ? ""
        : splittedPassportName.firstName;
      row.getCell(11).value = thaiGuest
        ? ""
        : splittedPassportName.middleName;
      row.getCell(12).value = thaiGuest
        ? ""
        : splittedPassportName.lastName;
      row.getCell(13).value = formattedPassport.nationality;
      row.getCell(14).value = thaiGuest ? formattedPassport.passportNo : "";
      row.getCell(15).value = thaiGuest ? "" : formattedPassport.passportNo;
      row.getCell(16).value = formattedPassport.nationality;
      row.getCell(17).value = formatNationalityToReportThaiName(
        booking.passport?.nationality || "",
      );
      row.getCell(18).value = formattedPassport.nationality;
      row.getCell(19).value = 146;
      row.getCell(20).value = formatNationalityToReportThaiName(
        booking.passport?.nationality || "",
      );
      row.getCell(21).value = formattedPassport.nationality;
      row.getCell(22).value = destination?.label || "";
      row.getCell(23).value = destination?.code || "";
      row.getCell(24).value = formatDateAD(booking.checkOut);
      row.getCell(25).value = "12.00";
      row.getCell(26).value = 1;

      row.commit();
    });

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );

    res.setHeader(
      "Content-Disposition",
      `attachment; filename=hotel-accommodation-${date}.xlsx`,
    );

    await logActivityStrict(req.user?.username, "EXPORT_PASSPORT_REPORT", {
      summary: {
        reportType: "hotel_accommodation",
        businessDate: date,
        bookingCount: bookings.length,
        incompleteBookingCount: missingBookings.length,
      },
    });
    setSensitiveDownloadHeaders(res);

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error(err);
    res
      .status(500)
      .json({ message: "Failed to create hotel accommodation report" });
  }
};

export const getHotelAccomodationReportStatus = async (
  req: Request,
  res: Response,
) => {
  try {
    const date = req.query.date as string;
    const query = hotelAccommodationDateQuery(date);

    if (!query) {
      return res.status(400).json({ message: "Invalid date format" });
    }

    const bookings = await Booking.find(query)
      .select(
        `bookingId name checkOut passport.namePrefix passport.nationality passport.nextDestinationCountry ${PASSPORT_SENSITIVE_SELECT}`,
      )
      .sort({
        checkIn: 1,
        name: 1,
      })
      .lean();

    const missingBookings = bookings
      .map((booking) => ({
        booking,
        reason: hotelPassportInfoIssue(booking.passport),
      }))
      .filter(({ reason }) => reason)
      .map(({ booking, reason }) => ({
        bookingId: booking.bookingId,
        name: booking.name,
        checkOut: booking.checkOut,
        reason,
      }));

    res.status(200).json({
      total: bookings.length,
      complete: bookings.length - missingBookings.length,
      missing: missingBookings.length,
      missingBookings,
    });
  } catch (err) {
    console.error(err);
    res
      .status(500)
      .json({ message: "Failed to fetch hotel accommodation status" });
  }
};
