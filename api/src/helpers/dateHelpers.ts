export const dateRangeText = (from: Date, to: Date) => {
  const formatDay = (date: Date) =>
    new Intl.DateTimeFormat("th-TH", { day: "numeric" }).format(date);

  const formatMonth = (date: Date) =>
    new Intl.DateTimeFormat("th-TH", { month: "short" }).format(date);

  const sameMonth = from.getMonth() === to.getMonth();

  const dateText = sameMonth
    ? `${formatDay(from)}-${formatDay(to)} ${formatMonth(to)}`
    : `${formatDay(from)} ${formatMonth(from)} - ${formatDay(to)} ${formatMonth(to)}`;
};

export const toInputDate = (date: string | Date) => {
  const d = new Date(date);

  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
};
