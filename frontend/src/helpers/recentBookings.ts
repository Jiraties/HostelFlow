export type RecentBookingEntry = {
  bookingId: string;
  openedAt: number;
};

const MAX_RECENT_BOOKINGS = 8;
const keyForUser = (userId: string) =>
  `hostelflow:recent-bookings:${userId}`;

const isEntry = (value: unknown): value is RecentBookingEntry => {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<RecentBookingEntry>;
  return (
    typeof entry.bookingId === "string" &&
    entry.bookingId.trim().length >= 3 &&
    entry.bookingId.trim().length <= 64 &&
    typeof entry.openedAt === "number" &&
    Number.isFinite(entry.openedAt)
  );
};

export const readRecentBookings = (userId?: string) => {
  if (!userId) return [];
  try {
    const parsed = JSON.parse(sessionStorage.getItem(keyForUser(userId)) || "[]");
    if (!Array.isArray(parsed)) return [];
    const newestById = new Map<string, RecentBookingEntry>();
    parsed.filter(isEntry).forEach((entry) => {
      const bookingId = entry.bookingId.trim();
      const existing = newestById.get(bookingId);
      if (!existing || existing.openedAt < entry.openedAt) {
        newestById.set(bookingId, { bookingId, openedAt: entry.openedAt });
      }
    });
    return [...newestById.values()]
      .sort((first, second) => second.openedAt - first.openedAt)
      .slice(0, MAX_RECENT_BOOKINGS);
  } catch {
    return [];
  }
};

export const rememberBooking = (userId: string | undefined, bookingId: string) => {
  if (!userId || !bookingId.trim()) return;
  const next = [
    { bookingId: bookingId.trim(), openedAt: Date.now() },
    ...readRecentBookings(userId).filter((entry) => entry.bookingId !== bookingId),
  ].slice(0, MAX_RECENT_BOOKINGS);
  try {
    sessionStorage.setItem(keyForUser(userId), JSON.stringify(next));
  } catch {
    // Search recents are optional and must never block opening a booking.
  }
};

export const clearRecentBookings = (userId?: string) => {
  if (!userId) return;
  try {
    sessionStorage.removeItem(keyForUser(userId));
  } catch {
    // Ignore unavailable or disabled session storage.
  }
};

