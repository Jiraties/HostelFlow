import type { DateFormatPreference } from "../types/userSettings";

const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const SHORT_MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

const toDate = (date: string | Date) => {
  if (typeof date === "string") {
    const dateKeyMatch = date.match(DATE_KEY_PATTERN);
    if (dateKeyMatch) {
      return new Date(
        Number(dateKeyMatch[1]),
        Number(dateKeyMatch[2]) - 1,
        Number(dateKeyMatch[3]),
      );
    }
  }

  return new Date(date);
};

const toDateKey = (year: number, month: number, day: number) => {
  const value = new Date(year, month - 1, day);
  if (
    value.getFullYear() !== year ||
    value.getMonth() !== month - 1 ||
    value.getDate() !== day
  ) {
    return null;
  }

  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
};

export const formatDisplayDate = (
  date: string | Date,
  dateFormat: DateFormatPreference = "dd/MM/yyyy",
  options?: { includeYear?: boolean },
) => {
  const value = toDate(date);
  const includeYear = options?.includeYear !== false;

  if (dateFormat === "d MMM yyyy") {
    return new Intl.DateTimeFormat("en-GB", {
      calendar: "gregory",
      day: "numeric",
      month: "short",
      ...(includeYear ? { year: "numeric" } : {}),
    }).format(value);
  }

  return new Intl.DateTimeFormat("en-GB", {
    calendar: "gregory",
    day: "2-digit",
    month: "2-digit",
    ...(includeYear ? { year: "numeric" } : {}),
  }).format(value);
};

export const formatDisplayDateTime = (
  date: string | Date,
  dateFormat: DateFormatPreference = "dd/MM/yyyy",
  options?: { includeYear?: boolean },
) =>
  `${formatDisplayTime(date)} - ${formatDisplayDate(date, dateFormat, options)}`;

export const formatDisplayTime = (date: string | Date) =>
  toDate(date).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });

export const dateFormatPlaceholder = (dateFormat: DateFormatPreference) =>
  dateFormat === "d MMM yyyy" ? "d mmm yyyy" : "dd/mm/yyyy";

export const formatDateInputValue = (
  value: string,
  dateFormat: DateFormatPreference,
) => (value ? formatDisplayDate(value, dateFormat) : "");

export const formatNumericDateDraft = (
  value: string,
  previousValue = "",
) => {
  if (value.length < previousValue.length) {
    return value.replace(/[^\d/]/g, "").slice(0, 10);
  }

  const firstSlash = value.indexOf("/");
  if (firstSlash > 0) {
    const dayDigits = value.slice(0, firstSlash).replace(/\D/g, "").slice(0, 2);
    if (dayDigits) {
      const day = dayDigits.padStart(2, "0");
      const remainingDigits = value
        .slice(firstSlash + 1)
        .replace(/\D/g, "")
        .slice(0, 6);
      if (!remainingDigits) return `${day}/`;

      const firstMonthDigit = remainingDigits[0];
      if (remainingDigits.length === 1) {
        return /^[2-9]$/.test(firstMonthDigit)
          ? `${day}/0${firstMonthDigit}/`
          : `${day}/${firstMonthDigit}`;
      }

      const month = remainingDigits.slice(0, 2);
      return remainingDigits.length === 2
        ? `${day}/${month}/`
        : `${day}/${month}/${remainingDigits.slice(2)}`;
    }
  }

  const digits = value.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 2) return digits;

  const day = digits.slice(0, 2);
  const firstMonthDigit = digits[2];
  if (digits.length === 3) {
    return /^[2-9]$/.test(firstMonthDigit)
      ? `${day}/0${firstMonthDigit}/`
      : `${day}/${firstMonthDigit}`;
  }

  const month = digits.slice(2, 4);
  return digits.length === 4
    ? `${day}/${month}/`
    : `${day}/${month}/${digits.slice(4)}`;
};

export const parseDateInputValue = (
  value: string,
  dateFormat: DateFormatPreference,
) => {
  const normalizedValue = value.trim();
  const isoMatch = normalizedValue.match(DATE_KEY_PATTERN);
  if (isoMatch) {
    return toDateKey(
      Number(isoMatch[1]),
      Number(isoMatch[2]),
      Number(isoMatch[3]),
    );
  }

  if (dateFormat === "d MMM yyyy") {
    const displayMatch = normalizedValue.match(/^(\d{1,2}) ([A-Za-z]{3}) (\d{4})$/);
    if (!displayMatch) return null;
    const month = SHORT_MONTHS.findIndex(
      (name) => name.toLowerCase() === displayMatch[2].toLowerCase(),
    );

    return month < 0
      ? null
      : toDateKey(Number(displayMatch[3]), month + 1, Number(displayMatch[1]));
  }

  const displayMatch = normalizedValue.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return displayMatch
    ? toDateKey(
        Number(displayMatch[3]),
        Number(displayMatch[2]),
        Number(displayMatch[1]),
      )
    : null;
};

export const formatHeaderDate = (
  date: string | Date,
  dateFormat: DateFormatPreference = "dd/MM/yyyy",
) => formatDisplayDate(date, dateFormat);
