import dayjs, { type Dayjs } from "dayjs";

export type CalendarInputMode = "date" | "month";

/** Calendar keys stay local date strings; never convert them through UTC. */
export const parseCalendarKey = (value: string, mode: CalendarInputMode): Dayjs | null => {
  const match = value.match(mode === "month" ? /^(\d{4})-(\d{2})$/ : /^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = mode === "month" ? 1 : Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const parsed = dayjs().startOf("day").date(1).year(year).month(month - 1).date(day);
  return parsed.year() === year && parsed.month() === month - 1 && parsed.date() === day ? parsed : null;
};

export const formatCalendarKey = (value: Dayjs, mode: CalendarInputMode) =>
  value.format(mode === "month" ? "YYYY-MM" : "YYYY-MM-DD");

export const calendarValueInBounds = (value: Dayjs, minimum: Dayjs, maximum: Dayjs, mode: CalendarInputMode) =>
  formatCalendarKey(value, mode) >= formatCalendarKey(minimum, mode) &&
  formatCalendarKey(value, mode) <= formatCalendarKey(maximum, mode);
