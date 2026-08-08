import type { TransactionType } from "../types/bookingTypes";

type TransactionDisplay = {
  icon: string;
  name: string;
  color: string;
};

export const transactionMap: Record<TransactionType, TransactionDisplay> = {
  roomCharge: { icon: "bx-bed-alt", name: "ค่าห้อง", color: "#51d1dc" },
  deposit: { icon: "bx-wallet", name: "รับมัดจำ", color: "#facc15" },
  adjustment: { icon: "bx-edit-alt", name: "ปรับราคา", color: "#a78bfa" },
  depositRefund: { icon: "bx-undo", name: "คืนมัดจำ", color: "#f87171" },
  cancellationRefund: {
    icon: "bx-calendar-x",
    name: "คืนเงินยกเลิก",
    color: "#fb7185",
  },
  roomRefund: { icon: "bx-undo", name: "คืนค่าห้อง", color: "#fb7185" },
  roomChargeWriteOff: {
    icon: "bx-calendar-x",
    name: "ปิดยอดค่าห้องที่เหลือ",
    color: "#94a3b8",
  },
  settlementCharge: {
    icon: "bx-receipt",
    name: "เก็บเงินเพิ่ม",
    color: "#22c55e",
  },
  compensation: { icon: "bx-gift", name: "ชดเชยลูกค้า", color: "#38bdf8" },
  depositKept: {
    icon: "bx-lock-keyhole",
    name: "เก็บมัดจำเป็นรายได้",
    color: "#facc15",
  },
  paymentCorrection: {
    icon: "bx-arrow-right-left",
    name: "แก้ไขการชำระเงิน",
    color: "#a78bfa",
  },
  towel: { icon: "bx-bath", name: "Towel", color: "#38bdf8" },
  motorbike: { icon: "bx-cycling", name: "Motorbike", color: "#fb923c" },
  slowBoat: { icon: "bx-water", name: "Slow Boat", color: "#2dd4bf" },
  joinTour: { icon: "bx-map", name: "Join Tour", color: "#22c55e" },
  extraBed: { icon: "bx-bed", name: "Extra Bed", color: "#ec4899" },
  pickACraft: { icon: "bx-palette", name: "Pick A Craft", color: "#f59e0b" },
  trek2D: { icon: "bx-map-alt", name: "Trek 2D", color: "#16a34a" },
  setMenu: { icon: "bx-food-menu", name: "Set Menu", color: "#84cc16" },
  sleeperBus: { icon: "bx-bus", name: "Sleeper Bus", color: "#6366f1" },
  onlyWalk: { icon: "bx-walking", name: "Only Walk", color: "#14b8a6" },
  laundry: { icon: "bx-washer", name: "Laundry", color: "#60a5fa" },
  bicycle: { icon: "bx-cycling", name: "Bicycle", color: "#fb923c" },
  car: { icon: "bx-car", name: "Car", color: "#64748b" },
  misc: {
    icon: "bx-dots-horizontal-rounded",
    name: "Misc",
    color: "#94a3b8",
  },
  rainCoat: { icon: "bx-cloud-rain", name: "Rain Coat", color: "#0ea5e9" },
  passwordLock: { icon: "bx-lock", name: "Password Lock", color: "#8b5cf6" },
  cooking: { icon: "bx-food-menu", name: "Cooking", color: "#f97316" },
  cardSurcharge: {
    icon: "bx-credit-card-alt",
    name: "ค่าธรรมเนียมบัตร 3%",
    color: "#94a3b8",
  },
};

const fallbackTransactionDisplay: TransactionDisplay = {
  icon: "bx-receipt",
  name: "รายการ",
  color: "#94a3b8",
};

export const getTransactionDisplay = (type: string): TransactionDisplay =>
  transactionMap[type as TransactionType] ?? fallbackTransactionDisplay;
