import { z } from "zod";
import { activeRoomInventory } from "../config/roomInventory";
import { businessDateKey, businessDateStart } from "../helpers/businessDateHelpers";
import { normalizeBookingSearchText } from "../helpers/bookingSearchHelpers";
import { effectiveCommercialSegments } from "../helpers/commercialSegmentHelpers";
import { bookingOccupiedRoomIdsOnDate, occupancySummaryForRange, occupiedCapacityOnDate, type OccupancyRoomBlock } from "../helpers/occupancyHelpers";
import { getRoomStayRoomIds } from "../helpers/roomStayHelpers";
import { summarizeBookingFinancialPosition, withEffectiveTransactions } from "../services/transactionCorrections";
import type { booking } from "../models/booking";
import type { Reader } from "./store";
import { channels, date, dates, dateSpan, money, page, pageInput, pagination, range, ref, satang, span, statuses, today, ToolError, windowFor, type Window } from "./contracts";
import type { Register } from "./server";

const inventory = activeRoomInventory();
const roomIds = inventory.map(({ id }) => id);
const capacity = new Map(inventory.map(({ id, capacity }) => [id, capacity]));
const validRoom = z.enum(roomIds);
export const text = (value: unknown, max = 120) => typeof value === "string"
  ? Array.from(value.replace(/[\p{Cc}\p{Cf}]/gu, "")).slice(0, max).join("") : "";
export const optionalText = (value: unknown, max = 120) => text(value, max) || null;
export const identifier = (value: unknown) => {
  if (typeof value !== "string" && !(value && typeof value === "object" && "_bsontype" in value && value._bsontype === "ObjectId")) return null;
  const id = ref.safeParse(String(value));
  return id.success ? id.data : null;
};
export const dateKey = (value: unknown) => value instanceof Date && Number.isFinite(+value) ? businessDateKey(value) : null;
export const timestamp = (value: unknown) => value instanceof Date && Number.isFinite(+value) ? value.toISOString() : null;
export const safeEnum = <T extends string>(options: readonly T[], value: unknown): T | null =>
  options.includes(value as T) ? value as T : null;
const idOut = ref.nullable();
const dateOut = date.nullable();
const count = z.int().nonnegative();
export const bookingDTO = z.strictObject({
  bookingId: ref, guestDisplayName: z.string().max(240), status: z.enum(statuses).nullable(), voided: z.boolean(),
  channel: z.enum(channels).nullable(), arrivalDate: dateOut, departureDate: dateOut,
  roomIds: z.array(validRoom), checkedInAt: z.iso.datetime().nullable(), checkedOutAt: z.iso.datetime().nullable(),
});
const roomsFor = (stay: Parameters<typeof getRoomStayRoomIds>[0]) =>
  getRoomStayRoomIds(stay).filter((id) => capacity.has(id));
export function bookingView(record: booking) {
  const bookingId = identifier(record.bookingId);
  if (!bookingId) throw new ToolError("DATA_INCOMPLETE");
  return {
    bookingId, guestDisplayName: text(record.name), status: safeEnum(statuses, record.status),
    voided: record.voided === true, channel: safeEnum(channels, record.platformId),
    arrivalDate: dateKey(record.checkIn), departureDate: dateKey(record.checkOut),
    roomIds: [...new Set((record.roomStays || []).flatMap(roomsFor))],
    checkedInAt: timestamp(record.checkedInAt), checkedOutAt: timestamp(record.checkout?.checkedOutAt),
  };
}
export const positionSchema = z.strictObject({
  bookingTotalSatang: money, amountReceivedSatang: money, outstandingBalanceSatang: money,
  guestCreditSatang: money, remainingDepositSatang: money,
});
export function position(record: booking) {
  for (const transaction of record.transactions || []) satang(transaction.amount);
  const result = summarizeBookingFinancialPosition(record.transactions || []);
  return {
    bookingTotalSatang: satang(result.bookingTotal), amountReceivedSatang: satang(result.amountReceived),
    outstandingBalanceSatang: satang(result.outstandingBalance), guestCreditSatang: satang(result.guestCredit),
    remainingDepositSatang: satang(result.remainingDeposit),
  };
}
export async function exactBooking(read: Reader, bookingId: string, detail = false) {
  const [record] = await read(detail ? "bookingDetail" : "bookingFinance", { bookingId }, { cap: 1 });
  if (!record) throw new ToolError("NOT_FOUND");
  return record;
}
export async function loadOccupancy(read: Reader, w: Window) {
  return Promise.all([
    read("occupancy", { checkIn: { $lt: w.end }, checkOut: { $gt: w.start }, voided: { $ne: true }, status: { $nin: ["cancelled", "noShow"] } }),
    read("block", {
      from: { $lt: w.end }, to: { $gt: w.start },
      $or: [{ roomIds: { $in: roomIds } }, { roomId: { $in: roomIds } }],
    }, { cap: 180 }),
  ]);
}
export const occupancySchema = z.strictObject({
  occupiedBedNights: count, availableBedNights: count, averageOccupiedCapacity: z.number().nonnegative(),
  occupancyRate: z.number().min(0).max(1),
});
export async function occupancyFor(read: Reader, w: Window) {
  const [bookings, blocks] = await loadOccupancy(read, w);
  return occupancySummaryForRange(bookings, w.start, w.end, blocks);
}
function blockActive(block: OccupancyRoomBlock, w: Window) {
  return +block.from < +w.end && +block.to > +w.start &&
    (!block.releasedAt || +businessDateStart(block.releasedAt) > +w.start);
}
const bookingList = z.strictObject({ period: dateSpan, ...pagination(bookingDTO).shape });

