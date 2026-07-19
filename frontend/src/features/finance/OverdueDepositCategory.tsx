import { useState } from "react";

import type { DepositReturnReminderBooking } from "../../types/cashShiftTypes";
import type { DateFormatPreference } from "../../types/userSettings";
import { DepositReminderGuestList } from "./DepositReminderGuestList";

type OverdueDepositCategoryProps = {
  bookings: DepositReturnReminderBooking[];
  amount: number;
  dateFormat: DateFormatPreference;
};

const formatMoney = (amount: number) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(amount);

export function OverdueDepositCategory({
  bookings,
  amount,
  dateFormat,
}: OverdueDepositCategoryProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <article
      className={
        expanded
          ? "depositReminder__warningCategory depositReminder__warningCategory--open"
          : "depositReminder__warningCategory"
      }
    >
      <button
        className="depositReminder__warningHeader"
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
      >
        <div className="depositReminder__warningIdentity">
          <span className="depositReminder__warningDot" aria-hidden="true" />
          <div>
            <h3>มัดจำที่ควรตรวจสอบ</h3>
            <p>{bookings.length} booking เลยกำหนด check-out</p>
          </div>
        </div>
        <div className="depositReminder__warningTotal">
          <strong>THB {formatMoney(amount)}</strong>
          <i
            className={expanded ? "bx bx-chevron-up" : "bx bx-chevron-down"}
            aria-hidden="true"
          />
        </div>
      </button>

      {expanded && (
        <DepositReminderGuestList
          bookings={bookings}
          dateFormat={dateFormat}
        />
      )}
    </article>
  );
}
