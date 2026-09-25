import axios from "axios";
import { Modal } from "@mui/material";
import { useLocation, useNavigate } from "react-router";
import toast from "react-hot-toast";
import { useCallback, useEffect, useRef, useState } from "react";
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
import AppTooltip from "../components/Tooltip";
import AddBooking from "../features/bookings/AddBooking";
import UnsavedChangesModal from "../components/UnsavedChangesModal";
import PageHeader from "../components/PageHeader";
import StatCard from "../features/dashboard/StatCard";
import { useAuth } from "../context/AuthContext";
import {
  formatBookingsDates,
  roomChargeOutstandingAmount,
  truncateDecimal,
} from "../helpers/bookingHelpers";
import { platformMap } from "../helpers/maps";
import { API_URL } from "../config/api";
import { profilePictureUrl } from "../helpers/profilePictureUrl";
import { requestUnsavedModalClose } from "../helpers/modalGuards";
import { formatRoomStayRooms } from "../helpers/roomStayHelpers";
import usePageTitle from "../hooks/useTitle";
import { formatDisplayDate as formatPreferredDate } from "../helpers/displayDate";

import type {
  booking,
  PlatformId,
  TransactionType,
} from "../types/bookingTypes";
import type { CashPositionData } from "../types/cashShiftTypes";
import type { DateFormatPreference } from "../types/userSettings";

import "./Home.css";
import "../features/bookings/CheckIn.css";
import "./Main.css";
import FinancialBreakdown from "../features/finance/FinancialBreakdown";
import StandaloneSaleModal from "../features/finance/StandaloneSaleModal";
import { DepositReturnReminderModal } from "../features/finance/DepositReturnReminderModal";
import { ReopenFinalCashShiftModal } from "../features/finance/ReopenFinalCashShiftModal";

const getFetchErrorMessage = (err: unknown) => {
  if (axios.isAxiosError(err) && err.response?.data?.message) {
    return err.response.data.message;
  }

  return "เกิดข้อผิดพลาดในการโหลดข้อมูล";
};

const formatDashboardHeaderDate = (date: Date) =>
  new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "long",
    timeZone: "Asia/Bangkok",
    weekday: "long",
    year: "numeric",
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

type TodayRevenueStats = {
  todayRevenue: number;
  todayArrivalRevenue: number;
  todayExtrasRevenue: number;
  todayReductions: number;
  todayCollectedRevenue: number;
  todayServiceHighlights: Array<{
    type: TransactionType;
    count: number;
    total: number;
  }>;
};

const serviceHighlightMeta: Partial<
  Record<TransactionType, { label: string; icon: string; color: string }>
> = {
  roomCharge: { label: "Extension", icon: "bx-bed", color: "#51d1dc" },
  depositKept: {
    label: "มัดจำที่แขกยอมเสีย",
    icon: "bx-wallet",
    color: "#eab308",
  },
  joinTour: { label: "Join Tour", icon: "bx-map", color: "#22c55e" },
  motorbike: { label: "Motorbike", icon: "bx-cycling", color: "#f97316" },
  slowBoat: { label: "Slow Boat", icon: "bx-water", color: "#14b8a6" },
  sleeperBus: { label: "Sleeper Bus", icon: "bx-bus", color: "#6366f1" },
  towel: { label: "Towel", icon: "bx-bath", color: "#0ea5e9" },
  extraBed: { label: "Extra Bed", icon: "bx-bed", color: "#ec4899" },
  pickACraft: { label: "Pick A Craft", icon: "bx-palette", color: "#f59e0b" },
  trek2D: { label: "Trek 2D", icon: "bx-map-alt", color: "#16a34a" },
  setMenu: { label: "Set Menu", icon: "bx-food-menu", color: "#84cc16" },
  onlyWalk: { label: "Only Walk", icon: "bx-walk", color: "#14b8a6" },
  laundry: { label: "Laundry", icon: "bx-washer", color: "#3b82f6" },
  bicycle: { label: "Bicycle", icon: "bx-cycling", color: "#eab308" },
  car: { label: "Car", icon: "bx-car", color: "#64748b" },
  misc: { label: "Misc", icon: "bx-dots-horizontal-rounded", color: "#64748b" },
  rainCoat: { label: "Rain Coat", icon: "bx-cloud-rain", color: "#0ea5e9" },
  passwordLock: { label: "Password Lock", icon: "bx-lock", color: "#8b5cf6" },
  cooking: { label: "Cooking", icon: "bx-food-menu", color: "#f97316" },
};

const formatServiceType = (type: TransactionType) => {
  const words = type.replace(/([a-z])([A-Z])/g, "$1 $2");
  return words.charAt(0).toUpperCase() + words.slice(1);
};

const priorityTodayServiceTypes: TransactionType[] = [
  "roomCharge",
  "joinTour",
  "motorbike",
  "slowBoat",
  "sleeperBus",
];

