export type AnalyticsResponse = {
  month: string;
  previousMonth: string;
  nextMonth: string;
  generatedAt: string;
  capacity: number;
  revenueBasis: "expected-stay-revenue";
  stats: {
    stayRevenue: number;
    outstandingBalance: number;
    occupancy: number;
    revpab: number;
    forwardOccupancy: number;
    changes: { stayRevenue: number | null; outstandingBalance: number | null; occupancy: number; revpab: number | null };
  };
  dailyTrend: { date: string; revenue: number; occupancy: number }[];
  channels: { id: string; name: string; bookings: number; revenue: number; averageNights: number; change: number | null }[];
  inventory: { id: string; name: string; occupancy: number; revenue: number; rateLabel: string; rate: number; changes: (number | null)[]; trend: { date: string; value: number }[] }[];
  unallocatedRoomRevenue: number;
  revenueGroups: { label: string; amount: number; color: string; groupKey: string | null }[];
  totalRevenue: number;
  outlook: { title: string; startDate: string; endDate: string; occupancy: number; bars: number[] }[];
};
