"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.shiftBusinessMonth = exports.businessMonthBounds = exports.businessDateStart = exports.businessDateKey = exports.BUSINESS_DAY_MS = void 0;
/** Business dates always use Asia/Bangkok, independently of the server timezone. */
exports.BUSINESS_DAY_MS = 86400000;
const BANGKOK_OFFSET_MS = 7 * 3600000;
const businessDateKey = (date) => new Date(date.getTime() + BANGKOK_OFFSET_MS).toISOString().slice(0, 10);
exports.businessDateKey = businessDateKey;
const businessDateStart = (date) => new Date(`${(0, exports.businessDateKey)(date)}T00:00:00+07:00`);
exports.businessDateStart = businessDateStart;
const businessMonthBounds = (month) => {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
        return null;
    const [year, number] = month.split("-").map(Number);
    if (year < 1900 || year > 9998)
        return null;
    return {
        start: new Date(Date.UTC(year, number - 1, 1) - BANGKOK_OFFSET_MS),
        end: new Date(Date.UTC(year, number, 1) - BANGKOK_OFFSET_MS),
    };
};
exports.businessMonthBounds = businessMonthBounds;
const shiftBusinessMonth = (month, offset) => {
    const [year, number] = month.split("-").map(Number);
    return new Date(Date.UTC(year, number - 1 + offset, 1)).toISOString().slice(0, 7);
};
exports.shiftBusinessMonth = shiftBusinessMonth;
//# sourceMappingURL=businessDateHelpers.js.map