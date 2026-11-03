import { useRef, type CSSProperties } from "react";
import "./MonthPickerPanel.css";

type MonthPickerPanelProps = {
  year: number;
  selectedMonth: number;
  onYearChange: (year: number) => void;
  onMonthChange: (month: number) => void;
  minYear?: number;
  maxYear?: number;
  isMonthDisabled?: (month: number) => boolean;
  autoFocus?: boolean;
  className?: string;
  style?: CSSProperties;
};

const monthNames = Array.from({ length: 12 }, (_, month) =>
  new Intl.DateTimeFormat("en-GB", { month: "long", calendar: "gregory" }).format(new Date(2024, month, 1)),
);

/** The calendar page's existing year controls and twelve-month grid. */
const MonthPickerPanel = ({
  year,
  selectedMonth,
  onYearChange,
  onMonthChange,
  minYear = 1,
  maxYear = 9999,
  isMonthDisabled = () => false,
  autoFocus = false,
  className = "",
  style,
}: MonthPickerPanelProps) => {
  const panelRef = useRef<HTMLSpanElement>(null);
  const focusMonth = selectedMonth >= 0 && !isMonthDisabled(selectedMonth)
    ? selectedMonth
    : monthNames.findIndex((_, index) => !isMonthDisabled(index));
  return (
    <span className={`calendar__monthPickerPanel ${className}`} style={style} ref={panelRef}>
      <span className="calendar__monthPickerYear">
        <button type="button" aria-label="Previous year" disabled={year <= minYear} onClick={() => onYearChange(year - 1)}>
          <i className="bx bx-chevron-left" aria-hidden="true" />
        </button>
        <span aria-live="polite">{year}</span>
        <button type="button" aria-label="Next year" disabled={year >= maxYear} onClick={() => onYearChange(year + 1)}>
          <i className="bx bx-chevron-right" aria-hidden="true" />
        </button>
      </span>
      <span className="calendar__monthPickerMonths">
        {monthNames.map((monthName, monthIndex) => (
          <button
            className={`calendar__monthPickerMonth${monthIndex === selectedMonth ? " calendar__monthPickerMonth--selected" : ""}`}
            type="button"
            key={monthName}
            data-month-index={monthIndex}
            aria-label={`${monthName} ${year}`}
            aria-pressed={monthIndex === selectedMonth}
            disabled={isMonthDisabled(monthIndex)}
            autoFocus={autoFocus && monthIndex === focusMonth}
            onClick={() => onMonthChange(monthIndex)}
            onKeyDown={(event) => {
              const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -3, ArrowDown: 3 }[event.key];
              if (!step) return;
              event.preventDefault();
              let next = monthIndex + step;
              while (next >= 0 && next < 12 && isMonthDisabled(next)) next += step;
              panelRef.current?.querySelector<HTMLButtonElement>(`[data-month-index="${next}"]`)?.focus();
            }}
          >
            {monthName.slice(0, 3)}
          </button>
        ))}
      </span>
    </span>
  );
};

export default MonthPickerPanel;
