import PaymentMethodChip from "../../components/PaymentMethodChip";
import { useEffect, useState } from "react";
import axios from "axios";
import toast from "react-hot-toast";
import ActionButton from "../../components/ActionButton";
import ModalCloseButton from "../../components/ModalCloseButton";
import type { booking } from "../../types/bookingTypes";

import { API_URL } from "../../config/api";
import {
  effectiveTransactions,
  formatBookingDates,
  roomChargeOutstandingAmount,
} from "../../helpers/bookingHelpers";
import { platformMap } from "../../helpers/maps";
import { formatRoomStayRooms } from "../../helpers/roomStayHelpers";
import { useAuth } from "../../context/AuthContext";
import { formatDisplayDate } from "../../helpers/displayDate";

import "./BookingCheckbox.css";
import "./CheckIn.css";
import "./Cancellation.css";
import "./CheckOut.css";

import { bangkokStayDate, remainingStayNights } from "../../helpers/checkoutNights";

type CheckOutProps = {
  booking: booking;
  onClose?: () => void;
  onDirtyChange?: (isDirty: boolean) => void;
  handleCheckOutSuccess?: (booking: booking) => void;
  onRecordPayment?: () => void;
};

const CheckOut = ({
  onClose,
  booking,
  onDirtyChange,
  handleCheckOutSuccess,
  onRecordPayment,
}: CheckOutProps) => {
  const { user } = useAuth();
  const dateFormat = user?.settings.dateFormat || "dd/MM/yyyy";
  const [today, setToday] = useState(() => bangkokStayDate(new Date()));
  const departure = bangkokStayDate(booking.checkOut);
  const isEarlyCheckOut = today < departure;
  const [releaseRemainingNights, setReleaseRemainingNights] = useState(false);
  useEffect(() => {
    const midnight = Date.parse(today + "T00:00:00+07:00") + 86400000;
    const timer = window.setTimeout(() => setToday(bangkokStayDate(new Date())), Math.max(1, midnight - Date.now()));
    return () => window.clearTimeout(timer);
  }, [today]);
  const [confirmedDepositReturn, setConfirmedDepositReturn] = useState(false);
  const [confirmedStillUnpaid, setConfirmedStillUnpaid] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [validationAttempted, setValidationAttempted] = useState(false);
  const nights = remainingStayNights(booking.roomStays, today, departure);

  const formatCurrency = (num: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      minimumFractionDigits: num % 1 === 0 ? 0 : 2,
      maximumFractionDigits: 2,
      currency: "THB",
    }).format(num);

  const currentTransactions = effectiveTransactions(booking);
  const depositTransactions = currentTransactions.filter(
    (transaction) => transaction.type === "deposit",
  );
  const depositAmount = depositTransactions.reduce(
    (total, transaction) => total + transaction.amount,
    0,
  );
  const refundedDepositAmount = currentTransactions
    .filter((transaction) => transaction.type === "depositRefund")
    .reduce((total, transaction) => total + transaction.amount, 0);
  const retainedDepositAmount = currentTransactions
    .filter((transaction) => transaction.type === "depositKept")
    .reduce((total, transaction) => total + transaction.amount, 0);
  const remainingDepositAmount = Math.max(
    depositAmount - refundedDepositAmount - retainedDepositAmount,
    0,
  );
  const depositPaymentMethod = depositTransactions[0]?.paymentMethod || "Cash";
  const unpaidRoomChargeAmount = roomChargeOutstandingAmount(booking);
  const hasUnpaidBalance = unpaidRoomChargeAmount > 0;
  useEffect(() => {
    onDirtyChange?.(
      confirmedDepositReturn ||
        confirmedStillUnpaid ||
        (isEarlyCheckOut && releaseRemainingNights),
    );

    return () => onDirtyChange?.(false);
  }, [
    confirmedDepositReturn,
    confirmedStillUnpaid,
    isEarlyCheckOut,
    onDirtyChange,
    releaseRemainingNights,
  ]);

  const checkOutHandler = async () => {
    setValidationAttempted(true);
    if (remainingDepositAmount > 0 && !confirmedDepositReturn) {
      throw new Error("กรุณายืนยันการคืนมัดจำก่อนเช็คเอาท์");
    }

    if (hasUnpaidBalance && !confirmedStillUnpaid) {
      throw new Error(
        "ยังมีเงินที่ยังไม่ได้รับ กรุณาบันทึกการชำระเงินหรือยืนยันก่อนเช็คเอาท์",
      );
    }

    setSubmitting(true);

    try {
      const response = await axios.patch(
        `${API_URL}/bookings/checkOut/${booking.bookingId}`,
        {
          expectedRevision: booking.revision,
          depositReturned: confirmedDepositReturn,
          releaseRemainingNights,
          ...(isEarlyCheckOut && { previewBusinessDate: today }),
          confirmedStillUnpaid,
        },
        { withCredentials: true },
      );

      if (response.data.booking) {
        handleCheckOutSuccess?.(formatBookingDates(response.data.booking));
      }

      return response;
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="checkIn__wrapper">
      {onClose && <ModalCloseButton onClick={onClose} />}
      <div className="checkIn__header">
        <h1 className="checkIn__title">เช็คเอาท์ {booking.name}</h1>

      </div>

      <div className="checkOut__grid">
        <div className="checkOut__summary">
          <div className="viewBooking__item">
            <span className="viewBooking__label">ช่องทางการจอง: </span>
            <div className="viewBooking__platform">
              <p
                className="viewBooking__infoText"
                style={{ color: platformMap[booking.platformId]?.color }}
              >
                {platformMap[booking.platformId]?.label || "ไม่ทราบ"}
              </p>
              <img
                className="viewBooking__logo"
                src={platformMap[booking.platformId]?.logo}
                alt={platformMap[booking.platformId]?.label}
              />
            </div>
          </div>
          <div className="viewBooking__item">
            <span className="viewBooking__label">ห้อง: </span>
            <p className="viewBooking__infoText">
              {booking.roomStays.map(formatRoomStayRooms).join(", ")}
            </p>
          </div>

          <div className="viewBooking__item">
            <span className="viewBooking__label">Check-In: </span>
            <p className="viewBooking__infoText">
              {formatDisplayDate(booking.checkIn, dateFormat)}{" "}
              <span className="viewBooking__nights">{booking.nights} คืน</span>
            </p>
          </div>
          <div className="viewBooking__item">
            <span className="viewBooking__label">Check-Out </span>
            <p className="viewBooking__infoText">
              {formatDisplayDate(booking.checkOut, dateFormat)}
            </p>
          </div>
        </div>

        <div>
          <p className="checkIn__label">สรุปยอดการคืนมัดจำ</p>
          {hasUnpaidBalance && (
            <section className="checkOut__unpaidWarning">
              <div className="checkOut__unpaidHeader">
                <i className="bx bx-alert-circle" />
                <div>
                  <p>ยอดค้างชำระ</p>
                  <strong>{formatCurrency(unpaidRoomChargeAmount)}</strong>
                </div>
              </div>
              <p>
                ยังมีเงินที่ยังไม่ได้รับ
                กรุณาบันทึกการชำระเงินหรือยืนยันก่อนเช็คเอาท์
              </p>
              <div className="checkOut__unpaidActions">
                {onRecordPayment && (
                  <button
                    type="button"
                    className="checkOut__recordPaymentButton"
                    onClick={onRecordPayment}
                  >
                    <i className="bx bx-receipt" />
                    บันทึกการชำระเงิน
                  </button>
                )}
                <label className="checkbox checkOut__stillUnpaidCheckbox">
                  ยืนยันว่าเช็คเอาท์โดยยังค้างชำระ
                  <input
                    type="checkbox"
                    checked={confirmedStillUnpaid}
                    aria-invalid={validationAttempted && !confirmedStillUnpaid}
                    aria-describedby={validationAttempted && !confirmedStillUnpaid ? "checkout-unpaid-error" : undefined}
                    onChange={(e) => setConfirmedStillUnpaid(e.target.checked)}
                  />
                  <span className="box"></span>
                </label>
              </div>
              {validationAttempted && !confirmedStillUnpaid && <p id="checkout-unpaid-error" className="formField__error">กรุณายืนยันการเช็คเอาท์โดยยังค้างชำระ</p>}
            </section>
          )}

          <div className="checkIn__paymentConfirmation">
            <div className="checkIn__paymentConfirmationList">
              <div className="checkIn__paymentRow">
                <p>
                  ค่ามัดจำ{" "}
                  <PaymentMethodChip method={depositPaymentMethod} />
                </p>
                <p>{formatCurrency(depositAmount)}</p>
              </div>

              {refundedDepositAmount > 0 && (
                <div className="checkIn__paymentRow">
                  <p>คืนมัดจำแล้ว</p>
                  <p>{formatCurrency(refundedDepositAmount)}</p>
                </div>
              )}
            </div>
            <div className="checkIn__paymentConfirmationTotal">
              <div className="checkIn__totalsBreakdown">
                <div className="checkIn__totalRow cash-total">
                  <p>
                    {remainingDepositAmount > 0
                      ? "ยอดเงินสดที่ต้องคืน:"
                      : "ไม่มียอดมัดจำที่ต้องคืน"}
                  </p>
                  <p className="checkIn__paymentConfirmationTotalText">
                    {formatCurrency(remainingDepositAmount)}
                  </p>
                </div>
              </div>
              {remainingDepositAmount > 0 && (
                <label className="checkbox checkOut__depositReturnConfirmation">
                  ยืนยันว่าคืนมัดจำแล้ว{" "}
                  <input
                    type="checkbox"
                    checked={confirmedDepositReturn}
                    aria-invalid={validationAttempted && !confirmedDepositReturn}
                    aria-describedby={validationAttempted && !confirmedDepositReturn ? "checkout-deposit-error" : undefined}
                    onChange={(event) =>
                      setConfirmedDepositReturn(event.target.checked)
                    }
                  />
                  <span className="box" />
                </label>
              )}
              {remainingDepositAmount > 0 && validationAttempted && !confirmedDepositReturn && <p id="checkout-deposit-error" className="formField__error">กรุณายืนยันการคืนมัดจำ</p>}
            </div>
          </div>

          {isEarlyCheckOut && (
            <section className="checkOut__section">
              <p className="checkIn__label">สถานะห้องสำหรับคืนที่เหลือ</p>
              <div className="cancellation__segmentedControl roomStatusSegmentedControl" role="group" aria-label="สถานะห้องสำหรับคืนที่เหลือ">
                <button
                  type="button"
                  className={
                    "cancellation__segment" +
                    (releaseRemainingNights
                      ? " cancellation__segment--active"
                      : "")
                  }
                  aria-pressed={releaseRemainingNights}
                  data-room-availability="available"
                  onClick={() => setReleaseRemainingNights(true)}
                >
                  <i className="bx bx-door-open" />
                  เปิดให้จองใหม่
                </button>
                <button
                  type="button"
                  className={
                    "cancellation__segment" +
                    (!releaseRemainingNights
                      ? " cancellation__segment--active"
                      : "")
                  }
                  aria-pressed={!releaseRemainingNights}
                  data-room-availability="blocked"
                  onClick={() => setReleaseRemainingNights(false)}
                >
                  <i className="bx bx-lock-keyhole" />
                  ไม่เปิดให้จอง
                </button>
              </div>
              <div className="checkoutNights" aria-live="polite">
                <ul>
                  {nights.map((night) => <li key={night}>
                    <time dateTime={night}>{formatDisplayDate(night, dateFormat)}</time>
                    <span>{releaseRemainingNights ? "ยกเลิกคืนจอง" : "ยังจองไว้"}</span>
                  </li>)}
                  <li><time dateTime={departure}>{formatDisplayDate(departure, dateFormat)}</time><span>วันออกเดิม</span></li>
                </ul>
                <p>{releaseRemainingNights
                  ? "คืนที่ยกเลิกจะไม่นับในอัตราเข้าพัก จองใหม่ได้เมื่อไม่มีรายการอื่นกันห้องไว้"
                  : "ยังกันห้องและนับคืนที่จองไว้ในอัตราเข้าพักจนถึงวันออกเดิม"}</p>
              </div>
            </section>
          )}
        </div>
      </div>

      <div className="checkOut__actions">
        <ActionButton
          text={isEarlyCheckOut ? "Early Check Out" : "Check Out"}
          icon="bx-door-open"
          highlight
          disabled={submitting}
          onClick={() =>
            toast.promise(checkOutHandler(), {
              loading: `กำลังเช็คเอาท์ ${booking.name}`,
              success: `เช็คเอาท์ ${booking.name} สำเร็จ`,
              error: (err) =>
                err.response?.data?.message ||
                err.message ||
                "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง",
            })
          }
        />
      </div>
    </div>
  );
};

export default CheckOut;
