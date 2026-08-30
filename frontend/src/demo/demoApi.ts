import axios, {
  AxiosError,
  AxiosHeaders,
  type AxiosAdapter,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from "axios";

import { API_URL, IS_DEMO_MODE } from "../config/api";
import { defaultUserSettings } from "../types/userSettings";
import type { booking, PlatformId, transcation } from "../types/bookingTypes";

const STORAGE_KEY = "hostelflow.portfolio-demo.v1";

const roomIds = [
  "Balcony",
  "Window",
  "Pottery 1",
  "Pottery 2",
  ...Array.from({ length: 14 }, (_, index) => `Siesta ${index + 1}`),
  ...Array.from({ length: 8 }, (_, index) => `Marquisette ${index + 1}`),
  ...Array.from({ length: 8 }, (_, index) => `Homespan ${index + 1}`),
  ...Array.from({ length: 6 }, (_, index) => `Veranda ${index + 1}`),
  ...Array.from({ length: 6 }, (_, index) => `Wicker ${index + 1}`),
];

type DemoUser = {
  userId: string;
  username: string;
  name: string;
  admin: boolean;
  active: boolean;
  profilePictureUrl: string;
  settings: typeof defaultUserSettings;
};

type DemoActivity = {
  _id: string;
  staffUsername: string;
  action: string;
  bookingId?: string;
  timestamp: string;
  details: Record<string, unknown>;
};

type DemoState = {
  bookings: booking[];
  users: DemoUser[];
  activities: DemoActivity[];
  cashShiftOpen: boolean;
};

type DemoBookingInput = {
  name?: string;
  bookingId?: string;
  platformId?: PlatformId;
  staffUsername?: string;
  checkIn?: string;
  checkOut?: string;
  roomIds?: string[];
  note?: string;
  price?: string | number;
  paymentMethod?: transcation["paymentMethod"];
};

type DemoRequestBody = {
  [key: string]: unknown;
  action?: "refund" | "compensation";
  admin?: boolean;
  amount?: string | number;
  booking?: DemoBookingInput;
  finalStatus?: booking["status"];
  name?: string;
  note?: string;
  paymentMethod?: transcation["paymentMethod"];
  pinned?: boolean;
  query?: string;
  transaction?: transcation;
  username?: string;
};

const pad = (value: number) => String(value).padStart(2, "0");

const localDate = (offset = 0) => {
  const value = new Date();
  value.setHours(12, 0, 0, 0);
  value.setDate(value.getDate() + offset);
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
};

const dateTime = (offset = 0, hour = 9) =>
  `${localDate(offset)}T${pad(hour)}:00:00+07:00`;

const makeTransaction = (
  id: string,
  type: transcation["type"],
  amount: number,
  paymentMethod: transcation["paymentMethod"],
  createdAt: string,
  extra: Partial<transcation> = {},
): transcation => ({
  _id: id,
  type,
  amount,
  paymentMethod,
  direction: "in",
  createdAt,
  createdBy: "demo.manager",
  reviewStatus: "none",
  ...extra,
});

const makeBooking = ({
  bookingId,
  name,
  room,
  from,
  to,
  status,
  platformId,
  price,
  paymentMethod,
  note,
}: {
  bookingId: string;
  name: string;
  room: string | string[];
  from: number;
  to: number;
  status: booking["status"];
  platformId: PlatformId;
  price: number;
  paymentMethod: transcation["paymentMethod"];
  note?: string;
}): booking => {
  const rooms = Array.isArray(room) ? room : [room];
  const transactionId = `${bookingId}-room`;
  const transactions = [
    makeTransaction(
      transactionId,
      "roomCharge",
      price,
      paymentMethod,
      dateTime(Math.min(from, 0), 10),
      { platformId },
    ),
  ];

  if (status === "checkedIn") {
    transactions.push(
      makeTransaction(
        `${bookingId}-deposit`,
        "deposit",
        500,
        "Cash",
        dateTime(from, 14),
      ),
    );
  }

  return {
    revision: 1,
    name,
    roomStays: [{ roomIds: rooms, from: localDate(from), to: localDate(to) }],
    commercialSegments: [
      {
        _id: `${bookingId}-segment`,
        kind: "original",
        from: localDate(from),
        to: localDate(to),
        platformId,
        amount: price,
        transactionId,
        createdBy: "demo.manager",
        createdAt: dateTime(Math.min(from, 0), 10),
      },
    ],
    checkIn: new Date(dateTime(from, 14)),
    checkOut: new Date(dateTime(to, 11)),
    nights: Math.max(to - from, 1),
    platformId,
    status,
    bookingId,
    transactions,
    staffUsername: "demo.manager",
    note,
    pinned: bookingId === "HF-DEMO-1001",
    passport: status === "checkedIn" ? { nationality: "Germany" } : undefined,
  };
};

const createSeedState = (): DemoState => {
  const bookings: booking[] = [
    makeBooking({ bookingId: "HF-DEMO-1001", name: "Maya Thompson", room: "Balcony", from: 0, to: 3, status: "booked", platformId: "BOOK", price: 2760, paymentMethod: "OTA", note: "Late arrival around 20:30" }),
    makeBooking({ bookingId: "HF-DEMO-1002", name: "Noah Williams", room: ["Siesta 1", "Siesta 2"], from: 0, to: 2, status: "booked", platformId: "HOST", price: 1400, paymentMethod: "Unpaid" }),
    makeBooking({ bookingId: "HF-DEMO-1003", name: "Sofia Martinez", room: "Pottery 1", from: -2, to: 0, status: "checkedIn", platformId: "AGOD", price: 2200, paymentMethod: "Card", note: "Vegetarian breakfast" }),
    makeBooking({ bookingId: "HF-DEMO-1004", name: "Kenji Sato", room: "Window", from: -1, to: 2, status: "checkedIn", platformId: "WALK", price: 3150, paymentMethod: "Cash" }),
    makeBooking({ bookingId: "HF-DEMO-1005", name: "Emma Dubois", room: "Marquisette 3", from: -4, to: -1, status: "checkedIn", platformId: "TRAV", price: 1800, paymentMethod: "Transfer" }),
    makeBooking({ bookingId: "HF-DEMO-1006", name: "Liam Anderson", room: "Veranda 2", from: 2, to: 6, status: "booked", platformId: "BOOK", price: 2480, paymentMethod: "OTA" }),
    makeBooking({ bookingId: "HF-DEMO-1007", name: "Anika Patel", room: "Wicker 4", from: 4, to: 8, status: "booked", platformId: "AGOD", price: 2320, paymentMethod: "Unpaid" }),
    makeBooking({ bookingId: "HF-DEMO-1008", name: "Oliver Chen", room: "Homespan 5", from: -8, to: -5, status: "checkedOut", platformId: "HOST", price: 2100, paymentMethod: "Cash" }),
  ];

  bookings[3].transactions.push(
    makeTransaction("HF-DEMO-1004-tour", "joinTour", 900, "Cash", dateTime(0, 16), { note: "Waterfall day trip" }),
  );
  bookings[2].transactions.push(
    makeTransaction("HF-DEMO-1003-laundry", "laundry", 160, "Cash", dateTime(0, 9)),
  );

  const users: DemoUser[] = [
    { userId: "demo-admin", username: "demo.manager", name: "Demo Manager", admin: true, active: true, profilePictureUrl: "", settings: { ...defaultUserSettings } },
    { userId: "demo-staff-1", username: "nina", name: "Nina", admin: false, active: true, profilePictureUrl: "", settings: { ...defaultUserSettings } },
    { userId: "demo-staff-2", username: "beam", name: "Beam", admin: false, active: true, profilePictureUrl: "", settings: { ...defaultUserSettings } },
  ];

  const activities: DemoActivity[] = [
    { _id: "activity-1", staffUsername: "demo.manager", action: "NEW_BOOKING", bookingId: "HF-DEMO-1001", timestamp: dateTime(0, 8), details: { success: true, snapshot: bookings[0] } },
    { _id: "activity-2", staffUsername: "nina", action: "CHECK_IN", bookingId: "HF-DEMO-1004", timestamp: dateTime(-1, 14), details: { success: true, snapshot: bookings[3] } },
    { _id: "activity-3", staffUsername: "beam", action: "ADD_TRANSACTION", bookingId: "HF-DEMO-1004", timestamp: dateTime(0, 16), details: { success: true, summary: { amount: 900, paymentMethod: "Cash", note: "Waterfall day trip" } } },
  ];

  return { bookings, users, activities, cashShiftOpen: true };
};

let memoryState: DemoState | null = null;

const readState = (): DemoState => {
  if (memoryState) return memoryState;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored) memoryState = JSON.parse(stored) as DemoState;
  } catch {
    // Browser privacy settings can disable localStorage; memory state still works.
  }
  memoryState ||= createSeedState();
  return memoryState;
};

