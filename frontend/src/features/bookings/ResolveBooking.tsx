import { useEffect, useMemo, useState } from "react";
import Select, { type SingleValue } from "react-select";
import axios from "axios";
import toast from "react-hot-toast";
import ActionButton from "../../components/ActionButton";
import ModalCloseButton from "../../components/ModalCloseButton";
import { API_URL } from "../../config/api";
import { formatBookingDates } from "../../helpers/bookingHelpers";
import { paymentMethodOptions } from "../../helpers/options";
import { customStyles, type OptionType } from "../../helpers/selectStyling";
import { useAuth } from "../../context/AuthContext";
import type { booking, ResolutionOutcome } from "../../types/bookingTypes";
import "./AddBooking.css";
import "./Cancellation.css";
import "./ResolveBooking.css";

type Transaction = booking["transactions"][number];
type TransactionType = Transaction["type"];
type PaymentMethod = Transaction["paymentMethod"];
type TransactionDirection = NonNullable<Transaction["direction"]>;
type FinalStatus = "checkedOut" | "cancelled";
type RoomReleaseStatus = "released" | "blocked";

type SettlementRow = {
  id: number;
  type: TransactionType;
  paymentMethod: Exclude<PaymentMethod, "Unpaid">;
  amount: string;
  direction: TransactionDirection;
  note: string;
  relatedTransactionId: string;
};

const outcomeOptions: Record<
  "open" | "checkedIn" | "closed",
  OptionType[]
> = {
  open: [
    { value: "cancelled_before_arrival", label: "ยกเลิกก่อนเข้าพัก" },
    { value: "no_show", label: "No-Show" },
    { value: "guest_left", label: "ลูกค้าไม่เข้าพัก / เคลียร์ยอดเอง" },
  ],
  checkedIn: [
    { value: "guest_left", label: "ลูกค้าออกจากที่พัก" },
    { value: "early_checkout", label: "เคลียร์ยอด Early Checkout" },
    { value: "cancelled_after_checkin", label: "ยกเลิกหลัง Check-In" },
    { value: "normal_checkout", label: "เคลียร์ยอด Check-Out เอง" },
  ],
  closed: [{ value: "post_close_adjustment", label: "แก้ไขหลังปิด" }],
};

const reasonOptions: OptionType[] = [
  { value: "guest_unhappy_room", label: "ลูกค้าไม่พอใจห้องพัก" },
  { value: "early_checkout", label: "Early checkout" },
  { value: "no_show", label: "No-show" },
  { value: "ota_cancellation", label: "ยกเลิกผ่าน OTA" },
  { value: "payment_error", label: "บันทึกการชำระเงินผิด" },
  { value: "deposit_kept_damage", label: "เก็บมัดจำ - ค่าเสียหาย" },
  { value: "deposit_kept_key", label: "เก็บมัดจำ - กุญแจ" },
  { value: "manager_approved_refund", label: "ผู้จัดการอนุมัติคืนเงิน" },
  { value: "staff_entry_error", label: "พนักงานบันทึกข้อมูลผิด" },
  { value: "other", label: "อื่น ๆ" },
];

const transactionTypeOptions: OptionType[] = [
  { value: "roomRefund", label: "คืนค่าห้อง", color: "#fb7185" },
  { value: "depositRefund", label: "คืนมัดจำ", color: "#f87171" },
  { value: "cancellationRefund", label: "คืนเงินยกเลิก", color: "#fb7185" },
  { value: "compensation", label: "ชดเชยลูกค้า", color: "#38bdf8" },
  { value: "settlementCharge", label: "เก็บเงินเพิ่ม", color: "#22c55e" },
  { value: "depositKept", label: "เก็บมัดจำ", color: "#facc15" },
  { value: "paymentCorrection", label: "แก้ไขการชำระเงิน", color: "#a78bfa" },
  { value: "adjustment", label: "ปรับยอด", color: "#94a3b8" },
];

const directionOptions: OptionType[] = [
  { value: "out", label: "เงินออก" },
  { value: "in", label: "เงินเข้า" },
  { value: "neutral", label: "ไม่มีเงินเข้า/ออก" },
];

const finalStatusOptions: OptionType[] = [
  { value: "checkedOut", label: "Check-Out แล้ว" },
  { value: "cancelled", label: "ยกเลิกแล้ว" },
];

const settlementPaymentMethodOptions = paymentMethodOptions.filter(
  (option) => option.value !== "Unpaid",
);

const defaultRow = (id: number): SettlementRow => ({
  id,
  type: "roomRefund",
  paymentMethod: "Cash",
  amount: "",
  direction: "out",
  note: "",
  relatedTransactionId: "",
});

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "THB",
    minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
  }).format(amount);

