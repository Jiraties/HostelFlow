import { z } from "zod";
import { BUSINESS_DAY_MS, businessDateKey } from "../helpers/businessDateHelpers";

export const property = Object.freeze({ id: "bmk", timeZone: "Asia/Bangkok", currency: "THB" } as const);
export const scope = "hostelflow:read";
export type OwnerContext = Readonly<{ property: typeof property }>;
export type Window = { start: Date; end: Date; startDate: string; endDate: string };
export const today = () => businessDateKey(new Date());
export const date = z.iso.date().refine((value) => +value.slice(0, 4) >= 1900 && +value.slice(0, 4) <= 9998, "Use a business date from 1900 through 9998");
export const dates = { startDate: date, endDate: date };
export const pageInput = {
  limit: z.int().min(1).max(25).default(15),
  offset: z.int().min(0).max(500).default(0),
};
export type PageInput = { offset: number; limit: number };
export const ref = z.string().min(1).max(80).regex(/^[\p{L}\p{N}][\p{L}\p{N}._/-]*$/u);
export const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/);
export const methods = ["OTA", "Cash", "Card", "Transfer", "Unpaid"] as const;
export const channels = ["BOOK", "HOST", "TRAV", "AGOD", "WALK"] as const;
export const statuses = ["booked", "checkedIn", "checkedOut", "cancelled", "noShow"] as const;
export const transactionTypes = [
  "roomCharge", "deposit", "adjustment", "depositRefund", "cancellationRefund", "roomRefund",
  "roomChargeWriteOff", "settlementCharge", "compensation", "depositKept", "paymentCorrection",
  "towel", "motorbike", "slowBoat", "joinTour", "extraBed", "pickACraft", "trek2D", "setMenu",
  "sleeperBus", "onlyWalk", "laundry", "bicycle", "car", "misc", "rainCoat", "passwordLock", "cooking", "cardSurcharge",
] as const;
export const sourceActions = [
  "NEW_BOOKING", "EXTEND_BOOKING", "CHECK_IN", "CORRECT_CHECK_IN", "CORRECT_BOOKING_STATUS",
  "CHECK_OUT", "ADD_TRANSACTION", "CANCEL_BOOKING", "MARK_NO_SHOW", "RECORD_PRE_ARRIVAL_ROOM_PAYMENT",
  "RECORD_REFUND", "RECORD_COMPENSATION", "RESOLVE_STAY", "ADD_STANDALONE_SALE",
  "ADJUST_STANDALONE_SALE", "CORRECT_TRANSACTION", "SYSTEM_MIGRATION",
] as const;
export const cashCorrections = ["recorded_mistake", "charge_change"] as const;
export const financeActions = [
  "RECORD_PRE_ARRIVAL_ROOM_PAYMENT", "RECORD_REFUND", "RECORD_COMPENSATION", "POST_CLOSE_ADJUSTMENT",
  "ADD_TRANSACTION", "CORRECT_TRANSACTION", "ADD_STANDALONE_SALE", "ADJUST_STANDALONE_SALE",
  "DAILY_CLOSE", "REVIEW_TRANSACTION", "RESOLVE_STAY",
] as const;
export const operationalActions = [
  "LOGIN", "LOGOUT", "NEW_BOOKING", "EXTEND_BOOKING", "REMOVE_BOOKING", "EDIT_BOOKING", "CHECK_IN",
  "CORRECT_CHECK_IN", "CORRECT_BOOKING_STATUS", "CHECK_OUT", "CANCEL_BOOKING", "MARK_NO_SHOW",
  "CORRECT_CLOSED_ROOM_AVAILABILITY", "CREATE_ROOM_BLOCK", "RELEASE_ROOM_BLOCK", "MANAGE_ROOM_STAYS",
] as const;

export class ToolError extends Error {
  constructor(readonly code: keyof typeof messages) {
    super(messages[code]);
  }
}
const messages = {
  INVALID_FILTER: "Use an approved filter and an ordered date range within this tool's limit.",
  NOT_FOUND: "No matching record was found.",
  LIMIT_EXCEEDED: "Too many records to calculate safely. Narrow the date range or use a more specific reference.",
  DATA_UNAVAILABLE: "The requested data is temporarily unavailable.",
  DATA_INCOMPLETE: "Stored records could not be safely interpreted. No total was returned.",
  CANCELLED: "The request was cancelled or timed out.",
};

export function windowFor({ startDate, endDate }: Pick<Window, "startDate" | "endDate">, maxDays = 31): Window {
  const start = new Date(startDate + "T00:00:00+07:00");
  const end = new Date(+new Date(endDate + "T00:00:00+07:00") + BUSINESS_DAY_MS);
  if (!(+end > +start && +end - +start <= maxDays * BUSINESS_DAY_MS)) throw new ToolError("INVALID_FILTER");
  return { start, end, startDate, endDate };
}

export function* days(window: Window) {
  for (let time = +window.start; time < +window.end; time += BUSINESS_DAY_MS) {
    const key = businessDateKey(new Date(time));
    yield windowFor({ startDate: key, endDate: key }, 1);
  }
}
export const inWindow = (value: Date | undefined, { start, end }: Window) => value != null && +value >= +start && +value < +end;
export const range = ({ start, end }: Window) => ({ $gte: start, $lt: end });
export const keyRange = ({ startDate, endDate }: Window) => ({ $gte: startDate, $lte: endDate });

export const money = z.int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER);
export function satang(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new ToolError("DATA_INCOMPLETE");
  const scaled = value * 100;
  const exact = Math.round(scaled);
  // Accept only floating-point representation noise, never round fractional satang.
  if (!Number.isSafeInteger(exact) || Math.abs(scaled - exact) > 1e-7) throw new ToolError("DATA_INCOMPLETE");
  return exact || 0;
}
export function addMoney(first: number, second: number) {
  const result = first + second;
  if (!Number.isSafeInteger(result)) throw new ToolError("DATA_INCOMPLETE");
  return result;
}
export const sum = <T>(items: readonly T[], get: (item: T) => number) =>
  items.reduce((total, item) => addMoney(total, get(item)), 0);
export const page = <T>(records: T[], { offset, limit }: PageInput, alreadySkipped = false) => ({
  records: records.slice(alreadySkipped ? 0 : offset, (alreadySkipped ? 0 : offset) + limit),
  nextOffset: (alreadySkipped ? 0 : offset) + limit < records.length && offset + limit <= 500 ? offset + limit : null,
  paginationCapped: (alreadySkipped ? 0 : offset) + limit < records.length && offset + limit > 500,
});
export const pagination = <T extends z.ZodType>(record: T) => z.strictObject({
  records: z.array(record).max(25), nextOffset: z.int().nullable(), paginationCapped: z.boolean(),
});
export const dateSpan = z.strictObject(dates);
export const span = ({ startDate, endDate }: Window) => ({ startDate, endDate });
export const metadata = z.strictObject({ id: z.literal("bmk"), timeZone: z.literal("Asia/Bangkok"), currency: z.literal("THB") });
