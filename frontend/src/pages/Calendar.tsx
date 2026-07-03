import ConfirmationModal from "../components/ConfirmationModal.tsx";
import UnsavedChangesModal from "../components/UnsavedChangesModal.tsx";
import ViewBooking from "../features/bookings/ViewBooking";
import AddBooking from "../features/bookings/AddBooking.tsx";
import PageHeader from "../components/PageHeader.tsx";
import axios from "axios";

import type { booking, PlatformId } from "../types/bookingTypes";
import { platformMap } from "../helpers/maps.ts";

import { useEffect, useMemo, useState, useRef } from "react";
import { Modal } from "@mui/material";
import type { ReactNode } from "react";
import { calculateNights } from "../helpers/bookingHelpers";
import { useLocation } from "react-router";
import { formatBookingDates } from "../helpers/bookingHelpers";
import { API_URL } from "../config/api.ts";
import { requestUnsavedModalClose } from "../helpers/modalGuards";
import { formatLocalDate, isSameDay } from "../helpers/bookingHelpers";
import { getRoomStayRoomIds } from "../helpers/roomStayHelpers";
import usePageTitle from "../hooks/useTitle";
// import { dummyBooking } from "./test.tsx";

import "./Calendar.css";

type CalendarBooking = {
  name: string;
  from: Date;
  to: Date;
  bookingId: string;
  platformId: PlatformId;
  status: booking["status"];
};

type Room = {
  roomId: string;
  bookings: CalendarBooking[];
};

const statusLabelMap: Record<booking["status"], string> = {
  booked: "รอเช็คอิน",
  checkedIn: "เข้าพัก",
  checkedOut: "เช็คเอาท์",
  cancelled: "ยกเลิก",
  noShow: "No-show",
};

const statusColorMap: Record<booking["status"], string> = {
  booked: "#00ADEF",
  checkedIn: "var(--green)",
  checkedOut: "#64748b",
  cancelled: "var(--red)",
  noShow: "#6b7280",
};

const calendarLegendItems = [
  { label: "รอเช็คอิน", color: "#00ADEF" },
  { label: "เข้าพัก", color: statusColorMap.checkedIn },
  { label: "เช็คเอาท์", color: statusColorMap.checkedOut },
  { label: "ยกเลิก / No-show", color: statusColorMap.cancelled },
  { label: "ค้างชำระ", color: "#ef4444", type: "outline" },
];

