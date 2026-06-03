import Booking, { PaymentMethod } from "../models/booking";
import dotenv from "dotenv";
import crypto from "crypto";

import { NextFunction, Request, Response } from "express";
import { logActivity } from "../services/activityServices";
import type {
  booking,
  PlatformId,
  roomStay,
  Status,
  transcation,
  TransactionType,
  EncryptedField,
} from "../models/booking";
import { dateRangeText, toInputDate } from "../helpers/dateHelpers";

dotenv.config();

const TOTAL_GUEST_CAPACITY = 52;
const ROOM_GUEST_CAPACITY: Record<string, number> = {
  Balcony: 2,
  Window: 2,
  "Pottery 1": 3,
  "Pottery 2": 3,
};
const CARD_SURCHARGE_RATE = 0.03;
const ADD_TRANSACTION_TYPES: TransactionType[] = [
  "deposit",
  "adjustment",
  "depositRefund",
  "towel",
  "motorbike",
  "slowBoat",
  "joinTour",
  "extraBed",
];
const PAYMENT_METHODS: PaymentMethod[] = ["Cash", "Card", "Transfer"];
const ROOM_BLOCKING_BOOKING_FILTER = {
  $or: [
    { status: { $ne: "cancelled" } },
    { "cancellation.roomReleaseStatus": "blocked" },
  ],
};
const BUSINESS_TIME_ZONE = "Asia/Bangkok";
const BANGKOK_UTC_OFFSET_HOURS = 7;

const getBusinessDateParts = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  return {
    year: Number(parts.find((part) => part.type === "year")?.value),
    month: Number(parts.find((part) => part.type === "month")?.value),
    day: Number(parts.find((part) => part.type === "day")?.value),
  };
};

const getBusinessDateStart = (year: number, month: number, day: number) =>
  new Date(Date.UTC(year, month - 1, day, -BANGKOK_UTC_OFFSET_HOURS, 0, 0, 0));

const getBusinessDayBounds = (date = new Date()) => {
  const { year, month, day } = getBusinessDateParts(date);
  const start = getBusinessDateStart(year, month, day);
  const end = new Date(start.getTime() + 86400000);

  return { start, end };
};

const getBusinessMonthBounds = (date = new Date()) => {
  const { year, month } = getBusinessDateParts(date);
  const start = getBusinessDateStart(year, month, 1);
  const end = getBusinessDateStart(year, month + 1, 1);

  return { start, end };
};

const getRoomGuestCapacity = (roomId: string) => ROOM_GUEST_CAPACITY[roomId] ?? 1;

const getGuestsInHouse = async (date = new Date()) => {
  const { start, end } = getBusinessDayBounds(date);
  const checkedInBookings = await Booking.find({
    status: "checkedIn",
    roomStays: {
      $elemMatch: {
        from: { $lt: end },
        to: { $gt: start },
      },
    },
  })
    .select("roomStays")
    .lean();

  return checkedInBookings.reduce(
    (bookingTotal, booking) =>
      bookingTotal +
      booking.roomStays.reduce((roomTotal, roomStay) => {
        const stayFrom = new Date(roomStay.from);
        const stayTo = new Date(roomStay.to);
        const stayIsActiveToday = stayFrom < end && stayTo > start;

        return stayIsActiveToday
          ? roomTotal + getRoomGuestCapacity(roomStay.roomId)
          : roomTotal;
      }, 0),
    0,
  );
};

const calculateCardSurcharge = (amount: number) =>
  Number((amount * CARD_SURCHARGE_RATE).toFixed(2));

const buildTransactionsWithCardSurcharge = (
  transaction: transcation,
): transcation[] => {
  const transactions = [transaction];

  if (
    transaction.paymentMethod === "Card" &&
    transaction.amount > 0 &&
    transaction.type !== "depositRefund" &&
    transaction.type !== "cardSurcharge"
  ) {
    transactions.push({
      type: "cardSurcharge",
      paymentMethod: "Card",
      relatedTransactionType: transaction.type,
      amount: calculateCardSurcharge(transaction.amount),
    });
  }

  return transactions;
};

