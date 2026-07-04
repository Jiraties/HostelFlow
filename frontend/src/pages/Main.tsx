import axios from "axios";
import { Modal } from "@mui/material";
import { useNavigate } from "react-router";
import toast from "react-hot-toast";
import { useCallback, useEffect, useState } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import ActionButton from "../components/ActionButton";
import AddBooking from "../features/bookings/AddBooking";
import UnsavedChangesModal from "../components/UnsavedChangesModal";
import PageHeader from "../components/PageHeader";
import StatCard from "../features/dashboard/StatCard";
import { useAuth } from "../context/AuthContext";
import {
  formatBookingsDates,
  truncateDecimal,
} from "../helpers/bookingHelpers";
import { platformMap } from "../helpers/maps";
import { API_URL } from "../config/api";
import { requestUnsavedModalClose } from "../helpers/modalGuards";
import { formatRoomStayRooms } from "../helpers/roomStayHelpers";
import usePageTitle from "../hooks/useTitle";

import type { booking, PlatformId } from "../types/bookingTypes";

import "./Home.css";
import "./Main.css";
import FinancialBreakdown from "../features/finance/FinancialBreakdown";

const getFetchErrorMessage = (err: unknown) => {
  if (axios.isAxiosError(err) && err.response?.data?.message) {
    return err.response.data.message;
  }

  return "เกิดข้อผิดพลาดในการโหลดข้อมูล";
};

const roomChargeTransaction = (booking: booking) =>
  booking.transactions.find((transaction) => transaction.type === "roomCharge");

const formatDisplayDate = (date: Date) =>
  new Intl.DateTimeFormat("th-TH", {
    calendar: "gregory",
    day: "numeric",
    month: "short",
  }).format(date);

const startOfDate = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate());

const daysBetweenDates = (from: Date, to: Date) =>
  Math.max(
    0,
    Math.floor(
      (startOfDate(to).getTime() - startOfDate(from).getTime()) /
        (1000 * 60 * 60 * 24),
    ),
  );

type AdminDashboardStats = {
  dailyGrossRevenue: number;
  dailyCollectedRevenue: number;
  monthlyGrossRevenue: number;
  monthlyCollectedRevenue: number;
  monthBookings: number;
  unpaidAmount: number;
  occupancyRate: number;
  channelMix: Array<{
    platformId: PlatformId;
    count: number;
  }>;
  revenueRange: RevenueRange;
  revenueSeries: Array<{
    date: string;
    grossRevenue: number;
    collectedRevenue: number;
    occupancyRate: number;
    occupiedCapacity: number;
  }>;
};

type RevenueRange = "mtd" | "1m" | "3m" | "1y";
type ChartMetric = "revenue" | "occupancy";

const revenueRangeOptions: Array<{ value: RevenueRange; label: string }> = [
  { value: "mtd", label: "MTD" },
  { value: "1m", label: "1M" },
  { value: "3m", label: "3M" },
  { value: "1y", label: "1Y" },
];

const revenueRangeTitleMap: Record<RevenueRange, string> = {
  mtd: "ESR MTD",
  "1m": "ESR 1M",
  "3m": "ESR 3M",
  "1y": "ESR 1Y",
};

const occupancyRangeTitleMap: Record<RevenueRange, string> = {
  mtd: "อัตราเข้าพัก MTD",
  "1m": "อัตราเข้าพัก 1M",
  "3m": "อัตราเข้าพัก 3M",
  "1y": "อัตราเข้าพัก 1Y",
};

const chartMetricOptions: Array<{ value: ChartMetric; label: string }> = [
  { value: "revenue", label: "ESR" },
  { value: "occupancy", label: "เข้าพัก" },
];

const dashboardHelpText = {
  bookedRevenue:
    "รายได้จากการเข้าพักที่คาดไว้หลังหักรายการลด เช่น คืนเงิน ชดเชย และปรับลบ โดยไม่รวมมัดจำ และบางยอดอาจยังไม่ได้รับเงินจริง",
  collectedRevenue: "เงินที่รับแล้วจริง เช่น เงินสด โอน บัตร หรือ OTA จ่ายแล้ว",
  unpaid: "ยอดจองที่ยังไม่ได้รับเงินจากลูกค้า",
  cashToday: "เงินสดรับ ลบ เงินสดจ่าย สำหรับวันที่เลือก",
  occupancy: "จำนวนแขกที่เข้าพักจริงเทียบกับจำนวนเตียงทั้งหมด",
};

