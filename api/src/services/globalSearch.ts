import Booking, {
  type PlatformId,
  type TransactionType,
} from "../models/booking";
import { activeRoomInventory } from "../config/roomInventory";
import { normalizeBookingSearchText } from "../helpers/bookingSearchHelpers";

const SEARCH_TIMEOUT_MS = 1500;
const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 20;
const MAX_CANDIDATES = 300;
const MAX_RECENTS = 8;
const BANGKOK_OFFSET_HOURS = 7;

export type SearchGroupName = "bookings" | "transactions" | "rooms";

export type BangkokDateRange = {
  key: string;
  start: Date;
  end: Date;
};

export type SearchIntent = {
  normalizedQuery: string;
  identifier?: string;
  otaPrefix?: string;
  rooms: string[];
  channels: PlatformId[];
  transactionTypes: TransactionType[];
  amount?: number;
  bookingDate?: BangkokDateRange;
  bookingDateField?: "checkIn" | "checkOut";
  transactionDate?: BangkokDateRange;
  nameText?: string;
  nameFallback?: string;
};

export type SearchPagination = {
  group?: SearchGroupName;
  page: number;
  limit: number;
};

export type BookingSearchResult = {
  kind: "booking";
  bookingId: string;
  guestName: string;
  status: string;
  voided: boolean;
  roomIds: string[];
  checkIn: Date;
  checkOut: Date;
  platformIds: PlatformId[];
  confirmationId?: string;
  historical: boolean;
  matchKind: "exact" | "prefix" | "structured" | "fuzzy";
};

export type TransactionSearchResult = {
  kind: "transaction";
  sourceType: "booking" | "standaloneSale";
  transactionId: string;
  bookingId: string;
  guestName: string;
  bookingStatus: string;
  roomIds: string[];
  amount: number;
  direction?: string;
  type: TransactionType;
  typeLabel: string;
  paymentMethod: string;
  createdAt: Date;
  businessDate: string;
  matchKind: "exact";
};

export type RoomSearchResult = {
  kind: "room";
  roomId: string;
  label: string;
  capacity: number;
  date: string;
  matchKind: "exact" | "prefix";
};

export type SearchPage<T> = {
  items: T[];
  page: number;
  hasMore: boolean;
};

type BookingCandidate = {
  _id: unknown;
  name: string;
  status: string;
  voided?: boolean;
  bookingId: string;
  checkIn: Date;
  checkOut: Date;
  platformId: PlatformId;
  roomStays?: Array<{ roomIds?: string[]; roomId?: string }>;
  commercialSegments?: Array<{
    platformId: PlatformId;
    channelBookingId?: string;
    from?: Date;
    to?: Date;
  }>;
};

const platformAliases = new Map<string, PlatformId>([
  ["book", "BOOK"],
  ["booking", "BOOK"],
  ["booking.com", "BOOK"],
  ["host", "HOST"],
  ["hostelworld", "HOST"],
  ["agod", "AGOD"],
  ["agoda", "AGOD"],
  ["trav", "TRAV"],
  ["traveloka", "TRAV"],
  ["walk", "WALK"],
  ["walk-in", "WALK"],
  ["walk in", "WALK"],
]);

const transactionTypeLabels: Record<TransactionType, string> = {
  roomCharge: "ค่าห้อง",
  deposit: "รับมัดจำ",
  adjustment: "ปรับราคา",
  depositRefund: "คืนมัดจำ",
  cancellationRefund: "คืนเงินยกเลิก",
  roomRefund: "คืนค่าห้อง",
  roomChargeWriteOff: "ปิดยอดค่าห้องที่เหลือ",
  settlementCharge: "เก็บเงินเพิ่ม",
  compensation: "ชดเชยลูกค้า",
  depositKept: "เก็บมัดจำเป็นรายได้",
  paymentCorrection: "แก้ไขการชำระเงิน",
  towel: "Towel",
  motorbike: "Motorbike",
  slowBoat: "Slow Boat",
  joinTour: "Join Tour",
  extraBed: "Extra Bed",
  pickACraft: "Pick A Craft",
  trek2D: "Trek 2D",
  setMenu: "Set Menu",
  sleeperBus: "Sleeper Bus",
  onlyWalk: "Only Walk",
  laundry: "Laundry",
  bicycle: "Bicycle",
  car: "Car",
  misc: "Misc",
  rainCoat: "Rain Coat",
  passwordLock: "Password Lock",
  cooking: "Cooking",
  cardSurcharge: "ค่าธรรมเนียมบัตร 3%",
};