const saveState = (state: DemoState) => {
  memoryState = state;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Keep the demo usable for the current tab when storage is unavailable.
  }
};

export const resetDemoData = () => {
  memoryState = createSeedState();
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing else to reset.
  }
};

const parseBody = (config: InternalAxiosRequestConfig) => {
  if (!config.data) return {} as DemoRequestBody;
  if (typeof config.data === "string") {
    try {
      return JSON.parse(config.data) as DemoRequestBody;
    } catch {
      return {} as DemoRequestBody;
    }
  }
  return config.data as DemoRequestBody;
};

const response = <T>(
  config: InternalAxiosRequestConfig,
  data: T,
  status = 200,
): AxiosResponse<T> => ({
  config,
  data,
  headers: new AxiosHeaders({ "x-hostelflow-demo": "true" }),
  status,
  statusText: status >= 400 ? "Demo error" : "OK",
});

const sameDate = (value: string | Date, date: string) =>
  new Date(value).toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" }) === date;

const overlaps = (currentBooking: booking, from: string, to: string) =>
  currentBooking.roomStays.some(
    (stay) => new Date(stay.from) < new Date(to) && new Date(stay.to) > new Date(from),
  ) && !["cancelled", "noShow"].includes(currentBooking.status);

const currentOccupancy = (bookings: booking[]) =>
  bookings
    .filter((item) => item.status === "checkedIn")
    .reduce((total, item) => total + (item.roomStays[0]?.roomIds.length || 0), 0);

