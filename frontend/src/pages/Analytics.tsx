import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useState } from "react";
import { Modal } from "@mui/material";
import PageHeader from "../components/PageHeader";
import usePageTitle from "../hooks/useTitle";
import AnalyticsDetails from "./AnalyticsDetails";
import FinancialBreakdown from "../features/finance/FinancialBreakdown";
import { useAuth } from "../context/AuthContext";
import { useAnalytics } from "../hooks/useAnalytics";
import { analyticsMoney, analyticsMonthLabel, analyticsDateLabel, currentAnalyticsMonth } from "../helpers/analyticsFormatting";
import AnalyticsChangeBadge from "./AnalyticsChangeBadge";
import "./Home.css";
import "./Analytics.css";

const Analytics = () => {
  usePageTitle("HostelFlow · Analytics");
  const { user } = useAuth();
  const [month, setMonth] = useState(currentAnalyticsMonth);
  const { data, loading, error, refresh } = useAnalytics(month, Boolean(user?.admin));
  const monthLabel = analyticsMonthLabel(month);
  const previousLabel = data ? analyticsMonthLabel(data.previousMonth) : "";
  const stats = data ? [
    { label: "Stay Revenue", value: analyticsMoney(data.stats.stayRevenue), change: data.stats.changes.stayRevenue, helper: "Expected Stay Revenue รวมค่าห้องและบริการ หลังปรับปรุง" },
    { label: "Outstanding Balance", value: analyticsMoney(data.stats.outstandingBalance), change: data.stats.changes.outstandingBalance, lowerIsBetter: true, helper: "ยอดที่ยังค้างชำระของรายการรายได้ในเดือนที่เลือก" },
    { label: "Occupancy", value: `${data.stats.occupancy.toFixed(1)}%`, change: data.stats.changes.occupancy, unit: "pts" as const, helper: "อัตราเข้าพักตามความจุ รวมการใช้ภายใน" },
    { label: "RevPAB", value: analyticsMoney(data.stats.revpab), change: data.stats.changes.revpab, helper: "รายได้ค่าห้องสุทธิ ÷ (จำนวนเตียงพร้อมขาย × จำนวนวัน)" },
    { label: "Forward Occupancy", value: `${data.stats.forwardOccupancy.toFixed(1)}%`, change: null, comparison: analyticsMonthLabel(data.nextMonth), helper: "อัตราเข้าพักเดือนถัดไป จากข้อมูลที่มีอยู่ขณะนี้ รวมการใช้ภายใน" },
  ] : [];
  const selectMonth = (next: string) => {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(next) || next < "1901-01" || next > "9997-12") return;
    setRevenueDetail(null);
    setMonth(next);
  };
  const [revenueDetail, setRevenueDetail] = useState<{ groupKey?: string } | null>(null);
  const openRevenueBreakdown = (groupKey?: string) => setRevenueDetail({ groupKey });
  const closeRevenueBreakdown = () => setRevenueDetail(null);

  return (
    <main className="home analytics">
      {revenueDetail && <Modal open className="home__modalCenter" onClose={closeRevenueBreakdown} aria-label={`รายละเอียดรายได้ ${monthLabel}`}>
        <FinancialBreakdown
          key={`${month}-${revenueDetail.groupKey || "all"}`}
          mode="monthly"
          month={month}
          initialGroupKey={revenueDetail?.groupKey}
          contextNote={`ข้อมูลจริง · ${monthLabel} · Expected Stay Revenue`}
          onClose={closeRevenueBreakdown}
        />
      </Modal>}
      <PageHeader
        title={`Analytics | ${monthLabel}`}
        meta={<div className="analytics__pageMeta">
          {user?.admin && <label className="analytics__monthControl">เดือน <input type="month" aria-label="เลือกเดือน Analytics" value={month} min="1901-01" max="9997-12" onChange={(event) => selectMonth(event.target.value)} /></label>}
          <span>อัปเดตล่าสุด {data ? new Date(data.generatedAt).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" }) : "--:--"}</span>
        </div>}
        lastUpdated={data ? new Date(data.generatedAt) : null}
        onRefresh={user?.admin ? refresh : undefined}
      />
      {!user?.admin && <p className="analytics__state" role="status">เฉพาะผู้ดูแลระบบเท่านั้นที่สามารถดู Analytics ได้</p>}
      {user?.admin && error && <div className="analytics__state" role="alert">{error} <button type="button" onClick={() => void refresh().catch(() => {})}>ลองใหม่</button></div>}
      {loading && <p className="analytics__state" role="status">กำลังโหลดข้อมูล Analytics…</p>}
      {data && <div className="analytics__content" aria-busy={loading}>
      {data.totalRevenue === 0 && data.channels.every((channel) => channel.bookings === 0) && data.dailyTrend.every((day) => day.occupancy === 0) && <p className="analytics__state" role="status">ยังไม่มีข้อมูลรายได้หรือการเข้าพักในเดือนนี้</p>}
      <p className="analytics__basisNote">ข้อมูลรายเดือน · Expected Stay Revenue: ค่าห้องลงวันที่เริ่มเข้าพัก / เริ่มต่อคืน บริการลงวันที่ทำรายการ รวมยอดค้างชำระและหักรายการคืนเงินที่เกี่ยวข้อง · Occupancy คิดเต็มเดือนตามความจุ {data.capacity} เตียง รวมการใช้ภายใน</p>
      <section
        className="analytics__stats"
        aria-label="ข้อมูล Analytics รายเดือน"
      >
        <div className="analytics__statsGrid">
          {stats.map((stat) => (
            <div
              className={`analytics__statCard${stat.label === "Stay Revenue" ? " analytics__statCard--interactive" : ""}`}
              key={stat.label}
            >
              {stat.label === "Stay Revenue" && (
                <button className="analytics__cardTrigger" type="button" onClick={() => openRevenueBreakdown()} aria-label={`ดูรายละเอียดรายได้จริง ${monthLabel}`}>
                  <i className="bx bx-chevron-right" aria-hidden="true" />
                </button>
              )}
              <p className="analytics__statLabel" title={stat.helper}>{stat.label}</p>
              <strong className="analytics__statValue">{stat.value}</strong>
              <div className="analytics__comparison">
                {stat.label !== "Forward Occupancy" && <AnalyticsChangeBadge value={stat.change} unit={stat.unit} lowerIsBetter={stat.lowerIsBetter} />}
                <span className="analytics__change--versus">
                  {stat.comparison || `vs ${previousLabel}` }
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>
      <section
        className="analytics__trendPanel"
        aria-label="กราฟแนวโน้มรายได้และอัตราเข้าพัก"
      >
        <div className="analytics__chartHeader">
          <div>
            <h2>Stay Revenue &amp; Occupancy</h2>
          </div>
          <div className="analytics__trendLegend">
            <span>
              <i className="analytics__trendLegendBar" />
              Stay Revenue รายวัน
            </span>
            <span>
              <i className="analytics__trendLegendLine" />
              Occupancy
            </span>
          </div>
        </div>
        <div
          className="analytics__chartWrapper"
          role="img"
          aria-label={`รายได้และอัตราเข้าพัก ${monthLabel}`}
        >
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart
              data={data.dailyTrend}
              barCategoryGap="28%"
              margin={{ top: 12, right: 12, bottom: 0, left: 0 }}
            >
              <CartesianGrid
                stroke="#e7e7e7"
                strokeOpacity={0.65}
                strokeDasharray="4 4"
                vertical={false}
              />
              <XAxis
                dataKey="date"
                tickFormatter={analyticsDateLabel}
                minTickGap={28}
                axisLine={false}
                tickLine={false}
                tick={{ fill: "#777777", fontSize: 12 }}
              />
              <YAxis
                yAxisId="revenue"
                axisLine={false}
                tickLine={false}
                width={54}
                tick={{ fill: "#777777", fontSize: 12 }}
                tickFormatter={(value: number) => `฿${value / 1000}k`}
              />
              <YAxis
                yAxisId="occupancy"
                orientation="right"
                axisLine={false}
                tickLine={false}
                width={42}
                domain={[0, 100]}
                tick={{ fill: "#777777", fontSize: 12 }}
                tickFormatter={(value: number) => `${value}%`}
              />
              <Tooltip
                contentStyle={{
                  border: "none",
                  borderRadius: "1rem",
                  boxShadow: "var(--main-shadow)",
                  fontSize: "1rem",
                }}
                labelFormatter={(date) => analyticsDateLabel(String(date))}
                formatter={(value, name) => [
                  name === "Daily Stay Revenue"
                    ? `${Number(value).toLocaleString("en-US")} ฿`
                    : `${value}%`,
                  name === "Daily Stay Revenue"
                    ? "รายได้จากการเข้าพัก"
                    : "อัตราเข้าพัก",
                ]}
              />
              <Bar
                yAxisId="revenue"
                dataKey="revenue"
                name="Daily Stay Revenue"
                fill="var(--analytics-revenue-color)"
                fillOpacity={0.75}
                stroke="none"
                radius={[10, 10, 0, 0]}
                maxBarSize={18}
              />
              <Line
                yAxisId="occupancy"
                type="monotone"
                dataKey="occupancy"
                name="Occupancy"
                stroke="var(--analytics-occupancy-color)"
                strokeWidth={3}
                strokeLinecap="round"
                dot={false}
                activeDot={{ r: 5, fill: "var(--analytics-occupancy-color)" }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </section>
      <AnalyticsDetails data={data} onOpenRevenueBreakdown={openRevenueBreakdown} />
      </div>}
    </main>
  );
};

export default Analytics;
