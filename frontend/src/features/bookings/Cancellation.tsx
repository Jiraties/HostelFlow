import { useEffect, useMemo, useState } from "react";
import Select, { type SingleValue } from "react-select";
import axios from "axios";
import toast from "react-hot-toast";
import ActionButton from "../../components/ActionButton";
import ModalCloseButton from "../../components/ModalCloseButton";
import CashShiftNudge from "../../components/CashShiftNudge";
import { API_URL } from "../../config/api";
import { formatBookingDates } from "../../helpers/bookingHelpers";
import { customStyles, type OptionType } from "../../helpers/selectStyling";
import type { booking } from "../../types/bookingTypes";
import "./AddBooking.css";
import "./Cancellation.css";

type CancellationType =
  | "refundable"
  | "non_refundable"
  | "no_payment_received";

const cancellationTypeOptions: OptionType[] = [
  { value: "refundable", label: "คืนเงิน" },
  { value: "non_refundable", label: "ไม่คืนเงิน" },
  { value: "no_payment_received", label: "ยังไม่ได้รับเงิน" },
];

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "THB",
    minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
  }).format(amount);

const formatCashFlow = (amount: number) =>
  amount > 0 ? `${formatCurrency(amount)}` : formatCurrency(0);

const moneyOutTransactionTypes = new Set([
  "depositRefund",
  "cancellationRefund",
  "roomRefund",
  "compensation",
]);

const transactionSignedAmount = (
  transaction: booking["transactions"][number],
) => {
  const direction =
    transaction.direction ||
    (transaction.paymentMethod === "Unpaid"
      ? "neutral"
      : moneyOutTransactionTypes.has(transaction.type)
        ? "out"
        : "in");

  if (direction === "neutral") return 0;
  return direction === "out"
    ? -Math.abs(transaction.amount || 0)
    : Math.abs(transaction.amount || 0);
};

