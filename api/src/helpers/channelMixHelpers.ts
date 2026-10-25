import type { booking, PlatformId } from "../models/booking";
import { effectiveCommercialSegments } from "./commercialSegmentHelpers";
import { withEffectiveTransactions } from "../services/transactionCorrections";

/** Recorded commercial segments overlapping the month, preserving all statuses. */
export const summarizeChannelMix = (records: booking[], start: Date, end: Date) => {
  const counts = new Map<PlatformId, { count: number; revenue: number }>();
  records.forEach((record) => {
    const source = typeof record.toObject === "function" ? record.toObject<booking>() : record;
    effectiveCommercialSegments(withEffectiveTransactions(source)).forEach((segment) => {
      if (new Date(segment.from) >= end || new Date(segment.to) <= start) return;
      const current = counts.get(segment.platformId) || { count: 0, revenue: 0 };
      current.count += 1;
      current.revenue += Math.abs(segment.amount || 0);
      counts.set(segment.platformId, current);
    });
  });
  const total = Array.from(counts.values()).reduce((sum, channel) => sum + channel.count, 0);
  return {
    unit: "commercialSegment" as const,
    total,
    channels: Array.from(counts, ([platformId, channel]) => ({
      platformId,
      ...channel,
      percentage: total === 0 ? 0 : Number((channel.count / total * 100).toFixed(2)),
    })),
  };
};
