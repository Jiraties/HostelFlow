import type { ComponentProps } from "react";
import { CalendarInput } from "./CalendarInput";
import { useAuth } from "../context/AuthContext";
import { dateFormatPlaceholder } from "../helpers/displayDate";
import "./PreferredDateInput.css";

type PreferredDateInputProps = Omit<ComponentProps<typeof CalendarInput>, "mode" | "displayFormat">;

export function PreferredDateInput({ className = "", ...props }: PreferredDateInputProps) {
  const { user } = useAuth();
  const dateFormat = user?.settings.dateFormat || "dd/MM/yyyy";
  return (
    <CalendarInput
      {...props}
      className={`preferredDateInput ${className}`}
      mode="date"
      displayFormat={dateFormat === "d MMM yyyy" ? "D MMM YYYY" : "DD/MM/YYYY"}
      placeholder={dateFormatPlaceholder(dateFormat)}
    />
  );
}
