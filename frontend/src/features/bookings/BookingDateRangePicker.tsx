import dayjs, { type Dayjs } from "dayjs";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  dateFormatPlaceholder,
  formatDateInputValue,
  parseDateInputValue,
} from "../../helpers/displayDate";
import type { DateFormatPreference } from "../../types/userSettings";
import "./BookingDateRangePicker.css";

type BookingDateRangePickerProps = {
  checkIn: string;
  checkOut: string;
  dateFormat: DateFormatPreference;
  hasError?: boolean;
  onChange: (checkIn: string, checkOut: string) => void;
  onCheckInChange: (checkIn: string) => void;
  onCheckOutChange: (checkOut: string) => void;
};

const weekdayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const toDateKey = (date: Dayjs) => date.format("YYYY-MM-DD");

const maskNumericDate = (value: string) => {
  const digits = value.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
};

export function BookingDateRangePicker({
  checkIn,
  checkOut,
  dateFormat,
  hasError = false,
  onChange,
  onCheckInChange,
  onCheckOutChange,
}: BookingDateRangePickerProps) {
  const pickerRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [displayMonth, setDisplayMonth] = useState(() =>
    dayjs(checkIn || checkOut || undefined).startOf("month"),
  );
  const [pendingCheckIn, setPendingCheckIn] = useState<string | null>(null);
  const [checkInDraft, setCheckInDraft] = useState(() =>
    formatDateInputValue(checkIn, dateFormat),
  );
  const [checkOutDraft, setCheckOutDraft] = useState(() =>
    formatDateInputValue(checkOut, dateFormat),
  );

  const calendarDays = useMemo(() => {
    const firstVisibleDay = displayMonth.startOf("month").startOf("week");
    return Array.from({ length: 42 }, (_, index) => firstVisibleDay.add(index, "day"));
  }, [displayMonth]);

  useEffect(() => {
    setCheckInDraft(formatDateInputValue(checkIn, dateFormat));
  }, [checkIn, dateFormat]);

  useEffect(() => {
    setCheckOutDraft(formatDateInputValue(checkOut, dateFormat));
  }, [checkOut, dateFormat]);

  useEffect(() => {
    if (!isOpen) return;

    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
        setPendingCheckIn(null);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setIsOpen(false);
      setPendingCheckIn(null);
    };

    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [isOpen]);

  const openPicker = () => {
    setDisplayMonth(dayjs(checkIn || checkOut || undefined).startOf("month"));
    setPendingCheckIn(checkIn && !checkOut ? checkIn : null);
    setIsOpen(true);
  };

  const selectDay = (date: Dayjs) => {
    const selectedDate = toDateKey(date);
    const moveToSelectedMonth = () => {
      if (!date.isSame(displayMonth, "month")) {
        setDisplayMonth(date.startOf("month"));
      }
    };

    if (!pendingCheckIn) {
      setPendingCheckIn(selectedDate);
      onChange(selectedDate, "");
      moveToSelectedMonth();
      return;
    }

    if (selectedDate <= pendingCheckIn) {
      setPendingCheckIn(selectedDate);
      onChange(selectedDate, "");
      moveToSelectedMonth();
      return;
    }

    onChange(pendingCheckIn, selectedDate);
    setPendingCheckIn(null);
    setIsOpen(false);
  };

  const rangeStart = pendingCheckIn || checkIn;
  const rangeEnd = pendingCheckIn ? "" : checkOut;

  const commitTypedDate = (
    value: string,
    onDateChange: (date: string) => void,
    resetDraft: () => void,
  ) => {
    if (!value.trim()) {
      onDateChange("");
      return;
    }

    const parsedDate = parseDateInputValue(value, dateFormat);
    if (parsedDate) {
      onDateChange(parsedDate);
      return;
    }

    resetDraft();
  };

  return (
    <div className="bookingDateRangePicker" ref={pickerRef}>
      <div
        className={`bookingDateRangePicker__trigger${
          hasError ? " bookingDateRangePicker__trigger--error" : ""
        }`}
      >
        <input
          type="text"
          inputMode={dateFormat === "d MMM yyyy" ? "text" : "numeric"}
          maxLength={dateFormat === "d MMM yyyy" ? 11 : 10}
          placeholder={dateFormatPlaceholder(dateFormat)}
          value={checkInDraft}
          aria-label="Check-in date"
          onFocus={openPicker}
          onChange={(event) =>
            setCheckInDraft(
              dateFormat === "d MMM yyyy"
                ? event.target.value
                : maskNumericDate(event.target.value),
            )
          }
          onBlur={() =>
            commitTypedDate(checkInDraft, onCheckInChange, () =>
              setCheckInDraft(formatDateInputValue(checkIn, dateFormat)),
            )
          }
        />
        <input
          type="text"
          inputMode={dateFormat === "d MMM yyyy" ? "text" : "numeric"}
          maxLength={dateFormat === "d MMM yyyy" ? 11 : 10}
          placeholder={dateFormatPlaceholder(dateFormat)}
          value={checkOutDraft}
          aria-label="Check-out date"
          onFocus={openPicker}
          onChange={(event) =>
            setCheckOutDraft(
              dateFormat === "d MMM yyyy"
                ? event.target.value
                : maskNumericDate(event.target.value),
            )
          }
          onBlur={() =>
            commitTypedDate(checkOutDraft, onCheckOutChange, () =>
              setCheckOutDraft(formatDateInputValue(checkOut, dateFormat)),
            )
          }
        />
      </div>

      {isOpen && (
        <section
          className="bookingDateRangePicker__popover"
          aria-label="เลือกช่วงวันเข้าพัก"
        >
          <header className="bookingDateRangePicker__header">
            <button
              type="button"
              aria-label="Previous month"
              onClick={() =>
                setDisplayMonth((currentMonth) => currentMonth.subtract(1, "month"))
              }
            >
              <i className="bx bx-chevron-left" aria-hidden="true" />
            </button>
            <strong>{displayMonth.format("MMMM YYYY")}</strong>
            <button
              type="button"
              aria-label="Next month"
              onClick={() =>
                setDisplayMonth((currentMonth) => currentMonth.add(1, "month"))
              }
            >
              <i className="bx bx-chevron-right" aria-hidden="true" />
            </button>
          </header>
          <div className="bookingDateRangePicker__weekdays" aria-hidden="true">
            {weekdayNames.map((weekday) => (
              <span key={weekday}>{weekday}</span>
            ))}
          </div>
          <div className="bookingDateRangePicker__days">
            {calendarDays.map((date) => {
              const dateKey = toDateKey(date);
              const isCurrentMonth = date.month() === displayMonth.month();
              const isToday = date.isSame(dayjs(), "day");
              const isRangeStart = dateKey === rangeStart;
              const isRangeEnd = dateKey === rangeEnd;
              const isInRange =
                Boolean(rangeStart && rangeEnd) &&
                dateKey > rangeStart &&
                dateKey < rangeEnd;

              return (
                <button
                  className={`bookingDateRangePicker__day${
                    !isCurrentMonth ? " bookingDateRangePicker__day--adjacent" : ""
                  }${isToday ? " bookingDateRangePicker__day--today" : ""}${
                    isRangeStart ? " bookingDateRangePicker__day--start" : ""
                  }${
                    isRangeEnd ? " bookingDateRangePicker__day--end" : ""
                  }${isInRange ? " bookingDateRangePicker__day--inRange" : ""}`}
                  type="button"
                  key={dateKey}
                  aria-label={date.format("D MMMM YYYY")}
                  aria-pressed={isRangeStart || isRangeEnd}
                  onClick={() => selectDay(date)}
                >
                  {date.date()}
                </button>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
