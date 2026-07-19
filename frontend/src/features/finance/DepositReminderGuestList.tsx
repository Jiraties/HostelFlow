import { formatDisplayDate } from "../../helpers/displayDate";
import type { DepositReturnReminderBooking } from "../../types/cashShiftTypes";
import type { DateFormatPreference } from "../../types/userSettings";

type DepositReminderGuestListProps = {
  bookings: DepositReturnReminderBooking[];
  dateFormat: DateFormatPreference;
};

const formatMoney = (amount: number) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(amount);

const guestRoomLabel = (booking: DepositReturnReminderBooking) =>
  booking.roomIds.length > 0 ? booking.roomIds.join(", ") : "ไม่ระบุห้อง";

export function DepositReminderGuestList({
  bookings,
  dateFormat,
}: DepositReminderGuestListProps) {
  return (
    <div className="depositReminder__guestList">
      {bookings.map((booking) => (
        <div className="depositReminder__guest" key={booking.bookingId}>
          <div className="depositReminder__guestDetails">
            <span>{booking.guestName}</span>
            <small>
              {booking.bookingId} · {guestRoomLabel(booking)} · check-out{" "}
              {formatDisplayDate(booking.checkOut, dateFormat)}
            </small>
          </div>
          <div className="depositReminder__guestSide">
            <span className="depositReminder__guestAmount">
              THB {formatMoney(booking.amount)}
            </span>
            <small className="depositReminder__guestMethod">
              คืนเงินสด
              <i className="bx bx-money" aria-hidden="true" />
            </small>
          </div>
        </div>
      ))}
    </div>
  );
}
