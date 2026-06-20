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

      <section className="main__cashCloseSection">
        <div className="main__sectionHeader">
          <div>
            <i className="bx bx-currency-notes" />
            <h2>ปิดยอดเงินสด</h2>
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
              <p>รับเงินสด</p>
              <strong>
                {cashCloseLoading
                  ? "-"
                  : `${formatMoney(reconciliation?.summary.cashIn || 0)} ฿`}
              </strong>
            </div>
            <div>
              <p>จ่ายเงินสด</p>
              <strong>
                {cashCloseLoading
                  ? "-"
                  : `${formatMoney(reconciliation?.summary.cashOut || 0)} ฿`}
              </strong>
            </div>
            <div>
              <p>ยอดเงินสดคาดไว้</p>
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
              text={dailyCloseIsComplete ? "อัปเดตปิดยอด" : "ปิดยอด"}
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
