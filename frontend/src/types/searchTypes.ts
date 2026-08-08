export type SearchGroupName = "bookings" | "transactions" | "rooms";
export type SearchMatchKind = "exact" | "prefix" | "structured" | "fuzzy";

export type BookingSearchResult = {
  kind: "booking";
  bookingId: string;
  guestName: string;
  status: string;
  voided: boolean;
  roomIds: string[];
  checkIn: string;
  checkOut: string;
  platformIds: string[];
  confirmationId?: string;
  historical: boolean;
  matchKind: SearchMatchKind;
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
  type: string;
  typeLabel: string;
  paymentMethod: string;
  createdAt: string;
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

export type SearchResult =
  | BookingSearchResult
  | TransactionSearchResult
  | RoomSearchResult;

export type SearchPage<T extends SearchResult> = {
  items: T[];
  page: number;
  hasMore: boolean;
};

export type SearchResponse = {
  mode: "search";
  interpreted: Record<string, boolean>;
  groups: {
    bookings?: SearchPage<BookingSearchResult>;
    transactions?: SearchPage<TransactionSearchResult>;
    rooms?: SearchPage<RoomSearchResult>;
  };
};

export type SearchBootstrapResponse = {
  mode: "bootstrap";
  recentBookings: BookingSearchResult[];
  todayArrivals: BookingSearchResult[];
};

export type SearchDestination =
  | {
      kind: "booking";
      bookingId: string;
      highlight?: { kind: "booking" };
    }
  | {
      kind: "bookingTransaction";
      bookingId: string;
      transactionId: string;
      highlight: { kind: "transaction"; transactionId: string };
      action?: "addTransaction";
    }
  | {
      kind: "bookingAction";
      bookingId: string;
      action: "addTransaction";
      highlight?: { kind: "booking" };
    }
  | {
      kind: "room";
      roomId: string;
      date: string;
      highlight: { kind: "roomDate"; roomId: string; date: string };
    };
