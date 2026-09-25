import ConfirmationModal from "../components/ConfirmationModal.tsx";
import UnsavedChangesModal from "../components/UnsavedChangesModal.tsx";
import ViewBooking from "../features/bookings/ViewBooking";
import AddBooking from "../features/bookings/AddBooking.tsx";
import RoomBlockModal, {
  type CalendarRoomBlock,
} from "../features/bookings/RoomBlockModal.tsx";
import PageHeader from "../components/PageHeader.tsx";
import axios from "axios";
import toast from "react-hot-toast";

import type { booking, PlatformId } from "../types/bookingTypes";
import { platformMap } from "../helpers/maps.ts";
import { getApiErrorMessage } from "../helpers/apiErrorMessage";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  useRef,
} from "react";
import { Modal } from "@mui/material";
import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import {
  calculateNights,
  roomChargeDisplayPaymentMethod,
} from "../helpers/bookingHelpers";
import { useLocation, useSearchParams } from "react-router";
import { formatBookingDates } from "../helpers/bookingHelpers";
import { API_URL } from "../config/api.ts";
import { requestUnsavedModalClose } from "../helpers/modalGuards";
import { formatLocalDate, isSameDay } from "../helpers/bookingHelpers";
import {
  formatShortRoomName,
  getRoomStayRoomIds,
} from "../helpers/roomStayHelpers";
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
  blocks?: CalendarRoomBlock[];
};

type CalendarSelection = {
  startRoomIndex: number;
  endRoomIndex: number;
  startIndex: number;
  endIndex: number;
};

type SelectionChooser = {
  selection: CalendarSelection;
  x: number;
  y: number;
};

type CalendarDensity = "compact" | "comfortable" | "spacious";

const calendarDensityCycle: CalendarDensity[] = [
  "comfortable",
  "compact",
  "spacious",
];

const calendarDensityIcons: Record<CalendarDensity, string> = {
  compact: "bx-grid-9",
  comfortable: "bx-grid",
  spacious: "bx-square",
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
  noShow: "var(--red)",
};

const roomTypeColorMap: Record<string, string> = {
  balcony: "#f29393",
  window: "#91cfa5",
  "pottery 1": "#eed58a",
  "pottery 2": "#add8e6",
  siesta: "#91b9df",
  marquisette: "#a8ddc3",
  homespan: "#c4c9cf",
  veranda: "#ebb6c8",
  wicker: "#e8cf82",
};

const getRoomTypeKey = (roomId: string) => {
  const roomType = roomId
    .trim()
    .toLowerCase()
    .replace(/\s*\d+$/, "");

  return roomType === "balcony" || roomType === "window"
    ? "balcony-window"
    : roomType;
};

const getRoomTypeColor = (roomId: string) => {
  const normalizedRoomId = roomId.trim().toLowerCase();
  const roomType = normalizedRoomId.replace(/\s+\d+$/, "");

  return (
    roomTypeColorMap[normalizedRoomId] ??
    roomTypeColorMap[roomType] ??
    "#d2ccc3"
  );
};

const getRoomTypeTint = (roomId: string) =>
  `color-mix(in srgb, ${getRoomTypeColor(roomId)} 10%, white)`;

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