const transactionTypeAliases = new Map<string, TransactionType>();
Object.entries(transactionTypeLabels).forEach(([type, label]) => {
  const typed = type as TransactionType;
  transactionTypeAliases.set(normalizeBookingSearchText(type), typed);
  transactionTypeAliases.set(
    normalizeBookingSearchText(type.replace(/([a-z])([A-Z])/g, "$1 $2")),
    typed,
  );
  transactionTypeAliases.set(normalizeBookingSearchText(label), typed);
});
transactionTypeAliases.set("มัดจำ", "deposit");
transactionTypeAliases.set("deposit", "deposit");

const roomAliases = new Map<string, string>();
activeRoomInventory().forEach((room) => {
  const normalized = normalizeBookingSearchText(room.id);
  roomAliases.set(normalized, room.id);
  const numbered = normalized.match(/^(.+?)\s+(\d+)$/);
  if (!numbered) return;
  const abbreviations: Record<string, string> = {
    siesta: "s",
    marquisette: "m",
    homespan: "h",
    veranda: "v",
    wicker: "w",
  };
  const short = abbreviations[numbered[1]];
  if (!short) return;
  roomAliases.set(`${short} ${numbered[2]}`, room.id);
  roomAliases.set(`${short}${numbered[2]}`, room.id);
});

const sortedRoomAliases = [...roomAliases.keys()].sort(
  (first, second) => second.length - first.length,
);
const sortedPlatformAliases = [...platformAliases.keys()].sort(
  (first, second) => second.length - first.length,
);
const sortedTransactionAliases = [...transactionTypeAliases.keys()].sort(
  (first, second) => second.length - first.length,
);

const phrasePattern = (phrase: string) =>
  new RegExp(
    `(^|\\s)${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=\\s|$)`,
    "i",
  );

const consumePhrase = (value: string, phrase: string) =>
  value
    .replace(phrasePattern(phrase), " ")
    .replace(/\s+/g, " ")
    .trim();

export const parseBangkokDate = (value: string): BangkokDateRange | null => {
  let year: number;
  let month: number;
  let day: number;
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const slash = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (iso) {
    year = Number(iso[1]);
    month = Number(iso[2]);
    day = Number(iso[3]);
  } else if (slash) {
    day = Number(slash[1]);
    month = Number(slash[2]);
    year = Number(slash[3]);
  } else {
    return null;
  }

  const check = new Date(Date.UTC(year, month - 1, day));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return null;
  }

  const start = new Date(
    Date.UTC(year, month - 1, day, -BANGKOK_OFFSET_HOURS, 0, 0, 0),
  );
  return {
    key: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    start,
    end: new Date(start.getTime() + 86400000),
  };
};

const bangkokDateKey = (value: Date) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);

const currentBangkokRange = () => parseBangkokDate(bangkokDateKey(new Date()))!;

const matchFirstPhrase = <T>(
  source: string,
  aliases: string[],
  values: Map<string, T>,
) => {
  for (const alias of aliases) {
    if (!phrasePattern(alias).test(source)) continue;
    return { alias, value: values.get(alias)! };
  }
  return null;
};