const Calendar = () => {
  usePageTitle("HostelFlow · ตารางการจอง");
  const today = new Date();

  const timelineRef = useRef<HTMLDivElement>(null);
  const location = useLocation();
  const [addBookingIsOpen, setAddBookingIsOpen] = useState(false);
  const [addBookingIsDirty, setAddBookingIsDirty] = useState(false);
  const [pendingUnsavedClose, setPendingUnsavedClose] = useState<
    (() => void) | null
  >(null);
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

  const startOfCalendarDay = (date: Date) =>
    new Date(date.getFullYear(), date.getMonth(), date.getDate());

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

  const roomRows: ReactNode[] = [];
  const mergedBookingBlocks: ReactNode[] = [];

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

  const monthStart = startOfCalendarDay(new Date(year, month, 1));
  const monthEnd = startOfCalendarDay(new Date(year, month + 1, 1));

  const getVisibleBookingPosition = (booking: CalendarBooking) => {
    const from = startOfCalendarDay(new Date(booking.from));
    const to = startOfCalendarDay(new Date(booking.to));
    const overlaps = to > monthStart && from < monthEnd;
    if (!overlaps) return null;

    const visibleStart = from < monthStart ? monthStart : from;
    const visibleEnd = to > monthEnd ? monthEnd : to;
    const startingDate = calendarDays.findIndex(
      (day) =>
        day.getFullYear() === visibleStart.getFullYear() &&
        day.getMonth() === visibleStart.getMonth() &&
        day.getDate() === visibleStart.getDate(),
    );
    if (startingDate === -1) return null;

    const span = calculateNights(visibleStart, visibleEnd);
    if (span <= 0) return null;

    return {
      from,
      to,
      startingDate,
      span,
      continuesBefore: from < monthStart,
      continuesAfter: to > monthEnd,
    };
  };

  const bookingBlocksBySegment = new Map<
    string,
    { booking: CalendarBooking; roomIndex: number }[]
  >();

  rooms.forEach((room, roomIndex) => {
    const gridRow = roomIndex + 2; // row 1 = header, rooms start at 2
    const roomRow: ReactNode[] = [];

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

    room.bookings.forEach((booking: CalendarBooking) => {
      const position = getVisibleBookingPosition(booking);
      if (!position) return;

      const segmentKey = [
        booking.bookingId,
        position.from.getTime(),
        position.to.getTime(),
      ].join("::");

      bookingBlocksBySegment.set(segmentKey, [
        ...(bookingBlocksBySegment.get(segmentKey) || []),
        { booking, roomIndex },
      ]);
    });

    roomRows.push(roomRow);
  });

  bookingBlocksBySegment.forEach((items, segmentKey) => {
    const sortedItems = [...items].sort((a, b) => a.roomIndex - b.roomIndex);
    const rowGroups: { booking: CalendarBooking; roomIndexes: number[] }[] = [];

    sortedItems.forEach((item) => {
      const currentGroup = rowGroups[rowGroups.length - 1];
      const previousRoomIndex =
        currentGroup?.roomIndexes[currentGroup.roomIndexes.length - 1];

      if (currentGroup && previousRoomIndex === item.roomIndex - 1) {
        currentGroup.roomIndexes.push(item.roomIndex);
        return;
      }

      rowGroups.push({ booking: item.booking, roomIndexes: [item.roomIndex] });
    });

    rowGroups.forEach((group, groupIndex) => {
      const booking = group.booking;
      const position = getVisibleBookingPosition(booking);
      if (!position) return;

      const gridRow = `${group.roomIndexes[0] + 2} / span ${
        group.roomIndexes.length
      }`;

      mergedBookingBlocks.push(
        <div
          className="timeline__item timeline__bookedRoomItem"
          title={
            booking.name +
            " (" +
            calculateNights(position.from, position.to) +
            " คืน)"
          }
          style={{
            gridColumn: `${position.startingDate + 2} / span ${position.span}`,
            gridRow,
            backgroundColor:
              statusColorMap[booking.status] ||
              platformMap[booking.platformId].color,
            borderTopLeftRadius: position.continuesBefore ? 0 : "0.5rem",
            borderBottomLeftRadius: position.continuesBefore ? 0 : "0.5rem",
            borderTopRightRadius: position.continuesAfter ? 0 : "0.5rem",
            borderBottomRightRadius: position.continuesAfter ? 0 : "0.5rem",
          }}
          key={`${segmentKey}-${groupIndex}`}
          onClick={() =>
            setViewBookingBooking({ bookingId: booking.bookingId } as booking)
          }
        >
          <p className="timeline__itemText">
            <span className="timeline__bookingName">{booking.name}</span>{" "}
            <span className="timeline__statusChip">
              {statusLabelMap[booking.status]}
            </span>
            <span className="timeline__itemNights">
              {calculateNights(position.from, position.to)} คืน
            </span>
          </p>
        </div>,
      );
    });
  });

  const handleAddBooking = (roomId: string, checkIn: Date) => {
    setAddBookingIsOpen(true);
    setAddBookingClickInfo({
      roomId,
      checkIn: formatLocalDate(checkIn),
    });
  };

  const appendToBookings = (booking: booking) => {
    const formattedBooking = formatBookingDates(booking);

    setRooms((prevRooms) =>
      prevRooms.map((room) => {
        const firstStay = formattedBooking.roomStays[0];
        if (
          !firstStay ||
          !getRoomStayRoomIds(firstStay).includes(room.roomId)
        ) {
          return room;
        }

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
              status: formattedBooking.status,
            },
          ],
        };
      }),
    );

    setAddBookingIsOpen(false);
  };

  const nextMonth = () => {
    if (month < 11) return setMonth(month + 1);

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

  const closeAddBookingModal = () => {
    requestUnsavedModalClose(
      addBookingIsDirty,
      () => setAddBookingIsOpen(false),
      () => setPendingUnsavedClose(() => () => setAddBookingIsOpen(false)),
    );
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
          onUpdated={() => getRooms()}
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
        onClose={closeAddBookingModal}
      >
        <AddBooking
          appendToBookings={appendToBookings}
          clickInfo={addBookingClickInfo}
          onClose={closeAddBookingModal}
          onDirtyChange={setAddBookingIsDirty}
        />
      </Modal>
      <Modal
        open={!!pendingUnsavedClose}
        className="home__modalCenter"
        onClose={() => setPendingUnsavedClose(null)}
      >
        <UnsavedChangesModal
          onClose={() => setPendingUnsavedClose(null)}
          onDiscard={() => {
            pendingUnsavedClose?.();
            setPendingUnsavedClose(null);
          }}
        />
      </Modal>
      <PageHeader
        title={
          <span className="calendar__monthSelector">
            <i className="bx bx-caret-left" onClick={() => previousMonth()} />
            {new Intl.DateTimeFormat("th-TH", {
              day: undefined,
              month: "long",
              year: "numeric",
              calendar: "gregory",
            }).format(new Date(year, month, 1))}
            <i className="bx bx-caret-right" onClick={() => nextMonth()} />
          </span>
        }
        lastUpdated={lastUpdated}
        onRefresh={getRooms}
      />

      <div className="calendar__legend" aria-label="คำอธิบายสถานะในปฏิทิน">
        {calendarLegendItems.map((item) => (
          <div className="calendar__legendItem" key={item.label}>
            <span
              className={
                item.type === "outline"
                  ? "calendar__legendDot calendar__legendDot--outline"
                  : "calendar__legendDot"
              }
              style={{ backgroundColor: item.color }}
            />
            <p>{item.label}</p>
          </div>
        ))}
      </div>

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
          {mergedBookingBlocks}
        </div>
      </div>
    </main>
  );
};

export default Calendar;
