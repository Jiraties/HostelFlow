export type NavigationItem = {
  id: number;
  label: string;
  link: string;
  icon: string;
  adminOnly?: boolean;
};

export const navigationItems: NavigationItem[] = [
  { id: 1, label: "Home", link: "/", icon: "bx-home" },
  { id: 2, label: "Arrivals", link: "/arrivals", icon: "bx-arrow-to-left" },
  {
    id: 3,
    label: "Departures",
    link: "/departures",
    icon: "bx-arrow-from-left",
  },
  { id: 5, label: "ปฏิทิน", link: "/calendar", icon: "bx-calendar" },
  { id: 4, label: "รายการทั้งหมด", link: "/master", icon: "bx-table" },
  { id: 6, label: "เอกสาร", link: "/documents", icon: "bx-article" },
  {
    id: 99,
    label: "จัดการ",
    link: "/manage",
    icon: "bx-group",
    adminOnly: true,
  },
  {
    id: 8,
    label: "ตั้งค่า และ ประวัติ",
    link: "/settings",
    icon: "bx-cog",
  },
];