export const parseSearchIntent = (rawQuery: unknown): SearchIntent => {
  const normalizedQuery = normalizeBookingSearchText(rawQuery).slice(0, 100);
  let remaining = normalizedQuery;
  const rooms: string[] = [];
  const channels: PlatformId[] = [];
  const transactionTypes: TransactionType[] = [];

  const dateToken = remaining.match(
    /(?:^|\s)(\d{4}-\d{2}-\d{2}|\d{2}\/\d{2}\/\d{4})(?=\s|$)/,
  );
  const parsedDate = dateToken ? parseBangkokDate(dateToken[1]) : null;
  if (parsedDate && dateToken) remaining = consumePhrase(remaining, dateToken[1]);

  const roomMatch = matchFirstPhrase(remaining, sortedRoomAliases, roomAliases);
  if (roomMatch) {
    rooms.push(roomMatch.value);
    remaining = consumePhrase(remaining, roomMatch.alias);
  }

  const channelMatch = matchFirstPhrase(
    remaining,
    sortedPlatformAliases,
    platformAliases,
  );
  if (channelMatch) {
    channels.push(channelMatch.value);
    remaining = consumePhrase(remaining, channelMatch.alias);
  }

  const transactionMatch = matchFirstPhrase(
    remaining,
    sortedTransactionAliases,
    transactionTypeAliases,
  );
  if (transactionMatch) {
    transactionTypes.push(transactionMatch.value);
    remaining = consumePhrase(remaining, transactionMatch.alias);
  }

  const amountToken = remaining.match(
    /(?:^|\s)(฿?\s*\d[\d,]*(?:\.\d{1,2})?\s*(?:บาท|฿)?)(?=\s|$)/,
  );
  let amount: number | undefined;
  if (amountToken) {
    const parsedAmount = Number(
      amountToken[1].replace(/[฿,\s]|บาท/g, ""),
    );
    if (Number.isFinite(parsedAmount) && parsedAmount >= 0) {
      amount = parsedAmount;
      remaining = consumePhrase(remaining, amountToken[1]);
    }
  }

  const hasRecognizedNonIdentifier = Boolean(
    parsedDate || rooms.length || channels.length || transactionTypes.length,
  );
  const identifier =
    !hasRecognizedNonIdentifier &&
    /^(?=.*\d)[a-z0-9-]{3,64}$/.test(normalizedQuery)
    ? normalizedQuery
    : undefined;
  const nameFallback = /[a-zก-๛]/i.test(normalizedQuery)
    ? normalizedQuery
    : undefined;
  const cleanedName = remaining.replace(/^[,;:]+|[,;:]+$/g, "").trim();
  const nameText = /[a-zก-๛]/i.test(cleanedName) ? cleanedName : undefined;

  return {
    normalizedQuery,
    identifier,
    otaPrefix: identifier && identifier.length >= 3 ? identifier : undefined,
    rooms,
    channels,
    transactionTypes,
    amount,
    bookingDate: parsedDate || undefined,
    transactionDate: parsedDate || undefined,
    nameText,
    nameFallback,
  };
};

export const normalizeSearchPagination = ({
  group,
  page,
  limit,
}: {
  group?: unknown;
  page?: unknown;
  limit?: unknown;
}): SearchPagination => {
  const parsedPage = Number(page);
  const parsedLimit = Number(limit);
  return {
    group:
      group === "bookings" || group === "transactions" || group === "rooms"
        ? group
        : undefined,
    page: Number.isInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1,
    limit:
      Number.isInteger(parsedLimit) && parsedLimit > 0
        ? Math.min(parsedLimit, MAX_LIMIT)
        : DEFAULT_LIMIT,
  };
};

const roomIdsForBooking = (booking: BookingCandidate) =>
  Array.from(
    new Set(
      (booking.roomStays || []).flatMap((stay) =>
        Array.isArray(stay.roomIds) && stay.roomIds.length > 0
          ? stay.roomIds
          : stay.roomId
            ? [stay.roomId]
            : [],
      ),
    ),
  );

const platformIdsForBooking = (booking: BookingCandidate) =>
  Array.from(
    new Set([
      booking.platformId,
      ...(booking.commercialSegments || []).map((segment) => segment.platformId),
    ]),
  );

const lifecycleRank = (booking: BookingCandidate, today: BangkokDateRange) => {
  if (booking.voided) return 5;
  if (booking.status === "checkedIn") return 0;
  if (booking.status === "booked" && booking.checkIn < today.end) return 1;
  if (booking.status === "booked") return 2;
  if (["checkedOut", "cancelled", "noShow"].includes(booking.status)) return 3;
  return 4;
};

const identifierMatch = (booking: BookingCandidate, intent: SearchIntent) => {
  if (!intent.identifier) return null;
  const identifier = intent.identifier;
  const primary = normalizeBookingSearchText(booking.bookingId);
  const confirmations = (booking.commercialSegments || [])
    .map((segment) => ({
      raw: segment.channelBookingId,
      normalized: normalizeBookingSearchText(segment.channelBookingId),
    }))
    .filter((item) => item.normalized);
  if (primary === identifier) return { rank: 0, kind: "exact" as const };
  const exact = confirmations.find((item) => item.normalized === identifier);
  if (exact) {
    return { rank: 1, kind: "exact" as const, confirmationId: exact.raw };
  }
  const prefix = confirmations.find((item) => item.normalized.startsWith(identifier));
  if (prefix) {
    return { rank: 2, kind: "prefix" as const, confirmationId: prefix.raw };
  }
  return null;
};

const bookingMatchRank = (booking: BookingCandidate, intent: SearchIntent) => {
  const identifier = identifierMatch(booking, intent);
  if (identifier) return identifier.rank;
  if (
    intent.nameText &&
    normalizeBookingSearchText(booking.name) === intent.nameText
  ) {
    return 2;
  }
  if (intent.rooms.length || intent.channels.length || intent.bookingDate) return 3;
  if (intent.nameText || intent.nameFallback) return 4;
  return 6;
};

