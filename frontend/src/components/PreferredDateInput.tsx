import type { InputHTMLAttributes } from "react";

import { useAuth } from "../context/AuthContext";
import {
  dateFormatPlaceholder,
  formatDateInputValue,
} from "../helpers/displayDate";

import "./PreferredDateInput.css";

type PreferredDateInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type"
> & {
  value: string;
};

export function PreferredDateInput({
  className = "",
  disabled,
  onClick,
  style,
  value,
  ...inputProps
}: PreferredDateInputProps) {
  const { user } = useAuth();
  const dateFormat = user?.settings.dateFormat || "dd/MM/yyyy";

  return (
    <span
      className={`preferredDateInput ${className}${
        disabled ? " preferredDateInput--disabled" : ""
      }`}
      style={style}
    >
      <span className="preferredDateInput__value" aria-hidden="true">
        {formatDateInputValue(value, dateFormat) ||
          dateFormatPlaceholder(dateFormat)}
      </span>
      <i className="bx bx-calendar preferredDateInput__icon" aria-hidden="true" />
      <input
        {...inputProps}
        className="preferredDateInput__native"
        type="date"
        value={value}
        disabled={disabled}
        onClick={(event) => {
          onClick?.(event);
          if (!disabled && typeof event.currentTarget.showPicker === "function") {
            event.currentTarget.showPicker();
          }
        }}
      />
    </span>
  );
}
