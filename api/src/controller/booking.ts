import Booking, { PaymentMethod } from "../models/booking";
import dotenv from "dotenv";
import crypto from "crypto";

import { NextFunction, Request, Response } from "express";
import { logActivity } from "../services/activityServices";
import type { PlatformId, Status } from "../models/booking";

dotenv.config();

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

    const calculateNights = (checkIn: string, checkOut: string) => {
      const checkInDate = new Date(checkIn + "T00:00:00");
      const checkOutDate = new Date(checkOut + "T00:00:00");

      const diff = checkOutDate.getTime() - checkInDate.getTime();
      return diff / 86400000;
    };

    // find bookings that have same room && checkout greater than new checkin && checkin less than new checkout
    const overlappingBooking = await Booking.findOne({
      roomStays: {
        $elemMatch: {
          roomId: booking.roomId,
          from: { $lt: newCheckOut },
          to: { $gt: newCheckIn },
        },
      },
    });

    if (overlappingBooking) {
      const from = new Date(overlappingBooking.roomStays[0].from);
      const to = new Date(overlappingBooking.roomStays[0].to);

      const formatDay = (date: Date) =>
        new Intl.DateTimeFormat("th-TH", { day: "numeric" }).format(date);

      const formatMonth = (date: Date) =>
        new Intl.DateTimeFormat("th-TH", { month: "short" }).format(date);

      const sameMonth = from.getMonth() === to.getMonth();

      const dateText = sameMonth
        ? `${formatDay(from)}-${formatDay(to)} ${formatMonth(to)}`
        : `${formatDay(from)} ${formatMonth(from)} - ${formatDay(to)} ${formatMonth(to)}`;
      return res.status(409).json({
        message: `ห้องนี้ถูกจองแล้วระหว่างวันที่ ${dateText} กรุณาเลือกช่วงเวลาอื่น`,
      });
    }

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

      transactions: [
        {
          type: "roomCharge",
          amount: booking.price,
          paymentMethod: booking.paymentMethod,
        },
      ],

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

export const getTodayArrivalBookings = async (req: Request, res: Response) => {
  const today = new Date().toISOString().split("T")[0];
  const todayDateString = new Date(today + "T00:00:00");

  const tomorrow = new Date(todayDateString);
  tomorrow.setDate(tomorrow.getDate() + 1);

  try {
    const bookings = await Booking.find({
      checkIn: { $gte: todayDateString, $lt: tomorrow },
    });
    res.status(200).json({ bookings });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch bookings" });
  }
};

export const getTodayDepartureBookings = async (
  req: Request,
  res: Response,
) => {
  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);

  const startOfTomorrow = new Date(startOfToday);
  startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);

  try {
    const bookings = await Booking.find({
      checkOut: { $gte: startOfToday, $lt: startOfTomorrow },
    });
    res.status(200).json({ bookings });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch bookings" });
  }
};

export const removeBooking = async (req: Request, res: Response) => {
  const { bookingId } = req.params;

  try {
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
      !checkInData.passportData.nationality ||
      !checkInData.passportData.passportNo ||
      !checkInData.passportData.passportName ||
      checkInData.deposit == null
    ) {
      return res.status(400).json({
        message: "กรุณากรอกข้อมูลให้ครบทุกช่อง",
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

    const newTransactions = [
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

    const updatedBooking = await Booking.findOneAndUpdate(
      { bookingId },
      {
        $push: {
          transactions: {
            $each: newTransactions,
          },
        },
        $set: {
          status: "checkedIn",
          checkInByStaffUsername: req.user?.userId,
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
