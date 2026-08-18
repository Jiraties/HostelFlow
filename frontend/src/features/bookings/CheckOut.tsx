import { useEffect, useState } from "react";
import axios from "axios";
import toast from "react-hot-toast";
import ActionButton from "../../components/ActionButton";
import ModalCloseButton from "../../components/ModalCloseButton";
import type { booking } from "../../types/bookingTypes";

import { API_URL } from "../../config/api";
import { formatBookingDates } from "../../helpers/bookingHelpers";
import { platformMap } from "../../helpers/maps";
import { formatRoomStayRooms } from "../../helpers/roomStayHelpers";
import { useAuth } from "../../context/AuthContext";
import { formatDisplayDate } from "../../helpers/displayDate";

import "./BookingCheckbox.css";
import "./CheckIn.css";
import "./Cancellation.css";
import "./CheckOut.css";

type CheckOutProps = {
  booking: booking;
  isEarlyCheckOut: boolean;
  onClose?: () => void;
  onDirtyChange?: (isDirty: boolean) => void;
  handleCheckOutSuccess?: (booking: booking) => void;
  onRecordPayment?: () => void;
};

const CheckOut = ({
  onClose,
  booking,
  isEarlyCheckOut,
  onDirtyChange,
  handleCheckOutSuccess,
  onRecordPayment,
}: CheckOutProps) => {
  const { user } = useAuth();
  const dateFormat = user?.settings.dateFormat || "dd/MM/yyyy";
  const [releaseRemainingNights, setReleaseRemainingNights] = useState(true);
  const [confirmedDepositReturn, setConfirmedDepositReturn] = useState(false);
  const [confirmedStillUnpaid, setConfirmedStillUnpaid] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const today = new Date();
  const todayDateOnly = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );
  const checkOutDate = new Date(booking.checkOut);
  const checkOutDateOnly = new Date(
    checkOutDate.getFullYear(),
    checkOutDate.getMonth(),
    checkOutDate.getDate(),
  );
  const nightsEarly = Math.max(
    Math.round(
      (checkOutDateOnly.getTime() - todayDateOnly.getTime()) / 86400000,
    ),
    0,
  );

  const formatCurrency = (num: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      minimumFractionDigits: num % 1 === 0 ? 0 : 2,
      maximumFractionDigits: 2,
      currency: "THB",
    }).format(num);

  const depositTransactions = booking.transactions.filter(
    (transaction) => transaction.type === "deposit",
  );
  const depositAmount = depositTransactions.reduce(
    (total, transaction) => total + transaction.amount,
    0,
  );
  const refundedDepositAmount = booking.transactions
    .filter((transaction) => transaction.type === "depositRefund")
    .reduce((total, transaction) => total + transaction.amount, 0);
  const retainedDepositAmount = booking.transactions
    .filter((transaction) => transaction.type === "depositKept")
    .reduce((total, transaction) => total + transaction.amount, 0);
  const remainingDepositAmount = Math.max(
    depositAmount - refundedDepositAmount - retainedDepositAmount,
    0,
  );
  const depositPaymentMethod = depositTransactions[0]?.paymentMethod || "Cash";
  const unpaidRoomChargeAmount = Math.max(
    Number(
      booking.transactions
        .reduce((sum, transaction) => {
          if (transaction.type === "roomCharge") {
            return (
              sum +
              (transaction.paymentMethod === "Unpaid"
                ? Math.abs(transaction.amount || 0)
                : 0)
            );
          }

          if (
            ["settlementCharge", "paymentCorrection"].includes(
              transaction.type,
            ) &&
            transaction.relatedTransactionType === "roomCharge" &&
            transaction.paymentMethod !== "Unpaid"
          ) {
            return sum - Math.abs(transaction.amount || 0);
          }

          return sum;
        }, 0)
        .toFixed(2),
    ),
    0,
  );
  const hasUnpaidBalance = unpaidRoomChargeAmount > 0;
  useEffect(() => {
    onDirtyChange?.(
      confirmedDepositReturn ||
        confirmedStillUnpaid ||
        (isEarlyCheckOut && !releaseRemainingNights),
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
        {isEarlyCheckOut && (
          <div className="bookingNoticeStack">
            {isEarlyCheckOut && (
              <div className="checkIn__reminder checkOut__earlyReminder">
                <i className="bx bx-message-bubble-exclamation" />
                <p>
                  ลูกค้าดังกล่าวเช็คเอาท์ก่อนกำหนด{" "}
                  <strong>{nightsEarly} คืน</strong>
                </p>
              </div>
            )}
          </div>
        )}
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
                    onChange={(e) => setConfirmedStillUnpaid(e.target.checked)}
                  />
                  <span className="box"></span>
                </label>
              </div>
            </section>
          )}

          <div className="checkIn__paymentConfirmation">
            <div className="checkIn__paymentConfirmationList">
              <div className="checkIn__paymentRow">
                <p>
                  ค่ามัดจำ{" "}
                  <span
                    className={`checkIn__paymentTag ${depositPaymentMethod.toLowerCase()}`}
                  >
                    {depositPaymentMethod}
                  </span>
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
                    onChange={(event) =>
                      setConfirmedDepositReturn(event.target.checked)
                    }
                  />
                  <span className="box" />
                </label>
              )}
            </div>
          </div>

          {isEarlyCheckOut && (
            <section className="checkOut__section">
              <p className="checkIn__label">สถานะห้องสำหรับคืนที่เหลือ</p>
              <div className="cancellation__segmentedControl">
                <button
                  type="button"
                  className={
                    "cancellation__segment" +
                    (releaseRemainingNights
                      ? " cancellation__segment--active"
                      : "")
                  }
                  style={{ borderRight: "1px #eee solid" }}
                  onClick={() => setReleaseRemainingNights(true)}
                >
                  <i className="bx bx-door-open" />
                  เปิดให้จอง
                </button>
                <button
                  type="button"
                  className={
                    "cancellation__segment" +
                    (!releaseRemainingNights
                      ? " cancellation__segment--active"
                      : "")
                  }
                  onClick={() => setReleaseRemainingNights(false)}
                >
                  <i className="bx bx-lock-keyhole" />
                  ไม่เปิดให้จอง
                </button>
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
