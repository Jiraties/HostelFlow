import ConfirmationModal from "../components/ConfirmationModal.tsx";
import UnsavedChangesModal from "../components/UnsavedChangesModal.tsx";
import ViewBooking from "../features/bookings/ViewBooking";
import AddBooking from "../features/bookings/AddBooking.tsx";
import PageHeader from "../components/PageHeader.tsx";
import axios from "axios";
import toast from "react-hot-toast";

import type { booking, PlatformId } from "../types/bookingTypes";
import { platformMap } from "../helpers/maps.ts";

import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import { Modal } from "@mui/material";
import type { ReactNode } from "react";
import {
  calculateNights,
  roomChargeDisplayPaymentMethod,
} from "../helpers/bookingHelpers";
import { useLocation } from "react-router";
import { formatBookingDates } from "../helpers/bookingHelpers";
import { API_URL } from "../config/api.ts";
import { requestUnsavedModalClose } from "../helpers/modalGuards";
import { formatLocalDate, isSameDay } from "../helpers/bookingHelpers";
import { getRoomStayRoomIds } from "../helpers/roomStayHelpers";
import usePageTitle from "../hooks/useTitle";
import { useAuth } from "../context/AuthContext";
import { platformOptions } from "../helpers/options";
// import { dummyBooking } from "./test.tsx";

import "./Calendar.css";

type CalendarBooking = {
  name: string;
  from: Date;
  to: Date;
  bookingId: string;
  platformId: PlatformId;
  status: booking["status"];
  isUnpaid: boolean;
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

type CalendarLegendItem = {
  label: string;
  color: string;
  type?: "accent";
};

const calendarLegendItems: CalendarLegendItem[] = [
  { label: "รอเช็คอิน", color: "#00ADEF" },
  { label: "เข้าพัก", color: statusColorMap.checkedIn },
  { label: "เช็คเอาท์", color: statusColorMap.checkedOut },
  { label: "ยกเลิก / No-show", color: statusColorMap.cancelled },
  { label: "ค้างชำระ", color: "#ff5269", type: "accent" },
];

const sourceLegendItems: CalendarLegendItem[] = platformOptions.map((platform) => ({
  label: platform.label,
  color: platform.color,
}));

const getDateInMonth = (year: number, month: number) =>
  new Date(year, month + 1, 0).getDate();

const startOfCalendarDay = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate());

const monthNames = Array.from({ length: 12 }, (_, month) =>
  new Intl.DateTimeFormat("en-GB", {
    month: "long",
    calendar: "gregory",
  }).format(new Date(2024, month, 1)),
);