const guestMatchKind = (booking: BookingCandidate, intent: SearchIntent) => {
  const nameTerm = intent.nameText || intent.nameFallback;
  if (!nameTerm) return null;
  const normalizedName = normalizeBookingSearchText(booking.name);
  if (normalizedName === nameTerm) return "exact" as const;
  const parts = normalizedName.split(" ");
  return parts.some((_, index) =>
    parts.slice(index).join(" ").startsWith(nameTerm),
  )
    ? ("prefix" as const)
    : null;
};

export const isWithinOneDamerauLevenshteinEdit = (
  first: string,
  second: string,
) => {
  if (first === second) return true;
  if (Math.abs(first.length - second.length) > 1) return false;

  if (first.length === second.length) {
    const mismatches: number[] = [];
    for (let index = 0; index < first.length; index += 1) {
      if (first[index] !== second[index]) mismatches.push(index);
      if (mismatches.length > 2) return false;
    }
    if (mismatches.length === 1) return true;
    return (
      mismatches.length === 2 &&
      mismatches[1] === mismatches[0] + 1 &&
      first[mismatches[0]] === second[mismatches[1]] &&
      first[mismatches[1]] === second[mismatches[0]]
    );
  }

  const [shorter, longer] =
    first.length < second.length ? [first, second] : [second, first];
  let shortIndex = 0;
  let longIndex = 0;
  let skipped = false;
  while (shortIndex < shorter.length && longIndex < longer.length) {
    if (shorter[shortIndex] === longer[longIndex]) {
      shortIndex += 1;
      longIndex += 1;
      continue;
    }
    if (skipped) return false;
    skipped = true;
    longIndex += 1;
  }
  return true;
};

const fuzzyNameMatches = (name: string, query: string) => {
  const normalizedName = normalizeBookingSearchText(name);
  const parts = normalizedName.split(" ").filter(Boolean);
  const targets = Array.from(
    new Set([
      normalizedName,
      ...parts,
      ...parts.map((_, index) => parts.slice(index).join(" ")),
    ]),
  );
  return targets.some((target) =>
    isWithinOneDamerauLevenshteinEdit(
      query,
      Array.from(target).slice(0, Array.from(query).length).join(""),
    ),
  );
};

