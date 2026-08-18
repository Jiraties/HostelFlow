import dayjs, { type Dayjs } from "dayjs";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  dateFormatPlaceholder,
  formatDateInputValue,
  formatNumericDateDraft,
  parseDateInputValue,
} from "../../helpers/displayDate";
import type { DateFormatPreference } from "../../types/userSettings";
import "./BookingDateRangePicker.css";

type BookingDateRangePickerProps = {
  checkIn: string;
  checkOut: string;
  dateFormat: DateFormatPreference;
  hasError?: boolean;
  disabled?: boolean;
  onChange: (checkIn: string, checkOut: string) => void;
  onCheckInChange: (checkIn: string) => void;
  onCheckOutChange: (checkOut: string) => void;
};

const weekdayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const toDateKey = (date: Dayjs) => date.format("YYYY-MM-DD");

export function BookingDateRangePicker({
  checkIn,
  checkOut,
  dateFormat,
  hasError = false,
  disabled = false,
  onChange,
  onCheckInChange,
  onCheckOutChange,
}: BookingDateRangePickerProps) {
  const pickerRef = useRef<HTMLDivElement>(null);
  const checkInInputRef = useRef<HTMLInputElement>(null);
  const checkOutInputRef = useRef<HTMLInputElement>(null);
  const keyboardOpenerRef = useRef<HTMLInputElement | null>(null);
  const calendarId = useId();
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
  const [calendarFocusDate, setCalendarFocusDate] = useState<string | null>(
    null,
  );

  const calendarDays = useMemo(() => {
    const firstVisibleDay = displayMonth.startOf("month").startOf("week");
    return Array.from({ length: 42 }, (_, index) => firstVisibleDay.add(index, "day"));
  }, [displayMonth]);

  useEffect(() => {
    // The editable draft intentionally follows externally changed booking dates.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCheckInDraft(formatDateInputValue(checkIn, dateFormat));
  }, [checkIn, dateFormat]);

  useEffect(() => {
    // The editable draft intentionally follows externally changed booking dates.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCheckOutDraft(formatDateInputValue(checkOut, dateFormat));
  }, [checkOut, dateFormat]);

  useEffect(() => {
    if (!isOpen) return;

    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
        setPendingCheckIn(null);
        setCalendarFocusDate(null);
        keyboardOpenerRef.current = null;
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setIsOpen(false);
      setPendingCheckIn(null);
      setCalendarFocusDate(null);
      keyboardOpenerRef.current?.focus({ preventScroll: true });
    };

    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !calendarFocusDate) return;

    const dayButton = pickerRef.current?.querySelector<HTMLButtonElement>(
      `[data-date-key="${calendarFocusDate}"]`,
    );
    if (!dayButton) return;

    dayButton.focus({ preventScroll: true });
  }, [calendarFocusDate, displayMonth, isOpen]);

  const openPicker = (focusCalendar = false, opener?: HTMLInputElement) => {
    if (disabled) return;
    setDisplayMonth(dayjs(checkIn || checkOut || undefined).startOf("month"));
    setPendingCheckIn(checkIn && !checkOut ? checkIn : null);
    setIsOpen(true);
    if (focusCalendar) {
      keyboardOpenerRef.current = opener || null;
      setCalendarFocusDate(checkIn || checkOut || toDateKey(dayjs()));
    } else {
      keyboardOpenerRef.current = null;
      setCalendarFocusDate(null);
    }
  };

  const selectDay = (date: Dayjs, keyboardSelection = false) => {
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
    setCalendarFocusDate(null);
    if (keyboardSelection) {
      window.requestAnimationFrame(() =>
        checkOutInputRef.current?.focus({ preventScroll: true }),
      );
    }
  };

  const handleDateInputKeyDown = (
    event: React.KeyboardEvent<HTMLInputElement>,
  ) => {
    if (event.key === "Tab") {
      setIsOpen(false);
      setPendingCheckIn(null);
      setCalendarFocusDate(null);
      return;
    }

    if (
      event.key !== "F4" &&
      !(event.altKey && event.key === "ArrowDown")
    ) {
      return;
    }

    event.preventDefault();
    openPicker(true, event.currentTarget);
  };

  const focusCalendarDate = (date: Dayjs) => {
    if (!date.isSame(displayMonth, "month")) {
      setDisplayMonth(date.startOf("month"));
    }
    setCalendarFocusDate(toDateKey(date));
  };

  const handleCalendarKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    date: Dayjs,
  ) => {
    let nextDate: Dayjs | null = null;
    if (event.key === "ArrowLeft") nextDate = date.subtract(1, "day");
    if (event.key === "ArrowRight") nextDate = date.add(1, "day");
    if (event.key === "ArrowUp") nextDate = date.subtract(7, "day");
    if (event.key === "ArrowDown") nextDate = date.add(7, "day");
    if (event.key === "Home") nextDate = date.startOf("week");
    if (event.key === "End") nextDate = date.endOf("week");
    if (event.key === "PageUp") nextDate = date.subtract(1, "month");
    if (event.key === "PageDown") nextDate = date.add(1, "month");
    if (!nextDate) return;

    event.preventDefault();
    focusCalendarDate(nextDate);
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
          disabled={disabled}
          ref={checkInInputRef}
          type="text"
          inputMode={dateFormat === "d MMM yyyy" ? "text" : "numeric"}
          maxLength={dateFormat === "d MMM yyyy" ? 11 : 10}
          placeholder={dateFormatPlaceholder(dateFormat)}
          value={checkInDraft}
          aria-label="Check-in date"
          aria-invalid={hasError}
          aria-haspopup="dialog"
          aria-expanded={isOpen}
          aria-controls={isOpen ? calendarId : undefined}
          onClick={() => openPicker()}
          onKeyDown={handleDateInputKeyDown}
          onChange={(event) =>
            setCheckInDraft(
              dateFormat === "d MMM yyyy"
                ? event.target.value
                : formatNumericDateDraft(event.target.value, checkInDraft),
            )
          }
          onBlur={() =>
            commitTypedDate(checkInDraft, onCheckInChange, () =>
              setCheckInDraft(formatDateInputValue(checkIn, dateFormat)),
            )
          }
        />
        <input
          disabled={disabled}
          ref={checkOutInputRef}
          type="text"
          inputMode={dateFormat === "d MMM yyyy" ? "text" : "numeric"}
          maxLength={dateFormat === "d MMM yyyy" ? 11 : 10}
          placeholder={dateFormatPlaceholder(dateFormat)}
          value={checkOutDraft}
          aria-label="Check-out date"
          aria-invalid={hasError}
          aria-haspopup="dialog"
          aria-expanded={isOpen}
          aria-controls={isOpen ? calendarId : undefined}
          onClick={() => openPicker()}
          onKeyDown={handleDateInputKeyDown}
          onChange={(event) =>
            setCheckOutDraft(
              dateFormat === "d MMM yyyy"
                ? event.target.value
                : formatNumericDateDraft(event.target.value, checkOutDraft),
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
          id={calendarId}
          className="bookingDateRangePicker__popover"
          role="dialog"
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
              const keyboardFocusDate =
                calendarFocusDate ||
                rangeStart ||
                rangeEnd ||
                toDateKey(dayjs());

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
                  data-date-key={dateKey}
                  tabIndex={dateKey === keyboardFocusDate ? 0 : -1}
                  aria-label={date.format("D MMMM YYYY")}
                  aria-pressed={isRangeStart || isRangeEnd}
                  onClick={(event) => selectDay(date, event.detail === 0)}
                  onKeyDown={(event) => handleCalendarKeyDown(event, date)}
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
