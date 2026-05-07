import ConfirmationModal from "../components/ConfirmationModal.tsx";
import ViewBooking from "../features/bookings/ViewBooking";
import AddBooking from "../features/bookings/AddBooking.tsx";
import axios from "axios";
import toast from "react-hot-toast";

import type { booking, PlatformId } from "../types/bookingTypes";
import { platformMap } from "../helpers/maps.ts";

import { useEffect, useMemo, useState, useRef } from "react";
import { Link } from "react-router";
import { useAuth } from "../context/AuthContext";
import { Modal } from "@mui/material";
import { calculateNights } from "../helpers/bookingHelpers";
import { useLocation } from "react-router";
import { formatBookingDates } from "../helpers/bookingHelpers";
import { API_URL } from "../config/api.ts";
import { formatLocalDate, isSameDay } from "../helpers/bookingHelpers";
// import { dummyBooking } from "./test.tsx";

import "./Calendar.css";

type CalendarBooking = {
  name: string;
  from: Date;
  to: Date;
  bookingId: string;
  platformId: PlatformId;
};

type Room = {
  roomId: string;
  bookings: CalendarBooking[];
};

const Calendar = () => {
  const today = new Date();

  const { user } = useAuth();
  const timelineRef = useRef<HTMLDivElement>(null);
  const location = useLocation();
  const [addBookingIsOpen, setAddBookingIsOpen] = useState(false);
  const [addBookingClickInfo, setAddBookingClickInfo] = useState<{
    checkIn: string | null;
    roomId: string | null;
  }>({
    checkIn: null,
    roomId: null,
  });
  const [month, setMonth] = useState(today.getMonth()); // JS MONTH 0=Jan 1=Feb 4=May
  const [year, setYear] = useState(today.getFullYear());
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [viewBookingBooking, setViewBookingBooking] = useState<booking | null>(
    null,
  );
  const [confirmationModalIsOpen, setConfirmationModalIsOpen] = useState<{
    isOpen: boolean;
    booking: booking | null;
  }>({
    isOpen: false,
    booking: null,
  });

  const getDateInMonth = (year: number, month: number) => {
    return new Date(year, month + 1, 0).getDate();
  };

  const calendarDays: Date[] = useMemo(() => {
    return Array.from(
      { length: getDateInMonth(year, month) },
      (_, i) => new Date(year, month, i + 1),
    );
  }, [month, year]); // [new Date(1,1,1), new Date(1,1,1), ...]

  const todayIndex = calendarDays.findIndex(
    (day) =>
      day.getFullYear() === today.getFullYear() &&
      day.getMonth() === today.getMonth() &&
      day.getDate() === today.getDate(),
  );

  const [rooms, setRooms] = useState<Room[]>([
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
      bookings: i % 3 === 0 ? [] : [],
    })),

    ...Array.from({ length: 8 }, (_, i) => ({
      roomId: `Marquisette ${i + 1}`,
      bookings: i % 2 === 0 ? [] : [],
    })),

    ...Array.from({ length: 8 }, (_, i) => ({
      roomId: `Homespan ${i + 1}`,
      bookings: i % 2 !== 0 ? [] : [],
    })),

    ...Array.from({ length: 6 }, (_, i) => ({
      roomId: `Veranda ${i + 1}`,
      bookings: i < 3 ? [] : [],
    })),

    ...Array.from({ length: 6 }, (_, i) => ({
      roomId: `Wicker ${i + 1}`,
      bookings: i % 2 === 0 ? [] : [],
    })),
  ]);

  let roomRows: any = [];

  const renderedDayHeaders = calendarDays.map((day, i) => {
    const monthAndDate = new Intl.DateTimeFormat("en-US", {
      day: "numeric",
      weekday: "short",
      calendar: "gregory",
    }).format(day);

    return (
      <div
        className="timeline__item timeline__dateItem"
        key={i}
        data-day={i}
        style={{ gridRow: 1 }}
      >
        <p style={i === todayIndex ? { color: "red" } : {}}>
          {monthAndDate.split(" ")[1]}
        </p>
        <p
          style={
            i === todayIndex
              ? { color: "red", fontWeight: 600 }
              : { fontWeight: 600 }
          }
        >
          {monthAndDate.split(" ")[0]}
        </p>
      </div>
    );
  });

  const monthStart = new Date(year, month, 1);
  const monthEnd = new Date(year, month + 1, 1);

  rooms.forEach((room, roomIndex) => {
    const gridRow = roomIndex + 2; // row 1 = header, rooms start at 2
    const roomRow = [];

    // Room label
    roomRow.push(
      <div
        className="timeline__item timeline__roomIdItem"
        style={{ gridColumn: "1", gridRow }}
        key={room.roomId}
      >
        <p>{room.roomId}</p>
      </div>,
    );

    // Empty clickable cells
    calendarDays.forEach((day, dayIndex) => {
      const isToday = isSameDay(day, today);

      roomRow.push(
        <div
          key={`empty-${room.roomId}-${dayIndex}`}
          className="timeline__item timeline__emptyCell"
          style={{
            gridColumn: `${dayIndex + 2}`,
            gridRow,
            backgroundColor: isToday ? "#ff000010" : undefined, // 🔥 slight red
          }}
          onClick={() => handleAddBooking(room.roomId, day)}
          title={`Add booking: ${room.roomId} — ${day.toDateString()}`}
        />,
      );
    });

    // Booking blocks
    room.bookings.forEach((booking: CalendarBooking, index) => {
      const from = new Date(booking.from);
      const to = new Date(booking.to);
      const overlaps = to > monthStart && from < monthEnd;
      if (!overlaps) return;

      const visibleStart = from < monthStart ? monthStart : from;
      const visibleEnd = to > monthEnd ? monthEnd : to;
      const startingDate = calendarDays.findIndex(
        (day) =>
          day.getFullYear() === visibleStart.getFullYear() &&
          day.getMonth() === visibleStart.getMonth() &&
          day.getDate() === visibleStart.getDate(),
      );
      if (startingDate === -1) return;

      const span = calculateNights(visibleStart, visibleEnd);
      const continuesBefore = from < monthStart;
      const continuesAfter = to > monthEnd;

      roomRow.push(
        <div
          className="timeline__item timeline__bookedRoomItem"
          title={booking.name + " (" + calculateNights(from, to) + " คืน)"}
          style={{
            gridColumn: `${startingDate + 2} / span ${span}`,
            gridRow,
            backgroundColor: platformMap[booking.platformId].color,
            borderTopLeftRadius: continuesBefore ? 0 : "0.5rem",
            borderBottomLeftRadius: continuesBefore ? 0 : "0.5rem",
            borderTopRightRadius: continuesAfter ? 0 : "0.5rem",
            borderBottomRightRadius: continuesAfter ? 0 : "0.5rem",
          }}
          key={index}
          onClick={() =>
            setViewBookingBooking({ bookingId: booking.bookingId } as booking)
          }
        >
          <p className="timeline__itemText">
            {booking.name}{" "}
            <span className="timeline__itemNights">
              {calculateNights(from, to)} คืน
            </span>
          </p>
        </div>,
      );
    });

    roomRows.push(roomRow);
  });

  const handleAddBooking = (roomId: string, checkIn: Date) => {
    setAddBookingIsOpen(true);
    setAddBookingClickInfo({
      roomId,
      checkIn: formatLocalDate(checkIn),
    });
  };

  console.log(roomRows);

  const appendToBookings = (booking: booking) => {
    const formattedBooking = formatBookingDates(booking);

    setRooms((prevRooms) =>
      prevRooms.map((room) => {
        if (room.roomId !== booking.roomStays[0].roomId) return room;

        return {
          ...room,
          bookings: [
            ...room.bookings,
            {
              name: formattedBooking.name,
              from: new Date(formattedBooking.roomStays[0].from),
              to: new Date(formattedBooking.roomStays[0].to),
              bookingId: formattedBooking.bookingId,
              platformId: formattedBooking.platformId,
            },
          ],
        };
      }),
    );

    setAddBookingIsOpen(false);
  };

  const nextMonth = () => {
    if (month + 1 < 11) return setMonth(month + 1);

    setYear(year + 1);
    setMonth(0);
  };

  const previousMonth = () => {
    if (month - 1 > -1) return setMonth(month - 1);

    setYear(year - 1);
    setMonth(11);
  };

  const getRooms = async () => {
    const fetchedRooms = await axios.get(
      `${API_URL}/bookings/getMonthCalendar?month=${month}&year=${year}`,
      {
        withCredentials: true,
      },
    );

    setRooms(fetchedRooms.data);
    setLastUpdated(new Date());
  };

  useEffect(() => {
    getRooms();
  }, [month, year, location]);

  const isfirstRun = useRef(true);
  useEffect(() => {
    const el = timelineRef.current;
    if (!el) return;

    const todayEl = el.querySelector(`[data-day="${todayIndex}"]`);
    if (!todayEl) return;

    console.log(todayIndex);

    todayEl.scrollIntoView({
      behavior: isfirstRun.current ? "instant" : "smooth",
      inline: "start",
    });
    isfirstRun.current = false;
  }, [month, year]);

  const closeAllModals = () => {
    setViewBookingBooking(null);
    setConfirmationModalIsOpen({ isOpen: false, booking: null });
    getRooms();
  };

  const removeBookingHandler = (booking: booking) => {
    setConfirmationModalIsOpen({ isOpen: true, booking });
  };

  return (
    <main className="calendar__main">
      <Modal
        open={!!viewBookingBooking}
        onClose={() => setViewBookingBooking(null)}
        className="home__modalCenter"
      >
        <ViewBooking
          booking={null}
          bookingId={viewBookingBooking?.bookingId}
          onClose={() => setViewBookingBooking(null)}
          setCheckInIsOpen={() => {}}
          removeBookingHandler={removeBookingHandler}
        />
      </Modal>
      <Modal
        open={confirmationModalIsOpen.isOpen}
        onClose={() =>
          setConfirmationModalIsOpen((prev) => ({ ...prev, isOpen: false }))
        }
        className="home__modalCenter"
      >
        <ConfirmationModal
          booking={confirmationModalIsOpen.booking}
          onClose={() =>
            setConfirmationModalIsOpen((prev) => ({ ...prev, isOpen: false }))
          }
          closeAllModals={closeAllModals}
        />
      </Modal>
      <Modal
        open={addBookingIsOpen}
        className="home__modalCenter"
        onClose={() => setAddBookingIsOpen(false)}
      >
        <AddBooking
          appendToBookings={appendToBookings}
          clickInfo={addBookingClickInfo}
          onClose={() => setAddBookingIsOpen(false)}
        />
      </Modal>
      <header className="home__header">
        <div>
          <h1 className="calendar__monthSelector">
            <i className="bx bx-caret-left" onClick={() => previousMonth()} />
            {new Intl.DateTimeFormat("th-TH", {
              day: undefined,
              month: "long",
              year: "numeric",
              calendar: "gregory",
            }).format(new Date(year, month, 1))}
            <i className="bx bx-caret-right" onClick={() => nextMonth()} />
          </h1>
          <div style={{ display: "flex", gap: "0.3rem", marginTop: "0.5rem" }}>
            <p>
              ข้อมูลอัปเดตล่าสุดเมื่อ {lastUpdated?.getHours()}:
              {lastUpdated?.getMinutes().toString().padStart(2, "0")}
            </p>
            <i
              className="bx bx-refresh home__refreshIcon"
              onClick={() => {
                toast.promise(getRooms, {
                  loading: "กำลังอัปเดตข้อมูล...",
                  success: "อัปเดตข้อมูลสำเร็จ",
                  error: "เกิดข้อผิดพลาดในการอัปเดตข้อมูล",
                });
              }}
            />
          </div>
        </div>

        <div className="home__headerProfile">
          <p>
            {user?.name} <strong>{"  " + user?.admin && "Admin"}</strong>
          </p>
          <Link to={"/settings"}>
            <img
              className="home__profileImg"
              src="https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcR3m972e8FEvBi7ETC03avlJcZDg8nT9dWLSw&s"
              alt="profilePicture"
            />
          </Link>
        </div>
      </header>

      <div className="timeline__wrapper" ref={timelineRef}>
        <div
          className="timeline"
          style={{
            gridTemplateColumns: `var(--timeline-room-column-width, 10rem) repeat(${getDateInMonth(year, month)}, 4rem)`,
            gridTemplateRows: `repeat(${rooms.length + 1}, 3rem)`,
          }}
        >
          <div
            style={{ gridRow: 1, gridColumn: 1 }}
            className="timeline__item timeline__roomIdItem"
          >
            ห้อง / วัน
          </div>
          {renderedDayHeaders}

          {roomRows}
        </div>
      </div>
    </main>
  );
};

export default Calendar;
