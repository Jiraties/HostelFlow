const AnalyticsChangeBadge = ({ value, unit = "%", lowerIsBetter = false }: { value: number | null; unit?: "%" | "pts"; lowerIsBetter?: boolean }) => (
  <span className={`analytics__change analytics__change--${value === null || value === 0 ? "neutral" : (lowerIsBetter ? value < 0 : value > 0) ? "up" : "down"}`}>
    {value === null ? "—" : <><span aria-hidden="true">{value > 0 ? "↑" : value < 0 ? "↓" : "="}</span>{Math.abs(value).toLocaleString("en-US", { maximumFractionDigits: 1 })}{unit === "pts" ? " pts" : "%"}</>}
  </span>
);

export default AnalyticsChangeBadge;
