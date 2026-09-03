import { useEffect, useState } from "react";
import axios from "axios";
import Select, { type SingleValue } from "react-select";
import toast from "react-hot-toast";
import ActionButton from "../../components/ActionButton";
import CashShiftNudge from "../../components/CashShiftNudge";
import ModalCloseButton from "../../components/ModalCloseButton";
import { API_URL } from "../../config/api";
import { getApiErrorMessage } from "../../helpers/apiErrorMessage";
import { formatBookingDates } from "../../helpers/bookingHelpers";
import { paymentMethodOptions } from "../../helpers/options";
import { customStyles, type OptionType } from "../../helpers/selectStyling";
import type { booking } from "../../types/bookingTypes";
import "./AddTransaction.css";
import "./ReceiveRoomPayment.css";

type Transaction = booking["transactions"][number];
type PaymentMethod = Transaction["paymentMethod"];

const receivePaymentMethods = paymentMethodOptions.filter((option) =>
  ["Cash", "Card", "Transfer"].includes(option.value),
);

const formatCurrency = (amount: number) =>
  amount.toLocaleString("th-TH", {
    minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });

const ReceiveRoomPayment = ({
  booking: currentBooking,
  transaction,
  remainingAmount,
  onClose,
  onUpdated,
  onDirtyChange,
}: {
  booking: booking;
  transaction: Transaction;
  remainingAmount: number;
  onClose: () => void;
  onUpdated?: (booking: booking) => void;
  onDirtyChange?: (isDirty: boolean) => void;
}) => {
  const [amount, setAmount] = useState(String(remainingAmount));
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | "">("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const numericAmount = Number(amount);
  const validAmount = Number.isFinite(numericAmount) && numericAmount > 0
    ? numericAmount
    : 0;
  const surcharge = paymentMethod === "Card"
    ? Number((validAmount * 0.03).toFixed(2))
    : 0;
  const afterRemaining = Math.max(
    Number((remainingAmount - validAmount).toFixed(2)),
    0,
  );

  useEffect(() => {
    onDirtyChange?.(
      amount !== String(remainingAmount) ||
        Boolean(paymentMethod || note),
    );
    return () => onDirtyChange?.(false);
  }, [amount, note, onDirtyChange, paymentMethod, remainingAmount]);

  const submit = async () => {
    if (submitting) return;
    if (!transaction._id) throw new Error("ไม่พบรายการค่าห้อง กรุณารีเฟรช Booking");
    if (!paymentMethod) throw new Error("กรุณาเลือกช่องทางรับชำระ");
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      throw new Error("จำนวนเงินต้องมากกว่า 0");
    }
    if (numericAmount > remainingAmount) {
      throw new Error(
        `รับชำระได้ไม่เกิน ${formatCurrency(remainingAmount)} บาท`,
      );
    }

    setSubmitting(true);
    try {
      const response = await axios.post(
        `${API_URL}/bookings/${currentBooking.bookingId}/pre-arrival-room-payments`,
        {
          expectedRevision: currentBooking.revision,
          relatedTransactionId: transaction._id,
          amount: numericAmount,
          paymentMethod,
          note: note.trim() || undefined,
        },
        {
          withCredentials: true,
          headers: { "Idempotency-Key": idempotencyKey },
        },
      );
      onUpdated?.(formatBookingDates(response.data.booking));
      onClose();
    } catch (error) {
      throw new Error(
        getApiErrorMessage(error, "ไม่สามารถบันทึกรับชำระค่าห้องได้"),
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="addBooking__wrapper receiveRoomPayment__wrapper">
      <ModalCloseButton onClick={onClose} />
      <header className="receiveRoomPayment__header">
        <div className="receiveRoomPayment__titleRow">
          <h1 className="addBooking__title">รับชำระค่าห้อง</h1>
          <span className="receiveRoomPayment__eyebrow">
            <i className="bx bx-wallet" aria-hidden="true" /> ก่อน Check-In
          </span>
        </div>
        <p>Booking ยังอยู่สถานะเดิม และรายการจะลงวันที่รับเงินจริงวันนี้</p>
      </header>

      <div className="addTransaction__form">
        {paymentMethod === "Cash" && <CashShiftNudge />}

        <section className="receiveRoomPayment__summary" aria-label="สรุปยอดค่าห้อง">
          <div>
            <span>ยอดค้างรายการนี้</span>
            <strong>{formatCurrency(remainingAmount)} บาท</strong>
          </div>
          <i className="bx bx-right-arrow-alt" aria-hidden="true" />
          <div>
            <span>คงเหลือหลังรับชำระ</span>
            <strong>{formatCurrency(afterRemaining)} บาท</strong>
          </div>
        </section>

        <div className="receiveRoomPayment__grid">
          <label>
            <span className="addBooking__label">จำนวนเงิน (฿)</span>
            <input
              className="boxInput"
              type="number"
              min="0.01"
              max={remainingAmount}
              step="0.01"
              value={amount}
              disabled={submitting}
              onChange={(event) => setAmount(event.target.value)}
            />
          </label>
          <label>
            <span className="addBooking__label">ช่องทางรับชำระ</span>
            <Select<OptionType>
              styles={customStyles<OptionType>()}
              classNamePrefix="rs"
              options={receivePaymentMethods}
              placeholder="เลือกช่องทาง"
              value={
                receivePaymentMethods.find(
                  (option) => option.value === paymentMethod,
                ) || null
              }
              isDisabled={submitting}
              menuPortalTarget={document.body}
              menuPosition="fixed"
              onChange={(option: SingleValue<OptionType>) =>
                setPaymentMethod((option?.value || "") as PaymentMethod | "")
              }
            />
          </label>
        </div>

        {paymentMethod === "Card" && (
          <div className="receiveRoomPayment__cardTotal" role="status">
            <span>ค่าธรรมเนียมบัตร 3% · {formatCurrency(surcharge)} บาท</span>
            <strong>แขกชำระรวม {formatCurrency(validAmount + surcharge)} บาท</strong>
          </div>
        )}

        <label className="receiveRoomPayment__note">
          <span className="addBooking__label">
            หมายเหตุ <small>(ถ้ามี)</small>
          </span>
          <input
            className="boxInput"
            value={note}
            disabled={submitting}
            placeholder="รายละเอียดเพิ่มเติม"
            onChange={(event) => setNote(event.target.value)}
          />
        </label>
      </div>

      <div className="addTransaction__actions">
        <ActionButton
          text="ยืนยันรับชำระ"
          icon="bx-check"
          highlight
          disabled={submitting}
          onClick={() =>
            toast.promise(submit(), {
              loading: "กำลังบันทึกรับชำระ...",
              success: "บันทึกรับชำระค่าห้องแล้ว",
              error: (error) =>
                error instanceof Error
                  ? error.message
                  : "ไม่สามารถบันทึกรับชำระได้",
            })
          }
        />
      </div>
    </div>
  );
};

export default ReceiveRoomPayment;
