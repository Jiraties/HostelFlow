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
import PageHeader from "../components/PageHeader";
import StatCard from "../features/dashboard/StatCard";
import { useAuth } from "../context/AuthContext";
import {
  formatBookingsDates,
  truncateDecimal,
} from "../helpers/bookingHelpers";
import { platformMap } from "../helpers/maps";
import { API_URL } from "../config/api";

import type { booking, PlatformId } from "../types/bookingTypes";

import "./Home.css";
import "./Main.css";

const getFetchErrorMessage = (err: unknown) => {
  if (axios.isAxiosError(err) && err.response?.data?.message) {
    return err.response.data.message;
  }

  return "เกิดข้อผิดพลาดในการโหลดข้อมูล";
};

const roomChargeTransaction = (booking: booking) =>
  booking.transactions.find((transaction) => transaction.type === "roomCharge");

const sumBookingTransactions = (
  booking: booking,
  predicate: (transaction: booking["transactions"][number]) => boolean,
) =>
  booking.transactions.reduce(
    (sum, transaction) =>
      predicate(transaction) ? sum + transaction.amount : sum,
    0,
  );

const getDepositToReturn = (bookings: booking[]) =>
  bookings.reduce((sum, booking) => {
    const deposits = sumBookingTransactions(
      booking,
      (transaction) => transaction.type === "deposit",
    );
    const refundedDeposits = sumBookingTransactions(
      booking,
      (transaction) => transaction.type === "depositRefund",
    );

    return sum + Math.max(deposits - refundedDeposits, 0);
  }, 0);

const formatDisplayDate = (date: Date) =>
  new Intl.DateTimeFormat("th-TH", {
    calendar: "gregory",
    day: "numeric",
    month: "short",
  }).format(date);

type AdminDashboardStats = {
  todayExpectedRevenue: number;
  monthRoomRevenue: number;
  monthBookings: number;
  unpaidAmount: number;
  occupancyRate: number;
  channelMix: Array<{
    platformId: PlatformId;
    count: number;
  }>;
  revenueSeries: Array<{
    date: string;
    revenue: number;
  }>;
};

const formatCompactNumber = (value: number) =>
  new Intl.NumberFormat("th-TH", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);

const formatCurrency = (value: number) => `${value.toLocaleString("th-TH")} ฿`;