const fuzzyQueryForIntent = (intent: SearchIntent) => {
  if (
    intent.identifier ||
    intent.rooms.length ||
    intent.channels.length ||
    intent.transactionTypes.length ||
    intent.amount !== undefined ||
    intent.bookingDate
  ) {
    return null;
  }
  const query = intent.nameText || intent.nameFallback || "";
  return /^[a-z][a-z '\-]{2,39}$/.test(query) ? query : null;
};

const bookingProjection = {
  name: 1,
  status: 1,
  voided: 1,
  bookingId: 1,
  checkIn: 1,
  checkOut: 1,
  platformId: 1,
  roomStays: 1,
  "commercialSegments.platformId": 1,
  "commercialSegments.channelBookingId": 1,
} as const;

const bookingBaseClauses = (intent: SearchIntent) => {
  const clauses: Record<string, unknown>[] = [];
  if (intent.identifier) {
    clauses.push({
      $or: [
        { bookingId: intent.identifier },
        { searchBookingIds: intent.identifier },
        { searchBookingIdPrefixes: intent.otaPrefix },
      ],
    });
  }
  const hasBookingStructuredClause = Boolean(
    intent.identifier ||
      intent.rooms.length ||
      intent.channels.length ||
      intent.bookingDate,
  );
  const nameTerm =
    intent.nameText ||
    (!hasBookingStructuredClause && intent.nameFallback
      ? intent.nameFallback
      : undefined);
  if (nameTerm) clauses.push({ searchNamePrefixes: nameTerm });
  if (intent.rooms.length) {
    clauses.push({
      $or: [
        { "roomStays.roomIds": { $in: intent.rooms } },
        { "roomStays.roomId": { $in: intent.rooms } },
      ],
    });
  }
  if (intent.channels.length && intent.bookingDate) {
    const dateCondition = {
      $gte: intent.bookingDate.start,
      $lt: intent.bookingDate.end,
    };
    const segmentDateCondition = intent.bookingDateField
      ? {
          [intent.bookingDateField === "checkIn" ? "from" : "to"]:
            dateCondition,
        }
      : { $or: [{ from: dateCondition }, { to: dateCondition }] };
    clauses.push({
      commercialSegments: {
        $elemMatch: {
          platformId: { $in: intent.channels },
          ...segmentDateCondition,
        },
      },
    });
  } else if (intent.channels.length) {
    clauses.push({
      $or: [
        { platformId: { $in: intent.channels } },
        { "commercialSegments.platformId": { $in: intent.channels } },
      ],
    });
  }
  if (intent.bookingDate && !intent.channels.length) {
    const dateCondition = {
      $gte: intent.bookingDate.start,
      $lt: intent.bookingDate.end,
    };
    clauses.push(
      intent.bookingDateField
        ? { [intent.bookingDateField]: dateCondition }
        : {
            $or: [
              { checkIn: dateCondition },
              { checkOut: dateCondition },
            ],
          },
    );
  }
  return clauses;
};

const bookingQuery = (intent: SearchIntent) => {
  const semanticClauses = bookingBaseClauses(intent);
  const semanticQuery =
    semanticClauses.length === 1
      ? semanticClauses[0]
      : semanticClauses.length > 1
        ? { $and: semanticClauses }
        : null;
  const shouldRunFallbackBranch = Boolean(
    intent.nameFallback &&
      !intent.nameText &&
      !intent.identifier &&
      (intent.rooms.length || intent.channels.length || intent.bookingDate),
  );
  if (semanticQuery && shouldRunFallbackBranch) {
    return {
      $or: [semanticQuery, { searchNamePrefixes: intent.nameFallback }],
    };
  }
  return semanticQuery;
};

const paginateItems = <T>(items: T[], pagination: SearchPagination) => {
  const start = (pagination.page - 1) * pagination.limit;
  const page = items.slice(start, start + pagination.limit + 1);
  return {
    items: page.slice(0, pagination.limit),
    page: pagination.page,
    hasMore: page.length > pagination.limit,
  } satisfies SearchPage<T>;
};

const searchBookings = async (
  intent: SearchIntent,
  pagination: SearchPagination,
) => {
  const query = bookingQuery(intent);
  if (!query) {
    return { items: [], page: pagination.page, hasMore: false };
  }

  const candidates = await Booking.find(
    query,
    bookingProjection,
  )
    .limit(MAX_CANDIDATES)
    .maxTimeMS(SEARCH_TIMEOUT_MS)
    .lean<BookingCandidate[]>();
  const today = currentBangkokRange();
  const ranked = candidates
    .filter((booking) => !intent.identifier || identifierMatch(booking, intent))
    .sort((first, second) => {
      const matchDifference =
        bookingMatchRank(first, intent) - bookingMatchRank(second, intent);
      if (matchDifference) return matchDifference;
      const lifecycleDifference =
        lifecycleRank(first, today) - lifecycleRank(second, today);
      if (lifecycleDifference) return lifecycleDifference;
      if (first.status === "booked" && second.status === "booked") {
        return first.checkIn.getTime() - second.checkIn.getTime();
      }
      return second.checkOut.getTime() - first.checkOut.getTime();
    })
    .map<BookingSearchResult>((booking) => {
      const identifier = identifierMatch(booking, intent);
      const matchKind =
        identifier?.kind || guestMatchKind(booking, intent) || "structured";
      return {
        kind: "booking",
        bookingId: booking.bookingId,
        guestName: booking.name,
        status: booking.status,
        voided: Boolean(booking.voided),
        roomIds: roomIdsForBooking(booking),
        checkIn: booking.checkIn,
        checkOut: booking.checkOut,
        platformIds: platformIdsForBooking(booking),
        confirmationId: identifier?.confirmationId,
        historical: ["checkedOut", "cancelled", "noShow"].includes(
          booking.status,
        ),
        matchKind,
      };
    });

  const fuzzyQuery = fuzzyQueryForIntent(intent);
  if (fuzzyQuery && ranked.length < DEFAULT_LIMIT) {
    const exactBookingIds = new Set(ranked.map((booking) => booking.bookingId));
    const fuzzyCandidates = await Booking.find({}, bookingProjection)
      .limit(MAX_CANDIDATES)
      .maxTimeMS(SEARCH_TIMEOUT_MS)
      .lean<BookingCandidate[]>();
    fuzzyCandidates
      .filter(
        (booking) =>
          !exactBookingIds.has(booking.bookingId) &&
          fuzzyNameMatches(booking.name, fuzzyQuery),
      )
      .sort((first, second) => {
        const lifecycleDifference =
          lifecycleRank(first, today) - lifecycleRank(second, today);
        if (lifecycleDifference) return lifecycleDifference;
        return second.checkOut.getTime() - first.checkOut.getTime();
      })
      .forEach((booking) => {
        ranked.push({
          kind: "booking",
          bookingId: booking.bookingId,
          guestName: booking.name,
          status: booking.status,
          voided: Boolean(booking.voided),
          roomIds: roomIdsForBooking(booking),
          checkIn: booking.checkIn,
          checkOut: booking.checkOut,
          platformIds: platformIdsForBooking(booking),
          historical: ["checkedOut", "cancelled", "noShow"].includes(
            booking.status,
          ),
          matchKind: "fuzzy",
        });
      });
  }

  return paginateItems(ranked, pagination);
};

const transactionTypeCondition = (types: TransactionType[]) =>
  types.length > 0 ? { $in: ["$$transaction.type", types] } : null;

const transactionFilterConditions = (intent: SearchIntent) => {
  const conditions: Record<string, unknown>[] = [];
  if (intent.amount !== undefined) {
    conditions.push({ $eq: ["$$transaction.amount", intent.amount] });
  }
  const typeCondition = transactionTypeCondition(intent.transactionTypes);
  if (typeCondition) conditions.push(typeCondition);
  if (intent.transactionDate) {
    conditions.push(
      { $gte: ["$$transaction.createdAt", intent.transactionDate.start] },
      { $lt: ["$$transaction.createdAt", intent.transactionDate.end] },
    );
  }
  return conditions;
};

const transactionElemMatch = (intent: SearchIntent) => ({
  ...(intent.amount !== undefined ? { amount: intent.amount } : {}),
  ...(intent.transactionTypes.length
    ? { type: { $in: intent.transactionTypes } }
    : {}),
  ...(intent.transactionDate
    ? {
        createdAt: {
          $gte: intent.transactionDate.start,
          $lt: intent.transactionDate.end,
        },
      }
    : {}),
});

const transactionCorrectionElemMatch = (intent: SearchIntent) => {
  const match = {
    ...(intent.amount !== undefined ? { "after.amount": intent.amount } : {}),
    ...(intent.transactionTypes.length
      ? { "after.type": { $in: intent.transactionTypes } }
      : {}),
  };
  return Object.keys(match).length > 0 ? match : null;
};

const effectiveTransactionProjection = {
  $map: {
    input: { $ifNull: ["$transactions", []] },
    as: "transaction",
    in: {
      $let: {
        vars: {
          latestCorrection: {
            $reduce: {
              input: {
                $filter: {
                  input: { $ifNull: ["$transactionCorrections", []] },
                  as: "correction",
                  cond: {
                    $eq: [
                      "$$correction.targetTransactionId",
                      { $toString: "$$transaction._id" },
                    ],
                  },
                },
              },
              initialValue: null,
              in: {
                $cond: [
                  {
                    $or: [
                      { $eq: ["$$value", null] },
                      {
                        $gte: [
                          "$$this.correctedAt",
                          "$$value.correctedAt",
                        ],
                      },
                    ],
                  },
                  "$$this",
                  "$$value",
                ],
              },
            },
          },
        },
        in: {
          $mergeObjects: [
            "$$transaction",
            { $ifNull: ["$$latestCorrection.after", {}] },
            {
              _id: "$$transaction._id",
              createdAt: "$$transaction.createdAt",
            },
          ],
        },
      },
    },
  },
};

const transactionParentClauses = (intent: SearchIntent) => {
  const clauses: Record<string, unknown>[] = [];
  // nameFallback belongs to the parallel booking-name branch. Once a
  // transaction token is recognized, only remaining unconsumed name text may
  // constrain the transaction's parent booking.
  if (intent.nameText) clauses.push({ searchNamePrefixes: intent.nameText });
  if (intent.rooms.length) {
    clauses.push({
      $or: [
        { "roomStays.roomIds": { $in: intent.rooms } },
        { "roomStays.roomId": { $in: intent.rooms } },
      ],
    });
  }
  if (intent.channels.length) {
    clauses.push({
      $or: [
        { platformId: { $in: intent.channels } },
        { "commercialSegments.platformId": { $in: intent.channels } },
      ],
    });
  }
  return clauses;
};

const searchTransactions = async (
  intent: SearchIntent,
  pagination: SearchPagination,
) => {
  if (
    intent.amount === undefined &&
    intent.transactionTypes.length === 0 &&
    !intent.transactionDate
  ) {
    return { items: [], page: pagination.page, hasMore: false };
  }

  const parentClauses = transactionParentClauses(intent);
  const transactionMatch = transactionElemMatch(intent);
  const correctionMatch = transactionCorrectionElemMatch(intent);
  const transactionCandidateClause = correctionMatch
    ? {
        $or: [
          { transactions: { $elemMatch: transactionMatch } },
          {
            transactionCorrections: { $elemMatch: correctionMatch },
            ...(intent.transactionDate
              ? {
                  "transactions.createdAt": {
                    $gte: intent.transactionDate.start,
                    $lt: intent.transactionDate.end,
                  },
                }
              : {}),
          },
        ],
      }
    : { transactions: { $elemMatch: transactionMatch } };
  const match = {
    ...(parentClauses.length === 1
      ? parentClauses[0]
      : parentClauses.length > 1
        ? { $and: parentClauses }
        : {}),
    ...transactionCandidateClause,
  };
  const filterConditions = transactionFilterConditions(intent);
  const today = currentBangkokRange();
  const skip = (pagination.page - 1) * pagination.limit;

  const rows = await Booking.collection
    .aggregate([
      { $match: match },
      { $set: { effectiveTransactions: effectiveTransactionProjection } },
      {
        $project: {
          name: 1,
          status: 1,
          voided: 1,
          bookingId: 1,
          checkIn: 1,
          checkOut: 1,
          roomStays: 1,
          transactions: {
            $map: {
              input: {
                $filter: {
                  input: "$effectiveTransactions",
                  as: "transaction",
                  cond:
                    filterConditions.length === 1
                      ? filterConditions[0]
                      : { $and: filterConditions },
                },
              },
              as: "transaction",
              in: {
                _id: "$$transaction._id",
                type: "$$transaction.type",
                amount: "$$transaction.amount",
                direction: "$$transaction.direction",
                paymentMethod: "$$transaction.paymentMethod",
                createdAt: "$$transaction.createdAt",
              },
            },
          },
        },
      },
      { $unwind: "$transactions" },
      {
        $addFields: {
          lifecycleRank: {
            $switch: {
              branches: [
                { case: { $eq: ["$voided", true] }, then: 5 },
                { case: { $eq: ["$status", "checkedIn"] }, then: 0 },
                {
                  case: {
                    $and: [
                      { $eq: ["$status", "booked"] },
                      { $lt: ["$checkIn", today.end] },
                    ],
                  },
                  then: 1,
                },
                { case: { $eq: ["$status", "booked"] }, then: 2 },
              ],
              default: 3,
            },
          },
        },
      },
      { $sort: { lifecycleRank: 1, "transactions.createdAt": -1, _id: -1 } },
      { $skip: skip },
      { $limit: pagination.limit + 1 },
    ])
    .maxTimeMS(SEARCH_TIMEOUT_MS)
    .toArray();

  const items = rows.slice(0, pagination.limit).map((row) => {
    const transaction = row.transactions;
    return {
      kind: "transaction" as const,
      sourceType: "booking" as const,
      transactionId: String(transaction._id),
      bookingId: row.bookingId,
      guestName: row.name,
      bookingStatus: row.status,
      roomIds: roomIdsForBooking(row as BookingCandidate),
      amount: transaction.amount,
      direction: transaction.direction,
      type: transaction.type,
      typeLabel:
        transactionTypeLabels[transaction.type as TransactionType] ||
        transaction.type,
      paymentMethod: transaction.paymentMethod,
      createdAt: transaction.createdAt,
      businessDate: bangkokDateKey(transaction.createdAt),
      matchKind: "exact",
    } satisfies TransactionSearchResult;
  });

  return {
    items,
    page: pagination.page,
    hasMore: rows.length > pagination.limit,
  } satisfies SearchPage<TransactionSearchResult>;
};

const searchRooms = (intent: SearchIntent, pagination: SearchPagination) => {
  const date = intent.bookingDate?.key || bangkokDateKey(new Date());
  const normalized = intent.normalizedQuery;
  const exactIds = new Set(intent.rooms);
  const rooms = activeRoomInventory()
    .flatMap<RoomSearchResult>((room) => {
      const aliases = [...roomAliases.entries()]
        .filter(([, roomId]) => roomId === room.id)
        .map(([alias]) => alias);
      const exact = exactIds.has(room.id) || aliases.includes(normalized);
      const prefix =
        !exact &&
        normalized.length >= 2 &&
        aliases.some((alias) => alias.startsWith(normalized));
      if (!exact && !prefix) return [];
      return [
        {
          kind: "room",
          roomId: room.id,
          label: room.id,
          capacity: room.capacity,
          date,
          matchKind: exact ? "exact" : "prefix",
        },
      ];
    })
    .sort((first, second) =>
      first.matchKind === second.matchKind
        ? first.roomId.localeCompare(second.roomId)
        : first.matchKind === "exact"
          ? -1
          : 1,
    );
  return paginateItems(rooms, pagination);
};

const safeRecentBookingIds = (value: unknown) => {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .slice(0, MAX_RECENTS * 2)
        .filter(
          (bookingId): bookingId is string =>
            typeof bookingId === "string" &&
            bookingId.trim().length >= 3 &&
            bookingId.trim().length <= 64,
        )
        .map((bookingId) => bookingId.trim()),
    ),
  ).slice(0, MAX_RECENTS);
};

