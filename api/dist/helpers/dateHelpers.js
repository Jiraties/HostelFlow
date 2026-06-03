"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatDateAD = exports.toInputDate = exports.dateRangeText = void 0;
const dateRangeText = (from, to) => {
    const formatDay = (date) => new Intl.DateTimeFormat("th-TH", { day: "numeric" }).format(date);
    const formatMonth = (date) => new Intl.DateTimeFormat("th-TH", { month: "short" }).format(date);
    const sameMonth = from.getMonth() === to.getMonth();
    const dateText = sameMonth
        ? `${formatDay(from)}-${formatDay(to)} ${formatMonth(to)}`
        : `${formatDay(from)} ${formatMonth(from)} - ${formatDay(to)} ${formatMonth(to)}`;
    return dateText;
};
exports.dateRangeText = dateRangeText;
const toInputDate = (date) => {
    const d = new Date(date);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
};
exports.toInputDate = toInputDate;
const formatDateAD = (date) => {
    const day = String(date.getDate()).padStart(2, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
};
exports.formatDateAD = formatDateAD;
//# sourceMappingURL=dateHelpers.js.map