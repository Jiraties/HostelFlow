import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import dayjs, { type Dayjs } from "dayjs";
import { calendarValueInBounds, formatCalendarKey, parseCalendarKey, type CalendarInputMode } from "../helpers/calendarInput";
import MonthPickerPanel from "./MonthPickerPanel";
import "../features/bookings/BookingDateRangePicker.css";
import "./CalendarInput.css";

type CalendarInputProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "value" | "onChange"> & {
  value: string;
  onChange?: (value: string) => void;
  mode?: CalendarInputMode;
  min?: string;
  max?: string;
  displayFormat?: string;
  placeholder?: string;
  allowClear?: boolean;
  iconOnly?: boolean;
};

type PickerState = {
  viewMonth: Dayjs;
  chooseMonth: boolean;
  position: CSSProperties;
  container: Element;
};

export const CalendarInput = ({
  value,
  onChange,
  mode = "date",
  min,
  max,
  displayFormat = mode === "month" ? "MMMM YYYY" : "DD/MM/YYYY",
  placeholder = mode === "month" ? "เลือกเดือน" : "เลือกวันที่",
  allowClear = true,
  iconOnly = false,
  className = "",
  disabled,
  id,
  onClick,
  onKeyDown,
  ...buttonProps
}: CalendarInputProps) => {
  const generatedId = useId();
  const dialogId = `${id || generatedId}-calendar`;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [picker, setPicker] = useState<PickerState | null>(null);
  const selected = parseCalendarKey(value, mode);
  const minimum = (min && parseCalendarKey(min, mode)) || dayjs().year(1).startOf("year");
  const maximum = (max && parseCalendarKey(max, mode)) || dayjs().year(9999).endOf("year");
  const accessibleLabel = buttonProps["aria-label"] || (mode === "month" ? "เลือกเดือน" : "เลือกวันที่");
  const open = Boolean(picker && !disabled);

  const popupPosition = (): CSSProperties => {
    const bounds = triggerRef.current!.getBoundingClientRect();
    const width = Math.min(mode === "month" ? 256 : 320, window.innerWidth - 32);
    const height = mode === "month" ? 280 : 350;
    const fitsBelow = window.innerHeight - bounds.bottom >= height + 8;
    return {
      position: "fixed",
      width,
      left: Math.max(16, Math.min(bounds.left, window.innerWidth - width - 16)),
      top: fitsBelow ? bounds.bottom + 8 : Math.max(16, bounds.top - height - 8),
    };
  };
  const openPicker = () => {
    if (disabled) return;
    const trigger = triggerRef.current!;
    const modalRoot = trigger.closest(".MuiModal-root");
    // Keep the popup within the owning dialog's focus boundary while allowing
    // fixed positioning to escape a scrolling field group.
    const container = trigger.closest('[role="dialog"]') ||
      (modalRoot && [...modalRoot.children].find((child) => child.contains(trigger))) ||
      document.body;
    let initial = selected || dayjs();
    if (initial.isBefore(minimum, mode)) initial = minimum;
    if (initial.isAfter(maximum, mode)) initial = maximum;
    setPicker({ viewMonth: initial.startOf("month"), chooseMonth: mode === "month", position: popupPosition(), container });
  };
  const closeAndRestoreFocus = () => {
    setPicker(null);
    triggerRef.current?.focus({ preventScroll: true });
  };
  const select = (next: Dayjs) => {
    if (!calendarValueInBounds(next, minimum, maximum, mode)) return;
    onChange?.(formatCalendarKey(next, mode));
    closeAndRestoreFocus();
  };

  useEffect(() => {
    if (!open) return;
    const outside = (event: Event) => {
      if (event.target instanceof Node && !triggerRef.current?.contains(event.target) && !panelRef.current?.contains(event.target)) setPicker(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setPicker(null);
      triggerRef.current?.focus({ preventScroll: true });
    };
    const closeOnResize = () => setPicker(null);
    const closeOnScroll = (event: Event) => {
      if (event.target instanceof Node && panelRef.current?.contains(event.target)) return;
      setPicker(null);
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    document.addEventListener("keydown", escape, true);
    window.addEventListener("resize", closeOnResize);
    document.addEventListener("scroll", closeOnScroll, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
      document.removeEventListener("keydown", escape, true);
      window.removeEventListener("resize", closeOnResize);
      document.removeEventListener("scroll", closeOnScroll, true);
    };
  }, [open]);

  const updateView = (date: Dayjs) => setPicker((current) => current ? { ...current, viewMonth: date.startOf("month") } : null);
  const days = picker ? Array.from({ length: 42 }, (_, index) => picker.viewMonth.startOf("week").add(index, "day")) : [];
  const focusDay = (date: Dayjs) => {
    if (!calendarValueInBounds(date, minimum, maximum, "date")) return;
    updateView(date);
    window.requestAnimationFrame(() => panelRef.current?.querySelector<HTMLButtonElement>(`[data-date="${formatCalendarKey(date, "date")}"]`)?.focus());
  };

  return (
    <>
      <button
        {...buttonProps}
        ref={triggerRef}
        id={id}
        type="button"
        disabled={disabled}
        className={`calendarInput ${className}${iconOnly ? " calendarInput--iconOnly" : ""}`}
        aria-label={iconOnly ? accessibleLabel : buttonProps["aria-label"]}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? dialogId : undefined}
        onClick={(event) => {
          onClick?.(event);
          if (event.defaultPrevented) return;
          if (open) closeAndRestoreFocus();
          else openPicker();
        }}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          // These keys activate this button, not an owning search combobox.
          if (["Enter", " ", "ArrowDown", "F4"].includes(event.key)) event.stopPropagation();
          if (!event.defaultPrevented && (event.key === "ArrowDown" || event.key === "F4")) {
            event.preventDefault();
            openPicker();
          }
        }}
      >
        {!iconOnly && <span className="calendarInput__value">{selected ? selected.format(displayFormat) : placeholder}</span>}
        <i className={`bx ${mode === "month" ? "bx-chevron-down" : "bx-calendar"} calendarInput__icon`} aria-hidden="true" />
      </button>
      {open && picker && createPortal(
        <div id={dialogId} role="dialog" aria-label={accessibleLabel} ref={panelRef} className="calendarInput__popover" style={picker.position} onKeyDown={(event) => event.stopPropagation()}>
          {picker.chooseMonth ? (
            <MonthPickerPanel
              year={picker.viewMonth.year()}
              selectedMonth={selected?.year() === picker.viewMonth.year() ? selected.month() : -1}
              onYearChange={(year) => updateView(picker.viewMonth.year(year))}
              onMonthChange={(month) => {
                const next = picker.viewMonth.month(month);
                if (mode === "month") select(next);
                else setPicker((current) => current ? { ...current, viewMonth: next, chooseMonth: false } : null);
              }}
              minYear={minimum.year()}
              maxYear={maximum.year()}
              isMonthDisabled={(month) => !calendarValueInBounds(picker.viewMonth.month(month), minimum, maximum, "month")}
              autoFocus
              className="calendarInput__monthPanel"
            />
          ) : (
            <>
              <div className="bookingDateRangePicker__header">
                <button type="button" aria-label="Previous month" disabled={picker.viewMonth.isSame(minimum, "month")} onClick={() => updateView(picker.viewMonth.subtract(1, "month"))}><i className="bx bx-chevron-left" aria-hidden="true" /></button>
                <button type="button" className="calendarInput__monthHeading" onClick={() => setPicker((current) => current ? { ...current, chooseMonth: true } : null)}>{picker.viewMonth.format("MMMM YYYY")}</button>
                <button type="button" aria-label="Next month" disabled={picker.viewMonth.isSame(maximum, "month")} onClick={() => updateView(picker.viewMonth.add(1, "month"))}><i className="bx bx-chevron-right" aria-hidden="true" /></button>
              </div>
              <div className="bookingDateRangePicker__weekdays" aria-hidden="true">{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => <span key={day}>{day}</span>)}</div>
              <div className="bookingDateRangePicker__days">
                {days.map((date) => {
                  const key = formatCalendarKey(date, "date");
                  const isSelected = selected?.isSame(date, "day");
                  return <button
                    type="button"
                    key={key}
                    data-date={key}
                    className={`bookingDateRangePicker__day${date.isSame(picker.viewMonth, "month") ? "" : " bookingDateRangePicker__day--adjacent"}${isSelected ? " bookingDateRangePicker__day--start" : ""}${date.isSame(dayjs(), "day") ? " bookingDateRangePicker__day--today" : ""}`}
                    aria-label={date.format("D MMMM YYYY")}
                    aria-pressed={Boolean(isSelected)}
                    disabled={!calendarValueInBounds(date, minimum, maximum, "date")}
                    autoFocus={isSelected || (!selected?.isSame(picker.viewMonth, "month") && date.isSame(picker.viewMonth, "day"))}
                    onClick={() => select(date)}
                    onKeyDown={(event) => {
                      const offset = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[event.key];
                      if (offset) { event.preventDefault(); focusDay(date.add(offset, "day")); }
                    }}
                  >{date.date()}</button>;
                })}
              </div>
            </>
          )}
          <div className="calendarInput__actions">
            {allowClear && <button type="button" disabled={!value} onClick={() => { onChange?.(""); closeAndRestoreFocus(); }}>ล้างค่า</button>}
            <button type="button" onClick={closeAndRestoreFocus}>ปิด</button>
          </div>
        </div>, picker.container,
      )}
    </>
  );
};

export default CalendarInput;