const formatLocalDateKey = (date: Date) => {
  const { year, month, day } = getBusinessDateParts(date);

  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(
    2,
    "0",
  )}`;
};

const roomChargeRevenue = (booking: booking) =>
  booking.transactions.reduce((sum, transaction) => {
    if (transaction.type !== "roomCharge") return sum;
    if (transaction.paymentMethod === "Unpaid") return sum;

    return sum + transaction.amount;
  }, 0);

const unpaidRoomChargeAmount = (booking: booking) =>
  booking.transactions.reduce((sum, transaction) => {
    if (transaction.type !== "roomCharge") return sum;
    if (transaction.paymentMethod !== "Unpaid") return sum;

    return sum + transaction.amount;
  }, 0);

const calculateNights = (checkIn: string, checkOut: string) => {
  const checkInDate = new Date(checkIn + "T00:00:00");
  const checkOutDate = new Date(checkOut + "T00:00:00");

  const diff = checkOutDate.getTime() - checkInDate.getTime();
  return diff / 86400000;
};

export const newBooking = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    if (!req.body.booking)
      return res.status(400).json({ message: "ไม่พบข้อมูล booking" });

    const { booking } = req.body;
    const newCheckIn = new Date(booking.checkIn + "T00:00:00");
    const newCheckOut = new Date(booking.checkOut + "T00:00:00");

    if (newCheckIn >= newCheckOut)
      return res.status(400).json({
        message: "วันที่เช็คอินต้องไม่อยู่หลังวันที่เช็คเอาท์",
      });

    // find bookings that have same room && checkout greater than new checkin && checkin less than new checkout
    const overlappingBooking = await Booking.findOne({
      ...ROOM_BLOCKING_BOOKING_FILTER,
      roomStays: {
        $elemMatch: {
          roomId: booking.roomId,
          from: { $lt: newCheckOut },
          to: { $gt: newCheckIn },
        },
      },
    });

    if (overlappingBooking) {
      return res.status(409).json({
        message: `ห้องนี้ถูกจองแล้วระหว่างวันที่ ${dateRangeText(overlappingBooking.roomStays[0].from, overlappingBooking.roomStays[0].to)} กรุณาเลือกช่วงเวลาอื่น`,
      });
    }

    const roomChargeTransaction: transcation = {
      type: "roomCharge",
      amount: Number(booking.price),
      paymentMethod: booking.paymentMethod,
    };

    const savedBooking = new Booking({
      name: booking.name,
      checkIn: newCheckIn,
      checkOut: newCheckOut,
      nights: calculateNights(booking.checkIn, booking.checkOut),
      platformId: booking.platformId,
      roomStays: [
        {
          roomId: booking.roomId,
          from: newCheckIn,
          to: newCheckOut,
        },
      ],
      note: booking.note || "",

      // ------- OLD TRANSACTION STRUCTURE --------
      // price: booking.price,
      // paymentMethod: booking.paymentMethod,
      // deposit: null,
      // depositRepaid: null,

      transactions: buildTransactionsWithCardSurcharge(roomChargeTransaction),

      staffUsername: booking.staffUsername,
      bookingId: booking.bookingId,
      checkInByStaffUsername: null,
      status: "booked",
    });

    await savedBooking.save();

    res
      .status(201)
      .json({ message: "Booking created successfully", booking: savedBooking });

    logActivity(req.user?.username, "NEW_BOOKING", {
      snapshot: {
        name: booking.name,
        checkIn: newCheckIn,
        checkOut: newCheckOut,
        platformId: booking.platformId,
        roomId: booking.roomId,
        price: booking.price,
        paymentMethod: booking.paymentMethod,
        bookingId: booking.bookingId,
      },
    });
  } catch (err: any) {
    if (err.code === 11000) {
      return res.status(409).json({
        message: "Booking ID ถูกใช้ไปแล้ว โปรดใช้ Booking ID อื่น",
      });
    }

    res.status(400).json({ error: (err as Error).message });
  }
};

type EditBookingBody = {
  booking: {
    name: string;
    checkIn: string;
    checkOut: string;
    platformId: PlatformId;
    note?: string;
  };
};

type EditBookingParams = {
  bookingId: string;
};

export const editBooking = async (
  req: Request<EditBookingParams, {}, EditBookingBody>,
  res: Response,
) => {
  try {
    const { booking } = req.body;
    const { bookingId } = req.params;

    if (
      !booking ||
      !booking.name ||
      !booking.checkIn ||
      !booking.checkOut ||
      !booking.platformId
    ) {
      return res.status(400).json({
        message: "กรุณากรอกข้อมูลให้ครบทุกช่อง",
      });
    }

    const newCheckIn = new Date(booking.checkIn + "T00:00:00");
    const newCheckOut = new Date(booking.checkOut + "T00:00:00");

    if (newCheckIn >= newCheckOut) {
      return res.status(400).json({
        message: "วันที่เช็คอินต้องไม่อยู่หลังวันที่เช็คเอาท์",
      });
    }

    const existingBooking = await Booking.findOne({ bookingId }).lean();
    if (!existingBooking) {
      return res.status(404).json({ message: "Booking not found" });
    }

    if (existingBooking.status === "checkedOut") {
      return res.status(409).json({
        message: "ไม่สามารถแก้ไข booking ที่ check-out แล้ว",
      });
    }

    const originalRoomStays = [...existingBooking.roomStays].sort(
      (a, b) => new Date(a.from).getTime() - new Date(b.from).getTime(),
    );

    const correctedRoomStays = originalRoomStays.map((roomStay) => ({
      roomId: roomStay.roomId,
      from: toInputDate(roomStay.from),
      to: toInputDate(roomStay.to),
    }));

    correctedRoomStays[0].from = booking.checkIn;
    correctedRoomStays[correctedRoomStays.length - 1].to = booking.checkOut;

    const hasInvalidStay = correctedRoomStays.some(
      (roomStay) => new Date(roomStay.from) >= new Date(roomStay.to),
    );

    if (hasInvalidStay) {
      return res.status(400).json({
        message:
          "วันที่ใหม่ทำให้ช่วงพักเดิมไม่ถูกต้อง กรุณาใช้จัดการช่วงการเข้าพักแทน",
      });
    }

    for (let i = 0; i < correctedRoomStays.length - 1; i++) {
      if (correctedRoomStays[i].to !== correctedRoomStays[i + 1].from) {
        return res.status(400).json({
          message:
            "วันที่ใหม่ทำให้ช่วงพักไม่ต่อเนื่อง กรุณาใช้จัดการช่วงการเข้าพักแทน",
        });
      }
    }

    const roomIds = [
      ...new Set(correctedRoomStays.map((roomStay) => roomStay.roomId)),
    ];

    const conflictingBookings = await Booking.find({
      bookingId: { $ne: bookingId },
      ...ROOM_BLOCKING_BOOKING_FILTER,
      roomStays: {
        $elemMatch: {
          roomId: { $in: roomIds },
          from: { $lt: newCheckOut },
          to: { $gt: newCheckIn },
        },
      },
    });

    const hasConflict = conflictingBookings.some((conflictingBooking) =>
      conflictingBooking.roomStays.some((existing: roomStay) =>
        correctedRoomStays.some(
          (incoming) =>
            existing.roomId === incoming.roomId &&
            new Date(existing.from) < new Date(incoming.to) &&
            new Date(existing.to) > new Date(incoming.from),
        ),
      ),
    );

    if (hasConflict) {
      return res.status(409).json({
        message: "ห้องถูกจองในช่วงวันที่ที่แก้ไข",
      });
    }

    const updatedBooking = await Booking.findOneAndUpdate(
      { bookingId },
      {
        $set: {
          name: booking.name,
          checkIn: newCheckIn,
          checkOut: newCheckOut,
          nights: calculateNights(booking.checkIn, booking.checkOut),
          platformId: booking.platformId,
          note: booking.note || "",
          roomStays: correctedRoomStays,
        },
      },
      { new: true },
    );

    logActivity(
      req.user?.username,
      "EDIT_BOOKING",
      {
        changes: {
          name: { before: existingBooking.name, after: booking.name },
          checkIn: { before: existingBooking.checkIn, after: newCheckIn },
          checkOut: { before: existingBooking.checkOut, after: newCheckOut },
          platformId: {
            before: existingBooking.platformId,
            after: booking.platformId,
          },
          note: {
            before: existingBooking.note || "",
            after: booking.note || "",
          },
          roomStays: {
            before: existingBooking.roomStays,
            after: correctedRoomStays,
          },
        },
      },
      String(bookingId),
    );

    res.status(200).json({
      message: "แก้ไข booking สำเร็จ",
      booking: updatedBooking,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
};

export const getTodayBookings = async (req: Request, res: Response) => {
  const { type } = req.params;
  const { start: startOfToday, end: startOfTomorrow } = getBusinessDayBounds();

  try {
    let bookings: booking[] = [];

    switch (type) {
      case "arrivals":
        bookings = await Booking.find({
          status: { $ne: "cancelled" },
          checkIn: { $gte: startOfToday, $lt: startOfTomorrow },
        });
        break;
      case "departures":
        bookings = await Booking.find({
          status: { $ne: "cancelled" },
          checkOut: { $gte: startOfToday, $lt: startOfTomorrow },
        });
        break;
      default:
        return res
          .status(400)
          .json({ error: "Please specify the type of query" });
    }

    const occupancy = await getGuestsInHouse();

    res.status(200).json({ bookings, occupancy });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch bookings" });
  }
};

export const getAdminDashboardStats = async (req: Request, res: Response) => {
  if (!req.user?.admin) {
    return res.status(403).json({
      message: "เฉพาะผู้ดูแลระบบเท่านั้นที่สามารถดูสถิตินี้ได้",
    });
  }

  const today = new Date();
  const { start: startOfToday, end: startOfTomorrow } =
    getBusinessDayBounds(today);
  const { start: startOfMonth, end: startOfNextMonth } =
    getBusinessMonthBounds(today);

  try {
    const [todayArrivals, monthBookings, unpaidBookings, occupancy] =
      await Promise.all([
        Booking.find({
          checkIn: { $gte: startOfToday, $lt: startOfTomorrow },
        }),
        Booking.find({
          checkIn: { $gte: startOfMonth, $lt: startOfNextMonth },
        }),
        Booking.find({
          status: { $ne: "checkedOut" },
          transactions: {
            $elemMatch: {
              type: "roomCharge",
              paymentMethod: "Unpaid",
            },
          },
        }),
        getGuestsInHouse(today),
      ]);

    const todayExpectedRevenue = todayArrivals.reduce(
      (sum, booking) => sum + roomChargeRevenue(booking),
      0,
    );
    const monthRoomRevenue = monthBookings.reduce(
      (sum, booking) => sum + roomChargeRevenue(booking),
      0,
    );
    const unpaidAmount = unpaidBookings.reduce(
      (sum, booking) => sum + unpaidRoomChargeAmount(booking),
      0,
    );

    const channelCounts = new Map<PlatformId, number>();
    const revenueByDate = new Map<string, number>();

    for (
      let date = new Date(startOfMonth);
      date <= startOfToday;
      date.setDate(date.getDate() + 1)
    ) {
      revenueByDate.set(formatLocalDateKey(date), 0);
    }

    monthBookings.forEach((booking) => {
      channelCounts.set(
        booking.platformId,
        (channelCounts.get(booking.platformId) || 0) + 1,
      );

      const dateKey = formatLocalDateKey(booking.checkIn);
      if (revenueByDate.has(dateKey)) {
        revenueByDate.set(
          dateKey,
          (revenueByDate.get(dateKey) || 0) + roomChargeRevenue(booking),
        );
      }
    });

    const channelMix = Array.from(channelCounts.entries()).map(
      ([platformId, count]) => ({
        platformId,
        count,
      }),
    );
    const revenueSeries = Array.from(revenueByDate.entries()).map(
      ([date, revenue]) => ({
        date,
        revenue,
      }),
    );

    res.status(200).json({
      todayExpectedRevenue,
      monthRoomRevenue,
      monthBookings: monthBookings.length,
      unpaidAmount,
      occupancyRate: occupancy / TOTAL_GUEST_CAPACITY,
      channelMix,
      revenueSeries,
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch admin dashboard stats" });
  }
};

const escapeRegex = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const getMasterBookings = async (req: Request, res: Response) => {
  const { from, to, name, bookingId, room, channel } = req.query;

  if (!from || !to) {
    return res.status(400).json({
      message: "Please specify from and to dates",
    });
  }

  const fromDate = new Date(`${from as string}T00:00:00`);
  const toDate = new Date(`${to as string}T00:00:00`);

  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
    return res.status(400).json({
      message: "Invalid date range",
    });
  }

  if (fromDate > toDate) {
    return res.status(400).json({
      message: "วันที่เริ่มต้นต้องไม่อยู่หลังวันที่สิ้นสุด",
    });
  }

  const endOfToDate = new Date(toDate);
  endOfToDate.setDate(endOfToDate.getDate() + 1);

  try {
    const query: Record<string, unknown> = {
      checkIn: { $lt: endOfToDate },
      checkOut: { $gt: fromDate },
    };

    if (typeof name === "string" && name.trim()) {
      query.name = { $regex: escapeRegex(name.trim()), $options: "i" };
    }

    if (typeof bookingId === "string" && bookingId.trim()) {
      query.bookingId = { $regex: escapeRegex(bookingId.trim()), $options: "i" };
    }

    if (typeof room === "string" && room.trim()) {
      query["roomStays.roomId"] = room.trim();
    }

    if (typeof channel === "string" && channel.trim()) {
      query.platformId = channel.trim();
    }

    const bookings = await Booking.find(query).sort({
      checkIn: 1,
      checkOut: 1,
      name: 1,
    });
    const occupancy = await getGuestsInHouse();

    res.status(200).json({ bookings, occupancy });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch bookings" });
  }
};

// export const getTodayDepartureBookings = async (
//   req: Request,
//   res: Response,
// ) => {
//   const now = new Date();
//   const startOfToday = new Date(now);
//   startOfToday.setHours(0, 0, 0, 0);

//   const startOfTomorrow = new Date(startOfToday);
//   startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);

//   try {
//     const bookings = await Booking.find({
//       checkOut: { $gte: startOfToday, $lt: startOfTomorrow },
//     });
//     res.status(200).json({ bookings });
//   } catch (err) {
//     res.status(500).json({ error: "Failed to fetch bookings" });
//   }
// };

export const removeBooking = async (req: Request, res: Response) => {
  const { bookingId } = req.params;

  try {
    if (!req.user?.admin) {
      return res.status(403).json({
        message: "เฉพาะผู้ดูแลระบบเท่านั้นที่สามารถลบการจองได้",
      });
    }

    const booking = await Booking.findOne({ bookingId });

    if (!booking)
      return res.status(404).json({
        message: "ไม่พบ booking นี้",
      });

    if (booking.status !== "booked") {
      return res.status(409).json({
        message: "ลบได้เฉพาะ booking ที่ยังไม่ได้ check-in",
      });
    }

    const deletedBooking = await Booking.findOneAndDelete({ bookingId });

    if (!deletedBooking)
      return res.status(400).json({
        message: "Deletion Unsuccessfull",
      });

    res.status(200).json({
      removedBooking: deletedBooking,
      message: `Successfully deleted bookingId: ${bookingId}`,
    });

    logActivity(req.user?.username, "REMOVE_BOOKING", {
      snapshot: {
        name: deletedBooking.name,
        checkIn: deletedBooking.checkIn,
        checkOut: deletedBooking.checkOut,
        platformId: deletedBooking.platformId,
        roomId: deletedBooking.roomStays?.[0]?.roomId,
        price: deletedBooking.transactions?.[0]?.amount,
        paymentMethod: deletedBooking.transactions?.[0]?.paymentMethod,
        bookingId: deletedBooking.bookingId,
      },
    });
  } catch (err) {
    res.status(400).json({ error: "Deletion Unsuccessful" });
  }
};

type checkInData = {
  deposit: number;
  unpaidPayment?: {
    paymentMethod: PaymentMethod;
    roundingAdjustment?: number;
  };
  passportData: {
    passportNo: string;
    passportName: string;
    nationality: string;
  };
};

export const checkIn = async (req: Request, res: Response) => {
  try {
    const { bookingId } = req.params;
    const checkInData: checkInData = req.body;

    if (!bookingId)
      return res.status(400).json({
        message: "กรุณาแนบข้อมูล bookingId เพื่อดำเนินการ check-in",
      });

    if (
      !checkInData.passportData?.nationality ||
      !checkInData.passportData?.passportNo ||
      !checkInData.passportData?.passportName ||
      checkInData.deposit == null
    ) {
      return res.status(400).json({
        message: "กรุณากรอกข้อมูลให้ครบทุกช่อง",
      });
    }

    if (checkInData.deposit < 0) {
      return res.status(400).json({
        message: "ยอดมัดจำต้องไม่ติดลบ",
      });
    }

    const existingBooking = await Booking.findOne({ bookingId });

    if (!existingBooking) {
      return res.status(404).json({
        message: "ไม่พบ booking นี้",
      });
    }

    if (existingBooking.status !== "booked") {
      return res.status(409).json({
        message: "booking นี้ไม่สามารถ check-in ซ้ำได้",
      });
    }

    const hasDeposit = existingBooking.transactions.some(
      (transaction) => transaction.type === "deposit",
    );

    if (hasDeposit) {
      return res.status(409).json({
        message: "booking นี้มีรายการมัดจำแล้ว",
      });
    }

    const hashPassport = (passportNo: string) => {
      return crypto.createHash("sha256").update(passportNo).digest("hex");
    };

    const encrypt = (text: string) => {
      if (!process.env.CRYPTO_SECRET) throw new Error("CRYPTO_SECRET Missing");

      const key = Buffer.from(process.env.CRYPTO_SECRET, "hex");
      const iv = crypto.randomBytes(12);

      const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);

      let cipherText = cipher.update(text, "utf8", "hex");
      cipherText += cipher.final("hex");

      const authTag = cipher.getAuthTag();

      return {
        iv: iv.toString("hex"),
        cipherText,
        authTag: authTag.toString("hex"),
      };
    };

    const encryptedPassportData = {
      passportHash: hashPassport(checkInData.passportData.passportNo),
      nationality: checkInData.passportData.nationality,
      passportNo: encrypt(checkInData.passportData.passportNo),
      passportName: encrypt(checkInData.passportData.passportName),
    };

    const newTransactions: transcation[] = [
      {
        type: "deposit",
        paymentMethod: "Cash",
        amount: checkInData.deposit,
      },
    ];

    if (checkInData.unpaidPayment?.roundingAdjustment)
      newTransactions.push({
        type: "adjustment",
        paymentMethod: "Cash",
        amount: checkInData.unpaidPayment.roundingAdjustment,
      });

    if (checkInData.unpaidPayment) {
      const unpaidRoomCharge = existingBooking.transactions.find(
        (transaction) =>
          transaction.type === "roomCharge" &&
          transaction.paymentMethod === "Unpaid",
      );

      if (
        checkInData.unpaidPayment.paymentMethod === "Card" &&
        unpaidRoomCharge
      ) {
        newTransactions.push({
          type: "cardSurcharge",
          paymentMethod: "Card",
          relatedTransactionType: "roomCharge",
          amount: calculateCardSurcharge(unpaidRoomCharge.amount),
        });
      }

      await Booking.findOneAndUpdate(
        {
          bookingId,
          transactions: {
            $elemMatch: {
              paymentMethod: "Unpaid",
              type: "roomCharge",
            },
          },
        },
        {
          $set: {
            "transactions.$[transaction].paymentMethod":
              checkInData.unpaidPayment.paymentMethod,
          },
        },
        {
          arrayFilters: [
            {
              "transaction.paymentMethod": "Unpaid",
              "transaction.type": "roomCharge",
            },
          ],
        },
      );
    }

    const updatedBooking = await Booking.findOneAndUpdate(
      { bookingId, status: "booked" },
      {
        $push: {
          transactions: {
            $each: newTransactions,
          },
        },
        $set: {
          status: "checkedIn",
          checkInByStaffUsername: req.user?.username,
          passport: encryptedPassportData,
        },
      },
      { new: true },
    );

    if (!updatedBooking) {
      return res.status(404).json({
        message: "ไม่พบ booking นี้",
      });
    }

    const sanitizedBooking = updatedBooking?.toObject();

    if (sanitizedBooking?.passport) {
      delete sanitizedBooking.passport.passportHash;
      delete sanitizedBooking.passport.passportNo;
      delete sanitizedBooking.passport.passportName;
    }

    res.status(200).json(sanitizedBooking);

    logActivity(
      req.user?.username,
      "CHECK_IN",
      {
        changes: {
          status: { before: "booked", after: "checkedIn" },
          checkInByStaffUsername: {
            before: existingBooking.checkInByStaffUsername,
            after: req.user?.username,
          },
        },
      },
      String(bookingId),
    );
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
};

type CalendarBooking = {
  name: string;
  from: Date;
  to: Date;
  bookingId: string;
  platformId: PlatformId;
  status: Status;
};

type Room = {
  roomId: string;
  bookings: CalendarBooking[];
};

export const getMonthCalendar = async (req: Request, res: Response) => {
  try {
    let { year, month } = req.query;
    const today = new Date();

    const parsedYear = year ? parseInt(year as string) : today.getFullYear();
    const parsedMonth = month ? parseInt(month as string) : today.getMonth();

    const startingDate = new Date(parsedYear, parsedMonth, 1); // 1st day of the month
    const endingDate = new Date(parsedYear, parsedMonth + 1, 1); // 1st day of next month

    const monthOfBookings = await Booking.find({
      ...ROOM_BLOCKING_BOOKING_FILTER,
      checkIn: { $lt: endingDate },
      checkOut: { $gt: startingDate },
    });

    const rooms: Room[] = [
      {
        roomId: "Balcony",
        bookings: [],
      },
      {
        roomId: "Window",
        bookings: [],
      },
      {
        roomId: "Pottery 1",
        bookings: [],
      },
      {
        roomId: "Pottery 2",
        bookings: [],
      },

      ...Array.from({ length: 14 }, (_, i) => ({
        roomId: `Siesta ${i + 1}`,
        bookings: [],
      })),

      ...Array.from({ length: 8 }, (_, i) => ({
        roomId: `Marquisette ${i + 1}`,
        bookings: [],
      })),

      ...Array.from({ length: 8 }, (_, i) => ({
        roomId: `Homespan ${i + 1}`,
        bookings: [],
      })),

      ...Array.from({ length: 6 }, (_, i) => ({
        roomId: `Veranda ${i + 1}`,
        bookings: [],
      })),

      ...Array.from({ length: 6 }, (_, i) => ({
        roomId: `Wicker ${i + 1}`,
        bookings: [],
      })),
    ];

    monthOfBookings.forEach((booking) => {
      booking.roomStays.forEach((roomStay) => {
        const roomWithMatchingId = rooms.find(
          (room) => room.roomId === roomStay.roomId,
        );
        roomWithMatchingId?.bookings.push({
          name: booking.name,
          platformId: booking.platformId,
          bookingId: booking.bookingId,
          from: roomStay.from,
          to: roomStay.to,
          status: booking.status,
        });
      });
    });

    res.status(200).json(rooms);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
};

export const getBookingById = async (req: Request, res: Response) => {
  try {
    const { bookingId } = req.params;

    const booking = await Booking.findOne({ bookingId });

    res.status(200).json(booking);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
};

export const manageRoomStays = async (req: Request, res: Response) => {
  try {
    const { roomStays } = req.body;
    const { bookingId } = req.params;

    if (
      !Array.isArray(roomStays) ||
      roomStays.length === 0 ||
      !roomStays.every(
        (roomStay: roomStay) => roomStay.roomId && roomStay.from && roomStay.to,
      )
    )
      return res.status(400).json({
        error: "MISSING",
        message: "กรุณากรอกข้อมูลให้ครบทุกช่อง",
      });

    const sorted = [...roomStays].sort(
      (a, b) => new Date(a.from).getTime() - new Date(b.from).getTime(),
    );

    // Check if they overlap or not && each room is available then && full from checkin till checkout
    const hasInternalOverlap = (sorted: roomStay[]) => {
      for (let i = 0; i < sorted.length - 1; i++) {
        const currentEnd = new Date(sorted[i].to);
        const nextStart = new Date(sorted[i + 1].from);

        if (currentEnd > nextStart) return true;
      }

      return false;
    };

    if (hasInternalOverlap(sorted))
      return res.status(400).json({
        error: "ROOM_STAYS_OVERLAP",
        message: "ช่วงการเข้าพักซ้อนกัน",
      });

    const booking = await Booking.findOne({ bookingId }).lean();

    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }

    if (booking.status === "checkedOut") {
      return res.status(409).json({
        error: "BOOKING_CHECKED_OUT",
        message: "ไม่สามารถแก้ไขช่วงพักของ booking ที่ check-out แล้ว",
      });
    }

    const originalRoomStays = booking.roomStays;

    // 1. Start must match check-in
    if (sorted[0].from !== toInputDate(booking.checkIn)) {
      return res.status(400).json({
        error: "INVALID_START",
        message: "ช่วงแรกต้องเริ่มตรงกับวันเช็คอิน",
      });
    }

    // 2. End must match check-out
    if (sorted[sorted.length - 1].to !== toInputDate(booking.checkOut)) {
      return res.status(400).json({
        error: "INVALID_END",
        message: "ช่วงสุดท้ายต้องตรงกับวันเช็คเอาท์",
      });
    }

    // 3. No gaps
    for (let i = 0; i < sorted.length - 1; i++) {
      if (sorted[i].to !== sorted[i + 1].from) {
        return res.status(400).json({
          error: "ROOM_STAYS_GAP",
          message: "ช่วงการเข้าพักต้องต่อเนื่องกัน",
        });
      }
    }

    const roomIds = [
      ...new Set(sorted.map((roomStay: roomStay) => roomStay.roomId)),
    ];
    const minFrom = new Date(sorted[0].from);
    const maxTo = new Date(sorted[sorted.length - 1].to);

    const conflictingBookings = await Booking.find({
      bookingId: { $ne: bookingId },
      ...ROOM_BLOCKING_BOOKING_FILTER,

      roomStays: {
        $elemMatch: {
          roomId: { $in: roomIds },
          from: { $lt: maxTo },
          to: { $gt: minFrom },
        },
      },
    });

    const hasConflict = conflictingBookings.some((booking) =>
      booking.roomStays.some((existing: roomStay) =>
        sorted.some(
          (incoming: roomStay) =>
            existing.roomId === incoming.roomId &&
            new Date(existing.from) < new Date(incoming.to) &&
            new Date(existing.to) > new Date(incoming.from),
        ),
      ),
    );

    if (hasConflict) {
      return res.status(409).json({
        error: "ROOM_CONFLICT",
        message: "ห้องถูกจองในช่วงเวลานี้",
      });
    }

    const updatedBooking = await Booking.findOneAndUpdate(
      { bookingId },
      {
        $set: {
          roomStays: sorted,
        },
      },
      { new: true },
    );

    logActivity(
      req.user?.username,
      "MANAGE_ROOM_STAYS",
      {
        summary: {
          beforeRoomStays: originalRoomStays,
          afterRoomStays: sorted,
        },
        changes: {
          roomStays: { before: originalRoomStays, after: sorted },
        },
      },
      String(bookingId),
    );

    res.status(200).json({ message: "สำเร็จ", booking: updatedBooking });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
};

type AddTransactionRequestBody = {
  transaction: transcation;
};
type AddTransactionParams = {
  bookingId: string;
};

export const addTransaction = async (
  req: Request<AddTransactionParams, {}, AddTransactionRequestBody>,
  res: Response,
) => {
  try {
    const { transaction } = req.body;
    const { bookingId } = req.params;

    if (!bookingId)
      return res.status(400).json({
        error: "MISSING",
        message: "กรุณากรอก BookingId ใน Params",
      });

    if (
      !transaction ||
      transaction.amount == null ||
      !transaction.paymentMethod ||
      !transaction.type
    )
      return res.status(400).json({
        error: "MISSING",
        message: "กรุณากรอกข้อมูลให้ครบทุกช่อง",
      });

    const amount = Number(transaction.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({
        error: "INVALID_AMOUNT",
        message: "จำนวนเงินต้องมากกว่า 0",
      });
    }

    if (!PAYMENT_METHODS.includes(transaction.paymentMethod)) {
      return res.status(400).json({
        error: "INVALID_PAYMENT_METHOD",
        message: "ช่องทางการชำระเงินไม่ถูกต้อง",
      });
    }

    if (!ADD_TRANSACTION_TYPES.includes(transaction.type)) {
      return res.status(400).json({
        error: "INVALID_TRANSACTION_TYPE",
        message: "ประเภทรายการไม่ถูกต้อง",
      });
    }

    const booking = await Booking.findOne({ bookingId }).lean();
    if (!booking) {
      return res.status(404).json({
        error: "BOOKING_NOT_FOUND",
        message: "ไม่พบ booking นี้",
      });
    }

    const baseTransaction: transcation = {
      type: transaction.type,
      paymentMethod: transaction.paymentMethod,
      amount,
    };

    if (transaction.reasonOfAdjustment) {
      baseTransaction.reasonOfAdjustment = transaction.reasonOfAdjustment;
    }

    const newTransactions = buildTransactionsWithCardSurcharge(baseTransaction);

    const updatedBooking = await Booking.findOneAndUpdate(
      { bookingId },
      {
        $push: {
          transactions: {
            $each: newTransactions,
          },
        },
      },
      { new: true },
    );

    logActivity(
      req.user?.username,
      "ADD_TRANSACTION",
      {
        summary: {
          addedTransactions: newTransactions,
        },
        changes: {
          transactions: {
            before: booking.transactions,
            after: updatedBooking?.transactions,
          },
        },
      },
      String(bookingId),
    );

    res.status(200).json({
      message: "เพิ่มรายการใช้จ่ายสำเร็จ",
      booking: updatedBooking,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
};

export const getPassportData = async (req: Request, res: Response) => {
  try {
    const { bookingId } = req.params;

    if (!bookingId)
      return res.status(400).json({
        error: "MISSING",
        message: "กรุณากรอก BookingId ใน Params",
      });

    if (!process.env.CRYPTO_SECRET) {
      throw new Error("CRYPTO_SECRET Missing");
    }

    const booking = await Booking.findOne({
      bookingId,
      status: {
        $in: ["checkedIn", "checkedOut"],
      },
    })
      .select("passport")
      .lean();

    if (
      !booking?.passport?.nationality ||
      !booking.passport.passportNo ||
      !booking.passport.passportName
    ) {
      return res.status(404).json({
        error: "NOT_FOUND",
        message: "ไม่พบข้อมูล Passport",
      });
    }

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

    const passportData = {
      nationality: booking.passport.nationality,
      passportNo: decrypt(booking.passport.passportNo),
      passportName: decrypt(booking.passport.passportName),
    };

    res.status(200).json({ passportData });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
};

export const cancelBooking = async (req: Request, res: Response) => {
  try {
    const { bookingId } = req.params;
    const { cancellationType, reopenRoom } = req.body;
    const cancelledByStaffUsername = req.user?.username;
    const paidCancellationTypes = ["refundable", "non_refundable"];

    if (!bookingId)
      return res.status(400).json({
        error: "MISSING",
        message: "กรุณากรอก BookingId ใน Params",
      });

    if (typeof reopenRoom !== "boolean")
      return res.status(400).json({
        error: "INVALID_PAYLOAD",
        message: "กรุณากรอกข้อมูลให้ครบและถูกต้อง",
      });

    if (!cancelledByStaffUsername) {
      return res.status(401).json({
        error: "NOT_AUTHORIZED",
        message: "กรุณาเข้าสู่ระบบใหม่",
      });
    }

    const existingBooking = await Booking.findOne({ bookingId });

    if (!existingBooking)
      return res.status(404).json({ message: "ไม่พบ Booking" });
    if (existingBooking.status !== "booked")
      return res.status(409).json({
        message: "สามารถยกเลิกได้เฉพาะ Booking ที่ยังไม่ได้ Check-In",
      });

    const paidByMethod = existingBooking.transactions.reduce(
      (totals, transaction) => {
        if (transaction.paymentMethod === "Unpaid") return totals;
        totals.set(
          transaction.paymentMethod,
          (totals.get(transaction.paymentMethod) || 0) + transaction.amount,
        );
        return totals;
      },
      new Map<PaymentMethod, number>(),
    );
    const paidAmount = Array.from(paidByMethod.values()).reduce(
      (sum, amount) => sum + amount,
      0,
    );
    const hasReceivedPayment = paidAmount > 0;

    if (
      hasReceivedPayment &&
      (typeof cancellationType !== "string" ||
        !paidCancellationTypes.includes(cancellationType))
    )
      return res.status(400).json({
        error: "INVALID_PAYLOAD",
        message: "กรุณาระบุประเภทการยกเลิกให้ถูกต้อง",
      });

    const refundAmount =
      hasReceivedPayment && cancellationType === "refundable" ? paidAmount : 0;
    const keptAmount =
      hasReceivedPayment && cancellationType === "non_refundable"
        ? paidAmount
        : 0;
    const refundTransactions: transcation[] =
      refundAmount > 0
        ? Array.from(paidByMethod.entries()).map(([paymentMethod, amount]) => ({
            type: "cancellationRefund",
            paymentMethod,
            amount,
          }))
        : [];

    const updatedBooking = await Booking.findOneAndUpdate(
      { bookingId, status: "booked" },
      {
        $set: {
          status: "cancelled",
          cancellation: {
            cancellationType: hasReceivedPayment
              ? cancellationType
              : "no_payment_received",
            roomReleaseStatus: reopenRoom ? "released" : "blocked",
            refundAmount,
            keptAmount,
            cancelledAt: new Date(),
            cancelledByStaffUsername,
          },
        },
        ...(refundTransactions.length > 0
          ? {
              $push: {
                transactions: {
                  $each: refundTransactions,
                },
              },
            }
          : {}),
      },
      { new: true },
    );

    if (!updatedBooking) {
      return res.status(404).json({
        error: "NOT_FOUND",
        message: "ไม่พบการจอง",
      });
    }

    res.status(200).json({
      message: "ยกเลิกการจองเรียบร้อย",
      booking: updatedBooking,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
};
