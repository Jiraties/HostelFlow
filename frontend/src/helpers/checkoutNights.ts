const bangkokDay = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit",
});

export const bangkokStayDate = (date: Date | string) => bangkokDay.format(new Date(date));

export const remainingStayNights = (
  stays: { from: string | Date; to: string | Date }[], today: string, departure: string,
) => {
  const nights = new Set<string>();
  for (const stay of stays) {
    const first = Math.max(Date.parse(today), Date.parse(bangkokStayDate(stay.from)));
    const end = Math.min(Date.parse(departure), Date.parse(bangkokStayDate(stay.to)));
    for (let time = first; time < end; time += 86400000) {
      nights.add(new Date(time).toISOString().slice(0, 10));
    }
  }
  return [...nights].sort();
};