const bookingSearchResult = (item: booking) => ({
  kind: "booking" as const,
  bookingId: item.bookingId,
  guestName: item.name,
  status: item.status,
  voided: Boolean(item.voided),
  roomIds: item.roomStays.flatMap((stay) => stay.roomIds),
  checkIn: String(item.checkIn),
  checkOut: String(item.checkOut),
  platformIds: [item.platformId],
  confirmationId: item.bookingId,
  historical: item.status === "checkedOut",
  matchKind: "prefix" as const,
});

const revenueTransaction = (state: DemoState, item: booking, transaction: transcation) => ({
  transactionId: transaction._id,
  bookingId: item.bookingId,
  sourceType: "booking" as const,
  guestName: item.name,
  platformId: item.platformId,
  type: transaction.type,
  label: transaction.type === "roomCharge" ? "ค่าห้อง" : transaction.type === "joinTour" ? "Join Tour" : "Laundry",
  color: transaction.type === "roomCharge" ? "#51d1dc" : "#22c55e",
  icon: transaction.type === "roomCharge" ? "bx-bed" : "bx-receipt",
  amount: transaction.amount,
  paymentMethod: transaction.paymentMethod,
  direction: transaction.direction,
  createdAt: transaction.createdAt,
  createdBy: transaction.createdBy,
  staff: { username: "demo.manager", name: state.users[0].name, profilePictureUrl: "" },
  note: transaction.note,
});