type AdminDashboardStats = {
  selectedMonth: string;
  monthlyGrossRevenue: number;
  monthlyCollectedRevenue: number;
  monthBookings: number;
  unpaidAmount: number;
  occupancyRate: number;
  rangeOccupancyRate: number;
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
  esrSeries: Array<{
    date: string;
    grossRevenue: number;
    collectedRevenue: number;
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
    "รายได้ค่าที่พักของการจองที่เริ่มเข้าพักในเดือนที่เลือก และรายการต่อคืนที่เริ่มในเดือนนั้น หลังหักรายการลด โดยนับเต็มยอดในเดือนที่เริ่มและไม่แบ่งข้ามเดือน",
  collectedRevenue:
    "ส่วนของ ESR เดือนที่เลือกที่รับเงินแล้วจริง ไม่รวมยอดค้างชำระและค่าธรรมเนียมบัตร",
  todayCollectedRevenue:
    "เงินที่รับแล้วสำหรับการจองที่เช็คอินวันนี้เท่านั้น ไม่ว่าจะรับชำระวันไหน",
  todayRevenue:
    "มูลค่าการเข้าพักทั้งหมดของผู้ที่เช็คอินวันนี้ รวมบริการเสริมที่ขายวันนี้ หลังหักรายการคืนเงินและรายการลดวันนี้",
  unpaid: "ยอดจองที่ยังไม่ได้รับเงินจากลูกค้า",
  cashToday: "เงินสดรับ ลบ เงินสดจ่าย สำหรับวันที่เลือก",
  occupancy:
    "เปอร์เซ็นต์เตียงที่ถูกจองตลอดเดือนที่เลือกเทียบกับเตียงที่เปิดขาย รวมการจองล่วงหน้า โดยห้องส่วนตัวที่ถูกจองจะนับเต็มความจุของห้อง",
  checkedInBeds:
    "จำนวนเตียงที่เช็คอินอยู่ตอนนี้ โดยห้องส่วนตัวจะนับเต็มความจุของห้อง",
};

const ExpectedStayRevenueInfo = () => (
  <AppTooltip
    className="main__metricInfo"
    content={dashboardHelpText.bookedRevenue}
    ariaLabel={dashboardHelpText.bookedRevenue}
    stopClickPropagation
  >
    <i className="bx bx-info-circle" />
  </AppTooltip>
);

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

const formatMoney = (value: number) =>
  value.toLocaleString("th-TH", {
    minimumFractionDigits: value % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });

const toCumulativeRevenueSeries = (
  series: AdminDashboardStats["esrSeries"],
) => {
  let cumulativeRevenue = 0;

  return series.map((point) => {
    cumulativeRevenue += point.grossRevenue;
    return { ...point, grossRevenue: cumulativeRevenue };
  });
};

const bangkokMonthKey = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value;
  return `${value("year")}-${value("month")}`;
};

const formatEnglishMonthLabel = (monthKey: string) =>
  new Intl.DateTimeFormat("en-GB", {
    month: "long",
    calendar: "gregory",
    year: "numeric",
    timeZone: "Asia/Bangkok",
  }).format(new Date(`${monthKey}-01T00:00:00+07:00`));

const formatTrendAxisLabel = (
  label: string,
  metric: ChartMetric,
  range: RevenueRange,
) =>
  metric === "occupancy" && range === "1y"
    ? label.replace(/^\d+\s+/, "")
    : label;

