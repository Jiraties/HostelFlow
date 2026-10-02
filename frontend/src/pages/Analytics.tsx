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
import "./Home.css";
import "./Analytics.css";

const previewStats: {
  label: string;
  value: string;
  change: number;
  comparison?: string;
}[] = [
  { label: "Stay Revenue", value: "฿128,400", change: 2 },
  { label: "Unpaid", value: "฿24,600", change: -4 },
  { label: "Occupancy", value: "76%", change: -1 },
  { label: "RevPAB", value: "฿580", change: 2 },
  {
    label: "Forward Occupancy",
    value: "68%",
    change: 3,
    comparison: "vs Sep 2026",
  },
];

// Fabricated daily figures for the September layout preview.
const dailyRevenue = [
  3200, 3600, 3900, 4100, 4800, 5200, 4600, 3700, 3500, 3800, 4200, 4500, 5100,
  5400, 4700, 4000, 3600, 3900, 4300, 4900, 5300, 4800, 4100, 3700, 3900, 4400,
  5000, 5100, 4500, 2600,
];
const dailyOccupancy = [
  62, 66, 69, 72, 78, 84, 80, 71, 68, 70, 74, 77, 83, 86, 81, 73, 69, 72, 76,
  82, 85, 80, 75, 70, 73, 77, 83, 84, 79, 76,
];
const mockDailyTrend = dailyRevenue.map((revenue, index) => ({
  label: `${index + 1} Sep`,
  revenue,
  occupancy: dailyOccupancy[index],
}));

const Analytics = () => {
  usePageTitle("HostelFlow · Analytics");
  const now = new Date();
  const [revenueDetail, setRevenueDetail] = useState<{ groupKey?: string } | null>(null);
  const openRevenueBreakdown = (groupKey?: string) => setRevenueDetail({ groupKey });
  const closeRevenueBreakdown = () => setRevenueDetail(null);

  return (
    <main className="home analytics">
      <Modal open={revenueDetail !== null} className="home__modalCenter" onClose={closeRevenueBreakdown} aria-label="รายละเอียดรายได้ September 2026">
        <FinancialBreakdown
          key={revenueDetail?.groupKey || "all"}
          mode="monthly"
          month="2026-09"
          initialGroupKey={revenueDetail?.groupKey}
          contextNote="ข้อมูลจริง · September 2026 — ตัวเลขบนหน้า Analytics เป็นตัวอย่าง"
          onClose={closeRevenueBreakdown}
        />
      </Modal>
      <PageHeader
        title={`Analytics | September 2026`}
        meta={<span className="analytics__pageMeta">Monthly overview <span aria-hidden="true">·</span> ตัวเลขตัวอย่าง</span>}
        lastUpdated={now}
        onRefresh={() => {}}
      />
      <section
        className="analytics__stats"
        aria-label="Sample analytics figures"
      >
        <div className="analytics__statsGrid">
          {previewStats.map((stat) => (
            <div
              className={`analytics__statCard${stat.label === "Stay Revenue" ? " analytics__statCard--interactive" : ""}`}
              key={stat.label}
            >
              {stat.label === "Stay Revenue" && (
                <button className="analytics__cardTrigger" type="button" onClick={() => openRevenueBreakdown()} aria-label="ดูรายละเอียดรายได้จริง September 2026">
                  <i className="bx bx-chevron-right" aria-hidden="true" />
                </button>
              )}
              <p className="analytics__statLabel">{stat.label}</p>
              <strong className="analytics__statValue">{stat.value}</strong>
              <div className="analytics__comparison">
                <span
                  className={`analytics__change analytics__change--${stat.change >= 0 ? "up" : "down"}`}
                >
                  <span aria-hidden="true">{stat.change >= 0 ? "↑" : "↓"}</span>
                  {Math.abs(stat.change)}%
                </span>
                <span className="analytics__change--versus">
                  {stat.comparison || "vs Aug 2026"}
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>
      <section
        className="analytics__trendPanel"
        aria-label="ตัวอย่างกราฟแนวโน้ม"
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
          aria-label="กราฟตัวอย่างแนวโน้มรายได้และอัตราเข้าพัก"
        >
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart
              data={mockDailyTrend}
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
                dataKey="label"
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
      <AnalyticsDetails onOpenRevenueBreakdown={openRevenueBreakdown} />
    </main>
  );
};

export default Analytics;