const sourceLegendItems: CalendarLegendItem[] = platformOptions.map(
  (platform) => ({
    label: platform.label,
    color: platform.color,
  }),
);

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
  usePageTitle("HostelFlow · ปฏิทิน");
  const { user, login } = useAuth();
  const today = new Date();
  const calendarColorMode = user?.settings.calendarColorMode || "status";
  const calendarDensity = user?.settings.calendarDensity || "comfortable";
  const calendarLegend = [
    ...(calendarColorMode === "source"
      ? sourceLegendItems
      : calendarLegendItems),
    { label: "บล็อกห้อง", color: "#64748b" },
  ];
  const dayColumnWidth =
    calendarDensity === "compact"
      ? "2.75rem"
      : calendarDensity === "spacious"
        ? "4.8rem"
        : "4rem";
  const roomRowHeight = calendarDensity === "compact" ? "2.75rem" : "3rem";

  const timelineRef = useRef<HTMLDivElement>(null);
  const monthPickerRef = useRef<HTMLSpanElement>(null);
  const selectionChooserRef = useRef<HTMLDivElement>(null);
  const selectionChooserFirstActionRef = useRef<HTMLButtonElement>(null);
  const dragRef = useRef<{
    pointerId: number;
    anchorRoomIndex: number;
    currentRoomIndex: number;
    anchorIndex: number;
    currentIndex: number;
    dragged: boolean;
  } | null>(null);
  const suppressNextClickRef = useRef(false);
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const targetRoomId = searchParams.get("room")?.trim() || "";
  const targetDate = searchParams.get("date")?.trim() || "";
  const targetDateParts = useMemo(
    () => targetDate.match(/^(\d{4})-(\d{2})-(\d{2})$/),
    [targetDate],
  );
  const [addBookingIsOpen, setAddBookingIsOpen] = useState(false);
  const [addBookingIsDirty, setAddBookingIsDirty] = useState(false);
  const [pendingUnsavedClose, setPendingUnsavedClose] = useState<
    (() => void) | null
  >(null);
  const [addBookingClickInfo, setAddBookingClickInfo] = useState<{
    checkIn: string | null;
    checkOut?: string | null;
    roomId: string | null;
    roomIds?: string[];
  }>({
    checkIn: null,
    roomId: null,
  });
  const [month, setMonth] = useState(today.getMonth()); // JS MONTH 0=Jan 1=Feb 4=May
  const [year, setYear] = useState(today.getFullYear());
  const [isMonthPickerOpen, setIsMonthPickerOpen] = useState(false);
  const [isCalendarDensitySaving, setIsCalendarDensitySaving] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [highlightedRoomDate, setHighlightedRoomDate] = useState("");
  const [searchAnnouncement, setSearchAnnouncement] = useState("");
  const [dragSelection, setDragSelection] = useState<CalendarSelection | null>(
    null,
  );
  const [selectionChooser, setSelectionChooser] =
    useState<SelectionChooser | null>(null);
  const [newRoomBlock, setNewRoomBlock] = useState<{
    roomIds: string[];
    from: string;
    to: string;
  } | null>(null);
  const [viewRoomBlock, setViewRoomBlock] = useState<CalendarRoomBlock | null>(
    null,
  );
  const handledRoomDateRef = useRef("");
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

  const [rooms, setRooms] = useState<Room[]>([]);

  const selectionDates = (selection: CalendarSelection) => {
    const startIndex = Math.min(selection.startIndex, selection.endIndex);
    const endIndex = Math.max(selection.startIndex, selection.endIndex);
    const startRoomIndex = Math.min(
      selection.startRoomIndex,
      selection.endRoomIndex,
    );
    const endRoomIndex = Math.max(
      selection.startRoomIndex,
      selection.endRoomIndex,
    );
    return {
      roomIds: rooms
        .slice(startRoomIndex, endRoomIndex + 1)
        .map((room) => room.roomId),
      from: formatLocalDate(calendarDays[startIndex]),
      to: formatLocalDate(calendarDays[endIndex]),
    };
  };

  const nightIsUnavailable = (roomId: string, dayIndex: number) => {
    const day = calendarDays[dayIndex];
    const nextDay = new Date(day);
    nextDay.setDate(nextDay.getDate() + 1);
    const room = rooms.find((item) => item.roomId === roomId);
    if (!room) return true;

    return [...room.bookings, ...(room.blocks || [])].some((item) => {
      const from = startOfCalendarDay(new Date(item.from));
      const to = startOfCalendarDay(new Date(item.to));
      return from < nextDay && to > day;
    });
  };

  const clampSelectionEnd = (
    roomIds: string[],
    anchorIndex: number,
    requestedIndex: number,
  ) => {
    if (requestedIndex > anchorIndex) {
      for (let index = anchorIndex; index < requestedIndex; index += 1) {
        if (roomIds.some((roomId) => nightIsUnavailable(roomId, index))) {
          return index;
        }
      }
      return requestedIndex;
    }

    if (requestedIndex < anchorIndex) {
      for (let index = anchorIndex - 1; index >= requestedIndex; index -= 1) {
        if (roomIds.some((roomId) => nightIsUnavailable(roomId, index))) {
          return index + 1;
        }
      }
    }
    return requestedIndex;
  };

  const selectionRangeIsUnavailable = (
    roomId: string,
    startIndex: number,
    endIndex: number,
  ) => {
    const start = Math.min(startIndex, endIndex);
    const end = Math.max(startIndex, endIndex);
    for (let index = start; index < end; index += 1) {
      if (nightIsUnavailable(roomId, index)) return true;
    }
    return false;
  };

  const clampSelectionRoomIndex = (
    anchorRoomIndex: number,
    requestedRoomIndex: number,
    startIndex: number,
    endIndex: number,
  ) => {
    const direction = requestedRoomIndex >= anchorRoomIndex ? 1 : -1;
    let currentRoomIndex = anchorRoomIndex;

    for (
      let roomIndex = anchorRoomIndex + direction;
      direction > 0
        ? roomIndex <= requestedRoomIndex
        : roomIndex >= requestedRoomIndex;
      roomIndex += direction
    ) {
      const room = rooms[roomIndex];
      if (
        !room ||
        selectionRangeIsUnavailable(room.roomId, startIndex, endIndex)
      ) {
        break;
      }
      currentRoomIndex = roomIndex;
    }

    return currentRoomIndex;
  };

  const dayIndexAtPointer = (clientX: number) => {
    const headers = Array.from(
      timelineRef.current?.querySelectorAll<HTMLElement>("[data-day]") || [],
    );
    if (!headers.length) return null;

    const containing = headers.find((header) => {
      const rect = header.getBoundingClientRect();
      return clientX >= rect.left && clientX <= rect.right;
    });
    if (containing) return Number(containing.dataset.day);

    const firstRect = headers[0].getBoundingClientRect();
    if (clientX < firstRect.left) return 0;
    return headers.length - 1;
  };

  const roomIndexAtPointer = (clientY: number) => {
    const labels = Array.from(
      timelineRef.current?.querySelectorAll<HTMLElement>(
        "[data-selection-room-index]",
      ) || [],
    );
    if (!labels.length) return null;

    const containing = labels.find((label) => {
      const rect = label.getBoundingClientRect();
      return clientY >= rect.top && clientY <= rect.bottom;
    });
    if (containing) return Number(containing.dataset.selectionRoomIndex);

    const firstRect = labels[0].getBoundingClientRect();
    if (clientY < firstRect.top) return 0;
    return labels.length - 1;
  };

  const handleSelectionPointerDown = (
    event: ReactPointerEvent<HTMLDivElement>,
    roomIndex: number,
    dayIndex: number,
  ) => {
    if (event.pointerType === "touch" || event.button !== 0) return;
    const roomId = rooms[roomIndex]?.roomId;
    if (!roomId || nightIsUnavailable(roomId, dayIndex)) return;
    suppressNextClickRef.current = false;
    setSelectionChooser(null);
    setDragSelection(null);
    dragRef.current = {
      pointerId: event.pointerId,
      anchorRoomIndex: roomIndex,
      currentRoomIndex: roomIndex,
      anchorIndex: dayIndex,
      currentIndex: dayIndex,
      dragged: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleSelectionPointerMove = (
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const requestedIndex = dayIndexAtPointer(event.clientX);
    const requestedRoomIndex = roomIndexAtPointer(event.clientY);
    if (requestedIndex === null || requestedRoomIndex === null) return;
    const anchorRoomId = rooms[drag.anchorRoomIndex]?.roomId;
    if (!anchorRoomId) return;

    let currentIndex = clampSelectionEnd(
      [anchorRoomId],
      drag.anchorIndex,
      requestedIndex,
    );
    const currentRoomIndex = clampSelectionRoomIndex(
      drag.anchorRoomIndex,
      requestedRoomIndex,
      drag.anchorIndex,
      currentIndex,
    );
    const selectedRoomIds = rooms
      .slice(
        Math.min(drag.anchorRoomIndex, currentRoomIndex),
        Math.max(drag.anchorRoomIndex, currentRoomIndex) + 1,
      )
      .map((room) => room.roomId);
    currentIndex = clampSelectionEnd(
      selectedRoomIds,
      drag.anchorIndex,
      requestedIndex,
    );
    if (
      requestedIndex !== drag.anchorIndex ||
      requestedRoomIndex !== drag.anchorRoomIndex
    ) {
      drag.dragged = true;
    }
    drag.currentIndex = currentIndex;
    drag.currentRoomIndex = currentRoomIndex;
    setDragSelection(
      currentIndex === drag.anchorIndex
        ? null
        : {
            startRoomIndex: drag.anchorRoomIndex,
            endRoomIndex: currentRoomIndex,
            startIndex: drag.anchorIndex,
            endIndex: currentIndex,
          },
    );
  };

  const finishSelection = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;

    if (!drag.dragged) {
      setDragSelection(null);
      return;
    }
    suppressNextClickRef.current = true;
    if (drag.currentIndex === drag.anchorIndex) {
      setDragSelection(null);
      return;
    }
    const selection = {
      startRoomIndex: drag.anchorRoomIndex,
      endRoomIndex: drag.currentRoomIndex,
      startIndex: drag.anchorIndex,
      endIndex: drag.currentIndex,
    };
    setDragSelection(selection);
    setSelectionChooser({
      selection,
      x: 0,
      y: 0,
    });
  };

  const cancelSelection = () => {
    dragRef.current = null;
    setDragSelection(null);
  };

  const selectionContainsNight = (roomId: string, dayIndex: number) => {
    if (!dragSelection) return false;
    const roomIndex = rooms.findIndex((room) => room.roomId === roomId);
    const startRoomIndex = Math.min(
      dragSelection.startRoomIndex,
      dragSelection.endRoomIndex,
    );
    const endRoomIndex = Math.max(
      dragSelection.startRoomIndex,
      dragSelection.endRoomIndex,
    );
    if (roomIndex < startRoomIndex || roomIndex > endRoomIndex) return false;
    const start = Math.min(dragSelection.startIndex, dragSelection.endIndex);
    const end = Math.max(dragSelection.startIndex, dragSelection.endIndex);
    return dayIndex >= start && dayIndex < end;
  };

  const roomRows: ReactNode[] = [];
  const mergedBookingBlocks: ReactNode[] = [];
  const roomBlockElements: ReactNode[] = [];
  const selectionGhostElements: ReactNode[] = [];
  const timelineGridRows: string[] = [roomRowHeight];
  const roomGridRows: number[] = [];
  let roomTypeSeparatorCount = 0;

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
        <p style={i === todayIndex ? { color: "red" } : {}}>{dateLabel}</p>
        {calendarDensity !== "compact" && (
          <p
            style={
              i === todayIndex
                ? { color: "red", fontWeight: 600 }
                : { fontWeight: 600 }
            }
          >
            {weekday}
          </p>
        )}
      </div>
    );
  });

  const monthStart = startOfCalendarDay(new Date(year, month, 1));
  const monthEnd = startOfCalendarDay(new Date(year, month + 1, 1));

  const getVisibleRangePosition = (
    fromValue: string | Date,
    toValue: string | Date,
  ) => {
    const from = startOfCalendarDay(new Date(fromValue));
    const to = startOfCalendarDay(new Date(toValue));
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

  const getVisibleBookingPosition = (booking: CalendarBooking) =>
    getVisibleRangePosition(booking.from, booking.to);

  const roomBlocksById = new Map<
    string,
    { block: CalendarRoomBlock; roomIndex: number }[]
  >();
  const bookingBlocksBySegment = new Map<
    string,
    { booking: CalendarBooking; roomIndex: number }[]
  >();

  rooms.forEach((room, roomIndex) => {
    const startsNewRoomType =
      roomIndex > 0 &&
      getRoomTypeKey(room.roomId) !==
        getRoomTypeKey(rooms[roomIndex - 1].roomId);

    if (startsNewRoomType) {
      roomTypeSeparatorCount += 1;
      timelineGridRows.push("1.1rem");
      roomRows.push(
        <div
          className="timeline__roomTypeSeparator"
          key={`room-type-separator-${room.roomId}`}
          style={{
            gridColumn: "1 / -1",
            gridRow: roomIndex + 1 + roomTypeSeparatorCount,
          }}
          aria-hidden="true"
        />,
      );
    }

    timelineGridRows.push(roomRowHeight);
    const gridRow = roomIndex + 2 + roomTypeSeparatorCount; // row 1 = header, rooms start at 2
    roomGridRows.push(gridRow);
    const roomRow: ReactNode[] = [];

    // Room label
    roomRow.push(
      <div
        className="timeline__item timeline__roomIdItem"
        data-selection-room-index={roomIndex}
        style={{
          gridColumn: "1",
          gridRow,
          backgroundColor: getRoomTypeTint(room.roomId),
        }}
        key={room.roomId}
      >
        <span
          aria-hidden="true"
          className="timeline__roomColorTab"
          style={{ backgroundColor: getRoomTypeColor(room.roomId) }}
        />
        <p aria-label={room.roomId}>
          <span className="timeline__roomNameFull" aria-hidden="true">
            {room.roomId}
          </span>
          <span className="timeline__roomNameShort" aria-hidden="true">
            {formatShortRoomName(room.roomId)}
          </span>
        </p>
      </div>,
    );

    // Empty clickable cells
    calendarDays.forEach((day, dayIndex) => {
      const isToday = isSameDay(day, today);
      const dateKey = formatLocalDate(day);
      const roomDateKey = `${room.roomId}::${dateKey}`;

      roomRow.push(
        <div
          key={`empty-${room.roomId}-${dayIndex}`}
          className={`timeline__item timeline__emptyCell${
            highlightedRoomDate === roomDateKey
              ? " timeline__emptyCell--searchHighlight"
              : ""
          }${
            selectionContainsNight(room.roomId, dayIndex)
              ? " timeline__emptyCell--dragSelected"
              : ""
          }`}
          data-search-room-id={room.roomId}
          data-search-date={dateKey}
          aria-current={
            highlightedRoomDate === roomDateKey ? "true" : undefined
          }
          style={{
            gridColumn: `${dayIndex + 2}`,
            gridRow,
            backgroundColor: isToday ? "#0000000a" : undefined, // subtle grey
          }}
          onPointerDown={(event) =>
            handleSelectionPointerDown(event, roomIndex, dayIndex)
          }
          onClick={() => {
            if (suppressNextClickRef.current) {
              suppressNextClickRef.current = false;
              return;
            }
            handleAddBooking(room.roomId, day);
          }}
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

    (room.blocks || []).forEach((block) => {
      const position = getVisibleRangePosition(block.from, block.to);
      if (!position) return;

      roomBlocksById.set(block.blockId, [
        ...(roomBlocksById.get(block.blockId) || []),
        { block, roomIndex },
      ]);
    });

    roomRows.push(roomRow);
  });

  if (dragSelection) {
    const startIndex = Math.min(
      dragSelection.startIndex,
      dragSelection.endIndex,
    );
    const endIndex = Math.max(dragSelection.startIndex, dragSelection.endIndex);
    const startRoomIndex = Math.min(
      dragSelection.startRoomIndex,
      dragSelection.endRoomIndex,
    );
    const endRoomIndex = Math.max(
      dragSelection.startRoomIndex,
      dragSelection.endRoomIndex,
    );
    const selectedNights = endIndex - startIndex;
    const selectedBeds = endRoomIndex - startRoomIndex + 1;
    const rowGroups: number[][] = [];

    for (
      let roomIndex = startRoomIndex;
      roomIndex <= endRoomIndex;
      roomIndex += 1
    ) {
      const currentGroup = rowGroups[rowGroups.length - 1];
      const previousRoomIndex = currentGroup?.[currentGroup.length - 1];
      if (
        currentGroup &&
        previousRoomIndex !== undefined &&
        roomGridRows[roomIndex] === roomGridRows[previousRoomIndex] + 1
      ) {
        currentGroup.push(roomIndex);
      } else {
        rowGroups.push([roomIndex]);
      }
    }

    if (selectedNights > 0) {
      rowGroups.forEach((roomIndexes, groupIndex) => {
        selectionGhostElements.push(
          <div
            className="timeline__item timeline__selectionGhost"
            style={{
              gridColumn: `${startIndex + 2} / span ${selectedNights}`,
              gridRow: `${roomGridRows[roomIndexes[0]]} / span ${roomIndexes.length}`,
            }}
            key={`selection-ghost-${groupIndex}`}
            data-selection-ghost
            aria-hidden="true"
          >
            <span className="timeline__selectionGhostLabel">
              <i className="bx bx-fullscreen" aria-hidden="true" />
              <span>
                {selectedBeds > 1 && `${selectedBeds} เตียง · `}
                {selectedNights} คืน
              </span>
            </span>
          </div>,
        );
      });
    }
  }

  roomBlocksById.forEach((items, blockId) => {
    const sortedItems = [...items].sort((a, b) => a.roomIndex - b.roomIndex);
    const rowGroups: { block: CalendarRoomBlock; roomIndexes: number[] }[] = [];

    sortedItems.forEach((item) => {
      const currentGroup = rowGroups[rowGroups.length - 1];
      const previousRoomIndex =
        currentGroup?.roomIndexes[currentGroup.roomIndexes.length - 1];
      if (
        currentGroup &&
        previousRoomIndex !== undefined &&
        roomGridRows[item.roomIndex] === roomGridRows[previousRoomIndex] + 1
      ) {
        currentGroup.roomIndexes.push(item.roomIndex);
      } else {
        rowGroups.push({ block: item.block, roomIndexes: [item.roomIndex] });
      }
    });

    rowGroups.forEach((group, groupIndex) => {
      const position = getVisibleRangePosition(
        group.block.from,
        group.block.to,
      );
      if (!position) return;
      roomBlockElements.push(
        <button
          type="button"
          className="timeline__item timeline__roomBlockItem"
          style={{
            gridColumn: `${position.startingDate + 2} / span ${position.span}`,
            gridRow: `${roomGridRows[group.roomIndexes[0]]} / span ${group.roomIndexes.length}`,
            borderTopLeftRadius: position.continuesBefore ? 0 : "0.5rem",
            borderBottomLeftRadius: position.continuesBefore ? 0 : "0.5rem",
            borderTopRightRadius: position.continuesAfter ? 0 : "0.5rem",
            borderBottomRightRadius: position.continuesAfter ? 0 : "0.5rem",
          }}
          key={`${blockId}-${groupIndex}`}
          title={`บล็อก: ${group.block.reason}`}
          onClick={() => setViewRoomBlock(group.block)}
        >
          <i className="bx bx-block" aria-hidden="true" />
          <span>
            บล็อก
            {group.block.roomIds && group.block.roomIds.length > 1
              ? ` · ${group.block.roomIds.length} เตียง`
              : ""}
          </span>
        </button>,
      );
    });
  });

  bookingBlocksBySegment.forEach((items, segmentKey) => {
    const sortedItems = [...items].sort((a, b) => a.roomIndex - b.roomIndex);
    const rowGroups: { booking: CalendarBooking; roomIndexes: number[] }[] = [];

    sortedItems.forEach((item) => {
      const currentGroup = rowGroups[rowGroups.length - 1];
      const previousRoomIndex =
        currentGroup?.roomIndexes[currentGroup.roomIndexes.length - 1];

      if (
        currentGroup &&
        previousRoomIndex !== undefined &&
        roomGridRows[item.roomIndex] === roomGridRows[previousRoomIndex] + 1
      ) {
        currentGroup.roomIndexes.push(item.roomIndex);
        return;
      }

      rowGroups.push({ booking: item.booking, roomIndexes: [item.roomIndex] });
    });

    rowGroups.forEach((group, groupIndex) => {
      const booking = group.booking;
      const position = getVisibleBookingPosition(booking);
      if (!position) return;

      const gridRow = `${roomGridRows[group.roomIndexes[0]]} / span ${
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
      checkOut: null,
    });
  };

  const handleAddBookingRange = (selection: CalendarSelection) => {
    const range = selectionDates(selection);
    suppressNextClickRef.current = false;
    setSelectionChooser(null);
    setDragSelection(null);
    setAddBookingClickInfo({
      roomId: range.roomIds[0] || null,
      roomIds: range.roomIds,
      checkIn: range.from,
      checkOut: range.to,
    });
    setAddBookingIsOpen(true);
  };

  const handleCreateRoomBlock = (selection: CalendarSelection) => {
    suppressNextClickRef.current = false;
    setSelectionChooser(null);
    setDragSelection(null);
    setNewRoomBlock(selectionDates(selection));
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
              isUnpaid:
                roomChargeDisplayPaymentMethod(formattedBooking) === "Unpaid",
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

  const updateCalendarDensity = async (nextDensity: CalendarDensity) => {
    if (!user || nextDensity === calendarDensity) return;

    const previousUser = user;
    login({
      ...user,
      settings: {
        ...user.settings,
        calendarDensity: nextDensity,
      },
    });
    setIsCalendarDensitySaving(true);

    try {
      const response = await axios.patch(
        `${API_URL}/auth/me/settings`,
        { calendarDensity: nextDensity },
        { withCredentials: true },
      );
      login(response.data.user);
      // toast.success("บันทึกความหนาแน่นปฏิทินแล้ว");
    } catch (error) {
      login(previousUser);
      const message = axios.isAxiosError<{ message?: string }>(error)
        ? error.response?.data.message
        : null;
      toast.error(message || "ไม่สามารถบันทึกความหนาแน่นปฏิทินได้");
    } finally {
      setIsCalendarDensitySaving(false);
    }
  };

  const cycleCalendarDensity = () => {
    const currentIndex = calendarDensityCycle.indexOf(calendarDensity);
    const nextDensity =
      calendarDensityCycle[(currentIndex + 1) % calendarDensityCycle.length];
    updateCalendarDensity(nextDensity);
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

  useEffect(() => {
    if (!selectionChooser) return;
    selectionChooserFirstActionRef.current?.focus({ preventScroll: true });

    const dismiss = (event: PointerEvent) => {
      if (!selectionChooserRef.current?.contains(event.target as Node)) {
        suppressNextClickRef.current = false;
        setSelectionChooser(null);
        setDragSelection(null);
      }
    };
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        suppressNextClickRef.current = false;
        setSelectionChooser(null);
        setDragSelection(null);
      }
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", dismissOnEscape);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", dismissOnEscape);
    };
  }, [selectionChooser]);

  useLayoutEffect(() => {
    if (!selectionChooser || !selectionChooserRef.current) return;
    const ghosts = Array.from(
      timelineRef.current?.querySelectorAll<HTMLElement>(
        "[data-selection-ghost]",
      ) || [],
    );
    if (!ghosts.length) return;

    const ghostRects = ghosts.map((ghost) => ghost.getBoundingClientRect());
    const ghostLeft = Math.min(...ghostRects.map((rect) => rect.left));
    const ghostRight = Math.max(...ghostRects.map((rect) => rect.right));
    const ghostTop = Math.min(...ghostRects.map((rect) => rect.top));
    const ghostBottom = Math.max(...ghostRects.map((rect) => rect.bottom));
    const chooserRect = selectionChooserRef.current.getBoundingClientRect();
    const margin = 8;
    const gap = 10;

    let x = ghostRight + gap;
    if (x + chooserRect.width > window.innerWidth - margin) {
      x = ghostLeft - chooserRect.width - gap;
    }
    x = Math.max(
      margin,
      Math.min(x, window.innerWidth - chooserRect.width - margin),
    );
    const y = Math.max(
      margin,
      Math.min(
        (ghostTop + ghostBottom - chooserRect.height) / 2,
        window.innerHeight - chooserRect.height - margin,
      ),
    );

    setSelectionChooser((current) =>
      current &&
      current.selection === selectionChooser.selection &&
      (current.x !== x || current.y !== y)
        ? { ...current, x, y }
        : current,
    );
  }, [selectionChooser]);

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
    toast.error(
      getApiErrorMessage(err, "ไม่สามารถโหลดตารางห้องได้ กรุณาลองใหม่อีกครั้ง"),
    );
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

  useEffect(() => {
    if (!targetDateParts) return;
    const targetYear = Number(targetDateParts[1]);
    const targetMonth = Number(targetDateParts[2]) - 1;
    const targetDay = Number(targetDateParts[3]);
    const validationDate = new Date(targetYear, targetMonth, targetDay);
    if (
      validationDate.getFullYear() !== targetYear ||
      validationDate.getMonth() !== targetMonth ||
      validationDate.getDate() !== targetDay
    ) {
      return;
    }
    const timeoutId = window.setTimeout(() => {
      setYear(targetYear);
      setMonth(targetMonth);
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [targetDateParts]);

  useEffect(() => {
    const targetKey = `${targetRoomId}::${targetDate}`;
    if (
      !targetRoomId ||
      !targetDateParts ||
      rooms.length === 0 ||
      handledRoomDateRef.current === targetKey ||
      year !== Number(targetDateParts[1]) ||
      month !== Number(targetDateParts[2]) - 1
    ) {
      return;
    }
    handledRoomDateRef.current = targetKey;
    let highlightTimeoutId = 0;
    const animationFrame = requestAnimationFrame(() => {
      const target = Array.from(
        timelineRef.current?.querySelectorAll<HTMLElement>(
          "[data-search-room-id][data-search-date]",
        ) || [],
      ).find(
        (element) =>
          element.dataset.searchRoomId === targetRoomId &&
          element.dataset.searchDate === targetDate,
      );
      if (!target) {
        setSearchAnnouncement("ไม่พบห้องหรือวันที่ที่ตรงกัน");
        toast.error("ไม่พบห้องหรือวันที่ที่ตรงกัน");
        return;
      }
      setHighlightedRoomDate(targetKey);
      target.scrollIntoView({
        behavior: "smooth",
        block: "center",
        inline: "center",
      });
      setSearchAnnouncement(
        `เลื่อนไปยัง ${targetRoomId} วันที่ ${targetDate} แล้ว`,
      );
      highlightTimeoutId = window.setTimeout(
        () => setHighlightedRoomDate(""),
        4000,
      );
    });
    return () => {
      cancelAnimationFrame(animationFrame);
      window.clearTimeout(highlightTimeoutId);
    };
  }, [month, rooms, targetDate, targetDateParts, targetRoomId, year]);

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
      <p className="calendar__searchAnnouncement" aria-live="polite">
        {searchAnnouncement}
      </p>
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
        open={!!newRoomBlock}
        className="home__modalCenter"
        onClose={() => setNewRoomBlock(null)}
      >
        <RoomBlockModal
          selection={newRoomBlock}
          onClose={() => setNewRoomBlock(null)}
          onChanged={() => getRooms().catch(showCalendarLoadError)}
        />
      </Modal>
      <Modal
        open={!!viewRoomBlock}
        className="home__modalCenter"
        onClose={() => setViewRoomBlock(null)}
      >
        <RoomBlockModal
          block={viewRoomBlock}
          onClose={() => setViewRoomBlock(null)}
          onChanged={() => getRooms().catch(showCalendarLoadError)}
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
        className="calendar__pageHeader"
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
            <button
              className="calendar__densitySelector home__action home__actionIconOnly"
              type="button"
              aria-label="เปลี่ยนความหนาแน่นปฏิทิน"
              title="เปลี่ยนความหนาแน่นปฏิทิน"
              disabled={isCalendarDensitySaving}
              onClick={cycleCalendarDensity}
            >
              <i
                className={`bx ${calendarDensityIcons[calendarDensity]}`}
                aria-hidden="true"
              />
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

      {selectionChooser && (
        <div
          className="calendar__selectionChooser"
          ref={selectionChooserRef}
          role="menu"
          aria-label="เลือกการทำงานสำหรับช่วงวันที่"
          style={{ left: selectionChooser.x, top: selectionChooser.y }}
        >
          <button
            type="button"
            role="menuitem"
            ref={selectionChooserFirstActionRef}
            onClick={() => handleAddBookingRange(selectionChooser.selection)}
          >
            <i
              className="bx bx-calendar-plus"
              style={{ color: "var(--primary-color)" }}
              aria-hidden="true"
            />
            เพิ่มการจอง
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => handleCreateRoomBlock(selectionChooser.selection)}
          >
            <i
              className="bx bx-block"
              style={{ color: "var(--primary-color)" }}
              aria-hidden="true"
            />
            บล็อก วันที่{" "}
            {calendarDays[
              Math.min(
                selectionChooser.selection.startIndex,
                selectionChooser.selection.endIndex,
              )
            ].getDate()}
            –
            {calendarDays[
              Math.max(
                selectionChooser.selection.startIndex,
                selectionChooser.selection.endIndex,
              )
            ].getDate()}
          </button>
        </div>
      )}

      <div
        className="timeline__wrapper"
        ref={timelineRef}
        onPointerMove={handleSelectionPointerMove}
        onPointerUp={finishSelection}
        onPointerCancel={cancelSelection}
      >
        <div
          className="timeline"
          style={{
            gridTemplateColumns: `var(--timeline-room-column-width, 10rem) repeat(${getDateInMonth(year, month)}, ${dayColumnWidth})`,
            gridTemplateRows: timelineGridRows.join(" "),
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
          {roomBlockElements}
          {selectionGhostElements}
        </div>
      </div>
    </main>
  );
};

export default Calendar;
