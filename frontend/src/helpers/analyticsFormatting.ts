export const analyticsMoney = (amount: number) =>
  `${amount < 0 ? "−" : ""}฿${Math.abs(amount).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
export const analyticsMonthLabel = (month: string) =>
  new Date(`${month}-01T00:00:00+07:00`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "Asia/Bangkok" });
export const analyticsDateLabel = (date: string) =>
  new Date(`${date}T00:00:00+07:00`).toLocaleDateString("en-US", { day: "numeric", month: "short", timeZone: "Asia/Bangkok" });
export const currentAnalyticsMonth = () => {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit" }).formatToParts(new Date());
  return `${parts.find((part) => part.type === "year")!.value}-${parts.find((part) => part.type === "month")!.value}`;
};