const RevenueLineChart = ({
  series,
}: {
  series: AdminDashboardStats["revenueSeries"];
}) => (
  <div className="main__chartWrapper">
    <ResponsiveContainer width="100%" height={260}>
      <ComposedChart
        data={series.map((point) => {
          const date = new Date(`${point.date}T00:00:00`);

          return {
            ...point,
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
          tick={{ fill: "#777777", fontSize: 12 }}
          tickFormatter={(value) => formatCompactNumber(Number(value))}
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
          formatter={(value) => [formatCurrency(Number(value)), "รายได้"]}
          labelFormatter={(label) => String(label)}
        />
        <Area
          type="monotone"
          dataKey="revenue"
          stroke="none"
          fill="var(--primary-color)"
          fillOpacity={0.12}
          activeDot={false}
        />
        <Line
          type="monotone"
          dataKey="revenue"
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
}: {
  title: string;
  icon: string;
  bookings: booking[];
  emptyText: string;
}) => (
  <section className="main__todaySection">
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
        bookings.slice(0, 6).map((booking) => {
          const roomNames = booking.roomStays
            .map((roomStay) => roomStay.roomId)
            .join(", ");
          const roomCharge = roomChargeTransaction(booking);
          const platform = platformMap[booking.platformId];

          return (
            <div className="main__bookingItem" key={booking.bookingId}>
              <div className="main__bookingPrimary">
                <h3>{booking.name}</h3>
                <p>{roomNames || "ยังไม่มีห้อง"}</p>
              </div>
              <div className="main__bookingMeta">
                <span style={{ color: platform?.color }}>
                  {platform?.label || booking.platformId}
                </span>
                <span>
                  {formatDisplayDate(booking.checkIn)} -{" "}
                  {formatDisplayDate(booking.checkOut)}
                </span>
                {roomCharge?.paymentMethod === "Unpaid" && (
                  <strong>ยังไม่ชำระเงิน</strong>
                )}
              </div>
            </div>
          );
        })
      )}
    </div>
  </section>
);

const Main = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [arrivals, setArrivals] = useState<booking[]>([]);
  const [departures, setDepartures] = useState<booking[]>([]);
  const [occupancy, setOccupancy] = useState(0);
  const [loading, setLoading] = useState(true);
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminStats, setAdminStats] = useState<AdminDashboardStats | null>(
    null,
  );
  const [addBookingIsOpen, setAddBookingIsOpen] = useState(false);
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
      const [arrivalsResponse, departuresResponse] = await Promise.all([
        axios.get(`${API_URL}/bookings/getTodayBookings/arrivals`, {
          withCredentials: true,
        }),
        axios.get(`${API_URL}/bookings/getTodayBookings/departures`, {
          withCredentials: true,
        }),
      ]);

      setArrivals(formatBookingsDates(arrivalsResponse.data.bookings));
      setDepartures(formatBookingsDates(departuresResponse.data.bookings));
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
  }, [user?.admin]);

  const refreshDashboard = useCallback(async () => {
    await fetchDailyOps();
    await fetchAdminStats();
  }, [fetchAdminStats, fetchDailyOps]);

  useEffect(() => {
    fetchDailyOps().catch((err) => toast.error(getFetchErrorMessage(err)));
  }, [fetchDailyOps]);

  useEffect(() => {
    fetchAdminStats();
  }, [fetchAdminStats]);

  const unpaidArrivals = arrivals.filter(
    (booking) => roomChargeTransaction(booking)?.paymentMethod === "Unpaid",
  ).length;
  const depositToReturn = getDepositToReturn(departures);
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
    },
    {
      label: "ยังไม่ชำระเงิน",
      value: unpaidArrivals,
    },
    {
      label: "มัดจำที่ต้องคืน (฿)",
      value: depositToReturn,
    },
  ];
  const adminStatCards = adminStats
    ? [
        {
          label: "รายได้วันนี้ (฿)",
          value: adminStats.todayExpectedRevenue,
        },
        {
          label: "รายได้เดือนนี้ (฿)",
          value: adminStats.monthRoomRevenue,
        },
        {
          label: "ยอดจองเดือนนี้",
          value: adminStats.monthBookings,
        },
        // {
        //   label: "ยอดค้างชำระ (฿)",
        //   value: adminStats.unpaidAmount,
        // },
        {
          label: "อัตราเข้าพัก",
          value: occupancyRatePercent,
          suffix: "%",
          fillPercent: Math.min(Math.max(occupancyRatePercent, 0), 100),
        },
      ]
    : [];

  const appendToBookings = () => {
    setAddBookingIsOpen(false);
    refreshDashboard().catch((err) => toast.error(getFetchErrorMessage(err)));
  };

  return (
    <main className="home main">
      <Modal
        open={addBookingIsOpen}
        className="home__modalCenter"
        onClose={() => setAddBookingIsOpen(false)}
      >
        <AddBooking
          appendToBookings={appendToBookings}
          onClose={() => setAddBookingIsOpen(false)}
        />
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
            <StatCard label={stat.label} value={stat.value} loading={loading} />
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
            <span>เดือนนี้</span>
          </div>

          <div className="main__adminStatsGrid">
            {(adminStats
              ? adminStatCards
              : [
                  { label: "รายได้วันนี้ (฿)", value: 0 },
                  { label: "รายได้เดือนนี้ (฿)", value: 0 },
                  { label: "ยอดจองเดือนนี้", value: 0 },
                  { label: "ยอดค้างชำระ (฿)", value: 0 },
                  { label: "อัตราเข้าพัก (%)", value: 0 },
                ]
            ).map((stat) => (
              <div
                className={`main__adminStatCard${
                  "fillPercent" in stat ? " main__adminStatCard--fill" : ""
                }`}
                key={stat.label}
                style={
                  "fillPercent" in stat
                    ? ({
                        "--admin-stat-fill": `${stat.fillPercent}%`,
                      } as React.CSSProperties)
                    : undefined
                }
              >
                <StatCard
                  label={stat.label}
                  value={stat.value}
                  loading={adminLoading && !adminStats}
                  suffix={"suffix" in stat ? stat.suffix : undefined}
                />
              </div>
            ))}
          </div>

          {adminStats && (
            <div className="main__adminInsights">
              <div className="main__chartCard">
                <div className="main__cardHeader">
                  <h3>รายได้ค่าห้องเดือนนี้</h3>
                  <span>{adminStats.monthRoomRevenue.toLocaleString()} ฿</span>
                </div>
                <RevenueLineChart series={adminStats.revenueSeries} />
              </div>

              <div className="main__channelCard">
                <div className="main__cardHeader">
                  <h3>ช่องทางการจอง</h3>
                  <span>{adminStats.monthBookings}</span>
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
                              (channel.count / adminStats.monthBookings) * 100,
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
              </div>
            </div>
          )}
        </section>
      )}

      <div className="main__todayGrid">
        <TodayList
          title="เช็คอินวันนี้"
          icon="bx-arrow-to-left"
          bookings={arrivals}
          emptyText="ไม่มีเช็คอินที่ต้องจัดการวันนี้"
        />
        <TodayList
          title="เช็คเอาท์วันนี้"
          icon="bx-arrow-from-left"
          bookings={departures}
          emptyText="ไม่มีเช็คเอาท์ที่ต้องจัดการวันนี้"
        />
      </div>
    </main>
  );
};

export default Main;
