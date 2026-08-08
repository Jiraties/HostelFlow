import type { SearchDestination } from "../types/searchTypes";

export type ResolvedSearchDestination = {
  pathname: string;
  search?: string;
  hash?: string;
};

export const resolveSearchDestination = (
  destination: SearchDestination,
): ResolvedSearchDestination => {
  const params = new URLSearchParams();

  if (destination.kind === "booking") {
    params.set("bookingId", destination.bookingId);
    return { pathname: "/master", search: `?${params.toString()}` };
  }

  if (
    destination.kind === "bookingTransaction" ||
    destination.kind === "bookingAction"
  ) {
    params.set("bookingId", destination.bookingId);
    if (destination.kind === "bookingTransaction") {
      params.set("transactionId", destination.transactionId);
    }
    if (destination.action) params.set("action", destination.action);
    return { pathname: "/master", search: `?${params.toString()}` };
  }

  params.set("room", destination.roomId);
  params.set("date", destination.date);
  return { pathname: "/calendar", search: `?${params.toString()}` };
};