const ResolveBooking = ({
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
  const { user } = useAuth();
  const bookingIsClosed =
    booking.status === "checkedOut" || booking.status === "cancelled";
  const bookingIsCheckedIn = booking.status === "checkedIn";
  const mode = bookingIsClosed ? "closed" : bookingIsCheckedIn ? "checkedIn" : "open";
  const availableOutcomeOptions = outcomeOptions[mode];
  const [outcome, setOutcome] = useState<ResolutionOutcome>(
    availableOutcomeOptions[0].value as ResolutionOutcome,
  );
  const [finalStatus, setFinalStatus] = useState<FinalStatus>(
    booking.status === "cancelled" ? "cancelled" : "checkedOut",
  );
  const [roomReleaseStatus, setRoomReleaseStatus] =
    useState<RoomReleaseStatus>("released");
  const [reasonCode, setReasonCode] = useState("");
  const [note, setNote] = useState("");
  const [rows, setRows] = useState<SettlementRow[]>([defaultRow(Date.now())]);
  const [submitting, setSubmitting] = useState(false);

  const availableFinalStatusOptions = bookingIsClosed
    ? finalStatusOptions.filter((option) => option.value === booking.status)
    : finalStatusOptions;

  const transactionAttachmentOptions: OptionType[] = booking.transactions
    .filter((transaction) => transaction._id)
    .map((transaction) => ({
      value: transaction._id || "",
      label: `${transaction.type} · ${transaction.paymentMethod} · ${formatCurrency(
        transaction.amount,
      )}`,
    }));

  const totals = useMemo(
    () =>
      rows.reduce(
        (summary, row) => {
          const amount = Number(row.amount) || 0;
          if (row.direction === "in") summary.moneyIn += amount;
          if (row.direction === "out") summary.moneyOut += amount;
          return summary;
        },
        { moneyIn: 0, moneyOut: 0 },
      ),
    [rows],
  );

  useEffect(() => {
    onDirtyChange?.(
      Boolean(
        reasonCode ||
          note ||
          roomReleaseStatus !== "released" ||
          rows.some(
            (row) =>
              row.amount ||
              row.note ||
              row.relatedTransactionId ||
              row.type !== "roomRefund" ||
              row.paymentMethod !== "Cash" ||
              row.direction !== "out",
          ),
      ),
    );

    return () => onDirtyChange?.(false);
  }, [note, onDirtyChange, reasonCode, roomReleaseStatus, rows]);

  const updateRow = <K extends keyof SettlementRow>(
    id: number,
    field: K,
    value: SettlementRow[K],
  ) => {
    setRows((prevRows) =>
      prevRows.map((row) => {
        if (row.id !== id) return row;
        const updatedRow = { ...row, [field]: value };

        if (field === "type" && value === "depositKept") {
          updatedRow.direction = "neutral";
        }

        return updatedRow;
      }),
    );
  };

  const addRow = () => setRows((prevRows) => [...prevRows, defaultRow(Date.now())]);

  const removeRow = (id: number) =>
    setRows((prevRows) =>
      prevRows.length === 1 ? prevRows : prevRows.filter((row) => row.id !== id),
    );

  const submitHandler = async () => {
    if (submitting) return;

    if (bookingIsClosed && !user?.admin) {
      throw new Error("การแก้ไขหลังปิด Booking ต้องให้ Admin ดำเนินการ");
    }

    if (!reasonCode || !note.trim()) {
      throw new Error("กรุณาเลือกเหตุผลและระบุหมายเหตุ");
    }

    const settlementTransactions = rows
      .filter((row) => row.amount || row.note || row.relatedTransactionId)
      .map((row) => {
        const amount = Number(row.amount);

        if (!Number.isFinite(amount) || amount <= 0) {
          throw new Error("จำนวนเงินต้องมากกว่า 0");
        }

        if (row.type === "depositKept" && row.direction !== "neutral") {
          throw new Error("รายการเก็บมัดจำต้องเลือกไม่มีเงินเข้า/ออก");
        }

        return {
          type: row.type,
          paymentMethod: row.paymentMethod,
          amount,
          direction: row.direction,
          note: row.note.trim() || undefined,
          relatedTransactionId: row.relatedTransactionId || undefined,
        };
      });

    setSubmitting(true);

    try {
      const response = await axios.patch(
        `${API_URL}/bookings/resolveBooking/${booking.bookingId}`,
        {
          outcome,
          finalStatus,
          roomReleaseStatus,
          reasonCode,
          note: note.trim(),
          transactions: settlementTransactions,
        },
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

  const formatOptionLabel = ({ label, color }: { label: string; color?: string }) => (
    <div className="resolveBooking__option">
      {color && <span style={{ backgroundColor: color }} />}
      {label}
    </div>
  );

  return (
    <div className="addBooking__wrapper resolveBooking__wrapper">
      {onClose && <ModalCloseButton onClick={onClose} />}
      <div className="resolveBooking__header">
        <h1 className="addBooking__title">
          {bookingIsClosed ? "แก้ไขหลังปิด" : "เคลียร์การเข้าพัก"}
        </h1>
        {bookingIsClosed && (
          <p className="resolveBooking__warning">
            Booking นี้ปิดแล้ว รายการนี้ต้องตรวจสอบย้อนหลัง
          </p>
        )}
      </div>

      <div className="addBooking__grid">
        <div>
          <p className="addBooking__label">ผลลัพธ์</p>
          <Select<OptionType>
            styles={customStyles<OptionType>()}
            options={availableOutcomeOptions}
            value={
              availableOutcomeOptions.find((option) => option.value === outcome) ||
              null
            }
            menuPortalTarget={document.body}
            menuPosition="fixed"
            onChange={(option: SingleValue<OptionType>) =>
              setOutcome((option?.value as ResolutionOutcome) || outcome)
            }
          />
        </div>
        <div>
          <p className="addBooking__label">สถานะสุดท้าย</p>
          <Select<OptionType>
            styles={customStyles<OptionType>()}
            options={availableFinalStatusOptions}
            value={
              availableFinalStatusOptions.find(
                (option) => option.value === finalStatus,
              ) || null
            }
            isDisabled={bookingIsClosed}
            menuPortalTarget={document.body}
            menuPosition="fixed"
            onChange={(option: SingleValue<OptionType>) =>
              setFinalStatus((option?.value as FinalStatus) || finalStatus)
            }
          />
        </div>
        <div>
          <p className="addBooking__label">สถานะห้องหลังเคลียร์รายการ</p>
          <div className="cancellation__segmentedControl resolveBooking__segmentedControl">
            <button
              type="button"
              className={
                "cancellation__segment" +
                (roomReleaseStatus === "released"
                  ? " cancellation__segment--active"
                  : "")
              }
              style={{ borderRight: "1px #eee solid" }}
              onClick={() => setRoomReleaseStatus("released")}
            >
              <i className="bx bx-door-open" />
              เปิดให้จอง
            </button>
            <button
              type="button"
              className={
                "cancellation__segment" +
                (roomReleaseStatus === "blocked"
                  ? " cancellation__segment--active"
                  : "")
              }
              onClick={() => setRoomReleaseStatus("blocked")}
            >
              <i className="bx bx-lock-alt" />
              ไม่เปิด
            </button>
          </div>
        </div>
        <div>
          <p className="addBooking__label">เหตุผล</p>
          <Select<OptionType>
            styles={customStyles<OptionType>()}
            options={reasonOptions}
            value={
              reasonOptions.find((option) => option.value === reasonCode) || null
            }
            menuPortalTarget={document.body}
            menuPosition="fixed"
            onChange={(option: SingleValue<OptionType>) =>
              setReasonCode(option?.value || "")
            }
          />
        </div>
      </div>

      <div>
        <p className="addBooking__label">หมายเหตุ</p>
        <textarea
          className="boxInput resolveBooking__note"
          value={note}
          placeholder="สรุปเหตุผลที่ต้องเคลียร์รายการ / คืนเงิน / เก็บเงินเพิ่ม"
          onChange={(event) => setNote(event.target.value)}
        />
      </div>

      <section className="resolveBooking__section">
        <div className="resolveBooking__sectionHeader">
          <p className="addBooking__label">รายการเคลียร์ยอด</p>
          <button type="button" className="resolveBooking__linkButton" onClick={addRow}>
            <i className="bx bx-plus" />
            เพิ่มรายการ
          </button>
        </div>

        <div className="resolveBooking__rows">
          {rows.map((row) => (
            <div className="resolveBooking__row" key={row.id}>
              <div>
                <p className="addBooking__label">ประเภทรายการ</p>
                <Select<OptionType>
                  styles={customStyles<OptionType>()}
                  options={transactionTypeOptions}
                  value={
                    transactionTypeOptions.find(
                      (option) => option.value === row.type,
                    ) || null
                  }
                  formatOptionLabel={formatOptionLabel}
                  menuPortalTarget={document.body}
                  menuPosition="fixed"
                  onChange={(option: SingleValue<OptionType>) =>
                    updateRow(row.id, "type", (option?.value as TransactionType) || row.type)
                  }
                />
              </div>
              <div>
                <p className="addBooking__label">จำนวนเงิน</p>
                <input
                  className="boxInput"
                  type="number"
                  min="0"
                  value={row.amount}
                  placeholder="0"
                  onChange={(event) => updateRow(row.id, "amount", event.target.value)}
                />
              </div>
              <div>
                <p className="addBooking__label">ทิศทางเงิน</p>
                <Select<OptionType>
                  styles={customStyles<OptionType>()}
                  options={directionOptions}
                  value={
                    directionOptions.find(
                      (option) => option.value === row.direction,
                    ) || null
                  }
                  isDisabled={row.type === "depositKept"}
                  menuPortalTarget={document.body}
                  menuPosition="fixed"
                  onChange={(option: SingleValue<OptionType>) =>
                    updateRow(
                      row.id,
                      "direction",
                      (option?.value as TransactionDirection) || row.direction,
                    )
                  }
                />
              </div>
              <div>
                <p className="addBooking__label">ช่องทาง</p>
                <Select<OptionType>
                  styles={customStyles<OptionType>()}
                  options={settlementPaymentMethodOptions}
                  value={
                    settlementPaymentMethodOptions.find(
                      (option) => option.value === row.paymentMethod,
                    ) || null
                  }
                  menuPortalTarget={document.body}
                  menuPosition="fixed"
                  onChange={(option: SingleValue<OptionType>) =>
                    updateRow(
                      row.id,
                      "paymentMethod",
                      (option?.value as Exclude<PaymentMethod, "Unpaid">) ||
                        row.paymentMethod,
                    )
                  }
                />
              </div>
              <div>
                <p className="addBooking__label">อ้างอิงรายการเดิม</p>
                <Select<OptionType>
                  styles={customStyles<OptionType>()}
                  options={transactionAttachmentOptions}
                  value={
                    transactionAttachmentOptions.find(
                      (option) => option.value === row.relatedTransactionId,
                    ) || null
                  }
                  isClearable
                  placeholder="ไม่บังคับ"
                  menuPortalTarget={document.body}
                  menuPosition="fixed"
                  onChange={(option: SingleValue<OptionType>) =>
                    updateRow(row.id, "relatedTransactionId", option?.value || "")
                  }
                />
              </div>
              <div className="resolveBooking__rowNote">
                <p className="addBooking__label">หมายเหตุรายการ</p>
                <input
                  className="boxInput"
                  value={row.note}
                  placeholder="ไม่บังคับ"
                  onChange={(event) => updateRow(row.id, "note", event.target.value)}
                />
              </div>
              <button
                type="button"
                className="resolveBooking__removeButton"
                disabled={rows.length === 1}
                onClick={() => removeRow(row.id)}
              >
                <i className="bx bx-trash" />
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="cancellation__section">
        <p className="addBooking__label">สรุปยอดเคลียร์รายการ</p>
        <div className="cancellation__paymentConfirmation">
          <div className="cancellation__paymentConfirmationList">
            <div className="cancellation__paymentRow">
              <p>ยอดที่ต้องรับเพิ่ม</p>
              <p>{formatCurrency(totals.moneyIn)}</p>
            </div>
            <div className="cancellation__paymentRow">
              <p>ยอดที่ต้องคืนลูกค้า</p>
              <p>{formatCurrency(totals.moneyOut)}</p>
            </div>
          </div>

          <div className="cancellation__paymentConfirmationTotal">
            <div className="cancellation__totalsBreakdown">
              <div className="cancellation__totalRowFlex">
                <div className="cancellation__totalRow">
                  <p>เงินเข้า</p>
                  <p className="cancellation__paymentConfirmationTotalText">
                    {formatCurrency(totals.moneyIn)}
                  </p>
                </div>
                <div className="cancellation__totalRow other-total">
                  <p>เงินออก</p>
                  <p className="cancellation__paymentConfirmationTotalText">
                    {formatCurrency(totals.moneyOut)}
                  </p>
                </div>
                <div className="cancellation__totalRow other-total">
                  <p>สุทธิ</p>
                  <p className="cancellation__paymentConfirmationTotalText">
                    {formatCurrency(totals.moneyIn - totals.moneyOut)}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="resolveBooking__actions">
        <ActionButton text="ยกเลิก" icon="bx-x" onClick={() => onClose?.()} />
        <ActionButton
          text={bookingIsClosed ? "บันทึกการแก้ไข" : "เคลียร์การเข้าพัก"}
          icon={bookingIsClosed ? "bx-history" : "bx-receipt"}
          highlight
          disabled={submitting || (bookingIsClosed && !user?.admin)}
          onClick={() =>
            toast.promise(submitHandler(), {
              loading: "กำลังบันทึก...",
              success: "บันทึกสำเร็จ",
              error: (err) =>
                err.response?.data?.message ||
                err.message ||
                "เกิดข้อผิดพลาดในการบันทึก",
            })
          }
        />
      </div>
    </div>
  );
};

export default ResolveBooking;
