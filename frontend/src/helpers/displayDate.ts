import type { DateFormatPreference } from "../types/userSettings";

const toDate = (date: string | Date) => new Date(date);

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
) =>
  `${toDate(date).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  })} - ${formatDisplayDate(date, dateFormat)}`;

export const formatHeaderDate = (date: string | Date) =>
  new Intl.DateTimeFormat("en-GB", {
    calendar: "gregory",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(toDate(date));
