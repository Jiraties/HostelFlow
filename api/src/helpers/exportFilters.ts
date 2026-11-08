import Booking, { transactionSchema, type PlatformId } from "../models/booking";

// The existing document-export channel catalogue. Keep the legacy workbook's
// labels and colors while sharing its values with request validation.
export const exportPlatformMap: Record<string, { label: string; color: string }> = {
  BOOK: { label: "Booking.com", color: "003580" },
  HOST: { label: "Hostelworld", color: "F15A24" },
  AGOD: { label: "Agoda", color: "19AC5B" },
  TRAV: { label: "Traveloka", color: "00ADEF" },
  WALK: { label: "Walk-In", color: "F12424" },
} satisfies Record<PlatformId, { label: string; color: string }>;

export const EXPORT_CATEGORIES = ["private", "dorm", "services"] as const;
export type ExportCategory = (typeof EXPORT_CATEGORIES)[number];

const enumValues = (path: { options: { enum?: readonly string[] } }) =>
  [...(path.options.enum || [])];

export type ExportFilters = {
  bookingChannels: string[];
  bookingStatuses: string[];
  paymentMethods: string[];
  categories: string[];
};

export const exportFilterValues = (): ExportFilters => ({
  bookingChannels: Object.keys(exportPlatformMap),
  bookingStatuses: [...enumValues(Booking.schema.path("status")), "voided"],
  paymentMethods: enumValues(transactionSchema.path("paymentMethod")),
  categories: [...EXPORT_CATEGORIES],
});

export class ExportFilterError extends Error {}

/** Comma-separated or repeated parameters. An explicit empty value means none. */
const parseSelection = (value: unknown, allowed: string[], key: string) => {
  const values = Array.isArray(value) ? value : [value];
  if (!values.every((item) => typeof item === "string")) {
    throw new ExportFilterError(`Invalid ${key}`);
  }
  const selected = [...new Set((values as string[]).flatMap((item) => item.split(",")))];
  if (selected.length === 1 && selected[0] === "") return [];
  if (selected.some((item) => !allowed.includes(item))) {
    throw new ExportFilterError(`Invalid ${key}`);
  }
  return selected;
};

export const usesMultiExportFilters = (query: Record<string, unknown>) =>
  query.filterVersion !== undefined ||
  Object.keys(exportFilterValues()).some((key) => query[key] !== undefined);

export const parseExportFilters = (query: Record<string, unknown>): ExportFilters => {
  if (query.filterVersion !== undefined && query.filterVersion !== "2") {
    throw new ExportFilterError("Unsupported filterVersion");
  }
  const allowed = exportFilterValues();
  const defaults = {
    ...allowed,
    bookingStatuses: allowed.bookingStatuses.filter((status) => status !== "cancelled"),
  };
  const legacyKeys = {
    bookingChannels: "bookingChannel",
    bookingStatuses: "bookingStatus",
    paymentMethods: "paymentMethod",
    categories: null,
  } as const;
  const result = {} as ExportFilters;
  for (const key of Object.keys(allowed) as (keyof ExportFilters)[]) {
    const legacyKey = legacyKeys[key];
    if (query[key] !== undefined && legacyKey && query[legacyKey] !== undefined) {
      throw new ExportFilterError(`Use ${key} or ${legacyKey}, not both`);
    }
    const value = query[key] ?? (legacyKey ? query[legacyKey] : undefined);
    // Preserve explicit legacy 'all' when a client migrates one dimension.
    if (value === undefined) result[key] = defaults[key];
    else if (legacyKey && query[key] === undefined && (value === "all" || value === "")) {
      result[key] = allowed[key];
    } else result[key] = parseSelection(value, allowed[key], key);
  }
  return result;
};

/** Void is a flag independent of status; expose it as its own export bucket. */
export const matchesExportStatus = (
  booking: { status: string; voided?: boolean },
  filters: ExportFilters,
) => filters.bookingStatuses.includes(booking.voided ? "voided" : booking.status);

export const hasEmptyExportDimension = (filters: ExportFilters) =>
  Object.values(filters).some((selected) => selected.length === 0);
