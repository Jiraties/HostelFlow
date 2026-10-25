"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.summarizeChannelMix = void 0;
const commercialSegmentHelpers_1 = require("./commercialSegmentHelpers");
const transactionCorrections_1 = require("../services/transactionCorrections");
/** Recorded commercial segments overlapping the month, preserving all statuses. */
const summarizeChannelMix = (records, start, end) => {
    const counts = new Map();
    records.forEach((record) => {
        const source = typeof record.toObject === "function" ? record.toObject() : record;
        (0, commercialSegmentHelpers_1.effectiveCommercialSegments)((0, transactionCorrections_1.withEffectiveTransactions)(source)).forEach((segment) => {
            if (new Date(segment.from) >= end || new Date(segment.to) <= start)
                return;
            const current = counts.get(segment.platformId) || { count: 0, revenue: 0 };
            current.count += 1;
            current.revenue += Math.abs(segment.amount || 0);
            counts.set(segment.platformId, current);
        });
    });
    const total = Array.from(counts.values()).reduce((sum, channel) => sum + channel.count, 0);
    return {
        unit: "commercialSegment",
        total,
        channels: Array.from(counts, ([platformId, channel]) => ({
            platformId,
            ...channel,
            percentage: total === 0 ? 0 : Number((channel.count / total * 100).toFixed(2)),
        })),
    };
};
exports.summarizeChannelMix = summarizeChannelMix;
//# sourceMappingURL=channelMixHelpers.js.map