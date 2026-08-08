"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.globalSearch = void 0;
const globalSearch_1 = require("../services/globalSearch");
const globalSearch = async (req, res) => {
    const startedAt = performance.now();
    res.set("Cache-Control", "no-store");
    const pagination = (0, globalSearch_1.normalizeSearchPagination)(req.body || {});
    const intent = (0, globalSearch_1.parseSearchIntent)(req.body?.query);
    if (intent.bookingDate &&
        (req.body?.bookingDateField === "checkIn" ||
            req.body?.bookingDateField === "checkOut")) {
        intent.bookingDateField = req.body.bookingDateField;
    }
    try {
        const result = intent.normalizedQuery
            ? await (0, globalSearch_1.searchEntities)(intent, pagination)
            : await (0, globalSearch_1.bootstrapSearch)(req.body?.recentBookingIds);
        const groupCounts = result.mode === "search"
            ? Object.fromEntries(Object.entries(result.groups).map(([group, value]) => [
                group,
                value?.items.length || 0,
            ]))
            : {
                recentBookings: result.recentBookings.length,
                todayArrivals: result.todayArrivals.length,
            };
        console.info("global_search", {
            durationMs: Math.round(performance.now() - startedAt),
            mode: result.mode,
            groupCounts,
            ...(result.mode === "search" ? { interpreted: result.interpreted } : {}),
        });
        return res.status(200).json(result);
    }
    catch (error) {
        if ((0, globalSearch_1.isSearchTimeout)(error)) {
            console.warn("global_search_timeout", {
                durationMs: Math.round(performance.now() - startedAt),
            });
            return res.status(503).json({
                error: "SEARCH_TIMEOUT",
                message: "การค้นหาใช้เวลานานเกินไป กรุณาลองอีกครั้ง",
            });
        }
        console.error("global_search_failed", {
            durationMs: Math.round(performance.now() - startedAt),
            error: error instanceof Error ? error.name : "UnknownError",
        });
        return res.status(500).json({
            error: "SEARCH_FAILED",
            message: "ไม่สามารถค้นหาได้ กรุณาลองอีกครั้ง",
        });
    }
};
exports.globalSearch = globalSearch;
//# sourceMappingURL=search.js.map