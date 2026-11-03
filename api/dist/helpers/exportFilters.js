"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.hasEmptyExportDimension = exports.matchesExportStatus = exports.parseExportFilters = exports.usesMultiExportFilters = exports.ExportFilterError = exports.exportFilterValues = exports.EXPORT_CATEGORIES = exports.exportPlatformMap = void 0;
const booking_1 = __importStar(require("../models/booking"));
// The existing document-export channel catalogue. Keep the legacy workbook's
// labels and colors while sharing its values with request validation.
exports.exportPlatformMap = {
    BOOK: { label: "Booking.com", color: "003580" },
    HOST: { label: "Hostelworld", color: "F15A24" },
    AGOD: { label: "Agoda", color: "19AC5B" },
    TRAV: { label: "Traveloka", color: "00ADEF" },
    WALK: { label: "Walk-In", color: "F12424" },
};
exports.EXPORT_CATEGORIES = ["private", "dorm", "services"];
const enumValues = (path) => [...(path.options.enum || [])];
const exportFilterValues = () => ({
    bookingChannels: Object.keys(exports.exportPlatformMap),
    bookingStatuses: [...enumValues(booking_1.default.schema.path("status")), "voided"],
    paymentMethods: enumValues(booking_1.transactionSchema.path("paymentMethod")),
    categories: [...exports.EXPORT_CATEGORIES],
});
exports.exportFilterValues = exportFilterValues;
class ExportFilterError extends Error {
}
exports.ExportFilterError = ExportFilterError;
/** Comma-separated or repeated parameters. An explicit empty value means none. */
const parseSelection = (value, allowed, key) => {
    const values = Array.isArray(value) ? value : [value];
    if (!values.every((item) => typeof item === "string")) {
        throw new ExportFilterError(`Invalid ${key}`);
    }
    const selected = [...new Set(values.flatMap((item) => item.split(",")))];
    if (selected.length === 1 && selected[0] === "")
        return [];
    if (selected.some((item) => !allowed.includes(item))) {
        throw new ExportFilterError(`Invalid ${key}`);
    }
    return selected;
};
const usesMultiExportFilters = (query) => query.filterVersion !== undefined ||
    Object.keys((0, exports.exportFilterValues)()).some((key) => query[key] !== undefined);
exports.usesMultiExportFilters = usesMultiExportFilters;
const parseExportFilters = (query) => {
    if (query.filterVersion !== undefined && query.filterVersion !== "2") {
        throw new ExportFilterError("Unsupported filterVersion");
    }
    const allowed = (0, exports.exportFilterValues)();
    const defaults = {
        ...allowed,
        bookingStatuses: allowed.bookingStatuses.filter((status) => status !== "cancelled"),
    };
    const legacyKeys = {
        bookingChannels: "bookingChannel",
        bookingStatuses: "bookingStatus",
        paymentMethods: "paymentMethod",
        categories: null,
    };
    const result = {};
    for (const key of Object.keys(allowed)) {
        const legacyKey = legacyKeys[key];
        if (query[key] !== undefined && legacyKey && query[legacyKey] !== undefined) {
            throw new ExportFilterError(`Use ${key} or ${legacyKey}, not both`);
        }
        const value = query[key] ?? (legacyKey ? query[legacyKey] : undefined);
        // Preserve explicit legacy 'all' when a client migrates one dimension.
        if (value === undefined)
            result[key] = defaults[key];
        else if (legacyKey && query[key] === undefined && (value === "all" || value === "")) {
            result[key] = allowed[key];
        }
        else
            result[key] = parseSelection(value, allowed[key], key);
    }
    return result;
};
exports.parseExportFilters = parseExportFilters;
/** Void is a flag independent of status; expose it as its own export bucket. */
const matchesExportStatus = (booking, filters) => filters.bookingStatuses.includes(booking.voided ? "voided" : booking.status);
exports.matchesExportStatus = matchesExportStatus;
const hasEmptyExportDimension = (filters) => Object.values(filters).some((selected) => selected.length === 0);
exports.hasEmptyExportDimension = hasEmptyExportDimension;
//# sourceMappingURL=exportFilters.js.map