const serializeBootstrapBooking = (booking: BookingCandidate) => ({
  kind: "booking" as const,
  bookingId: booking.bookingId,
  guestName: booking.name,
  status: booking.status,
  voided: Boolean(booking.voided),
  roomIds: roomIdsForBooking(booking),
  checkIn: booking.checkIn,
  checkOut: booking.checkOut,
  platformIds: platformIdsForBooking(booking),
  historical: ["checkedOut", "cancelled", "noShow"].includes(booking.status),
  matchKind: "structured" as const,
});

export const bootstrapSearch = async (recentBookingIds: unknown) => {
  const ids = safeRecentBookingIds(recentBookingIds);
  const today = currentBangkokRange();
  const [recent, arrivals] = await Promise.all([
    ids.length
      ? Booking.find(
          { bookingId: { $in: ids }, voided: { $ne: true } },
          bookingProjection,
        )
          .maxTimeMS(SEARCH_TIMEOUT_MS)
          .lean<BookingCandidate[]>()
      : Promise.resolve([]),
    Booking.find(
      {
        voided: { $ne: true },
        status: { $nin: ["cancelled", "noShow"] },
        checkIn: { $gte: today.start, $lt: today.end },
      },
      bookingProjection,
    )
      .sort({ status: 1, checkIn: 1, name: 1 })
      .limit(MAX_LIMIT)
      .maxTimeMS(SEARCH_TIMEOUT_MS)
      .lean<BookingCandidate[]>(),
  ]);
  const recentById = new Map(recent.map((booking) => [booking.bookingId, booking]));
  arrivals.sort((first, second) => {
    const lifecycleDifference =
      lifecycleRank(first, today) - lifecycleRank(second, today);
    if (lifecycleDifference) return lifecycleDifference;
    return first.name.localeCompare(second.name, "th");
  });

  return {
    mode: "bootstrap" as const,
    recentBookings: ids
      .flatMap((bookingId) => {
        const booking = recentById.get(bookingId);
        return booking ? [serializeBootstrapBooking(booking)] : [];
      }),
    todayArrivals: arrivals.map(serializeBootstrapBooking),
  };
};

