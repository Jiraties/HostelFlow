// Fabricated records only. No production identifiers, people, or financial values.
import type { booking } from "../../src/models/booking";

export const syntheticDate = (day: string) => new Date(`${day}T00:00:00+07:00`);
export const syntheticAnalyticsBooking = (overrides: Partial<booking> = {}) => ({
  bookingId: "SYNTHETIC-ANALYTICS-BOOKING",
  name: "Synthetic analytics fixture",
  staffUsername: "synthetic-analytics-admin",
  platformId: "BOOK",
  status: "booked",
  checkIn: syntheticDate("2026-09-02"),
  checkOut: syntheticDate("2026-09-04"),
  roomStays: [{ from: syntheticDate("2026-09-02"), to: syntheticDate("2026-09-04"), roomIds: ["Siesta 1", "Balcony"] }],
  transactions: [{ _id: "synthetic-charge", type: "roomCharge", paymentMethod: "Unpaid", amount: 900, createdAt: syntheticDate("2026-07-01") }],
  commercialSegments: [{ kind: "original", from: syntheticDate("2026-09-02"), to: syntheticDate("2026-09-04"), platformId: "BOOK", amount: 900, transactionId: "synthetic-charge", createdBy: "synthetic-analytics-admin", createdAt: syntheticDate("2026-07-01") }],
  transactionCorrections: [],
  ...overrides,
}) as booking;
