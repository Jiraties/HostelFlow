import type { PaymentMethod, PlatformId } from "./bookingTypes";

export type CalendarColorMode = "status" | "source";
export type Density = "compact" | "comfortable" | "spacious";
export type DateFormatPreference = "dd/MM/yyyy" | "d MMM yyyy";
export type SpreadsheetView = "arrivals" | "departures" | "master";
export type SpreadsheetColumnOrders = Partial<Record<SpreadsheetView, string[]>>;

export interface UserSettings {
  calendarColorMode: CalendarColorMode;
  calendarDensity: Density;
  tableDensity: Density;
  defaultPlatformId: PlatformId | "";
  defaultPaymentMethod: PaymentMethod | "";
  dateFormat: DateFormatPreference;
  spreadsheetColumnOrders: SpreadsheetColumnOrders;
}

export const defaultUserSettings: UserSettings = {
  calendarColorMode: "status",
  calendarDensity: "comfortable",
  tableDensity: "comfortable",
  defaultPlatformId: "",
  defaultPaymentMethod: "",
  dateFormat: "dd/MM/yyyy",
  spreadsheetColumnOrders: {},
};

export const normalizeUserSettings = (
  settings?: Partial<UserSettings>,
): UserSettings => ({
  ...defaultUserSettings,
  ...(settings || {}),
});
