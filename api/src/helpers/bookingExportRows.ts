import type { booking, commercialSegment, transcation } from "../models/booking";
import { ROOM_INVENTORY } from "../config/roomInventory";
import { commercialRoomSlices, effectiveCommercialSegments, transactionPlatformId } from "./commercialSegmentHelpers";
import { effectiveBookingTransactions } from "../services/transactionCorrections";
import { bookingsReportDepositCollectedTotal, bookingsReportTransactionAmount, bookingsReportUnpaidCancellationAdjustments } from "./bookingsReportHelpers";
import { EXPECTED_STAY_REVENUE_SERVICE_TYPES } from "./expectedStayRevenueHelpers";
import { exportFilterValues, hasEmptyExportDimension, matchesExportStatus, type ExportFilters } from "./exportFilters";

export type RoomExportCategory = "private" | "dorm" | "mixed" | "unclassified";
export type BookingExportRow = {
  booking: booking;
  category: RoomExportCategory | "services";
  kind: "accommodation" | "service" | "adjustment";
  sourceId: string;
  channelBookingId: string;
  from: Date;
  to: Date;
  rooms: string[];
  platformId: string;
  paymentMethod: string;
  amount: number;
  depositCollected: number | "";
  createdBy?: string;
  note: string;
  transactionType?: string;
};

const serviceTypes = new Set(EXPECTED_STAY_REVENUE_SERVICE_TYPES);
const inventory = new Map(ROOM_INVENTORY.map((room) => [room.id, room]));

/** A commercial charge is indivisible: mixed room types never duplicate it. */
export const classifyExportRooms = (rooms: string[]): RoomExportCategory => {
  if (rooms.length === 0 || rooms.some((id) => !inventory.has(id))) return "unclassified";
  const categories = new Set(rooms.map((id) => inventory.get(id)!.category));
  return categories.size > 1 ? "mixed" : [...categories][0];
};

const matchesRoomCategory = (category: RoomExportCategory, filters: ExportFilters) =>
  category === "mixed" || category === "unclassified"
    ? filters.categories.includes("private") || filters.categories.includes("dorm")
    : filters.categories.includes(category);

const roomsForSegment = (booking: booking, segment?: commercialSegment) =>
  [...new Set(commercialRoomSlices(booking)
    .filter((slice) => !segment || (new Date(slice.from) < new Date(segment.to) && new Date(slice.to) > new Date(segment.from)))
    .flatMap((slice) => slice.roomIds))];

const serviceRelated = (transaction: transcation, transactions: transcation[], visited = new Set<string>()): boolean => {
  if (serviceTypes.has(transaction.type) || (transaction.relatedTransactionType && serviceTypes.has(transaction.relatedTransactionType))) return true;
  if (!transaction.relatedTransactionId || visited.has(transaction.relatedTransactionId)) return false;
  visited.add(transaction.relatedTransactionId);
  const parent = transactions.find((candidate) => String(candidate._id) === transaction.relatedTransactionId);
  return parent ? serviceRelated(parent, transactions, visited) : false;
};

/** Refunds can reference a room charge directly or the receipt settling it. */
const segmentForTransaction = (
  transaction: transcation,
  transactions: transcation[],
  segments: commercialSegment[],
): commercialSegment | undefined => {
  const visited = new Set<transcation>();
  let current = transaction;
  while (!visited.has(current)) {
    visited.add(current);
    const { _id, commercialSegmentId, relatedTransactionId } = current;
    const segment = segments.find((candidate) =>
      (commercialSegmentId && String(candidate._id) === commercialSegmentId) ||
      candidate.transactionId === String(_id) ||
      candidate.transactionId === relatedTransactionId);
    if (segment) return segment;
    if (!relatedTransactionId) return undefined;
    const parent = transactions.find((candidate) => String(candidate._id) === relatedTransactionId);
    if (!parent) return undefined;
    current = parent;
  }
  return undefined;
};