const Cancellation = ({
  booking,
  onClose,
  onUpdated,
  onDirtyChange,
}: {
  booking: booking;
  onClose?: () => void;
  onUpdated?: (booking: booking) => void;
  onDirtyChange?: (isDirty: boolean) => void;
}) => {
  const paidBreakdown = useMemo(() => {
    const breakdown = new Map<string, number>();
    let unpaidAmount = 0;

    booking.transactions.forEach((transaction) => {
      if (transaction.paymentMethod === "Unpaid") {
        unpaidAmount += transaction.amount;
        return;
      }

      const currentAmount = breakdown.get(transaction.paymentMethod) || 0;

      breakdown.set(
        transaction.paymentMethod,
        currentAmount + transactionSignedAmount(transaction),
      );
    });

    return {
      paidByMethod: Array.from(breakdown.entries())
        .map(([method, amount]) => [method, Math.max(amount, 0)] as const)
        .filter(([, amount]) => amount > 0),
      paidTotal: Array.from(breakdown.values()).reduce(
        (sum, amount) => sum + Math.max(amount, 0),
        0,
      ),
      unpaidAmount,
    };
  }, [booking.transactions]);

  const hasNonRefundableAdvance =
    booking.advancePayment?.nonRefundableOnCancellation === true;
  const initialCancellationType: CancellationType = hasNonRefundableAdvance
    ? "non_refundable"
    : "refundable";

  const [cancellationType, setCancellationType] =
    useState<CancellationType>(initialCancellationType);
  const [reopenRoom, setReopenRoom] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const hasReceivedPayment = paidBreakdown.paidTotal > 0;
  const effectiveCancellationType = hasReceivedPayment
    ? hasNonRefundableAdvance
      ? "non_refundable"
      : cancellationType
    : "no_payment_received";

  const refundAmount =
    hasReceivedPayment && effectiveCancellationType === "refundable"
      ? paidBreakdown.paidTotal
      : 0;
  const keptAmount =
    hasReceivedPayment && effectiveCancellationType === "non_refundable"
      ? paidBreakdown.paidTotal
      : 0;
  const availableCancellationTypeOptions = hasReceivedPayment
    ? hasNonRefundableAdvance
      ? cancellationTypeOptions.filter(
          (option) => option.value === "non_refundable",
        )
      : cancellationTypeOptions.filter(
          (option) => option.value !== "no_payment_received",
        )
      : cancellationTypeOptions.filter(
          (option) => option.value === "no_payment_received",
        );
  const cashRefundAmount = paidBreakdown.paidByMethod.find(
    ([method]) => method === "Cash",
  )?.[1] || 0;
  const hasCashMovement =
    effectiveCancellationType === "refundable" && cashRefundAmount > 0;

  const selectedCancellationType =
    cancellationTypeOptions.find(
      (option) => option.value === effectiveCancellationType,
    ) || null;

  useEffect(() => {
    onDirtyChange?.(
      cancellationType !== initialCancellationType || reopenRoom !== true,
    );

    return () => onDirtyChange?.(false);
  }, [cancellationType, initialCancellationType, onDirtyChange, reopenRoom]);

  const submitHandler = async () => {
    if (submitting) return;
    setSubmitting(true);

    try {
      const payload: {
        expectedRevision: number;
        reopenRoom: boolean;
        cancellationType: CancellationType;
      } = {
        expectedRevision: booking.revision,
        reopenRoom,
        cancellationType: effectiveCancellationType,
      };

      const response = await axios.patch(
        `${API_URL}/bookings/cancelBooking/${booking.bookingId}`,
        payload,
        { withCredentials: true },
      );

      if (response.data.booking) {
        onUpdated?.(formatBookingDates(response.data.booking));
      }

      onClose?.();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="cancellation__wrapper">
      {onClose && <ModalCloseButton onClick={onClose} />}
      <h1 className="addBooking__title">ยกเลิกการจอง</h1>
      {hasCashMovement && <CashShiftNudge />}
      {hasNonRefundableAdvance && (
        <div className="cancellation__advanceNotice">
          <i className="bx bx-lock-keyhole" aria-hidden="true" />
          <p>
            การจองนี้รับค่าห้องล่วงหน้าแล้ว
            {booking.advancePayment?.calculationMode === "amount"
              ? ` ${formatCurrency(booking.advancePayment.amount)}`
              : ` ${booking.advancePayment?.percentage}%`}
            {" "}ระบบจะเก็บยอดที่รับไว้และปิดยอดที่เหลือโดยอัตโนมัติ
          </p>
        </div>
      )}

      <section className="cancellation__section">
        <div className="addBooking__grid">
          <div>
            <p className="addBooking__label">ประเภทการยกเลิก</p>
            <Select<OptionType>
              styles={customStyles<OptionType>()}
              classNamePrefix="rs"
              options={availableCancellationTypeOptions}
              value={selectedCancellationType}
              isDisabled={!hasReceivedPayment || hasNonRefundableAdvance}
              onChange={(option: SingleValue<OptionType>) =>
                setCancellationType(
                  (option?.value as CancellationType) || "refundable",
                )
              }
            />
          </div>
          <div>
            <p className="addBooking__label">สถานะห้องหลังยกเลิก</p>
            <div className="cancellation__segmentedControl">
              <button
                type="button"
                className={
                  "cancellation__segment" +
                  (reopenRoom ? " cancellation__segment--active" : "")
                }
                style={{ borderRight: "1px #eee solid" }}
                onClick={() => setReopenRoom(true)}
              >
                <i className="bx bx-door-open" />
                เปิดให้จอง
              </button>
              <button
                type="button"
                className={
                  "cancellation__segment" +
                  (!reopenRoom ? " cancellation__segment--active" : "")
                }
                onClick={() => setReopenRoom(false)}
              >
                <i className="bx bx-lock-keyhole" />
                ไม่เปิดให้จอง
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="cancellation__section">
        <p className="addBooking__label">สรุปยอดการยกเลิก</p>
        <div className="cancellation__paymentConfirmation">
          <div className="cancellation__paymentConfirmationList">
            {hasReceivedPayment ? (
              paidBreakdown.paidByMethod.map(([method, amount]) => (
                <div className="cancellation__paymentRow" key={method}>
                  <p>
                    {cancellationType === "refundable" ? "คืน" : "เก็บ"}
                    ยอดที่รับแล้ว{" "}
                    <span
                      className={`cancellation__paymentTag ${method.toLowerCase()}`}
                    >
                      {method}
                    </span>
                  </p>
                  <p>{formatCurrency(amount)}</p>
                </div>
              ))
            ) : (
              <div className="cancellation__paymentRow">
                <p>ยังไม่มีการรับเงินสำหรับการจองนี้</p>
                <p>{formatCurrency(0)}</p>
              </div>
            )}
          </div>

          <div className="cancellation__paymentConfirmationTotal">
            <div className="cancellation__totalsBreakdown">
              {hasReceivedPayment && (
                <p className="cancellation__summaryNote"></p>
              )}
              <div className="cancellation__totalRowFlex">
                <div className="cancellation__totalRow">
                  <p>คืนให้ลูกค้า</p>
                  <p className="cancellation__paymentConfirmationTotalText">
                    {formatCashFlow(refundAmount)}
                  </p>
                </div>
                <div className="cancellation__totalRow other-total">
                  <p>ที่พักเก็บไว้</p>
                  <p className="cancellation__paymentConfirmationTotalText">
                    {formatCurrency(keptAmount)}
                  </p>
                </div>
                <div className="cancellation__totalRow other-total">
                  <p>สถานะห้อง:</p>
                  <p className="cancellation__paymentConfirmationTotalText">
                    {reopenRoom ? "เปิดให้จอง" : "ไม่เปิดให้จอง"}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="cancellation__actions">
        <ActionButton
          text="ยืนยันการยกเลิก"
          icon="bx-calendar-x"
          highlight
          disabled={submitting}
          onClick={() =>
            toast.promise(submitHandler(), {
              loading: `กำลังยกเลิกการจองของ ${booking.name}`,
              success: `ยกเลิกการจองของ ${booking.name} เรียบร้อยแล้ว`,
              error: (err) =>
                err.response?.data?.message ||
                "เกิดข้อผิดพลาดในการยกเลิกการจอง",
            })
          }
        />
      </div>
    </form>
  );
};

export default Cancellation;