const ExpectedStayRevenueInfo = () => (
  <span
    className="main__metricInfo"
    onClick={(event) => event.stopPropagation()}
  >
    <i className="bx bx-info-circle" />
    <span className="main__metricTooltip">
      <span>{dashboardHelpText.bookedRevenue}</span>
    </span>
  </span>
);

type FinanceSummary = {
  cashIn: number;
  cashOut: number;
  refunds: number;
  unpaidBalance: number;
};

type DailyClose = {
  businessDate: string;
  staffUsername: string;
  openingCash: number;
  expectedCash: number;
  actualCash: number;
  variance: number;
  cashIn: number;
  cashOut: number;
  note?: string;
  createdAt?: string | Date;
  staff?: {
    username: string;
    name?: string;
    profilePictureUrl?: string;
  };
  closedBy?: {
    username: string;
    name?: string;
    profilePictureUrl?: string;
  };
};

type ReconciliationData = {
  businessDate: string;
  threshold: number;
  summary: FinanceSummary;
  dailyCloses: DailyClose[];
};

type ReviewBooking = booking & {
  reviewLabel: string;
  reviewType: "checkIn" | "checkOut";
};

const getReviewDate = (booking: ReviewBooking) =>
  booking.reviewType === "checkIn" ? booking.checkIn : booking.checkOut;

const getReviewDateLabel = (booking: ReviewBooking) =>
  booking.reviewType === "checkIn" ? "ควรเช็คอิน" : "ควรเช็คเอาท์";

const getReviewOverdueLabel = (booking: ReviewBooking) => {
  const daysOverdue = daysBetweenDates(getReviewDate(booking), new Date());

  return daysOverdue > 0 ? `${daysOverdue} วัน` : "วันนี้";
};

type NeedsReviewResponse = {
  lateCheckIns: booking[];
  lateCheckOuts: booking[];
};

const formatCompactNumber = (value: number) =>
  new Intl.NumberFormat("th-TH", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);

const formatCurrency = (value: number) => `${value.toLocaleString("th-TH")} ฿`;

const todayInputValue = () => {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
};

const formatMoney = (value: number) =>
  value.toLocaleString("th-TH", {
    minimumFractionDigits: value % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });

const formatCloseTime = (date?: string | Date) =>
  date
    ? new Date(date).toLocaleTimeString("th-TH", {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";

const currentThaiMonthLabel = () =>
  new Intl.DateTimeFormat("th-TH", {
    month: "long",
    calendar: "gregory",
  }).format(new Date());

const TrendLineChart = ({
  series,
  metric,
}: {
  series: AdminDashboardStats["revenueSeries"];
  metric: ChartMetric;
}) => (
  <div className="main__chartWrapper">
    <ResponsiveContainer width="100%" height={260}>
      <ComposedChart
        data={series.map((point) => {
          const date = new Date(`${point.date}T00:00:00`);

          return {
            ...point,
            occupancyPercent: point.occupancyRate * 100,
            label: new Intl.DateTimeFormat("th-TH", {
              day: "numeric",
              month: "short",
            }).format(date),
          };
        })}
        margin={{ top: 12, right: 12, bottom: 0, left: 0 }}
      >
        <CartesianGrid
          stroke="#e7e7e7"
          strokeDasharray="4 4"
          vertical={false}
        />
        <XAxis
          dataKey="label"
          axisLine={false}
          tickLine={false}
          minTickGap={18}
          tick={{ fill: "#777777", fontSize: 12 }}
        />
        <YAxis
          axisLine={false}
          tickLine={false}
          width={54}
          domain={metric === "occupancy" ? [0, 100] : undefined}
          tick={{ fill: "#777777", fontSize: 12 }}
          tickFormatter={(value) =>
            metric === "revenue"
              ? formatCompactNumber(Number(value))
              : `${formatMoney(Number(value))}%`
          }
        />
        <Tooltip
          cursor={{
            stroke: "var(--primary-color)",
            strokeDasharray: "4 4",
          }}
          contentStyle={{
            border: "none",
            borderRadius: "1rem",
            boxShadow: "var(--main-shadow)",
            fontFamily: '"IBM Plex Sans Thai", sans-serif',
          }}
          formatter={(value, _name, item) => {
            if (metric === "occupancy") {
              const payload =
                item && typeof item === "object" && "payload" in item
                  ? (item.payload as { occupiedCapacity?: number })
                  : {};

              return [
                `${formatMoney(Number(value))}% · ${formatMoney(
                  payload.occupiedCapacity || 0,
                )} เตียง`,
                "อัตราเข้าพัก",
              ];
            }

            return [formatCurrency(Number(value)), "ESR"];
          }}
          labelFormatter={(label) => String(label)}
        />
        <Area
          type="monotone"
          dataKey={metric === "revenue" ? "grossRevenue" : "occupancyPercent"}
          stroke="none"
          fill="var(--primary-color)"
          fillOpacity={0.12}
          activeDot={false}
        />
        <Line
          type="monotone"
          dataKey={metric === "revenue" ? "grossRevenue" : "occupancyPercent"}
          stroke="var(--primary-color)"
          strokeWidth={3}
          dot={{ r: 3, fill: "#fff", strokeWidth: 2 }}
          activeDot={{ r: 5, fill: "var(--primary-color)" }}
        />
      </ComposedChart>
    </ResponsiveContainer>
  </div>
);

const TodayList = ({
  title,
  icon,
  bookings,
  emptyText,
  onBookingClick,
  isBookingsThatNeedReview,
}: {
  title: string;
  icon: string;
  bookings: Array<booking | ReviewBooking>;
  emptyText: string;
  onBookingClick: (booking: booking) => void;
  isBookingsThatNeedReview?: boolean;
}) => {
  const visibleBookings = bookings.slice(0, 6);
  const hiddenBookingCount = Math.max(
    0,
    bookings.length - visibleBookings.length,
  );

  return (
    <section
      className={`main__todaySection${
        isBookingsThatNeedReview ? " main__todaySection--review" : ""
      }`}
    >
      <div className="main__sectionHeader">
        <div>
          <i className={`bx ${icon}`} />
          <h2>{title}</h2>
        </div>
        <span>{bookings.length}</span>
      </div>

      <div className="main__bookingList">
        {bookings.length === 0 ? (
          <div className="main__emptyState">
            <i className="bx bx-check-circle" />
            <p>{emptyText}</p>
          </div>
        ) : (
          <>
            {visibleBookings.map((booking) => {
              const roomNames = booking.roomStays
                .map(formatRoomStayRooms)
                .join(", ");
              const platform = platformMap[booking.platformId];
              const isReviewBooking =
                isBookingsThatNeedReview && "reviewType" in booking;

              return (
                <button
                  className={`main__bookingItem${
                    isReviewBooking ? " main__bookingItem--review" : ""
                  }${
                    isReviewBooking
                      ? ` main__bookingItem--review-${booking.reviewType}`
                      : ""
                  }`}
                  key={booking.bookingId}
                  type="button"
                  onClick={() => onBookingClick(booking)}
                >
                  <div className="main__bookingPrimary">
                    <h3>{booking.name}</h3>
                    <p>{roomNames || "ยังไม่มีห้อง"}</p>
                  </div>
                  <div className="main__bookingMeta">
                    {isReviewBooking ? (
                      <>
                        <strong className="main__bookingReviewReason">
                          {booking.reviewLabel}
                        </strong>
                        <span className="main__bookingMetaLine">
                          {getReviewDateLabel(booking)}{" "}
                          {formatDisplayDate(getReviewDate(booking))}
                          {" · "}
                          <strong className="main__bookingReviewAge">
                            {getReviewOverdueLabel(booking)}
                          </strong>
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="main__bookingMetaLine">
                          {formatDisplayDate(booking.checkIn)} -{" "}
                          {formatDisplayDate(booking.checkOut)}
                        </span>
                        <span
                          className="main__bookingMetaLine"
                          style={{ color: platform?.color }}
                        >
                          {platform?.label || booking.platformId}
                        </span>
                      </>
                    )}
                    <div className="main__bookingReviewTags">
                      {"reviewLabel" in booking && !isReviewBooking && (
                        <strong className="main__bookingReviewTag">
                          {booking.reviewLabel}
                        </strong>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
            {hiddenBookingCount > 0 && (
              <div className="main__bookingOverflow">
                +{hiddenBookingCount} รายการเพิ่มเติม
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
};

const Main = () => {
  usePageTitle("HostelFlow · หน้าแรก");
  const { user } = useAuth();
  const navigate = useNavigate();
  const [arrivals, setArrivals] = useState<booking[]>([]);
  const [departures, setDepartures] = useState<booking[]>([]);
  const [bookingsThatNeedReview, setBookingsThatNeedReview] = useState<
    ReviewBooking[]
  >([]);
  const [occupancy, setOccupancy] = useState(0);
  const [loading, setLoading] = useState(true);
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminStats, setAdminStats] = useState<AdminDashboardStats | null>(
    null,
  );
  const [revenueRange, setRevenueRange] = useState<RevenueRange>("mtd");
  const [chartMetric, setChartMetric] = useState<ChartMetric>("revenue");
  const [cashCloseLoading, setCashCloseLoading] = useState(false);
  const [cashCloseSaving, setCashCloseSaving] = useState(false);
  const [reconciliation, setReconciliation] =
    useState<ReconciliationData | null>(null);
  const [cashCloseDate, setCashCloseDate] = useState(todayInputValue());
  const [openingCash, setOpeningCash] = useState("0");
  const [actualCash, setActualCash] = useState("");
  const [closeNote, setCloseNote] = useState("");
  const [addBookingIsOpen, setAddBookingIsOpen] = useState(false);
  const [addBookingIsDirty, setAddBookingIsDirty] = useState(false);
  const [financialBreakdownIsOpen, setFinancialBreakdownIsOpen] =
    useState(false);
  const [pendingUnsavedClose, setPendingUnsavedClose] = useState<
    (() => void) | null
  >(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fullFormattedDate = new Intl.DateTimeFormat("th-TH", {
    day: "numeric",
    month: "long",
    year: "numeric",
    calendar: "gregory",
  }).format(new Date());

  const fetchDailyOps = useCallback(async () => {
    setLoading(true);
    try {
      const [
        arrivalsResponse,
        departuresResponse,
        bookingsThatNeedReviewResponse,
      ] = await Promise.all([
        axios.get(`${API_URL}/bookings/getTodayBookings/arrivals`, {
          withCredentials: true,
        }),
        axios.get(`${API_URL}/bookings/getTodayBookings/departures`, {
          withCredentials: true,
        }),
        axios.get<NeedsReviewResponse>(
          `${API_URL}/bookings/getNeedsReviewBookings`,
          {
            withCredentials: true,
          },
        ),
      ]);

      setArrivals(formatBookingsDates(arrivalsResponse.data.bookings));
      setDepartures(formatBookingsDates(departuresResponse.data.bookings));
      setBookingsThatNeedReview(
        [
          ...formatBookingsDates(
            bookingsThatNeedReviewResponse.data.lateCheckIns,
          ).map((booking) => ({
            ...booking,
            reviewLabel: "ยังไม่ได้เช็คอิน",
            reviewType: "checkIn" as const,
          })),
          ...formatBookingsDates(
            bookingsThatNeedReviewResponse.data.lateCheckOuts,
          ).map((booking) => ({
            ...booking,
            reviewLabel: "ยังไม่ได้เช็คเอาท์",
            reviewType: "checkOut" as const,
          })),
        ].sort(
          (firstBooking, secondBooking) =>
            getReviewDate(firstBooking).getTime() -
            getReviewDate(secondBooking).getTime(),
        ),
      );
      setOccupancy(arrivalsResponse.data.occupancy);
      setLastUpdated(new Date());
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchAdminStats = useCallback(async () => {
    if (!user?.admin) {
      setAdminStats(null);
      return;
    }

    setAdminLoading(true);
    try {
      const response = await axios.get(
        `${API_URL}/bookings/getAdminDashboardStats`,
        {
          params: { revenueRange },
          withCredentials: true,
        },
      );

      setAdminStats(response.data);
    } catch (err) {
      setAdminStats(null);
      toast.error(getFetchErrorMessage(err));
    } finally {
      setAdminLoading(false);
    }
  }, [revenueRange, user?.admin]);

  const fetchCashClose = useCallback(async () => {
    setCashCloseLoading(true);
    try {
      const response = await axios.get(`${API_URL}/finance/reconciliation`, {
        params: { date: cashCloseDate },
        withCredentials: true,
      });

      setReconciliation(response.data);

      const ownClose = response.data.dailyCloses?.find(
        (dailyClose: DailyClose) => dailyClose.staffUsername === user?.username,
      );

      if (ownClose) {
        setOpeningCash(String(ownClose.openingCash));
        setActualCash(String(ownClose.actualCash));
        setCloseNote(ownClose.note || "");
      }
    } catch (err) {
      setReconciliation(null);
      toast.error(getFetchErrorMessage(err));
    } finally {
      setCashCloseLoading(false);
    }
  }, [cashCloseDate, user?.username]);

  const refreshDashboard = useCallback(async () => {
    await fetchDailyOps();
    await fetchAdminStats();
    await fetchCashClose();
  }, [fetchAdminStats, fetchCashClose, fetchDailyOps]);

  useEffect(() => {
    fetchDailyOps().catch((err) => toast.error(getFetchErrorMessage(err)));
  }, [fetchDailyOps]);

  useEffect(() => {
    fetchAdminStats();
  }, [fetchAdminStats]);

  useEffect(() => {
    fetchCashClose();
  }, [fetchCashClose]);

  const expectedCash =
    Number(openingCash || 0) +
    (reconciliation?.summary.cashIn || 0) -
    (reconciliation?.summary.cashOut || 0);
  const cashVariance =
    actualCash === "" ? 0 : Number(actualCash || 0) - expectedCash;
  const cashVarianceNeedsNote =
    reconciliation && Math.abs(cashVariance) > reconciliation.threshold;
  const dailyCloseIsComplete = Boolean(
    reconciliation?.dailyCloses?.some(
      (dailyClose) => dailyClose.staffUsername === user?.username,
    ),
  );
  const latestDailyClose = reconciliation?.dailyCloses?.[0];
  const latestDailyClosePerson =
    latestDailyClose?.closedBy || latestDailyClose?.staff;

  const submitCashClose = async () => {
    if (actualCash === "") {
      throw new Error("กรุณากรอกยอดเงินสดที่นับได้");
    }

    if (cashVarianceNeedsNote && !closeNote.trim()) {
      throw new Error("กรุณาระบุหมายเหตุเมื่อยอดเงินสดไม่ตรงกัน");
    }

    setCashCloseSaving(true);
    try {
      await axios.post(
        `${API_URL}/finance/daily-close`,
        {
          businessDate: cashCloseDate,
          openingCash: Number(openingCash || 0),
          actualCash: Number(actualCash || 0),
          note: closeNote.trim(),
        },
        { withCredentials: true },
      );
      await fetchCashClose();
    } finally {
      setCashCloseSaving(false);
    }
  };

  const unpaidArrivals = arrivals.filter(
    (booking) => roomChargeTransaction(booking)?.paymentMethod === "Unpaid",
  ).length;
  const occupancyRatePercent = adminStats
    ? truncateDecimal(adminStats.occupancyRate * 100, 2)
    : 0;
  const statCards = [
    {
      label: "เช็คอินวันนี้",
      value: arrivals.length,
    },
    {
      label: "เช็คเอาท์วันนี้",
      value: departures.length,
    },
    {
      label: "แขกที่พักอยู่ตอนนี้",
      value: occupancy,
      helperText: dashboardHelpText.occupancy,
    },
    {
      label: "ค้างชำระ",
      value: unpaidArrivals,
      helperText: dashboardHelpText.unpaid,
    },
    // {
    //   label: "มัดจำที่ต้องคืน (฿)",
    //   value: depositToReturn,
    // },
    {
      label: "ต้องตรวจสอบ",
      value: bookingsThatNeedReview.length,
    },
  ];
  const adminRevenueGroups = adminStats
    ? [
        {
          title: "วันนี้",
          grossRevenue: adminStats.dailyGrossRevenue,
          collectedRevenue: adminStats.dailyCollectedRevenue,
        },
        {
          title: "เดือนนี้",
          grossRevenue: adminStats.monthlyGrossRevenue,
          collectedRevenue: adminStats.monthlyCollectedRevenue,
        },
      ]
    : [
        {
          title: "วันนี้",
          grossRevenue: 0,
          collectedRevenue: 0,
        },
        {
          title: "เดือนนี้",
          grossRevenue: 0,
          collectedRevenue: 0,
        },
      ];
  const chartRevenueTotals = adminStats
    ? adminStats.revenueSeries.reduce(
        (total, point) => total + point.grossRevenue,
        0,
      )
    : 0;
  const occupancyFillPercent = Math.min(Math.max(occupancyRatePercent, 0), 100);
  const chartAverageOccupancy =
    adminStats && adminStats.revenueSeries.length > 0
      ? adminStats.revenueSeries.reduce(
          (total, point) => total + point.occupancyRate,
          0,
        ) / adminStats.revenueSeries.length
      : 0;
  const thisMonthLabel = `เดือนนี้ (${currentThaiMonthLabel()})`;
  const chartTitle =
    chartMetric === "revenue"
      ? revenueRangeTitleMap[revenueRange]
      : occupancyRangeTitleMap[revenueRange];
  const chartSummary =
    chartMetric === "revenue"
      ? `${chartRevenueTotals.toLocaleString()} ฿`
      : `${formatMoney(chartAverageOccupancy * 100)}%`;

  const appendToBookings = () => {
    setAddBookingIsOpen(false);
    refreshDashboard().catch((err) => toast.error(getFetchErrorMessage(err)));
  };

  const openBookingInMaster = (booking: booking) => {
    navigate(`/master?bookingId=${encodeURIComponent(booking.bookingId)}`);
  };

  return (
    <main className="home main">
      <Modal
        open={addBookingIsOpen}
        className="home__modalCenter"
        onClose={() =>
          requestUnsavedModalClose(
            addBookingIsDirty,
            () => setAddBookingIsOpen(false),
            () =>
              setPendingUnsavedClose(() => () => setAddBookingIsOpen(false)),
          )
        }
      >
        <AddBooking
          appendToBookings={appendToBookings}
          onClose={() => setAddBookingIsOpen(false)}
          onDirtyChange={setAddBookingIsDirty}
        />
      </Modal>
      <Modal
        open={!!pendingUnsavedClose}
        className="home__modalCenter"
        onClose={() => setPendingUnsavedClose(null)}
      >
        <UnsavedChangesModal
          onClose={() => setPendingUnsavedClose(null)}
          onDiscard={() => {
            pendingUnsavedClose?.();
            setPendingUnsavedClose(null);
          }}
        />
      </Modal>
      <Modal
        open={financialBreakdownIsOpen}
        className="home__modalCenter"
        onClose={() => setFinancialBreakdownIsOpen(false)}
      >
        <FinancialBreakdown />
      </Modal>

      <PageHeader
        title={`หน้าแรก | ${fullFormattedDate}`}
        lastUpdated={lastUpdated}
        onRefresh={refreshDashboard}
      />

      <section className="main__actions">
        <ActionButton
          text="เพิ่มการจองใหม่"
          icon="bx-plus"
          onClick={() => setAddBookingIsOpen(true)}
          highlight
        />
        <ActionButton
          text="เช็คอินวันนี้"
          icon="bx-arrow-to-left"
          onClick={() => navigate("/arrivals")}
        />
        <ActionButton
          text="เช็คเอาท์วันนี้"
          icon="bx-arrow-from-left"
          onClick={() => navigate("/departures")}
        />
        <ActionButton
          text="รายการจองทั้งหมด"
          icon="bx-table"
          onClick={() => navigate("/master")}
        />
      </section>

      <section className="main__statsGrid">
        {statCards.map((stat) => (
          <div className="main__statCard" key={stat.label}>
            <StatCard
              label={stat.label}
              value={stat.value}
              loading={loading}
              helperText={stat.helperText}
            />
          </div>
        ))}
      </section>

      {user?.admin && (adminStats || adminLoading) && (
        <section className="main__adminSection">
          <div className="main__adminHeader">
            <div>
              <i className="bx bx-bar-chart-big" />
              <h2>ภาพรวมสำหรับแอดมิน</h2>
            </div>
            <span>{thisMonthLabel}</span>
          </div>

          <div className="main__adminDashboardGrid">
            <div className="main__adminPrimaryColumn">
              <section
                className="main__adminPanel main__revenueHero"
                onClick={() => setFinancialBreakdownIsOpen(true)}
              >
                <div className="main__adminPanelHeader">
                  <div>
                    <div className="main__metricTitle">
                      <h3>Expected Stay Revenue</h3>
                      <ExpectedStayRevenueInfo />
                    </div>
                  </div>
                  <p>{thisMonthLabel}</p>
                </div>
                <div className="main__revenueHeroValue">
                  <strong>
                    {adminLoading && !adminStats
                      ? "-"
                      : `${formatMoney(adminStats?.monthlyGrossRevenue || 0)} ฿`}
                  </strong>
                  <span title={dashboardHelpText.collectedRevenue}>
                    เงินที่รับแล้ว{" "}
                    {adminLoading && !adminStats
                      ? "-"
                      : `${formatMoney(adminStats?.monthlyCollectedRevenue || 0)} ฿`}
                  </span>
                </div>
              </section>

              <section className="main__adminPanel main__revenueBreakdown">
                {adminRevenueGroups.map((group) => (
                  <div className="main__summaryRow" key={group.title}>
                    <div className="main__summaryLabel">
                      <span>{group.title}</span>
                    </div>
                    <div className="main__summaryMetric">
                      <p className="main__summaryMetricLabel">
                        <span>Expected Stay Revenue</span>
                        <ExpectedStayRevenueInfo />
                      </p>
                      <strong>
                        {adminLoading && !adminStats
                          ? "-"
                          : `${formatMoney(group.grossRevenue)} ฿`}
                      </strong>
                    </div>
                    <div className="main__summaryMetric">
                      <p title={dashboardHelpText.collectedRevenue}>
                        เงินที่รับแล้ว
                      </p>
                      <strong className="main__summarySecondaryValue">
                        {adminLoading && !adminStats
                          ? "-"
                          : `${formatMoney(group.collectedRevenue)} ฿`}
                      </strong>
                    </div>
                  </div>
                ))}
              </section>

              {adminStats && (
                <section className="main__adminPanel main__trendPanel">
                  <div className="main__cardHeader">
                    <div>
                      <h3>{chartTitle}</h3>
                      <span>{chartSummary}</span>
                    </div>
                    <div className="main__chartControls">
                      <div className="main__chartMetricControl">
                        {chartMetricOptions.map((option) => (
                          <button
                            className={
                              option.value === chartMetric
                                ? "main__chartRangeButton main__chartRangeButton--active"
                                : "main__chartRangeButton"
                            }
                            key={option.value}
                            type="button"
                            onClick={() => setChartMetric(option.value)}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                      <div className="main__chartRangeControl">
                        {revenueRangeOptions.map((option) => (
                          <button
                            className={
                              option.value === revenueRange
                                ? "main__chartRangeButton main__chartRangeButton--active"
                                : "main__chartRangeButton"
                            }
                            key={option.value}
                            type="button"
                            onClick={() => setRevenueRange(option.value)}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                  <TrendLineChart
                    metric={chartMetric}
                    series={adminStats.revenueSeries}
                  />
                </section>
              )}
            </div>

            <aside className="main__adminSideColumn">
              <section
                className="main__adminPanel main__occupancyPanel"
                style={
                  {
                    "--operation-fill": `${occupancyFillPercent}%`,
                  } as React.CSSProperties
                }
              >
                <div className="main__adminPanelHeader">
                  <div>
                    <span>Occupancy</span>
                    <h3 title={dashboardHelpText.occupancy}>การเข้าพัก</h3>
                  </div>
                  <p>เดือนนี้</p>
                </div>
                <div className="main__sideMetric main__sideMetric--large">
                  <p title={dashboardHelpText.occupancy}>อัตราเข้าพัก</p>
                  <strong>
                    {adminLoading && !adminStats
                      ? "-"
                      : `${formatMoney(occupancyRatePercent)}%`}
                  </strong>
                </div>
              </section>

              <section className="main__adminPanel main__bookingPanel">
                <div className="main__adminPanelHeader">
                  <div>
                    <span>Bookings</span>
                    <h3>ยอดจอง</h3>
                  </div>
                  <p>เดือนนี้</p>
                </div>
                <div className="main__sideMetric">
                  <p>ยอดจองเดือนนี้</p>
                  <strong>
                    {adminLoading && !adminStats
                      ? "-"
                      : (adminStats?.monthBookings || 0).toLocaleString(
                          "th-TH",
                        )}
                  </strong>
                </div>
              </section>

              {adminStats && (
                <section className="main__adminPanel main__channelPanel">
                  <div className="main__adminPanelHeader">
                    <div>
                      <span>Channels</span>
                      <h3>ช่องทางการจอง</h3>
                    </div>
                    <p>{adminStats.monthBookings}</p>
                  </div>
                  <div className="main__channelList">
                    {adminStats.channelMix.length === 0 ? (
                      <div className="main__emptyState">
                        <i className="bx bx-info-circle" />
                        <p>ยังไม่มีรายการจองเดือนนี้</p>
                      </div>
                    ) : (
                      adminStats.channelMix.map((channel) => {
                        const platform = platformMap[channel.platformId];
                        const percentage =
                          adminStats.monthBookings === 0
                            ? 0
                            : Math.round(
                                (channel.count / adminStats.monthBookings) *
                                  100,
                              );

                        return (
                          <div
                            className="main__channelItem"
                            key={channel.platformId}
                          >
                            <div>
                              <span
                                style={{
                                  backgroundColor:
                                    platform?.color || "var(--primary-color)",
                                }}
                              />
                              <p>{platform?.label || channel.platformId}</p>
                            </div>
                            <strong>
                              {channel.count} รายการ · {percentage}%
                            </strong>
                          </div>
                        );
                      })
                    )}
                  </div>
                </section>
              )}
            </aside>
          </div>
        </section>
      )}

      <section className="main__cashCloseSection">
        <div className="main__sectionHeader">
          <div>
            <i className="bx bx-currency-notes" />
            <h2>ปิดยอดเงินสดประจำวัน</h2>
          </div>
          {latestDailyClose ? (
            <div className="main__cashCloseStatus">
              <img
                src={
                  API_URL +
                  (latestDailyClosePerson?.profilePictureUrl ||
                    "/uploads/default.jpg")
                }
                alt=""
              />

              <span>{formatCloseTime(latestDailyClose.createdAt)}</span>
              <p>บันทึกแล้ว</p>
            </div>
          ) : (
            <span>วันนี้</span>
          )}
        </div>

        <div className="main__cashCloseGrid">
          <div className="main__cashCloseSummary">
            <div>
              <p title={dashboardHelpText.cashToday}>รับเงินสด</p>
              <strong>
                {cashCloseLoading
                  ? "-"
                  : `${formatMoney(reconciliation?.summary.cashIn || 0)} ฿`}
              </strong>
            </div>
            <div>
              <p title={dashboardHelpText.cashToday}>จ่ายเงินสด</p>
              <strong>
                {cashCloseLoading
                  ? "-"
                  : `${formatMoney(reconciliation?.summary.cashOut || 0)} ฿`}
              </strong>
            </div>
            <div>
              <p title={dashboardHelpText.cashToday}>ยอดเงินสดคาดไว้</p>
              <strong>{formatMoney(expectedCash)} ฿</strong>
            </div>
            <div>
              <p>ส่วนต่าง</p>
              <strong
                className={
                  cashVariance < 0 ? "main__cashCloseVariance--negative" : ""
                }
              >
                {formatMoney(cashVariance)} ฿
              </strong>
            </div>
          </div>

          <div className="main__cashCloseForm">
            <label>
              <span>วันที่</span>
              <input
                className="boxInput"
                type="date"
                value={cashCloseDate}
                onChange={(event) => setCashCloseDate(event.target.value)}
              />
            </label>
            <label>
              <span>เงินสดตั้งต้น</span>
              <input
                className="boxInput"
                type="number"
                value={openingCash}
                onChange={(event) => setOpeningCash(event.target.value)}
              />
            </label>
            <label>
              <span>เงินสดที่นับได้</span>
              <input
                className="boxInput"
                type="number"
                value={actualCash}
                placeholder="ยอดในลิ้นชัก"
                onChange={(event) => setActualCash(event.target.value)}
              />
            </label>
            {cashVarianceNeedsNote && (
              <label className="main__cashCloseNote">
                <span>หมายเหตุยอดต่าง</span>
                <input
                  className="boxInput"
                  type="text"
                  value={closeNote}
                  placeholder="เช่น เงินทอนตั้งต้นไม่ตรง"
                  onChange={(event) => setCloseNote(event.target.value)}
                />
              </label>
            )}
            <ActionButton
              text={
                dailyCloseIsComplete
                  ? "อัปเดตปิดยอดเงินสด"
                  : "ปิดยอดเงินสดประจำวัน"
              }
              icon="bx-save"
              highlight
              disabled={cashCloseSaving || cashCloseLoading}
              onClick={() =>
                toast.promise(submitCashClose(), {
                  loading: "กำลังบันทึกปิดยอดเงินสด",
                  success: "บันทึกปิดยอดเงินสดเรียบร้อย",
                  error: (err) => {
                    if (axios.isAxiosError(err)) {
                      return (
                        err.response?.data?.message ||
                        "เกิดข้อผิดพลาดในการบันทึกปิดยอด"
                      );
                    }
                    if (err instanceof Error) return err.message;
                    return "เกิดข้อผิดพลาดในการบันทึกปิดยอด";
                  },
                })
              }
            />
          </div>
        </div>
      </section>

      <div className="main__todayGrid">
        {bookingsThatNeedReview.length > 0 ? (
          <TodayList
            title="ต้องตรวจสอบ"
            icon="bx-error-circle"
            bookings={bookingsThatNeedReview}
            emptyText="ไม่มีรายการจองที่ต้องตรวจสอบ"
            isBookingsThatNeedReview={true}
            onBookingClick={openBookingInMaster}
          />
        ) : (
          <TodayList
            title="เช็คอินวันนี้"
            icon="bx-arrow-to-left"
            bookings={arrivals}
            emptyText="ไม่มีเช็คอินที่ต้องจัดการวันนี้"
            onBookingClick={openBookingInMaster}
          />
        )}
        <div className="main__todayStack">
          {bookingsThatNeedReview.length > 0 && (
            <TodayList
              title="เช็คอินวันนี้"
              icon="bx-arrow-to-left"
              bookings={arrivals}
              emptyText="ไม่มีเช็คอินที่ต้องจัดการวันนี้"
              onBookingClick={openBookingInMaster}
            />
          )}
          <TodayList
            title="เช็คเอาท์วันนี้"
            icon="bx-arrow-from-left"
            bookings={departures}
            emptyText="ไม่มีเช็คเอาท์ที่ต้องจัดการวันนี้"
            onBookingClick={openBookingInMaster}
          />
        </div>
      </div>
    </main>
  );
};

export default Main;
