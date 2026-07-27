const MIN_SEARCH_PREFIX_LENGTH = 3;
const MAX_SEARCH_PREFIX_LENGTH = 64;
type SearchableCommercialSegment = {
  channelBookingId?: string | null;
};

export const normalizeBookingSearchText = (value: unknown) =>
  String(value || "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

const prefixesForValue = (value: string) => {
  const characters = Array.from(value);
  const lastPrefixLength = Math.min(
    characters.length,
    MAX_SEARCH_PREFIX_LENGTH,
  );
  const prefixes: string[] = [];

  for (
    let length = MIN_SEARCH_PREFIX_LENGTH;
    length <= lastPrefixLength;
    length += 1
  ) {
    prefixes.push(characters.slice(0, length).join(""));
  }

  return prefixes;
};

export const buildBookingIdSearchValues = (
  bookingId: unknown,
  commercialSegments: SearchableCommercialSegment[] = [],
) =>
  Array.from(
    new Set(
      [bookingId, ...commercialSegments.map((segment) => segment.channelBookingId)]
        .map(normalizeBookingSearchText)
        .filter(Boolean),
    ),
  );

export const buildBookingIdSearchPrefixes = (bookingIds: string[]) =>
  Array.from(new Set(bookingIds.flatMap(prefixesForValue)));

export const buildGuestNameSearchPrefixes = (name: unknown) => {
  const normalizedName = normalizeBookingSearchText(name);
  if (!normalizedName) return [];

  const nameParts = normalizedName.split(" ");
  const searchableParts = Array.from(
    new Set([
      ...nameParts,
      ...nameParts.map((_, index) => nameParts.slice(index).join(" ")),
    ]),
  );

  return Array.from(new Set(searchableParts.flatMap(prefixesForValue)));
};

export const buildBookingSearchFields = ({
  bookingId,
  name,
  commercialSegments = [],
}: {
  bookingId: unknown;
  name: unknown;
  commercialSegments?: SearchableCommercialSegment[];
}) => {
  const searchBookingIds = buildBookingIdSearchValues(
    bookingId,
    commercialSegments,
  );

  return {
    searchBookingIds,
    searchBookingIdPrefixes:
      buildBookingIdSearchPrefixes(searchBookingIds),
    searchNamePrefixes: buildGuestNameSearchPrefixes(name),
  };
};