export function registerBookings(register: Register) {
  register("get_operations_overview", "Summarize booked bed capacity, available beds, arrivals and departures. Physical assignment counts are available for today only; they are not a headcount.", z.strictObject({ businessDate: date.optional() }), z.strictObject({
    businessDate: date, inventoryBeds: count, bookedOccupiedBeds: count, unavailableBeds: count, availableBeds: count,
    bookedOccupancyPercentage: z.number().min(0).max(100), expectedArrivals: count, expectedDepartures: count,
    checkedInBookings: count.nullable(), checkedInAssignedBeds: count.nullable(),
    overdueCheckouts: count.nullable(), earlyCheckouts: count,
  }), async ({ businessDate = today() }, read) => {
    const w = windowFor({ startDate: businessDate, endDate: businessDate }, 1);
    const current = businessDate === today();
    const [[bookings, blocks], arrivals, departures, early, physical] = await Promise.all([
      loadOccupancy(read, w),
      read("occupancy", { checkIn: range(w), status: "booked", voided: { $ne: true } }),
      read("occupancy", { checkOut: range(w), status: { $in: ["booked", "checkedIn", "checkedOut"] }, voided: { $ne: true } }),
      read("occupancy", { "checkout.earlyCheckOut": true, "checkout.checkedOutAt": range(w), voided: { $ne: true } }),
      current ? read("occupancy", { status: "checkedIn", voided: { $ne: true } }, { cap: 180 }) : Promise.resolve(null),
    ]);
    const occupied = occupiedCapacityOnDate(bookings, w.start, w.end, blocks);
    const bookedRooms = new Set(bookings.flatMap((record) => bookingOccupiedRoomIdsOnDate(record, w.start, w.end)));
    const allUnavailableRooms = new Set([...bookedRooms, ...blocks.filter((b) => blockActive(b, w)).flatMap(roomsFor)]);
    const total = inventory.reduce((n, room) => n + room.capacity, 0);
    const unavailable = [...allUnavailableRooms].reduce((n, roomId) => n + (capacity.get(roomId) ?? 0), 0);
    const assigned = new Set(physical?.flatMap((record) => {
      const planned = bookingOccupiedRoomIdsOnDate(record, w.start, w.end);
      if (planned.length) return planned;
      const latest = [...(record.roomStays || [])].filter((stay) => +stay.from < +w.end).sort((a, b) => +b.from - +a.from)[0];
      return latest ? roomsFor(latest) : [];
    }));
    return {
      businessDate, inventoryBeds: total, bookedOccupiedBeds: occupied,
      unavailableBeds: unavailable, availableBeds: total - unavailable, bookedOccupancyPercentage: occupied * 100 / total,
      expectedArrivals: arrivals.length, expectedDepartures: departures.filter((b) => !b.checkout?.earlyCheckOut).length,
      checkedInBookings: physical?.length ?? null, checkedInAssignedBeds: physical ? [...assigned].reduce((n, id) => n + (capacity.get(id) ?? 0), 0) : null,
      overdueCheckouts: physical?.filter((record) => +record.checkOut < +w.start).length ?? null,
      earlyCheckouts: early.length,
    };
  });

  register("list_arrivals_departures", "List scheduled arrivals or departures in Bangkok, excluding voided reservations. Optional status filter and pagination.", z.strictObject({
    ...dates, ...pageInput, kind: z.enum(["arrivals", "departures"]), statuses: z.array(z.enum(statuses)).min(1).max(5).optional(),
  }), bookingList, async (args, read) => {
    const w = windowFor(args, 14);
    const field = args.kind === "arrivals" ? "checkIn" : "checkOut";
    const records = await read("bookingList", {
      [field]: range(w), status: { $in: args.statuses || ["booked", "checkedIn", "checkedOut"] }, voided: { $ne: true },
    }, { sort: { [field]: 1, _id: 1 }, skip: args.offset, cap: args.limit + 1 });
    return { period: span(w), ...page(records.map(bookingView), args, true) };
  });

  register("search_bookings", "Find bookings by exact ID, indexed guest name prefix or a short arrival/departure window. Room, status and channel can narrow results.", z.strictObject({
    ...pageInput, bookingId: ref.optional(), guestNamePrefix: z.string().trim().min(3).max(60).optional(),
    roomId: validRoom.optional(), status: z.enum(statuses).optional(), channel: z.enum(channels).optional(),
    includeVoided: z.boolean().default(false), period: dateSpan.optional(), dateField: z.enum(["arrival", "departure"]).default("arrival"),
  }), pagination(bookingDTO), async (args, read) => {
    const prefix = normalizeBookingSearchText(args.guestNamePrefix);
    if (!args.bookingId && !prefix && !args.period) throw new ToolError("INVALID_FILTER");
    if (args.guestNamePrefix && prefix.length < 3) throw new ToolError("INVALID_FILTER");
    const field = args.dateField === "arrival" ? "checkIn" : "checkOut";
    const filters = [
      args.bookingId && { $or: [{ bookingId: args.bookingId }, { searchBookingIds: normalizeBookingSearchText(args.bookingId) }] },
      prefix && { searchNamePrefixes: prefix },
      args.roomId && { $or: [{ "roomStays.roomIds": args.roomId }, { "roomStays.roomId": args.roomId }] },
      args.status && { status: args.status }, args.channel && { platformId: args.channel },
      args.period && { [field]: range(windowFor(args.period, 31)) }, !args.includeVoided && { voided: { $ne: true } },
    ].filter((filter): filter is Exclude<typeof filter, undefined | false | ""> => !!filter);
    const records = await read("bookingList", { $and: filters }, { sort: { [field]: 1, _id: 1 }, skip: args.offset, cap: args.limit + 1 });
    return page(records.map(bookingView), args, true);
  });

  register("get_booking_details", "Get the allowed reservation, room stays, commercial segments and effective payment balance for an exact booking ID.", z.strictObject({ bookingId: ref }), z.strictObject({
    booking: bookingDTO, paymentSummary: positionSchema,
    roomStays: z.array(z.strictObject({ roomIds: z.array(validRoom), stayStartDate: dateOut, stayEndDate: dateOut })).max(300),
    commercialSegments: z.array(z.strictObject({
      segmentId: idOut, chargeTransactionId: idOut, kind: z.enum(["original", "extension"]).nullable(),
      stayStartDate: dateOut, stayEndDate: dateOut, channel: z.enum(channels).nullable(), chargeSatang: money,
    })).max(301),
  }), async ({ bookingId }, read) => {
    const source = await exactBooking(read, bookingId, true);
    const record = withEffectiveTransactions(source);
    return {
      booking: bookingView(source), paymentSummary: position(record),
      roomStays: (record.roomStays || []).map((stay) => ({
        roomIds: roomsFor(stay), stayStartDate: dateKey(stay.from), stayEndDate: dateKey(stay.to),
      })),
      commercialSegments: effectiveCommercialSegments(record).map((segment) => ({
        segmentId: identifier(segment._id), chargeTransactionId: identifier(segment.transactionId),
        kind: safeEnum(["original", "extension"] as const, segment.kind), channel: safeEnum(channels, segment.platformId),
        stayStartDate: dateKey(segment.from), stayEndDate: dateKey(segment.to), chargeSatang: satang(segment.amount),
      })),
    };
  });
}
