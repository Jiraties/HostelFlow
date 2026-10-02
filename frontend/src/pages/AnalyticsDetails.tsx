import { Area, AreaChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import bookingLogo from "../../assets/images/booking.jpeg";
import hostelworldLogo from "../../assets/images/hostelworld.png";
import walkInLogo from "../../assets/images/WalkIn.png";
import AppTooltip from "../components/Tooltip";

// Entirely fabricated figures for the Analytics layout preview, including
// average stay lengths and comparisons. These are not operational data.
const channels = [
  { name: "Booking.com", logo: bookingLogo, bookings: 146, revenue: 52400, averageNights: 3.2, change: 12 },
  { name: "Hostelworld", logo: hostelworldLogo, bookings: 88, revenue: 32200, averageNights: 2.8, change: 5 },
  { name: "Walk-In", logo: walkInLogo, bookings: 62, revenue: 18600, averageNights: 1.6, change: 19 },
  { name: "Direct", logo: null, bookings: 104, revenue: 25200, averageNights: 3.6, change: 8 },
];
const totalChannelRevenue = channels.reduce((sum, channel) => sum + channel.revenue, 0);

const inventory = [
  { name: "Dormitory", subtitle: "ห้องรวม (เตียง)", icon: "bx-bed", occupancy: "78%", revenue: 74600, rateLabel: "RevPAB", rate: 650, changes: [3, 5, 4], trend: [64, 62, 66, 72, 78, 70, 68, 76, 82, 73, 72, 80, 84, 76, 78] },
  { name: "Private Room", subtitle: "ห้องส่วนตัว", icon: "bx-home", occupancy: "64%", revenue: 53800, rateLabel: "Average Room Rate", rate: 1680, changes: [5, 8, 4], trend: [42, 48, 51, 49, 62, 64, 70, 62, 52, 55, 64, 72, 66, 60, 64] },
];

const revenueGroups = [
  { label: "Accommodation", amount: 100000, color: "#67cbd5", groupKey: "roomCharge-original" },
  { label: "Extensions (Extra Nights)", amount: 12800, color: "#94d4ef", groupKey: "roomCharge-extension" },
  { label: "Slow Boat / Tours", amount: 8600, color: "#f7c782", groupKey: null },
  { label: "Other Services", amount: 11600, color: "#b7a1e8", groupKey: null },
  { label: "Refunds / Adjustments", amount: -4600, color: "#e791b1", groupKey: null },
];
const totalRevenue = revenueGroups.reduce((sum, group) => sum + group.amount, 0);
const positiveRevenue = revenueGroups.filter((group) => group.amount > 0);
const grossRevenue = positiveRevenue.reduce((sum, group) => sum + group.amount, 0);

const outlook = [
  { title: "Next Month", period: "Oct 2026", occupancy: 71, change: 6, bars: [35, 55, 43, 68, 57, 76, 94] },
  { title: "30 Days", period: "1–30 Oct 2026", occupancy: 68, change: 4, bars: [40, 68, 50, 45, 72, 62, 95] },
  { title: "60 Days", period: "Oct–Nov 2026", occupancy: 52, change: 7, bars: [42, 58, 74, 51, 60, 77, 94] },
  { title: "90 Days", period: "Oct–Dec 2026", occupancy: 46, change: 9, bars: [50, 42, 70, 35, 45, 78, 94] },
];

const money = (amount: number) => `${amount < 0 ? "−" : ""}฿${Math.abs(amount).toLocaleString("en-US")}`;

const ChangeBadge = ({ value }: { value: number }) => (
  <span className={`analytics__change analytics__change--${value >= 0 ? "up" : "down"}`}>
    <span aria-hidden="true">{value >= 0 ? "↑" : "↓"}</span>
    {Math.abs(value)}%
  </span>
);

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

const AnalyticsDetails = ({ onOpenRevenueBreakdown }: { onOpenRevenueBreakdown: (groupKey?: string) => void }) => (
  <>
    <section className="analytics__detailPanel" aria-labelledby="analytics-channel-title">
      <div className="analytics__detailHeader">
        <h2 className="analytics__title" id="analytics-channel-title">Channel Performance <AnalyticsInfo description="เปรียบเทียบการจองและรายได้ตามช่องทาง · Avg. Nights คือจำนวนคืนเฉลี่ยต่อการจอง · Revenue Share คือสัดส่วนรายได้ของแต่ละช่องทางเทียบกับรายได้รวมทุกช่องทาง" /></h2>
        <span className="analytics__periodLabel">vs Aug 2026</span>
      </div>
      <div className="analytics__tableScroll" tabIndex={0} role="region" aria-label="Sample channel performance table">
        <table className="analytics__channelTable">
          <thead><tr><th scope="col">Channel</th><th scope="col">Bookings</th><th scope="col">Revenue</th><th scope="col">Avg. Nights</th><th scope="col">Revenue Share</th></tr></thead>
          <tbody>
            {channels.map((channel) => {
              const revenueShare = totalChannelRevenue > 0 ? channel.revenue / totalChannelRevenue * 100 : 0;
              return (
                <tr key={channel.name}>
                  <th scope="row">
                    <span className="analytics__channelIdentity">
                      {channel.logo ? (
                        <img className="analytics__channelLogo" src={channel.logo} alt="" width={40} height={40} />
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
        <h2 className="analytics__title" id="analytics-inventory-title">Inventory Performance <AnalyticsInfo description="ผลการดำเนินงานแยกตามประเภทห้องพัก" /></h2>
        <span className="analytics__periodLabel">vs Aug 2026</span>
      </div>
      <div className="analytics__inventoryGrid">
        {inventory.map((item) => (
          <article className="analytics__inventoryCard" key={item.name}>
            <div className="analytics__inventoryIdentity">
              <span className="analytics__channelIcon analytics__channelIcon--direct"><i className={`bx ${item.icon}`} aria-hidden="true" /></span>
              <h3 className="analytics__title">{item.name} <AnalyticsInfo description={item.subtitle} /></h3>
            </div>
            <dl className="analytics__inventoryMetrics">
              {[{ label: "Occupancy", value: item.occupancy }, { label: "Revenue", value: money(item.revenue) }, { label: item.rateLabel, value: money(item.rate) }].map((metric, index) => (
                <div key={metric.label}><dt>{metric.label}</dt><dd><strong>{metric.value}</strong><ChangeBadge value={item.changes[index]} /></dd></div>
              ))}
            </dl>
            <div className="analytics__sparkline" role="img" aria-label={`${item.name}: sample September occupancy trend`}>
              <ResponsiveContainer width="100%" height={100}>
                <AreaChart data={item.trend.map((value, index) => ({ value, day: index * 2 + 1 }))} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
                  <XAxis dataKey="day" ticks={[1, 15, 29]} interval="preserveStartEnd" axisLine={false} tickLine={false} tick={{ fill: "#777777", fontSize: 12 }} tickFormatter={(day) => `${day} Sep`} />
                  <Area type="monotone" dataKey="value" stroke="var(--primary-color)" strokeWidth={2} fill="var(--primary-color)" fillOpacity={0.12} isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </article>
        ))}
      </div>
    </section>

    <div className="analytics__bottomGrid">
      <section className="analytics__detailPanel" aria-labelledby="analytics-breakdown-title">
        <div className="analytics__detailHeader">
          <h2 className="analytics__title" id="analytics-breakdown-title">Revenue Breakdown <AnalyticsInfo description={`สัดส่วนรายได้ตามประเภทบริการ · วงแหวนแสดงรายได้ก่อนหักคืนเงิน · ยอดรวมหลังปรับปรุง ${money(totalRevenue)}`} /></h2>
          <button className="analytics__detailButton" type="button" onClick={() => onOpenRevenueBreakdown()}>ดูรายละเอียดจริง <i className="bx bx-chevron-right" aria-hidden="true" /></button>
        </div>
        <div className="analytics__breakdownBody">
          <div className="analytics__donut" role="group" aria-label={`Sample gross revenue composition: ${money(grossRevenue)} before refunds and adjustments`}>
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
            <button className="analytics__donutLabel" type="button" onClick={() => onOpenRevenueBreakdown()} aria-label="ดูรายละเอียดรายได้จริง September 2026"><strong>{money(totalRevenue)}</strong><span>Total Revenue</span></button>
          </div>
          <dl className="analytics__revenueList">
            {revenueGroups.map((group) => (
              <div key={group.label}>
                <dt>
                  {group.groupKey ? (
                    <button className="analytics__categoryButton" type="button" onClick={() => onOpenRevenueBreakdown(group.groupKey)} aria-label={`ดูรายละเอียดรายได้จริง ${group.label}`}>
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
        <div className="analytics__detailHeader"><h2 className="analytics__title" id="analytics-outlook-title">Forward Outlook <AnalyticsInfo description="อัตราเข้าพักล่วงหน้า · เทียบกับช่วงเดียวกันของเดือนก่อน" /></h2></div>
        <div className="analytics__outlookGrid">
          {outlook.map((item) => (
            <article className="analytics__outlookCard" key={item.title}>
              <h3>{item.title}</h3><p>{item.period}</p>
              <div className="analytics__outlookValue"><strong>{item.occupancy}%</strong><ChangeBadge value={item.change} /></div>
              <div className="analytics__miniBars" aria-hidden="true">{item.bars.map((height, index) => <span key={index} style={{ height: `${height}%` }} />)}</div>
            </article>
          ))}
        </div>
      </section>
    </div>
  </>
);

export default AnalyticsDetails;