const demoAdapter: AxiosAdapter = async (config) => {
  await new Promise((resolve) => window.setTimeout(resolve, 90));
  const state = readState();
  const method = (config.method || "get").toLowerCase();
  const rawUrl = config.url || "";
  const url = new URL(rawUrl, window.location.origin);
  const path = url.pathname.startsWith(API_URL)
    ? url.pathname.slice(API_URL.length) || "/"
    : url.pathname;
  const params = { ...Object.fromEntries(url.searchParams), ...(config.params || {}) } as Record<string, string>;
  const body = parseBody(config);
  const activeUser = state.users[0];
  const today = localDate();

  if (path === "/auth/me") return response(config, { user: activeUser });
  if (path === "/auth/staff-directory") return response(config, { staff: state.users.map(({ username, name }) => ({ username, name })) });
  if (path === "/auth/logout" || path === "/auth/login") return response(config, { user: activeUser });
  if (path === "/auth/users" && method === "get") return response(config, { users: state.users });
  if (path === "/auth/admin/createUser" && method === "post") {
    state.users.push({ userId: `demo-user-${Date.now()}`, username: body.username || "demo.user", name: body.name || "Demo User", admin: Boolean(body.admin), active: true, profilePictureUrl: "", settings: { ...defaultUserSettings } });
    saveState(state);
    return response(config, { message: "created" }, 201);
  }
  if (/^\/auth\/users\/[^/]+\/password$/.test(path)) return response(config, { message: "updated" });
  const userMatch = path.match(/^\/auth\/users\/([^/]+)$/);
  if (userMatch && method === "patch") {
    const user = state.users.find((item) => item.userId === userMatch[1]);
    if (user) Object.assign(user, body);
    saveState(state);
    return response(config, { user });
  }
  if (path === "/auth/me/settings" && method === "patch") {
    activeUser.settings = {
      ...activeUser.settings,
      ...(body as Partial<typeof defaultUserSettings>),
    };
    saveState(state);
    return response(config, { user: activeUser });
  }
  if (path === "/auth/me/profile-picture") return response(config, { user: activeUser });

  if (path.startsWith("/bookings/getTodayBookings/")) {
    const listType = path.split("/").pop();
    const field = listType === "departures" ? "checkOut" : "checkIn";
    const bookings = state.bookings.filter((item) => sameDate(item[field], today) && !["cancelled", "noShow"].includes(item.status));
    return response(config, { bookings, occupancy: currentOccupancy(state.bookings) });
  }
  if (path === "/bookings/getMasterBookings") {
    const query = String(params.search || "").toLowerCase();
    const status = String(params.status || "");
    const channel = String(params.channel || "");
    const room = String(params.room || "");
    const bookings = state.bookings.filter((item) =>
      (!query || `${item.name} ${item.bookingId}`.toLowerCase().includes(query)) &&
      (!status || status === "all" || item.status === status) &&
      (!channel || channel === "all" || item.platformId === channel) &&
      (!room || room === "all" || item.roomStays.some((stay) => stay.roomIds.includes(room))),
    );
    return response(config, { bookings, occupancy: currentOccupancy(state.bookings), pagination: { page: 1, hasMore: false, total: bookings.length } });
  }
  if (path === "/bookings/getNeedsReviewBookings") {
    return response(config, {
      lateCheckIns: state.bookings.filter((item) => item.status === "booked" && new Date(item.checkIn) < new Date(`${today}T00:00:00+07:00`)),
      lateCheckOuts: state.bookings.filter((item) => item.status === "checkedIn" && new Date(item.checkOut) < new Date(`${today}T00:00:00+07:00`)),
    });
  }
  if (path === "/bookings/getNeedsReviewBookings/count") return response(config, { count: 1 });
  if (path === "/bookings/getAdminDashboardStats") {
    const points = Array.from({ length: 30 }, (_, index) => ({
      date: localDate(index - 29),
      grossRevenue: 3800 + ((index * 437) % 5100),
      collectedRevenue: 3300 + ((index * 389) % 4600),
      occupancyRate: 0.38 + ((index * 7) % 48) / 100,
      occupiedCapacity: 20 + ((index * 7) % 25),
    }));
    return response(config, { monthlyGrossRevenue: 186420, monthlyCollectedRevenue: 171650, monthBookings: 94, unpaidAmount: 8470, occupancyRate: 0.68, rangeOccupancyRate: 0.64, channelMix: [{ platformId: "BOOK", count: 37 }, { platformId: "HOST", count: 24 }, { platformId: "AGOD", count: 18 }, { platformId: "WALK", count: 15 }], revenueRange: params.revenueRange || "1m", revenueSeries: points, esrSeries: points });
  }
  if (path === "/bookings/getMonthCalendar") {
    return response(config, roomIds.map((roomId) => ({
      roomId,
      bookings: state.bookings.flatMap((item) => item.roomStays.filter((stay) => stay.roomIds.includes(roomId)).map((stay) => ({ name: item.name, from: stay.from, to: stay.to, bookingId: item.bookingId, platformId: item.platformId, status: item.status, isUnpaid: item.transactions.some((transaction) => transaction.type === "roomCharge" && transaction.paymentMethod === "Unpaid") }))),
    })));
  }
  if (path === "/bookings/getRoomAvailability") {
    const occupiedRoomIds = state.bookings.filter((item) => overlaps(item, params.checkIn, params.checkOut)).flatMap((item) => item.roomStays.flatMap((stay) => stay.roomIds));
    return response(config, { occupiedRoomIds: [...new Set(occupiedRoomIds)] });
  }
  const bookingByIdMatch = path.match(/^\/bookings\/getBookingById\/(.+)$/);
  if (bookingByIdMatch) return response(config, state.bookings.find((item) => item.bookingId === decodeURIComponent(bookingByIdMatch[1])) || null);
  if (path === "/bookings/newBooking" && method === "post") {
    const form = body.booking || {};
    const from = String(form.checkIn || localDate());
    const to = String(form.checkOut || localDate(1));
    const item: booking = {
      revision: 1, name: form.name || "Demo Guest", bookingId: form.bookingId || `HF-DEMO-${Date.now()}`, platformId: form.platformId || "WALK", status: "booked", staffUsername: form.staffUsername || activeUser.username,
      checkIn: new Date(`${from}T14:00:00+07:00`), checkOut: new Date(`${to}T11:00:00+07:00`), nights: Math.max(1, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86400000)),
      roomStays: [{ roomIds: form.roomIds || [], from, to }], note: form.note,
      transactions: [makeTransaction(`${form.bookingId || "demo"}-room`, "roomCharge", Number(form.price || 0), form.paymentMethod || "Unpaid", new Date().toISOString(), { platformId: form.platformId || "WALK" })],
    };
    state.bookings.unshift(item); saveState(state); return response(config, { booking: item }, 201);
  }
  const simpleBookingAction = path.match(/^\/bookings\/(?:editBooking|updateBookingNote|pinBooking|checkIn|checkOut|cancelBooking|resolveBooking)\/(.+)$/);
  if (simpleBookingAction) {
    const item = state.bookings.find((entry) => entry.bookingId === decodeURIComponent(simpleBookingAction[1]));
    if (item) {
      if (path.includes("editBooking")) Object.assign(item, body.booking, { revision: item.revision + 1 });
      if (path.includes("updateBookingNote")) Object.assign(item, { note: body.note, revision: item.revision + 1 });
      if (path.includes("pinBooking")) Object.assign(item, { pinned: body.pinned, revision: item.revision + 1 });
      if (path.includes("checkIn")) Object.assign(item, { status: "checkedIn", revision: item.revision + 1, checkedInAt: new Date().toISOString(), checkInByStaffUsername: activeUser.username });
      if (path.includes("checkOut")) Object.assign(item, { status: "checkedOut", revision: item.revision + 1 });
      if (path.includes("cancelBooking")) Object.assign(item, { status: "cancelled", revision: item.revision + 1 });
      if (path.includes("resolveBooking")) Object.assign(item, { status: body.finalStatus || "checkedOut", revision: item.revision + 1 });
      saveState(state);
    }
    return response(config, { booking: item });
  }
  const removeMatch = path.match(/^\/bookings\/removeBooking\/(.+)$/);
  if (removeMatch) { state.bookings = state.bookings.filter((item) => item.bookingId !== decodeURIComponent(removeMatch[1])); saveState(state); return response(config, { message: "removed" }); }
  const addTransactionMatch = path.match(/^\/bookings\/addTransaction\/(.+)$/);
  if (addTransactionMatch) {
    const item = state.bookings.find((entry) => entry.bookingId === decodeURIComponent(addTransactionMatch[1]));
    if (item && body.transaction) { item.transactions.push({ ...body.transaction, _id: `demo-transaction-${Date.now()}`, createdAt: new Date().toISOString(), createdBy: activeUser.username }); item.revision += 1; saveState(state); }
    return response(config, { booking: item });
  }
  const financialActionMatch = path.match(/^\/bookings\/(.+)\/financial-actions$/);
  if (financialActionMatch) {
    const item = state.bookings.find((entry) => entry.bookingId === decodeURIComponent(financialActionMatch[1]));
    if (item) { item.transactions.push(makeTransaction(`demo-financial-${Date.now()}`, body.action === "refund" ? "roomRefund" : "compensation", Number(body.amount), body.paymentMethod || "Cash", new Date().toISOString(), { direction: "out", note: body.note })); item.revision += 1; saveState(state); }
    return response(config, { booking: item });
  }
  const noShowMatch = path.match(/^\/bookings\/(.+)\/no-show$/);
  if (noShowMatch) { const item = state.bookings.find((entry) => entry.bookingId === decodeURIComponent(noShowMatch[1])); if (item) { item.status = "noShow"; item.revision += 1; saveState(state); } return response(config, { booking: item }); }
  if (/\/check-in-corrections\/eligibility$/.test(path) || /\/status-corrections\/eligibility$/.test(path)) return response(config, { eligible: false, reason: "Demo booking does not require correction" });
  if (path.includes("/additional-guests")) return response(config, { guests: [], additionalGuests: [], revision: 1 });
  if (path.startsWith("/bookings/getPassportData/")) return response(config, { passportData: { namePrefix: "Ms", passportNo: "DEMO-ONLY", passportName: "Sample Guest", nationality: "Germany", nextDestinationCountry: "Thailand" } });
  if (path.includes("/extensions") || path.includes("/manageRoomStays/") || path.includes("/closed-room-availability")) return response(config, { booking: state.bookings.find((item) => path.includes(item.bookingId)) });

  if (path === "/finance/today-revenue-summary") return response(config, { todayRevenue: 8220, todayArrivalRevenue: 7160, todayExtrasRevenue: 1060, todayReductions: 0, todayCollectedRevenue: 6820, todayServiceHighlights: [{ type: "joinTour", count: 1, total: 900 }, { type: "laundry", count: 1, total: 160 }] });
  if (path === "/finance/cash-position") {
    const activeShift = state.cashShiftOpen ? { _id: "demo-shift-1", businessDate: today, shiftNumber: 1, staffUsername: activeUser.username, status: "open", ledgerRevision: 4, openingMode: "counted", operatingOpeningCash: 2500, operatingCashIn: 1060, operatingCashOut: 0, operatingExpectedCash: 3560, startedAt: dateTime(0, 7), staff: { username: activeUser.username, name: activeUser.name } } : null;
    return response(config, { businessDate: today, threshold: 20, activeShift, previousShift: null, current: { operatingCash: activeShift?.operatingExpectedCash || 3560 }, handoff: { operatingCash: 2500 }, shifts: activeShift ? [activeShift] : [], finalCloseRecovery: null });
  }
  if (path === "/finance/cash-shifts/start") { state.cashShiftOpen = true; saveState(state); return response(config, { message: "started" }); }
  if (/^\/finance\/cash-shifts\/[^/]+\/close$/.test(path)) { state.cashShiftOpen = false; saveState(state); return response(config, { message: "closed" }); }
  if (path === "/finance/deposit-return-reminder") return response(config, { reminder: { businessDate: today, targetBusinessDate: localDate(1), requiredAmount: 500, bookingCount: 1, bookings: [{ bookingId: "HF-DEMO-1004", guestName: "Kenji Sato", roomIds: ["Window"], checkOut: localDate(2), amount: 500 }], overdueAmount: 0, overdueBookingCount: 0, overdueBookings: [], calculationToken: "demo-calculation", calculatedAt: new Date().toISOString() } });
  if (path === "/finance/review-events/count") return response(config, { count: 1 });
  if (path === "/finance/review-events") return response(config, { transactions: [{ _id: "review-demo-1", transactionId: "review-demo-1", bookingId: "HF-DEMO-1004", sourceType: "booking", guestName: "Kenji Sato", staffUsername: "demo.manager", type: "joinTour", paymentMethod: "Cash", amount: 900, direction: "in", createdAt: dateTime(0, 16), reviewFlags: ["large_cash"], reviewStatus: "needs_review", note: "Demo review item" }] });
  if (path.includes("/finance/review-events/") || path.includes("/audit-resolution")) return response(config, { message: "updated" });
  if (path === "/finance/cash-shift-audit") return response(config, { businessDate: params.date || today, threshold: 20, shifts: [], gaps: [] });
  if (path === "/finance/standalone-sales") return response(config, { sale: { _id: `demo-sale-${Date.now()}` } }, 201);
  if (path === "/finance/today-revenue-breakdown" || path === "/finance/expected-stay-revenue-breakdown") {
    const entries = state.bookings.flatMap((item) => item.transactions.filter((transaction) => ["roomCharge", "joinTour", "laundry"].includes(transaction.type)).map((transaction) => revenueTransaction(state, item, transaction)));
    const total = entries.reduce((sum, item) => sum + item.amount, 0);
    const roomEntries = entries.filter((item) => item.type === "roomCharge");
    const serviceEntries = entries.filter((item) => item.type !== "roomCharge");
    return response(config, { period: { startDate: localDate(-29), endDate: localDate(1), basis: "bookingOrExtensionStartAndServiceCreatedAt" }, totals: { grossStayCharges: total, grossRoomCharges: roomEntries.reduce((sum, item) => sum + item.amount, 0), grossServiceRevenue: serviceEntries.reduce((sum, item) => sum + item.amount, 0), expectedStayRevenue: total, collectedRevenue: total - 1400, unpaidRevenue: 1400, reductions: 0, netAfterReductions: total, transactionCount: entries.length }, categories: [{ type: "roomCharge", label: "ค่าห้อง", color: "#51d1dc", icon: "bx-bed", total: roomEntries.reduce((sum, item) => sum + item.amount, 0), percentage: 88, transactionCount: roomEntries.length, transactions: roomEntries }, { type: "joinTour", label: "บริการเสริม", color: "#22c55e", icon: "bx-map", total: serviceEntries.reduce((sum, item) => sum + item.amount, 0), percentage: 12, transactionCount: serviceEntries.length, transactions: serviceEntries }], reductions: [], paymentMethods: ["Cash", "Card", "OTA", "Transfer", "Unpaid"].map((paymentMethod) => { const transactions = entries.filter((item) => item.paymentMethod === paymentMethod); const subtotal = transactions.reduce((sum, item) => sum + item.amount, 0); return { paymentMethod, label: paymentMethod, icon: "bx-wallet", total: subtotal, percentage: total ? (subtotal / total) * 100 : 0, transactionCount: transactions.length, transactions }; }).filter((item) => item.transactionCount) });
  }

  if (path === "/activities/admin" || path.endsWith("/recentActivities") || path === "/activities/recentActivities") return response(config, { activities: state.activities });
  if (path === "/activities/admin/stats") return response(config, { totalActions: 27, byStaff: [{ staffUsername: "demo.manager", count: 12 }, { staffUsername: "nina", count: 9 }, { staffUsername: "beam", count: 6 }], byAction: [{ action: "NEW_BOOKING", count: 11 }, { action: "CHECK_IN", count: 9 }, { action: "ADD_TRANSACTION", count: 7 }] });

  if (path === "/documents/getImmigrationReportStatus" || path === "/documents/getHotelAccommodationReportStatus") return response(config, { total: 3, complete: 2, missing: 1, missingBookings: [{ bookingId: "HF-DEMO-1002", name: "Noah Williams", checkOut: localDate(2), reason: "Passport ไม่ครบ" }] });
  if (path.startsWith("/documents/get")) return response(config, new Blob(["HostelFlow demo export\nNo production data is included."], { type: "text/plain" }));

  if (path === "/search" && method === "post") {
    const query = String(body.query || "").toLowerCase();
    const matched = state.bookings.filter((item) => !query || `${item.name} ${item.bookingId} ${item.roomStays.flatMap((stay) => stay.roomIds).join(" ")}`.toLowerCase().includes(query)).map(bookingSearchResult);
    if (!query) return response(config, { mode: "bootstrap", recentBookings: matched.slice(0, 5), todayArrivals: state.bookings.filter((item) => sameDate(item.checkIn, today)).map(bookingSearchResult) });
    return response(config, { mode: "search", interpreted: {}, groups: { bookings: { items: matched, page: 1, hasMore: false } } });
  }

  const errorResponse = response(config, { message: `Demo endpoint not implemented: ${method.toUpperCase()} ${path}` }, 501);
  throw new AxiosError(errorResponse.data.message, "ERR_DEMO_ENDPOINT", config, undefined, errorResponse);
};

let configured = false;

export const setupDemoApi = () => {
  if (!IS_DEMO_MODE || configured) return;
  configured = true;
  axios.defaults.adapter = demoAdapter;
};
