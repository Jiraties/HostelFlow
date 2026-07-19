import type {
  PaymentMethod,
  TransactionType,
} from "../types/bookingTypes";
import { paymentMethodOptions } from "./options";
import type { OptionType } from "./selectStyling";

export const transactionTypeOptions: OptionType[] = [
  { value: "slowBoat", label: "Slow Boat", color: "#2dd4bf" },
  { value: "sleeperBus", label: "Sleeper Bus", color: "#6366f1" },
  { value: "motorbike", label: "Motorbike", color: "#fb923c" },
  { value: "joinTour", label: "Join Tour", color: "#22c55e" },
  { value: "trek2D", label: "Trek 2D", color: "#16a34a" },
  { value: "onlyWalk", label: "Only Walk", color: "#14b8a6" },
  { value: "towel", label: "Towel", color: "#38bdf8" },
  { value: "laundry", label: "Laundry", color: "#60a5fa" },
  { value: "extraBed", label: "Extra Bed", color: "#ec4899" },
  { value: "setMenu", label: "Set Menu", color: "#84cc16" },
  { value: "pickACraft", label: "Pick A Craft", color: "#f59e0b" },
  { value: "bicycle", label: "Bicycle", color: "#fb923c" },
  { value: "misc", label: "Misc", color: "#94a3b8" },
  { value: "rainCoat", label: "Rain Coat", color: "#0ea5e9" },
  { value: "passwordLock", label: "Password Lock", color: "#8b5cf6" },
  { value: "car", label: "Car", color: "#64748b" },
  { value: "cooking", label: "Cooking", color: "#f97316" },
];

export const standaloneTransactionTypeOptions = transactionTypeOptions.filter(
  (option) => option.value !== "adjustment",
);

export const addTransactionPaymentMethodOptions = paymentMethodOptions.filter(
  (option) => option.value !== "OTA" && option.value !== "Unpaid",
);

export const transactionPresets: Partial<
  Record<TransactionType, { amount: number; paymentMethod?: PaymentMethod }>
> = {
  towel: { amount: 30, paymentMethod: "Cash" },
  laundry: { amount: 60, paymentMethod: "Cash" },
  slowBoat: { amount: 250 },
  joinTour: { amount: 400 },
  onlyWalk: { amount: 400 },
  trek2D: { amount: 600 },
  setMenu: { amount: 120 },
};