const TrendLineChart = ({
  series,
  metric,
  range,
}: {
  series:
    | AdminDashboardStats["revenueSeries"]
    | AdminDashboardStats["esrSeries"];
  metric: ChartMetric;
  range: RevenueRange;
}) => (
  <div className="main__chartWrapper">
    <ResponsiveContainer width="100%" height={260}>
      <ComposedChart
        data={series.map((point) => {
          const date = new Date(`${point.date}T00:00:00`);

          return {
            ...point,
            occupancyPercent:
              ("occupancyRate" in point ? point.occupancyRate : 0) * 100,
            label: new Intl.DateTimeFormat("en-GB", {
              day: "numeric",
              month: "short",
              calendar: "gregory",
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
          tickFormatter={(label) =>
            formatTrendAxisLabel(String(label), metric, range)
          }
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
  dateFormat,
}: {
  title: string;
  icon: string;
  bookings: Array<booking | ReviewBooking>;
  emptyText: string;
  onBookingClick: (booking: booking) => void;
  isBookingsThatNeedReview?: boolean;
  dateFormat: DateFormatPreference;
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
                          {formatPreferredDate(
                            getReviewDate(booking),
                            dateFormat,
                            { includeYear: false },
                          )}
                          {" · "}
                          <strong className="main__bookingReviewAge">
                            {getReviewOverdueLabel(booking)}
                          </strong>
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="main__bookingMetaLine">
                          {formatPreferredDate(booking.checkIn, dateFormat, {
                            includeYear: false,
                          })}{" "}
                          -{" "}
                          {formatPreferredDate(booking.checkOut, dateFormat, {
                            includeYear: false,
                          })}
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
  usePageTitle("HostelFlow · Home");
  const { user, resolveStaffName } = useAuth();
  const currentUsername = user?.username;
  const dateFormat = user?.settings.dateFormat || "dd/MM/yyyy";
  const navigate = useNavigate();
  const location = useLocation();
  const [arrivals, setArrivals] = useState<booking[]>([]);
  const [departures, setDepartures] = useState<booking[]>([]);
  const [bookingsThatNeedReview, setBookingsThatNeedReview] = useState<
    ReviewBooking[]
  >([]);
  const [occupancy, setOccupancy] = useState(0);
  const [loading, setLoading] = useState(true);
  const [adminLoading, setAdminLoading] = useState(false);
  const [todayRevenueLoading, setTodayRevenueLoading] = useState(false);
  const [todayRevenueStats, setTodayRevenueStats] =
    useState<TodayRevenueStats | null>(null);
  const [adminStats, setAdminStats] = useState<AdminDashboardStats | null>(
    null,
  );
  const adminRequestIdRef = useRef(0);
  const dashboardMonthInputRef = useRef<HTMLInputElement>(null);
  const currentDashboardMonth = bangkokMonthKey();
  const [dashboardMonth, setDashboardMonth] = useState(currentDashboardMonth);
  const [revenueRange, setRevenueRange] = useState<RevenueRange>("1m");
  const [chartMetric, setChartMetric] = useState<ChartMetric>("occupancy");
  const [cashCloseLoading, setCashCloseLoading] = useState(false);
  const [cashCloseSaving, setCashCloseSaving] = useState(false);
  const [cashPosition, setCashPosition] = useState<CashPositionData | null>(
    null,
  );
  const [operatingOpeningCash, setOperatingOpeningCash] = useState("0");
  const [operatingActualCash, setOperatingActualCash] = useState("");
  const [recountHandoff, setRecountHandoff] = useState(false);
  const [cashCloseExpanded, setCashCloseExpanded] = useState(false);
  const [closeNote, setCloseNote] = useState("");
  const [addBookingIsOpen, setAddBookingIsOpen] = useState(false);
  const [standaloneSaleIsOpen, setStandaloneSaleIsOpen] = useState(false);
  const [depositReminderIsOpen, setDepositReminderIsOpen] = useState(false);
  const [reopenFinalShiftIsOpen, setReopenFinalShiftIsOpen] = useState(false);
  const [addBookingIsDirty, setAddBookingIsDirty] = useState(false);
  const [financialBreakdownMode, setFinancialBreakdownMode] = useState<
    "monthly" | "today" | null
  >(null);
  const [financialBreakdownType, setFinancialBreakdownType] =
    useState<TransactionType | null>(null);
  const [pendingUnsavedClose, setPendingUnsavedClose] = useState<
    (() => void) | null
  >(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [headerNow, setHeaderNow] = useState(() => new Date());

  const fullFormattedDate = formatDashboardHeaderDate(headerNow);

  useEffect(() => {
    const interval = window.setInterval(() => setHeaderNow(new Date()), 60_000);
    return () => window.clearInterval(interval);
  }, []);

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
    const requestId = ++adminRequestIdRef.current;
    if (!user?.admin) {
      setAdminStats(null);
      setAdminLoading(false);
      return;
    }

    setAdminLoading(true);
    try {
      const response = await axios.get<AdminDashboardStats>(
        `${API_URL}/bookings/getAdminDashboardStats`,
        {
          params: { revenueRange, month: dashboardMonth },
          withCredentials: true,
        },
      );

      if (requestId !== adminRequestIdRef.current) return;
      setAdminStats(response.data);
    } catch (err) {
      if (requestId !== adminRequestIdRef.current) return;
      setAdminStats(null);
      toast.error(getFetchErrorMessage(err));
    } finally {
      if (requestId === adminRequestIdRef.current) {
        setAdminLoading(false);
      }
    }
  }, [dashboardMonth, revenueRange, user?.admin]);

  const fetchTodayRevenue = useCallback(async () => {
    setTodayRevenueLoading(true);
    try {
      const response = await axios.get<TodayRevenueStats>(
        `${API_URL}/finance/today-revenue-summary`,
        { withCredentials: true },
      );
      setTodayRevenueStats(response.data);
    } catch (err) {
      setTodayRevenueStats(null);
      toast.error(getFetchErrorMessage(err));
    } finally {
      setTodayRevenueLoading(false);
    }
  }, []);

  const fetchCashClose = useCallback(async () => {
    setCashCloseLoading(true);
    try {
      const positionResponse = await axios.get(
        `${API_URL}/finance/cash-position`,
        {
          withCredentials: true,
        },
      );

      const nextPosition = positionResponse.data as CashPositionData;
      setCashPosition(nextPosition);
      setOperatingOpeningCash(String(nextPosition.handoff.operatingCash || 0));
      setOperatingActualCash("");
      setCloseNote("");
      setRecountHandoff(false);
      const previousShiftBelongsToCurrentStaff =
        nextPosition.previousShift?.staffUsername === currentUsername;
      setCashCloseExpanded(
        !nextPosition.previousShift ||
          Boolean(nextPosition.activeShift) ||
          !previousShiftBelongsToCurrentStaff,
      );
    } catch (err) {
      setCashPosition(null);
      toast.error(getFetchErrorMessage(err));
    } finally {
      setCashCloseLoading(false);
    }
  }, [currentUsername]);

  const refreshDashboard = useCallback(async () => {
    await fetchDailyOps();
    await fetchTodayRevenue();
    await fetchAdminStats();
    await fetchCashClose();
  }, [fetchAdminStats, fetchCashClose, fetchDailyOps, fetchTodayRevenue]);

  useEffect(() => {
    fetchDailyOps().catch((err) => toast.error(getFetchErrorMessage(err)));
  }, [fetchDailyOps]);

  useEffect(() => {
    fetchAdminStats();
  }, [fetchAdminStats]);

  useEffect(() => {
    fetchTodayRevenue();
  }, [fetchTodayRevenue]);

  useEffect(() => {
    fetchCashClose();
  }, [fetchCashClose]);

  useEffect(() => {
    if (location.hash !== "#cash-close") return;

    const timeoutId = window.setTimeout(() => {
      document
        .getElementById("cash-close")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [location.hash]);

  const activeCashShift = cashPosition?.activeShift || null;
  const previousCashShift = cashPosition?.previousShift || null;
  const cashShiftIsOpen = Boolean(activeCashShift);
  const cashDayIsFinalized = Boolean(previousCashShift?.isFinalDayClose);
  const finalCloseRecovery = cashPosition?.finalCloseRecovery || null;
  const canCloseActiveShift = Boolean(
    activeCashShift &&
    (user?.admin || activeCashShift.staffUsername === currentUsername),
  );
  const hasPreviousCashShift = Boolean(previousCashShift);
  const previousShiftBelongsToCurrentStaff =
    previousCashShift?.staffUsername === currentUsername;
  const cashCloseIsComplete =
    !activeCashShift &&
    hasPreviousCashShift &&
    previousShiftBelongsToCurrentStaff;
  const cashCloseIsCollapsed = cashCloseIsComplete && !cashCloseExpanded;
  const operatingExpectedCash = activeCashShift?.operatingExpectedCash || 0;
  const operatingVariance =
    operatingActualCash === ""
      ? 0
      : Number(operatingActualCash || 0) - operatingExpectedCash;
  const ordinaryCloseVarianceNeedsNote = Boolean(
    cashPosition && Math.abs(operatingVariance) > cashPosition.threshold,
  );
  const finalDayCloseCashIsInvalid =
    operatingActualCash === "" ||
    !Number.isFinite(Number(operatingActualCash)) ||
    Number(operatingActualCash) < 0;
  const openingVarianceNeedsNote = Boolean(
    cashPosition &&
    Math.abs(
      Number(operatingOpeningCash || 0) - cashPosition.handoff.operatingCash,
    ) > cashPosition.threshold,
  );
  const activeShiftStaffName =
    activeCashShift?.staff?.name ||
    resolveStaffName(activeCashShift?.staffUsername);
  const previousShiftStaffName =
    previousCashShift?.staff?.name ||
    resolveStaffName(previousCashShift?.staffUsername);
  const cashShiftTitle = activeCashShift
    ? `กะของ ${activeShiftStaffName} เปิดอยู่`
    : cashDayIsFinalized
      ? "ปิดยอดวันนี้แล้ว"
      : hasPreviousCashShift
        ? `รับต่อจาก ${previousShiftStaffName || "กะก่อนหน้า"}`
        : "เริ่มกะแรกของวันนี้";
  const cashShiftSubtitle = activeCashShift
    ? ""
    : cashDayIsFinalized
      ? finalCloseRecovery?.eligible
        ? "หากมีเงินสดเข้าหลังปิดยอด ให้เปิดกะเดิมอีกครั้งแล้วปิดยอดใหม่"
        : finalCloseRecovery?.denialReason?.message ||
          "ไม่สามารถเปิดกะเพิ่มในวันที่ปิดยอดสุดท้ายแล้ว"
      : hasPreviousCashShift
        ? "รับยอดปิดกะก่อนหน้า หรือเลือกนับใหม่ถ้าเงินไม่ตรง"
        : "นับเงินสดทั่วไปก่อนเริ่มรับผิดชอบกะ";
  const cashShiftActionTitle = activeCashShift
    ? "ปิดกะ"
    : cashDayIsFinalized
      ? finalCloseRecovery?.eligible
        ? "เปิดกะอีกครั้ง"
        : "ปิดยอดวันนี้แล้ว"
      : hasPreviousCashShift && !recountHandoff
        ? "รับส่งเงิน"
        : "นับเงินเริ่มกะ";

  const startCashShift = async (
    openingMode: "counted" | "accepted_handoff",
  ) => {
    if (
      openingMode === "counted" &&
      openingVarianceNeedsNote &&
      !closeNote.trim()
    ) {
      throw new Error("กรุณาระบุหมายเหตุเมื่อยอดรับส่งเงินไม่ตรงกัน");
    }
    setCashCloseSaving(true);
    try {
      await axios.post(
        `${API_URL}/finance/cash-shifts/start`,
        {
          openingMode,
          operatingOpeningCash: Number(operatingOpeningCash || 0),
          note: closeNote.trim(),
        },
        { withCredentials: true },
      );
      await fetchCashClose();
    } finally {
      setCashCloseSaving(false);
    }
  };

  const closeCashShift = async (
    closeDay = false,
    depositReminder?: { calculationToken: string },
  ) => {
    if (!activeCashShift) {
      throw new Error("ยังไม่มีกะเงินสดที่เปิดอยู่");
    }
    if (!canCloseActiveShift) {
      throw new Error("เฉพาะผู้รับผิดชอบกะหรือผู้ดูแลระบบเท่านั้นที่ปิดกะได้");
    }
    if (operatingActualCash === "") {
      throw new Error("กรุณากรอกยอดเงินสดที่นับได้");
    }

    if (
      cashPosition &&
      Math.abs(operatingVariance) > cashPosition.threshold &&
      !closeNote.trim()
    ) {
      throw new Error("กรุณาระบุหมายเหตุเมื่อยอดเงินสดไม่ตรงกัน");
    }

    setCashCloseSaving(true);
    try {
      await axios.post(
        `${API_URL}/finance/cash-shifts/${activeCashShift._id}/close`,
        {
          operatingActualCash: Number(operatingActualCash || 0),
          closeDay,
          note: closeNote.trim(),
          ...(closeDay && depositReminder
            ? {
                depositReminderToken: depositReminder.calculationToken,
              }
            : {}),
        },
        { withCredentials: true },
      );
      await fetchCashClose();
    } finally {
      setCashCloseSaving(false);
    }
  };

  const reopenFinalCashShift = async (input: {
    reason: string;
    expectedLedgerRevision: number;
    idempotencyKey: string;
  }) => {
    if (!finalCloseRecovery) throw new Error("ไม่พบยอดปิดที่เปิดใหม่ได้");
    setCashCloseSaving(true);
    try {
      await axios.post(
        `${API_URL}/finance/cash-shifts/${finalCloseRecovery.shiftId}/reopen-final`,
        {
          reason: input.reason,
          expectedLedgerRevision: input.expectedLedgerRevision,
        },
        {
          withCredentials: true,
          headers: { "Idempotency-Key": input.idempotencyKey },
        },
      );
      await fetchCashClose();
      toast.success("เปิดกะอีกครั้งแล้ว");
    } catch (err) {
      if (axios.isAxiosError(err)) {
        throw new Error(
          err.response?.data?.message || "ไม่สามารถเปิดกะอีกครั้งได้",
        );
      }
      throw err;
    } finally {
      setCashCloseSaving(false);
    }
  };

  const unpaidArrivals = arrivals.filter(
    (booking) => roomChargeOutstandingAmount(booking) > 0,
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
      label: "เตียงที่เช็คอินอยู่ตอนนี้",
      value: occupancy,
      helperText: dashboardHelpText.checkedInBeds,
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
      valueColor: "var(--red)",
    },
  ];
  const revenueChartSeries = adminStats
    ? toCumulativeRevenueSeries(adminStats.esrSeries)
    : [];
  const chartRevenueTotal =
    revenueChartSeries[revenueChartSeries.length - 1]?.grossRevenue || 0;
  const todayServiceHighlights = [
    ...(todayRevenueStats?.todayServiceHighlights || []),
  ]
    .filter((service) => service.count > 0)
    .sort((first, second) => {
      const firstPriority = priorityTodayServiceTypes.indexOf(first.type);
      const secondPriority = priorityTodayServiceTypes.indexOf(second.type);
      const normalizedFirstPriority =
        firstPriority === -1 ? Number.MAX_SAFE_INTEGER : firstPriority;
      const normalizedSecondPriority =
        secondPriority === -1 ? Number.MAX_SAFE_INTEGER : secondPriority;

      return (
        normalizedFirstPriority - normalizedSecondPriority ||
        second.total - first.total
      );
    })
    .slice(0, 6);
  const occupancyFillPercent = Math.min(Math.max(occupancyRatePercent, 0), 100);
  const dashboardMonthLabel = formatEnglishMonthLabel(dashboardMonth);
  const dashboardMonthIsCurrent = dashboardMonth === currentDashboardMonth;
  const chartTitle =
    chartMetric === "revenue"
      ? "ESR เดือนที่เลือก"
      : occupancyRangeTitleMap[revenueRange];
  const chartSummary =
    chartMetric === "revenue"
      ? `${chartRevenueTotal.toLocaleString()} ฿`
      : `${formatMoney((adminStats?.rangeOccupancyRate || 0) * 100)}%`;

  const appendToBookings = () => {
    setAddBookingIsOpen(false);
    refreshDashboard().catch((err) => toast.error(getFetchErrorMessage(err)));
  };

  const openBookingInMaster = (booking: booking) => {
    navigate(`/master?bookingId=${encodeURIComponent(booking.bookingId)}`);
  };

  const openArrivalBooking = (booking: booking) => {
    navigate(`/arrivals?bookingId=${encodeURIComponent(booking.bookingId)}`);
  };

  const openDepartureBooking = (booking: booking) => {
    navigate(`/departures?bookingId=${encodeURIComponent(booking.bookingId)}`);
  };

  return (
    <main className="home main">
      <Modal
        open={depositReminderIsOpen}
        className="home__modalCenter"
        onClose={() => setDepositReminderIsOpen(false)}
      >
        {cashPosition ? (
          <DepositReturnReminderModal
            businessDate={cashPosition.businessDate}
            closingCashAmount={Number(operatingActualCash)}
            dateFormat={dateFormat}
            onClose={() => setDepositReminderIsOpen(false)}
            onConfirm={(calculationToken) =>
              closeCashShift(true, { calculationToken })
            }
          />
        ) : (
          <div />
        )}
      </Modal>
      <Modal
        open={reopenFinalShiftIsOpen}
        className="home__modalCenter"
        onClose={() => setReopenFinalShiftIsOpen(false)}
      >
        {finalCloseRecovery ? (
          <ReopenFinalCashShiftModal
            recovery={finalCloseRecovery}
            onClose={() => setReopenFinalShiftIsOpen(false)}
            onConfirm={reopenFinalCashShift}
          />
        ) : (
          <div />
        )}
      </Modal>
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
        open={standaloneSaleIsOpen}
        className="home__modalCenter"
        onClose={() => setStandaloneSaleIsOpen(false)}
      >
        <StandaloneSaleModal
          onClose={() => setStandaloneSaleIsOpen(false)}
          onSaved={() => {
            void refreshDashboard();
          }}
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
        open={financialBreakdownMode !== null}
        className="home__modalCenter"
        onClose={() => {
          setFinancialBreakdownMode(null);
          setFinancialBreakdownType(null);
        }}
      >
        <FinancialBreakdown
          key={`${financialBreakdownMode}-${financialBreakdownType || "all"}-${dashboardMonth}`}
          mode={financialBreakdownMode || "monthly"}
          month={dashboardMonth}
          initialType={financialBreakdownType}
          onClose={() => {
            setFinancialBreakdownMode(null);
            setFinancialBreakdownType(null);
          }}
        />
      </Modal>
      <PageHeader
        title={fullFormattedDate}
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
          text="เพิ่มรายการใช้จ่ายแขกนอก"
          icon="bx-dollar"
          onClick={() => setStandaloneSaleIsOpen(true)}
          // highlight
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
              valueColor={stat.valueColor}
            />
          </div>
        ))}
      </section>

      <section className="main__todayFinanceSection" aria-label="ภาพรวมวันนี้">
        <section
          className="main__adminPanel main__todayRevenue"
          onClick={() => {
            setFinancialBreakdownType(null);
            setFinancialBreakdownMode("today");
          }}
          onKeyDown={(event) => {
            if (event.target !== event.currentTarget) return;
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            setFinancialBreakdownType(null);
            setFinancialBreakdownMode("today");
          }}
          role="button"
          tabIndex={0}
          aria-label="ดูรายละเอียดรายได้วันนี้"
        >
          {/* <div className="main__todayRevenueEyebrow">
            <span>TODAY</span>
          </div> */}
          <div className="main__todayRevenueHeader">
            <h2 title={dashboardHelpText.todayRevenue}>รายได้วันนี้</h2>
            <strong>
              {todayRevenueLoading && !todayRevenueStats
                ? "-"
                : `${formatMoney(todayRevenueStats?.todayRevenue || 0)} ฿`}
            </strong>
          </div>
          <div className="main__todayRevenueBreakdown">
            <div>
              <span>การจองที่เช็คอินวันนี้</span>
              <strong>
                {formatMoney(todayRevenueStats?.todayArrivalRevenue || 0)} ฿
              </strong>
            </div>
            <div>
              <span>บริการเสริมวันนี้</span>
              <strong>
                {formatMoney(todayRevenueStats?.todayExtrasRevenue || 0)} ฿
              </strong>
            </div>
            <div>
              <span>คืนเงิน/รายการลดวันนี้</span>
              <strong className="main__todayRevenueReduction">
                −{formatMoney(todayRevenueStats?.todayReductions || 0)} ฿
              </strong>
            </div>
            <div>
              <span title={dashboardHelpText.todayCollectedRevenue}>
                รับแล้วสำหรับเช็คอินวันนี้
              </span>
              <strong className="main__todayCollectedRevenue">
                {formatMoney(todayRevenueStats?.todayCollectedRevenue || 0)} ฿
              </strong>
            </div>
          </div>
          {todayServiceHighlights.length > 0 && (
            <div className="main__todayServiceStrip">
              <div className="main__todayServiceChips">
                {todayServiceHighlights.map((service) => {
                  const meta = serviceHighlightMeta[service.type] || {
                    label: formatServiceType(service.type),
                    icon: "bx-receipt",
                    color: "var(--primary-color)",
                  };

                  return (
                    <button
                      className="main__todayServiceChip"
                      key={service.type}
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        setFinancialBreakdownType(service.type);
                        setFinancialBreakdownMode("today");
                      }}
                      style={
                        {
                          "--service-color": meta.color,
                        } as React.CSSProperties
                      }
                    >
                      <i className={`bx ${meta.icon}`} />
                      <span>{meta.label}</span>
                      <strong>{service.count}</strong>
                    </button>
                  );
                })}
              </div>
              <span className="main__todayDetailsLink">รายละเอียด ›</span>
            </div>
          )}
        </section>
      </section>

      {user?.admin && (adminStats || adminLoading) && (
        <section className="main__adminSection">
          <div className="main__adminHeader">
            <div>
              <i className="bx bx-bar-chart-big" />
              <h2>ผลการดำเนินงานรายเดือน</h2>
            </div>
            <label
              className="main__adminMonthPicker"
              onClick={(event) => {
                const monthInput = dashboardMonthInputRef.current;
                if (
                  !monthInput ||
                  typeof monthInput.showPicker !== "function"
                ) {
                  return;
                }
                event.preventDefault();
                monthInput.focus();
                monthInput.showPicker();
              }}
            >
              <span>เลือกเดือน</span>
              <input
                ref={dashboardMonthInputRef}
                type="month"
                value={dashboardMonth}
                max={currentDashboardMonth}
                aria-label="เลือกเดือนสำหรับผลการดำเนินงาน"
                onChange={(event) => {
                  if (!event.target.value) return;
                  setAdminLoading(true);
                  setAdminStats(null);
                  setDashboardMonth(event.target.value);
                }}
              />
            </label>
          </div>

          <div className="main__adminDashboardGrid">
            <div className="main__adminPrimaryColumn">
              <section
                className="main__adminPanel main__revenueHero"
                onClick={() => setFinancialBreakdownMode("monthly")}
              >
                <div className="main__adminPanelHeader">
                  <div>
                    <div className="main__metricTitle">
                      <h3>Expected Stay Revenue</h3>
                      <ExpectedStayRevenueInfo />
                    </div>
                  </div>
                  <p>
                    {dashboardMonthIsCurrent ? "เดือนนี้" : dashboardMonthLabel}
                  </p>
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
                            onClick={() => {
                              setChartMetric(option.value);
                              if (option.value === "revenue") {
                                setRevenueRange("mtd");
                              }
                            }}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                      {chartMetric === "occupancy" && (
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
                      )}
                    </div>
                  </div>
                  <TrendLineChart
                    metric={chartMetric}
                    range={revenueRange}
                    series={
                      chartMetric === "revenue"
                        ? revenueChartSeries
                        : adminStats.revenueSeries
                    }
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
                  <p>ทั้งเดือน</p>
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

              {adminStats && (
                <section className="main__adminPanel main__channelPanel">
                  <div className="main__adminPanelHeader">
                    <div>
                      <span>Bookings by channel</span>
                      <h3>ช่องทางการจอง</h3>
                    </div>
                    <p>{adminStats.monthBookings} การจอง</p>
                  </div>
                  <div className="main__channelList">
                    {adminStats.channelMix.length === 0 ? (
                      <div className="main__emptyState">
                        <i className="bx bx-info-circle" />
                        <p>ยังไม่มีรายการจองในเดือนที่เลือก</p>
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

      <section className="main__cashCloseSection" id="cash-close">
        <div className="main__cashCloseHero">
          <div
            className={
              cashCloseIsComplete
                ? "main__cashCloseHeroIcon main__cashCloseHeroIcon--complete"
                : "main__cashCloseHeroIcon"
            }
          >
            <i
              className={
                cashCloseIsComplete ? "bx bx-check" : "bx bx-currency-notes"
              }
            />
          </div>
          <div>
            <h2>{cashCloseIsComplete ? "ปิดกะเงินสดแล้ว" : cashShiftTitle}</h2>
            {!cashCloseIsComplete && cashShiftSubtitle ? (
              <span>{cashShiftSubtitle}</span>
            ) : null}
          </div>
          <div className="main__cashCloseHeroMeta">
            <strong
              className={
                cashCloseIsComplete
                  ? "main__cashCloseBadge main__cashCloseBadge--complete"
                  : cashShiftIsOpen
                    ? "main__cashCloseBadge main__cashCloseBadge--open"
                    : "main__cashCloseBadge"
              }
            >
              {cashCloseIsComplete
                ? "เรียบร้อย"
                : cashShiftIsOpen
                  ? "เปิดกะ"
                  : "พร้อมเริ่ม"}
            </strong>
            {activeCashShift && activeShiftStaffName ? (
              <div className="main__cashCloseStaffChip">
                <img
                  src={profilePictureUrl(
                    activeCashShift.staff?.profilePictureUrl,
                  )}
                  alt=""
                />
                <span>{activeShiftStaffName}</span>
              </div>
            ) : null}
          </div>
        </div>

        {cashCloseIsCollapsed ? (
          <button
            className="main__cashCloseExpandButton"
            type="button"
            onClick={() => setCashCloseExpanded(true)}
          >
            <span>ต้องแก้ไขหรือทำรายการเงินสดเพิ่ม?</span>
            <strong>เปิดรายละเอียด</strong>
            <i className="bx bx-chevron-down" />
          </button>
        ) : (
          <div className="main__cashCloseGrid">
            <div className="main__cashCloseOverview">
              <div className="main__cashCloseTile main__cashCloseTile--operating">
                <div className="main__cashCloseTileHeader">
                  <i className="bx bx-wallet" />
                  <span>รายได้เงินสด</span>
                </div>
                <strong>
                  {cashCloseLoading
                    ? "-"
                    : `${formatMoney(cashPosition?.current.operatingCash || 0)} ฿`}
                </strong>
              </div>
            </div>

            <div className="main__cashCloseActionPanel">
              <div className="main__cashCloseActionHeader">
                <p>ขั้นตอนต่อไป</p>
                <h3>{cashShiftActionTitle}</h3>
              </div>
              <div className="main__cashCloseForm">
                {activeCashShift ? (
                  <label>
                    <span>เงินสดที่นับได้</span>
                    <input
                      className="boxInput"
                      type="number"
                      min="0"
                      disabled={!canCloseActiveShift}
                      value={operatingActualCash}
                      placeholder={`${formatMoney(operatingExpectedCash)} คาดไว้`}
                      onChange={(event) =>
                        setOperatingActualCash(event.target.value)
                      }
                    />
                  </label>
                ) : !cashDayIsFinalized ? (
                  <label>
                    <span>เงินสดเริ่มกะ</span>
                    <input
                      className="boxInput"
                      type="number"
                      min="0"
                      value={operatingOpeningCash}
                      disabled={hasPreviousCashShift && !recountHandoff}
                      onChange={(event) =>
                        setOperatingOpeningCash(event.target.value)
                      }
                    />
                  </label>
                ) : null}
                {!cashDayIsFinalized &&
                  (ordinaryCloseVarianceNeedsNote ||
                    openingVarianceNeedsNote) && (
                    <label className="main__cashCloseNote">
                      <span>หมายเหตุยอดต่าง</span>
                      <input
                        className="boxInput"
                        type="text"
                        value={closeNote}
                        placeholder="เช่น รับส่งเงินไม่ตรง / พบเงินเกิน"
                        onChange={(event) => setCloseNote(event.target.value)}
                      />
                    </label>
                  )}
                {!activeCashShift &&
                  !cashDayIsFinalized &&
                  hasPreviousCashShift && (
                    <label className="checkbox main__cashCloseToggle">
                      นับใหม่แทนรับส่ง
                      <input
                        type="checkbox"
                        checked={recountHandoff}
                        onChange={(event) => {
                          setRecountHandoff(event.target.checked);
                          if (!event.target.checked && cashPosition) {
                            setOperatingOpeningCash(
                              String(cashPosition.handoff.operatingCash || 0),
                            );
                          }
                        }}
                      />
                      <span className="box"></span>
                    </label>
                  )}
                <div className="main__cashCloseActions">
                  <ActionButton
                    text={
                      activeCashShift
                        ? "ปิดเฉพาะกะ"
                        : cashDayIsFinalized
                          ? finalCloseRecovery?.eligible
                            ? "เปิดกะอีกครั้ง"
                            : "ปิดยอดวันนี้แล้ว"
                          : hasPreviousCashShift && !recountHandoff
                            ? "รับส่งเงินและเริ่มกะ"
                            : "เริ่มกะเงินสด"
                    }
                    icon={
                      cashDayIsFinalized && finalCloseRecovery?.eligible
                        ? "bx-undo"
                        : "bx-save"
                    }
                    highlight
                    disabled={
                      cashCloseSaving ||
                      cashCloseLoading ||
                      (cashDayIsFinalized && !finalCloseRecovery?.eligible) ||
                      Boolean(activeCashShift && !canCloseActiveShift)
                    }
                    onClick={() => {
                      if (cashDayIsFinalized && finalCloseRecovery?.eligible) {
                        setReopenFinalShiftIsOpen(true);
                        return;
                      }
                      toast.promise(
                        activeCashShift
                          ? closeCashShift(false)
                          : startCashShift(
                              hasPreviousCashShift && !recountHandoff
                                ? "accepted_handoff"
                                : "counted",
                            ),
                        {
                          loading: "กำลังบันทึกกะเงินสด",
                          success: "บันทึกกะเงินสดเรียบร้อย",
                          error: (err) => {
                            if (axios.isAxiosError(err)) {
                              return (
                                err.response?.data?.message ||
                                "เกิดข้อผิดพลาดในการบันทึกกะเงินสด"
                              );
                            }
                            if (err instanceof Error) return err.message;
                            return "เกิดข้อผิดพลาดในการบันทึกกะเงินสด";
                          },
                        },
                      );
                    }}
                  />
                  {activeCashShift && (
                    <ActionButton
                      text="ปิดยอดวันนี้"
                      icon="bx-moon"
                      disabled={
                        cashCloseSaving ||
                        !canCloseActiveShift ||
                        finalDayCloseCashIsInvalid
                      }
                      onClick={() => setDepositReminderIsOpen(true)}
                    />
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </section>

      <div className="main__todayGrid">
        {bookingsThatNeedReview.length > 0 ? (
          <TodayList
            title="ต้องตรวจสอบ"
            icon="bx-alert-circle"
            bookings={bookingsThatNeedReview}
            emptyText="ไม่มีรายการจองที่ต้องตรวจสอบ"
            isBookingsThatNeedReview={true}
            onBookingClick={openBookingInMaster}
            dateFormat={dateFormat}
          />
        ) : (
          <TodayList
            title="เช็คอินวันนี้"
            icon="bx-arrow-to-left"
            bookings={arrivals}
            emptyText="ไม่มีเช็คอินที่ต้องจัดการวันนี้"
            onBookingClick={openArrivalBooking}
            dateFormat={dateFormat}
          />
        )}
        <div className="main__todayStack">
          {bookingsThatNeedReview.length > 0 && (
            <TodayList
              title="เช็คอินวันนี้"
              icon="bx-arrow-to-left"
              bookings={arrivals}
              emptyText="ไม่มีเช็คอินที่ต้องจัดการวันนี้"
              onBookingClick={openArrivalBooking}
              dateFormat={dateFormat}
            />
          )}
          <TodayList
            title="เช็คเอาท์วันนี้"
            icon="bx-arrow-from-left"
            bookings={departures}
            emptyText="ไม่มีเช็คเอาท์ที่ต้องจัดการวันนี้"
            onBookingClick={openDepartureBooking}
            dateFormat={dateFormat}
          />
        </div>
      </div>
    </main>
  );
};

export default Main;