const Calendar = () => {
  usePageTitle("HostelFlow · ตารางการจอง");
  const { user } = useAuth();
  const today = new Date();
  const calendarColorMode = user?.settings.calendarColorMode || "status";
  const calendarDensity = user?.settings.calendarDensity || "comfortable";
  const calendarLegend =
    calendarColorMode === "source" ? sourceLegendItems : calendarLegendItems;
  const dayColumnWidth =
    calendarDensity === "compact"
      ? "3.25rem"
      : calendarDensity === "spacious"
        ? "4.8rem"
        : "4rem";
  const roomRowHeight =
    calendarDensity === "compact"
      ? "2.4rem"
      : "3rem";

  const timelineRef = useRef<HTMLDivElement>(null);
  const monthPickerRef = useRef<HTMLSpanElement>(null);
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
  const [isMonthPickerOpen, setIsMonthPickerOpen] = useState(false);
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
    const weekday = new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      calendar: "gregory",
    }).format(day);
    const dateLabel = new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
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
          {dateLabel}
        </p>
        <p
          style={
            i === todayIndex
              ? { color: "red", fontWeight: 600 }
              : { fontWeight: 600 }
          }
        >
          {weekday}
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
            backgroundColor: isToday ? "#0000000a" : undefined, // subtle grey
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
          className={`timeline__item timeline__bookedRoomItem${
            booking.isUnpaid ? " timeline__bookedRoomItem--unpaid" : ""
          }`}
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
              calendarColorMode === "source"
                ? platformMap[booking.platformId].color
                : statusColorMap[booking.status],
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
              isUnpaid: roomChargeDisplayPaymentMethod(formattedBooking) === "Unpaid",
            },
          ],
        };
      }),
    );

    setAddBookingIsOpen(false);
  };

  const nextMonth = () => {
    setIsMonthPickerOpen(false);
    if (month < 11) return setMonth(month + 1);

    setYear(year + 1);
    setMonth(0);
  };

  const previousMonth = () => {
    setIsMonthPickerOpen(false);
    if (month - 1 > -1) return setMonth(month - 1);

    setYear(year - 1);
    setMonth(11);
  };

  const selectMonth = (selectedMonth: number) => {
    setMonth(selectedMonth);
    setIsMonthPickerOpen(false);
  };

  useEffect(() => {
    if (!isMonthPickerOpen) return;

    const closeMonthPicker = (event: MouseEvent) => {
      if (!monthPickerRef.current?.contains(event.target as Node)) {
        setIsMonthPickerOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsMonthPickerOpen(false);
    };

    document.addEventListener("mousedown", closeMonthPicker);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeMonthPicker);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [isMonthPickerOpen]);

  const getRooms = useCallback(async () => {
    const fetchedRooms = await axios.get(
      `${API_URL}/bookings/getMonthCalendar?month=${month}&year=${year}`,
      {
        withCredentials: true,
      },
    );

    setRooms(fetchedRooms.data);
    setLastUpdated(new Date());
  }, [month, setLastUpdated, setRooms, year]);

  const showCalendarLoadError = useCallback((err: unknown) => {
    const message = axios.isAxiosError<{ message?: string; error?: string }>(err)
      ? err.response?.data.message || err.response?.data.error
      : null;

    toast.error(message || "ไม่สามารถโหลดตารางห้องได้ กรุณาลองใหม่อีกครั้ง");
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      getRooms().catch(showCalendarLoadError);
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [getRooms, location, showCalendarLoadError]);

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
  }, [month, todayIndex, year]);

  const closeAllModals = () => {
    setViewBookingBooking(null);
    setConfirmationModalIsOpen({ isOpen: false, booking: null });
    getRooms().catch(showCalendarLoadError);
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
          onUpdated={() => getRooms().catch(showCalendarLoadError)}
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
            <button
              className="calendar__monthNavButton"
              type="button"
              aria-label="Previous month"
              onClick={previousMonth}
            >
              <i className="bx bx-caret-left" aria-hidden="true" />
            </button>
            <span className="calendar__monthPicker" ref={monthPickerRef}>
              <button
                className="calendar__monthPickerTrigger"
                type="button"
                aria-expanded={isMonthPickerOpen}
                aria-haspopup="dialog"
                onClick={() => setIsMonthPickerOpen((isOpen) => !isOpen)}
              >
                {new Intl.DateTimeFormat("en-GB", {
                  month: "long",
                  year: "numeric",
                  calendar: "gregory",
                }).format(new Date(year, month, 1))}
                <i className="bx bx-chevron-down" aria-hidden="true" />
              </button>
              {isMonthPickerOpen && (
                <span
                  className="calendar__monthPickerPanel"
                  role="dialog"
                  aria-label="Choose month"
                >
                  <span className="calendar__monthPickerYear">
                    <button
                      type="button"
                      aria-label="Previous year"
                      onClick={() => setYear((currentYear) => currentYear - 1)}
                    >
                      <i className="bx bx-chevron-left" aria-hidden="true" />
                    </button>
                    <span>{year}</span>
                    <button
                      type="button"
                      aria-label="Next year"
                      onClick={() => setYear((currentYear) => currentYear + 1)}
                    >
                      <i className="bx bx-chevron-right" aria-hidden="true" />
                    </button>
                  </span>
                  <span className="calendar__monthPickerMonths">
                    {monthNames.map((monthName, monthIndex) => (
                      <button
                        className={
                          monthIndex === month
                            ? "calendar__monthPickerMonth calendar__monthPickerMonth--selected"
                            : "calendar__monthPickerMonth"
                        }
                        type="button"
                        key={monthName}
                        onClick={() => selectMonth(monthIndex)}
                      >
                        {monthName.slice(0, 3)}
                      </button>
                    ))}
                  </span>
                </span>
              )}
            </span>
            <button
              className="calendar__monthNavButton"
              type="button"
              aria-label="Next month"
              onClick={nextMonth}
            >
              <i className="bx bx-caret-right" aria-hidden="true" />
            </button>
          </span>
        }
        lastUpdated={lastUpdated}
        onRefresh={getRooms}
      />

      <div className="calendar__legend" aria-label="คำอธิบายสถานะในปฏิทิน">
        {calendarLegend.map((item) => (
          <div className="calendar__legendItem" key={item.label}>
            <span
              className={`calendar__legendDot${
                item.type ? ` calendar__legendDot--${item.type}` : ""
              }`}
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
            gridTemplateColumns: `var(--timeline-room-column-width, 10rem) repeat(${getDateInMonth(year, month)}, ${dayColumnWidth})`,
            gridTemplateRows: `repeat(${rooms.length + 1}, ${roomRowHeight})`,
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
