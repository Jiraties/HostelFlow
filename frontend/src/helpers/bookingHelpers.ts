import type { booking } from "../types/bookingTypes";

export const roomChargeTransaction = (booking: booking) => {
  const transaction = booking.transactions.find(
    (transaction) => transaction.type === "roomCharge",
  );

  if (transaction) return transaction;
  return {
    type: "roomCharge",
    paymentMethod: "Unpaid",

    amount: 0,
  };
};

export const calculateNights = (checkIn: Date, checkOut: Date) => {
  const start = new Date(
    checkIn.getFullYear(),
    checkIn.getMonth(),
    checkIn.getDate(),
  );

  const end = new Date(
    checkOut.getFullYear(),
    checkOut.getMonth(),
    checkOut.getDate(),
  );

  const diff = end.getTime() - start.getTime();
  return diff / 86400000;
};

export const formatLocalDate = (date: Date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

export const isSameDay = (d1: Date, d2: Date) =>
  d1.getFullYear() === d2.getFullYear() &&
  d1.getMonth() === d2.getMonth() &&
  d1.getDate() === d2.getDate();

type Booking = {
  name: string;
  status: "booked" | "checkedIn" | "checkedOut";
  bookingId: string;
  from: Date;
  to: Date;
};

export const toInputDate = formatLocalDate;

export const populateDummyBookings = (
  rooms: { roomId: string; bookings: Booking[] }[],
  year: number,
  month: number,
) => {
  const getRandomInt = (min: number, max: number) =>
    Math.floor(Math.random() * (max - min + 1)) + min;

  const names = [
    "Alice",
    "Bob",
    "Charlie",
    "David",
    "Emma",
    "Frank",
    "Grace",
    "Henry",
    "Ivy",
    "Jack",
  ];

  return rooms.map((room) => {
    const bookings: Booking[] = [];

    let currentDay = getRandomInt(1, 5); // start early in month

    while (currentDay < 25) {
      const stayLength = getRandomInt(2, 4); // 2–4 nights

      const from = new Date(year, month, currentDay);
      const to = new Date(year, month, currentDay + stayLength);

      bookings.push({
        name: names[getRandomInt(0, names.length - 1)],
        status: "booked",
        bookingId: `${room.roomId}-${currentDay}`,
        from,
        to,
      });

      // move forward with a gap (prevents overlap)
      currentDay += stayLength + getRandomInt(1, 3);
    }

    return {
      ...room,
      bookings,
    };
  });
};

export const formatBookingsDates = (bookings: booking[]) =>
  bookings.map(formatBookingDates);

export const formatBookingDates = (booking: booking) => ({
  ...booking,
  checkIn: new Date(booking.checkIn),
  checkOut: new Date(booking.checkOut),
});