export const searchEntities = async (
  intent: SearchIntent,
  pagination: SearchPagination,
) => {
  const includeBookings = !pagination.group || pagination.group === "bookings";
  const includeTransactions =
    !pagination.group || pagination.group === "transactions";
  const includeRooms = !pagination.group || pagination.group === "rooms";
  const [bookings, transactions, rooms] = await Promise.all([
    includeBookings ? searchBookings(intent, pagination) : Promise.resolve(undefined),
    includeTransactions
      ? searchTransactions(intent, pagination)
      : Promise.resolve(undefined),
    includeRooms ? Promise.resolve(searchRooms(intent, pagination)) : undefined,
  ]);

  return {
    mode: "search" as const,
    interpreted: {
      identifier: Boolean(intent.identifier),
      rooms: intent.rooms.length > 0,
      channels: intent.channels.length > 0,
      transactionTypes: intent.transactionTypes.length > 0,
      amount: intent.amount !== undefined,
      date: Boolean(intent.bookingDate),
      name: Boolean(intent.nameText || intent.nameFallback),
    },
    groups: {
      ...(bookings ? { bookings } : {}),
      ...(transactions ? { transactions } : {}),
      ...(rooms ? { rooms } : {}),
    },
  };
};

export const isSearchTimeout = (error: unknown) => {
  const value = error as { code?: number; codeName?: string; message?: string };
  return (
    value?.code === 50 ||
    value?.codeName === "MaxTimeMSExpired" ||
    value?.message?.includes("operation exceeded time limit") === true
  );
};