export const buildBookingExportRows = (
  bookings: booking[],
  bounds: { start: Date; end: Date },
  filters: ExportFilters,
): BookingExportRow[] => {
  if (hasEmptyExportDimension(filters)) return [];
  const matchesPayment = (method?: string) => method
    ? filters.paymentMethods.includes(method)
    : filters.paymentMethods.length === exportFilterValues().paymentMethods.length;
  const rows: BookingExportRow[] = [];

  bookings.forEach((booking) => {
    if (!matchesExportStatus(booking, filters)) return;
    const transactions = effectiveBookingTransactions(booking);
    const { adjustments: cancellationAdjustments, needsReview: cancellationNeedsReview } = bookingsReportUnpaidCancellationAdjustments(booking, transactions);
    const source = typeof booking.toObject === "function" ? booking.toObject() : booking;
    const financialBooking = {
      ...source,
      transactions,
      roomStays: (source.roomStays || []).map((stay: booking["roomStays"][number]) => ({
        ...stay,
        roomIds: stay.roomIds?.length ? stay.roomIds : stay.roomId ? [stay.roomId] : [],
      })),
    } as booking;
    const segments = effectiveCommercialSegments(financialBooking);

    segments.filter((segment) => new Date(segment.from) < bounds.end && new Date(segment.to) > bounds.start)
      .forEach((segment) => {
        const transaction = transactions.find((candidate) => String(candidate._id) === segment.transactionId);
        const rooms = roomsForSegment(financialBooking, segment);
        const category = classifyExportRooms(rooms);
        if (!matchesRoomCategory(category, filters) || !filters.bookingChannels.includes(segment.platformId) || !matchesPayment(transaction?.paymentMethod)) return;
        rows.push({
          booking,
          category,
          kind: "accommodation",
          sourceId: String(segment._id || segment.transactionId),
          channelBookingId: segment.channelBookingId || booking.bookingId,
          from: new Date(segment.from),
          to: new Date(segment.to),
          rooms,
          platformId: segment.platformId,
          paymentMethod: transaction?.paymentMethod || "",
          amount: transaction?.amount ?? segment.amount,
          depositCollected: segment.kind === "original"
            ? bookingsReportDepositCollectedTotal(transactions.filter((entry) => filters.paymentMethods.includes(entry.paymentMethod) && filters.bookingChannels.includes(transactionPlatformId(financialBooking, entry))))
            : "",
          createdBy: segment.createdBy || booking.staffUsername,
          note: [segment.note || booking.note || "", cancellationNeedsReview ? "ตรวจสอบยอดยกเลิก: รายการชำระหรือปิดยอดไม่ระบุค่าห้องที่เกี่ยวข้อง" : ""].filter(Boolean).join(" · "),
        });
        const adjustment = cancellationAdjustments.get(segment.transactionId);
        if (adjustment !== undefined) rows.push({
          booking, category, kind: "adjustment",
          sourceId: `cancel-unpaid:${segment.transactionId}`,
          channelBookingId: segment.channelBookingId || booking.bookingId,
          from: new Date(segment.from), to: new Date(segment.to), rooms,
          platformId: segment.platformId, paymentMethod: "Unpaid", amount: adjustment,
          depositCollected: "", createdBy: booking.cancellation?.cancelledByStaffUsername || booking.staffUsername,
          note: "ยอดค้างรับที่ยกเลิก (คำนวณสำหรับรายงาน ไม่ใช่การคืนเงินจริง)",
          transactionType: "cancelledUnpaidBalance",
        });
      });

    transactions.forEach((transaction) => {
      const amount = bookingsReportTransactionAmount(transaction);
      if (transaction.type === "roomCharge" || amount === 0) return;
      const isService = serviceRelated(transaction, transactions);
      const segment = segmentForTransaction(transaction, transactions, segments);
      const rooms = isService ? [] : roomsForSegment(financialBooking, segment);
      const category = isService ? "services" : classifyExportRooms(rooms);
      const platformId = segment && !transaction.platformId
        ? segment.platformId : transactionPlatformId(financialBooking, transaction);
      if (!filters.bookingChannels.includes(platformId) || !matchesPayment(transaction.paymentMethod)) return;
      if (category === "services" ? !filters.categories.includes("services") : !matchesRoomCategory(category, filters)) return;
      rows.push({
        booking,
        category,
        kind: serviceTypes.has(transaction.type) ? "service" : "adjustment",
        sourceId: String(transaction._id || ""),
        channelBookingId: booking.bookingId,
        from: new Date(booking.checkIn),
        to: new Date(booking.checkOut),
        rooms,
        platformId,
        paymentMethod: transaction.paymentMethod,
        amount,
        depositCollected: "",
        createdBy: transaction.createdBy || booking.staffUsername,
        note: transaction.note || "",
        transactionType: transaction.type,
      });
    });
  });
  return rows;
};
