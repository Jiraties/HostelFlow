import { paymentMethodOptions, platformOptions } from "./options";

export const exportStatusOptions = [
  { value: "booked", label: "ยังไม่ Check-In" },
  { value: "checkedIn", label: "Check-In แล้ว" },
  { value: "checkedOut", label: "Check-Out แล้ว" },
  { value: "noShow", label: "No-Show" },
  { value: "cancelled", label: "ยกเลิกแล้ว (Cancelled)" },
  { value: "voided", label: "Void (แยกจากยกเลิก)" },
];

export const exportCategoryOptions = [
  { value: "private", label: "ห้องพักส่วนตัว" },
  { value: "dorm", label: "ห้องพักรวม" },
  { value: "services", label: "บริการเสริม" },
];

export const defaultBookingExportFilters = () => ({
  bookingChannels: platformOptions.map((option) => option.value),
  bookingStatuses: exportStatusOptions.filter((option) => option.value !== "cancelled").map((option) => option.value),
  paymentMethods: paymentMethodOptions.map((option) => option.value),
  categories: exportCategoryOptions.map((option) => option.value),
});

export type BookingExportFilters = ReturnType<typeof defaultBookingExportFilters>;

export const bookingExportIsEmpty = (filters: BookingExportFilters) =>
  Object.values(filters).some((values) => values.length === 0);

export const bookingExportQuery = (month: string, filters: BookingExportFilters) => ({
  month,
  filterVersion: "2",
  bookingChannels: filters.bookingChannels.join(","),
  bookingStatuses: filters.bookingStatuses.join(","),
  paymentMethods: filters.paymentMethods.join(","),
  categories: filters.categories.join(","),
});
