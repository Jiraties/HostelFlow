export type CalendarAnnotationKind =
  | "EXTRA_SALE"
  | "ROOM_CHECK"
  | "FOLLOW_UP"
  | "OTHER";

export const calendarAnnotationOptions: {
  value: CalendarAnnotationKind;
  label: string;
}[] = [
  { value: "EXTRA_SALE", label: "ขายเสริม" },
  { value: "ROOM_CHECK", label: "ตรวจห้อง" },
  { value: "FOLLOW_UP", label: "ติดตาม" },
  { value: "OTHER", label: "อื่นๆ" },
];

export const calendarAnnotationLabel = (
  kind: CalendarAnnotationKind | undefined,
  customReason = "",
) =>
  kind === "OTHER"
    ? customReason || "อื่นๆ"
    : calendarAnnotationOptions.find((option) => option.value === kind)?.label ||
      "ขายเสริม";

export const calendarAnnotationTitle = (
  kind: CalendarAnnotationKind | undefined,
  customReason = "",
) => `หมายเหตุ${calendarAnnotationLabel(kind, customReason.trim())}`;
