export type PassportReportStatus = {
  total: number;
  complete: number;
  missing: number;
  missingBookings: {
    bookingId: string;
    name: string;
    checkOut?: string;
    guestId?: string | null;
    guestLabel?: string;
    reason?: string;
  }[];
};

export type PassportReadiness = {
  data: PassportReportStatus | null;
  loading: boolean;
  error: string | null;
  updatedAt: Date | null;
};

export const passportReadinessKind = ({ data, loading, error }: PassportReadiness) => {
  if (loading) return "loading";
  if (error || !data) return "error";
  if (data.total === 0) return "empty";
  return data.missing > 0 ? "incomplete" : "ready";
};

export const isPassportReportStatus = (value: unknown): value is PassportReportStatus => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as PassportReportStatus;
  return [candidate.total, candidate.complete, candidate.missing].every((count) => Number.isInteger(count) && count >= 0) &&
    candidate.total === candidate.complete + candidate.missing &&
    Array.isArray(candidate.missingBookings) && candidate.missingBookings.length === candidate.missing &&
    candidate.missingBookings.every((entry) => entry && typeof entry.bookingId === "string" && typeof entry.name === "string");
};

export const currentReportingDate = (now = new Date()) => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const part = (type: string) => parts.find((entry) => entry.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
};

/** Acquire synchronously, before a request or confirmation can yield. */
export const withDocumentExportLock = async (
  locks: Set<string>,
  key: string,
  operation: () => Promise<void>,
) => {
  if (locks.has(key)) return false;
  locks.add(key);
  try {
    await operation();
    return true;
  } finally {
    locks.delete(key);
  }
};
