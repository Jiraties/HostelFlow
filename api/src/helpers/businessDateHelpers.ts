/** Business dates always use Asia/Bangkok, independently of the server timezone. */
export const BUSINESS_DAY_MS = 86400000;
const BANGKOK_OFFSET_MS = 7 * 3600000;

export const businessDateKey = (date: Date) =>
  new Date(date.getTime() + BANGKOK_OFFSET_MS).toISOString().slice(0, 10);

export const businessDateStart = (date: Date) =>
  new Date(`${businessDateKey(date)}T00:00:00+07:00`);

export const businessMonthBounds = (month: string) => {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return null;
  const [year, number] = month.split("-").map(Number);
  if (year < 1900 || year > 9998) return null;
  return {
    start: new Date(Date.UTC(year, number - 1, 1) - BANGKOK_OFFSET_MS),
    end: new Date(Date.UTC(year, number, 1) - BANGKOK_OFFSET_MS),
  };
};

export const shiftBusinessMonth = (month: string, offset: number) => {
  const [year, number] = month.split("-").map(Number);
  return new Date(Date.UTC(year, number - 1 + offset, 1)).toISOString().slice(0, 7);
};
