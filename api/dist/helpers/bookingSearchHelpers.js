"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildBookingSearchFields = exports.buildGuestNameSearchPrefixes = exports.buildBookingIdSearchPrefixes = exports.buildBookingIdSearchValues = exports.normalizeBookingSearchText = void 0;
const MIN_SEARCH_PREFIX_LENGTH = 3;
const MAX_SEARCH_PREFIX_LENGTH = 64;
const normalizeBookingSearchText = (value) => String(value || "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
exports.normalizeBookingSearchText = normalizeBookingSearchText;
const prefixesForValue = (value) => {
    const characters = Array.from(value);
    const lastPrefixLength = Math.min(characters.length, MAX_SEARCH_PREFIX_LENGTH);
    const prefixes = [];
    for (let length = MIN_SEARCH_PREFIX_LENGTH; length <= lastPrefixLength; length += 1) {
        prefixes.push(characters.slice(0, length).join(""));
    }
    return prefixes;
};
const buildBookingIdSearchValues = (bookingId, commercialSegments = []) => Array.from(new Set([bookingId, ...commercialSegments.map((segment) => segment.channelBookingId)]
    .map(exports.normalizeBookingSearchText)
    .filter(Boolean)));
exports.buildBookingIdSearchValues = buildBookingIdSearchValues;
const buildBookingIdSearchPrefixes = (bookingIds) => Array.from(new Set(bookingIds.flatMap(prefixesForValue)));
exports.buildBookingIdSearchPrefixes = buildBookingIdSearchPrefixes;
const buildGuestNameSearchPrefixes = (name) => {
    const normalizedName = (0, exports.normalizeBookingSearchText)(name);
    if (!normalizedName)
        return [];
    const nameParts = normalizedName.split(" ");
    const searchableParts = Array.from(new Set([
        ...nameParts,
        ...nameParts.map((_, index) => nameParts.slice(index).join(" ")),
    ]));
    return Array.from(new Set(searchableParts.flatMap(prefixesForValue)));
};
exports.buildGuestNameSearchPrefixes = buildGuestNameSearchPrefixes;
const buildBookingSearchFields = ({ bookingId, name, commercialSegments = [], }) => {
    const searchBookingIds = (0, exports.buildBookingIdSearchValues)(bookingId, commercialSegments);
    return {
        searchBookingIds,
        searchBookingIdPrefixes: (0, exports.buildBookingIdSearchPrefixes)(searchBookingIds),
        searchNamePrefixes: (0, exports.buildGuestNameSearchPrefixes)(name),
    };
};
exports.buildBookingSearchFields = buildBookingSearchFields;
//# sourceMappingURL=bookingSearchHelpers.js.map