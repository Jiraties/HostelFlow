import { Area, AreaChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import bookingLogo from "../../assets/images/booking.jpeg";
import hostelworldLogo from "../../assets/images/hostelworld.png";
import walkInLogo from "../../assets/images/WalkIn.png";
import AppTooltip from "../components/Tooltip";

import type { AnalyticsResponse } from "../types/analytics";
import { analyticsMoney as money, analyticsMonthLabel, analyticsDateLabel } from "../helpers/analyticsFormatting";
import ChangeBadge from "./AnalyticsChangeBadge";

const channelLogos: Record<string, string> = { BOOK: bookingLogo, HOST: hostelworldLogo, WALK: walkInLogo };

const AnalyticsInfo = ({ description }: { description: string }) => (
  <AppTooltip
    className="analytics__info"
    content={<span className="analytics__tooltipText">{description}</span>}
    ariaLabel={description}
    stopClickPropagation
  >
    <i className="bx bx-info-circle" aria-hidden="true" />
  </AppTooltip>
);

const AnalyticsDetails = ({ data, onOpenRevenueBreakdown }: { data: AnalyticsResponse; onOpenRevenueBreakdown: (groupKey?: string) => void }) => {
  const { channels, inventory, revenueGroups, outlook, totalRevenue } = data;
  const totalChannelRevenue = channels.reduce((sum, channel) => sum + channel.revenue, 0);
  const positiveRevenue = revenueGroups.filter((group) => group.amount > 0);
  const grossRevenue = positiveRevenue.reduce((sum, group) => sum + group.amount, 0);
  return (
  <>
    <section className="analytics__detailPanel" aria-labelledby="analytics-channel-title">
      <div className="analytics__detailHeader">
        <h2 className="analytics__title" id="analytics-channel-title">Channel Performance <AnalyticsInfo description="รายได้ค่าห้องสุทธิตามช่องทางของช่วงเข้าพักที่เริ่มในเดือนที่เลือก ไม่รวมบริการ · Bookings นับการจองไม่ซ้ำในแต่ละช่องทาง รวมการต่อคืน · Avg. Nights รวมคืนของช่วงเข้าพักเหล่านี้ ÷ Bookings · Revenue Share เทียบกับรายได้ค่าห้องสุทธิรวม" /></h2>
        <span className="analytics__periodLabel">vs {analyticsMonthLabel(data.previousMonth)}</span>
      </div>
      <div className="analytics__tableScroll" tabIndex={0} role="region" aria-label="ตารางผลการดำเนินงานตามช่องทาง">
        <table className="analytics__channelTable">
          <thead><tr><th scope="col">Channel</th><th scope="col">Bookings</th><th scope="col">Revenue</th><th scope="col">Avg. Nights</th><th scope="col">Revenue Share</th></tr></thead>
          <tbody>
            {channels.map((channel) => {
              const revenueShare = totalChannelRevenue > 0 ? channel.revenue / totalChannelRevenue * 100 : 0;
              const logo = channelLogos[channel.id];
              return (
                <tr key={channel.name}>
                  <th scope="row">
                    <span className="analytics__channelIdentity">
                      {logo ? (
                        <img className="analytics__channelLogo" src={logo} alt="" width={40} height={40} />
                      ) : (
                        <span className="analytics__channelIcon analytics__channelIcon--direct"><i className="bx bx-link" aria-hidden="true" /></span>
                      )}
                      {channel.name}
                    </span>
                  </th>
                  <td><span className="analytics__tableMetric">{channel.bookings}<ChangeBadge value={channel.change} /></span></td>
                  <td>{money(channel.revenue)}</td>
                  <td>{channel.averageNights.toFixed(1)}</td>
                  <td>{revenueShare.toFixed(1)}%</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>

    <section className="analytics__detailPanel" aria-labelledby="analytics-inventory-title">
      <div className="analytics__detailHeader">
        <h2 className="analytics__title" id="analytics-inventory-title">Inventory Performance <AnalyticsInfo description="Occupancy คิดตามความจุและรวมการใช้ภายใน · รายได้ค่าห้องสุทธิใช้ฐานเดียวกับ Stay Revenue · การจองที่มีหลายประเภทห้องแบ่งรายได้ตามความจุ × จำนวนคืน เนื่องจากไม่มีราคาต่อห้อง · RevPAB / RevPAR ใช้รายได้ค่าห้องสุทธิ ÷ เตียง / ห้องพร้อมขาย ÷ จำนวนวัน" /></h2>
        <span className="analytics__periodLabel">vs {analyticsMonthLabel(data.previousMonth)}</span>
      </div>
      <div className="analytics__inventoryGrid">
        {inventory.map((item) => (
          <article className="analytics__inventoryCard" key={item.id}>
            <div className="analytics__inventoryIdentity">
              <span className="analytics__channelIcon analytics__channelIcon--direct"><i className={`bx ${(item.id === "private" ? "bx-home" : "bx-bed")}`} aria-hidden="true" /></span>
              <h3 className="analytics__title">{item.name} <AnalyticsInfo description={item.id === "private" ? "ห้องส่วนตัว" : "ห้องรวม (เตียง)"} /></h3>
            </div>
            <dl className="analytics__inventoryMetrics">
              {[{ label: "Occupancy", value: `${item.occupancy.toFixed(1)}%` }, { label: "Revenue", value: money(item.revenue) }, { label: item.rateLabel, value: money(item.rate) }].map((metric, index) => (
                <div key={metric.label}><dt>{metric.label}</dt><dd><strong>{metric.value}</strong><ChangeBadge value={item.changes[index] ?? null} unit={index === 0 ? "pts" : "%"} /></dd></div>
              ))}
            </dl>
            <div className="analytics__sparkline" role="img" aria-label={`${item.name}: อัตราเข้าพัก ${analyticsMonthLabel(data.month)}`}>
              <ResponsiveContainer width="100%" height={100}>
                <AreaChart data={item.trend} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
                  <XAxis dataKey="date" minTickGap={50} interval="preserveStartEnd" axisLine={false} tickLine={false} tick={{ fill: "#777777", fontSize: 12 }} tickFormatter={analyticsDateLabel} />
                  <Area type="monotone" dataKey="value" stroke="var(--primary-color)" strokeWidth={2} fill="var(--primary-color)" fillOpacity={0.12} isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </article>
        ))}
      </div>
      {data.unallocatedRoomRevenue !== 0 && <p className="analytics__basisNote">รายได้ค่าห้องที่ยังแยกประเภทห้องไม่ได้: {money(data.unallocatedRoomRevenue)}</p>}
    </section>

    <div className="analytics__bottomGrid">
      <section className="analytics__detailPanel" aria-labelledby="analytics-breakdown-title">
        <div className="analytics__detailHeader">
          <h2 className="analytics__title" id="analytics-breakdown-title">Revenue Breakdown <AnalyticsInfo description={`สัดส่วนรายได้ตามประเภทบริการ · วงแหวนแสดงรายการยอดบวก ยอดติดลบแสดงแยกในรายการด้านข้าง · ยอดรวมหลังปรับปรุง ${money(totalRevenue)}`} /></h2>
          <button className="analytics__detailButton" type="button" onClick={() => onOpenRevenueBreakdown()}>ดูรายละเอียดจริง <i className="bx bx-chevron-right" aria-hidden="true" /></button>
        </div>
        <div className="analytics__breakdownBody">
          <div className="analytics__donut" role="group" aria-label={`สัดส่วนรายการรายได้ยอดบวก ${money(grossRevenue)}`}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={positiveRevenue}
                  dataKey="amount"
                  nameKey="label"
                  innerRadius="73%"
                  outerRadius="98%"
                  startAngle={90}
                  endAngle={-270}
                  paddingAngle={2}
                  cornerRadius={3}
                  stroke="none"
                  isAnimationActive={false}
                >
                  {positiveRevenue.map((group) => <Cell key={group.label} fill={group.color} />)}
                </Pie>
                <Tooltip
                  wrapperStyle={{ zIndex: 10 }}
                  contentStyle={{ border: "none", borderRadius: "1rem", boxShadow: "var(--main-shadow)", fontSize: "1rem" }}
                  formatter={(value, name) => [money(Number(value)), name]}
                />
              </PieChart>
            </ResponsiveContainer>
            <button className="analytics__donutLabel" type="button" onClick={() => onOpenRevenueBreakdown()} aria-label={`ดูรายละเอียดรายได้จริง ${analyticsMonthLabel(data.month)}`}><strong>{money(totalRevenue)}</strong><span>Total Revenue</span></button>
          </div>
          <dl className="analytics__revenueList">
            {revenueGroups.map((group) => (
              <div key={group.label}>
                <dt>
                  {group.groupKey ? (
                    <button className="analytics__categoryButton" type="button" onClick={() => onOpenRevenueBreakdown(group.groupKey ?? undefined)} aria-label={`ดูรายละเอียดรายได้จริง ${group.label}`}>
                      <span className="analytics__colorDot" style={{ backgroundColor: group.color }} />{group.label}<i className="bx bx-chevron-right" aria-hidden="true" />
                    </button>
                  ) : <><span className="analytics__colorDot" style={{ backgroundColor: group.color }} />{group.label}</>}
                </dt>
                <dd className={group.amount < 0 ? "analytics__negativeAmount" : undefined}>{money(group.amount)}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section className="analytics__detailPanel" aria-labelledby="analytics-outlook-title">
        <div className="analytics__detailHeader"><h2 className="analytics__title" id="analytics-outlook-title">Forward Outlook <AnalyticsInfo description="คำนวณจากการจองและการใช้ภายในที่มีอยู่ขณะนี้ เริ่มหลังสิ้นเดือนที่เลือก · ไม่ใช่ภาพย้อนหลัง ณ เดือนนั้น และยังไม่มีประวัติ snapshot สำหรับเปรียบเทียบ · แท่งย่อยแบ่งช่วงเวลาเป็น 7 ส่วน" /></h2></div>
        <p className="analytics__basisNote">จากข้อมูลที่มีอยู่ขณะนี้ รวมการใช้ภายใน</p>
        <div className="analytics__outlookGrid">
          {outlook.map((item) => (
            <article className="analytics__outlookCard" key={item.title}>
              <h3>{item.title}</h3><p>{item.title === "Next Month" ? analyticsMonthLabel(data.nextMonth) : `${analyticsDateLabel(item.startDate)} – ${analyticsDateLabel(item.endDate)} ${item.endDate.slice(0, 4)}`}</p>
              <div className="analytics__outlookValue"><strong>{item.occupancy.toFixed(1)}%</strong></div>
              <div className="analytics__miniBars" aria-hidden="true">{item.bars.map((height, index) => <span key={index} style={{ height: `${height}%` }} title={`${height.toFixed(1)}%`} />)}</div>
            </article>
          ))}
        </div>
      </section>
    </div>
  </>
  );
};

export default AnalyticsDetails;
