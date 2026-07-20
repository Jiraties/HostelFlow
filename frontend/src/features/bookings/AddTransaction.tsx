import { useEffect, useState } from "react";
import Select, { type SingleValue } from "react-select";
import toast from "react-hot-toast";
import axios from "axios";
import ActionButton from "../../components/ActionButton";
import ModalCloseButton from "../../components/ModalCloseButton";
import CashShiftNudge from "../../components/CashShiftNudge";
import { API_URL } from "../../config/api";
import { formatBookingDates } from "../../helpers/bookingHelpers";
import { customStyles, type OptionType } from "../../helpers/selectStyling";
import {
  addTransactionPaymentMethodOptions,
  transactionPresets,
  transactionTypeOptions,
} from "../../helpers/transactionFormOptions";
import type { booking } from "../../types/bookingTypes";
import "./AddTransaction.css";
import "./Cancellation.css";

type Transaction = booking["transactions"][number];
type TransactionType = Transaction["type"];
type PaymentMethod = Transaction["paymentMethod"];
type AdjustmentDirection = "in" | "out";

const addTransactionTypePriority = new Map(
  [
    "towel",
    "pickACraft",
    "laundry",
    "slowBoat",
    "motorbike",
    "joinTour",
    "extraBed",
  ].map((type, index) => [type, index]),
);

const prioritizedTransactionTypeOptions = [...transactionTypeOptions].sort(
  (first, second) =>
    (addTransactionTypePriority.get(first.value) ?? Number.MAX_SAFE_INTEGER) -
    (addTransactionTypePriority.get(second.value) ?? Number.MAX_SAFE_INTEGER),
);

type AddTransactionFormData = {
  type: TransactionType | "";
  paymentMethod: PaymentMethod | "";
  amount: string;
  note: string;
  relatedTransactionId: string;
  adjustmentDirection: AdjustmentDirection;
};

const transactionAttachmentMeta: Record<
  TransactionType,
  { label: string; color: string }
> = {
  roomCharge: { label: "ค่าห้อง", color: "#51d1dc" },
  deposit: { label: "รับมัดจำ", color: "#facc15" },
  adjustment: { label: "ปรับราคา", color: "#a78bfa" },
  depositRefund: { label: "คืนมัดจำ", color: "#f87171" },
  cancellationRefund: { label: "คืนเงินยกเลิก", color: "#fb7185" },
  roomRefund: { label: "คืนค่าห้อง", color: "#fb7185" },
  roomChargeWriteOff: { label: "ปิดยอดค่าห้องที่เหลือ", color: "#94a3b8" },
  settlementCharge: { label: "รับชำระยอดค้าง", color: "#22c55e" },
  compensation: { label: "ชดเชยลูกค้า", color: "#38bdf8" },
  depositKept: { label: "เก็บมัดจำเป็นรายได้", color: "#facc15" },
  paymentCorrection: { label: "แก้ไขการชำระเงิน", color: "#a78bfa" },
  towel: { label: "Towel", color: "#38bdf8" },
  motorbike: { label: "Motorbike", color: "#fb923c" },
  slowBoat: { label: "Slow Boat", color: "#2dd4bf" },
  joinTour: { label: "Join Tour", color: "#22c55e" },
  extraBed: { label: "Extra Bed", color: "#ec4899" },
  pickACraft: { label: "Pick A Craft", color: "#f59e0b" },
  trek2D: { label: "Trek 2D", color: "#16a34a" },
  setMenu: { label: "Set Menu", color: "#84cc16" },
  sleeperBus: { label: "Sleeper Bus", color: "#6366f1" },
  onlyWalk: { label: "Only Walk", color: "#14b8a6" },
  laundry: { label: "Laundry", color: "#60a5fa" },
  bicycle: { label: "Bicycle", color: "#fb923c" },
  car: { label: "Car", color: "#64748b" },
  misc: { label: "Misc", color: "#94a3b8" },
  rainCoat: { label: "Rain Coat", color: "#0ea5e9" },
  passwordLock: { label: "Password Lock", color: "#8b5cf6" },
  cooking: { label: "Cooking", color: "#f97316" },
  cardSurcharge: { label: "ค่าธรรมเนียมบัตร 3%", color: "#94a3b8" },
};

const AddTransaction = ({
  bookingId,
  bookingStatus,
  transactions,
  onClose,
  onUpdated,
  onDirtyChange,
}: {
  bookingId: string;
  bookingStatus: booking["status"];
  guestName: string;
  transactions: Transaction[];
  onClose: () => void;
  onUpdated?: (booking: booking) => void;
  onDirtyChange?: (isDirty: boolean) => void;
}) => {
  const [submitting, setSubmitting] = useState(false);
  const [formData, setFormData] = useState<AddTransactionFormData>({
    type: "",
    paymentMethod: "",
    amount: "",
    note: "",
    relatedTransactionId: "",
    adjustmentDirection: "in",
  });

  useEffect(() => {
    onDirtyChange?.(
      Boolean(
        formData.type ||
        formData.paymentMethod ||
        formData.amount ||
        formData.note ||
        formData.relatedTransactionId ||
        formData.adjustmentDirection !== "in",
      ),
    );

    return () => onDirtyChange?.(false);
  }, [formData, onDirtyChange]);

  const formDataChangeHandler = (
    field: keyof AddTransactionFormData,
    value: string,
  ) => {
    if (submitting) return;
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const transactionTypeChangeHandler = (value: string) => {
    if (submitting) return;

    const type = value as TransactionType | "";
    const preset = type ? transactionPresets[type] : undefined;
    setFormData((prev) => ({
      ...prev,
      type,
      ...(preset
        ? {
            ...(preset.amount != null
              ? { amount: String(preset.amount) }
              : {}),
            paymentMethod: preset.paymentMethod || "",
          }
        : {}),
    }));
  };

  const formatPaymentMethodLabel = ({ label, value }: OptionType) => (
    <div style={value === "Unpaid" ? { color: "red" } : {}}>{label}</div>
  );

  const formatTransactionTypeLabel = ({
    label,
    color,
  }: {
    label: string;
    color?: string;
  }) => (
    <div style={{ display: "flex", alignItems: "center" }}>
      <span
        style={{
          width: "10px",
          height: "10px",
          borderRadius: "50%",
          backgroundColor: color || "#ddd",
          display: "inline-block",
          marginRight: "8px",
        }}
      />
      {label}
    </div>
  );

  const formatCurrency = (value: number) =>
    value.toLocaleString("th-TH", {
      minimumFractionDigits: value % 1 === 0 ? 0 : 2,
      maximumFractionDigits: 2,
    });

  const amount = Number(formData.amount);
  const validAmount = Number.isFinite(amount) && amount > 0 ? amount : 0;
  const shouldShowCardSurcharge =
    formData.paymentMethod === "Card" &&
    formData.type !== "depositRefund" &&
    !(formData.type === "adjustment" && formData.adjustmentDirection === "out");
  const cardSurcharge = shouldShowCardSurcharge
    ? Number((validAmount * 0.03).toFixed(2))
    : 0;
  const totalGuestPays = validAmount + cardSurcharge;
  const needsNote =
    formData.type === "adjustment" || formData.type === "depositRefund";
  const canAttachTransaction = formData.type === "adjustment";
  const hasCashMovement =
    formData.paymentMethod === "Cash" &&
    formData.type !== "deposit" &&
    validAmount > 0;
  const attachmentTransactionLabel = (transaction: Transaction) => {
    if (
      transaction.type === "roomCharge" &&
      transaction.sourceAction === "EXTEND_BOOKING"
    ) {
      return "ค่าห้องของคืนที่เพิ่ม";
    }

    if (
      transaction.type === "roomCharge" &&
      transaction.paymentMethod === "Unpaid"
    ) {
      return "ค่าห้องเดิม (ยังไม่ชำระ)";
    }

    if (
      transaction.type === "settlementCharge" &&
      transaction.relatedTransactionType === "roomCharge"
    ) {
      return "รับชำระค่าห้องภายหลัง";
    }

    return transactionAttachmentMeta[transaction.type].label;
  };
  const transactionAttachmentOptions: OptionType[] = transactions
    .filter((transaction) => transaction._id)
    .map((transaction) => ({
      value: transaction._id || "",
      label: `${attachmentTransactionLabel(transaction)} · ${transaction.paymentMethod} · ${formatCurrency(transaction.amount)} บาท`,
      color: transactionAttachmentMeta[transaction.type].color,
    }));
  const availableTransactionTypeOptions = prioritizedTransactionTypeOptions.filter(
    (option) => option.value !== "deposit" || bookingStatus === "checkedIn",
  );
  const availablePaymentMethodOptions =
    formData.type === "deposit"
      ? addTransactionPaymentMethodOptions.filter(
          (option) => option.value === "Cash",
        )
      : addTransactionPaymentMethodOptions;

  const submitHandler = async () => {
    if (submitting) return;
    setSubmitting(true);

    try {
      if (!formData.type || !formData.paymentMethod || !formData.amount) {
        throw new Error("กรุณากรอกข้อมูลให้ครบทุกช่อง");
      }

      if (!Number.isFinite(amount) || amount <= 0) {
        throw new Error("จำนวนเงินต้องมากกว่า 0");
      }

      if (needsNote && !formData.note.trim()) {
        throw new Error("กรุณาระบุหมายเหตุสำหรับรายการนี้");
      }

      if (formData.type === "adjustment" && !formData.relatedTransactionId) {
        throw new Error("กรุณาเลือกรายการเดิมที่ต้องการปรับยอด");
      }

      const transaction: Transaction = {
        type: formData.type,
        paymentMethod: formData.paymentMethod,
        amount,
        note: formData.note.trim() || undefined,
        relatedTransactionId: formData.relatedTransactionId || undefined,
        direction:
          formData.type === "adjustment"
            ? formData.adjustmentDirection
            : undefined,
      };

      const response = await axios.post(
        `${API_URL}/bookings/addTransaction/${bookingId}`,
        { transaction },
        { withCredentials: true },
      );

      if (response.status !== 200) throw new Error(response.data.message);
      if (response.data.booking) {
        onUpdated?.(formatBookingDates(response.data.booking));
      }

      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="addBooking__wrapper addTransaction__wrapper">
      <ModalCloseButton onClick={onClose} />
      <div className="addTransaction__header">
        <div>
          <h1 className="addBooking__title">
            {bookingStatus === "checkedOut"
              ? "เพิ่มรายการหลัง Check-Out"
              : "เพิ่มรายการใช้จ่าย"}
          </h1>
          {bookingStatus === "checkedOut" && (
            <p className="addTransaction__description">
              รายการนี้จะถูกบันทึกเพิ่มในประวัติของ Booking ที่ปิดแล้ว
            </p>
          )}
        </div>
      </div>

      <div className="addTransaction__form">
        {hasCashMovement && <CashShiftNudge />}
        <div>
          <p className="addBooking__label">ประเภทรายการ</p>
          <Select<OptionType>
            styles={customStyles<OptionType>()}
            classNamePrefix="rs"
            options={availableTransactionTypeOptions}
            placeholder="เลือกประเภทรายการ"
            formatOptionLabel={formatTransactionTypeLabel}
            menuPortalTarget={document.body}
            menuPosition="fixed"
            value={
              availableTransactionTypeOptions.find(
                (option) => option.value === formData.type,
              ) || null
            }
            onChange={(option: SingleValue<OptionType>) =>
              transactionTypeChangeHandler(option?.value || "")
            }
          />
        </div>

        <div>
          <p className="addBooking__label">จำนวนเงิน (฿)</p>
          <input
            className="boxInput"
            type="number"
            min="0"
            value={formData.amount}
            placeholder="เช่น 500"
            onChange={(e) => formDataChangeHandler("amount", e.target.value)}
          />
        </div>

        {formData.type === "adjustment" && (
          <div>
            <p className="addBooking__label">ทิศทางการปรับยอด</p>
            <div className="cancellation__segmentedControl">
              <button
                type="button"
                className={
                  "cancellation__segment" +
                  (formData.adjustmentDirection === "in"
                    ? " cancellation__segment--active"
                    : "")
                }
                style={{ borderRight: "1px #eee solid" }}
                onClick={() =>
                  formDataChangeHandler("adjustmentDirection", "in")
                }
              >
                <i className="bx bx-plus" />
                เพิ่มยอด
              </button>
              <button
                type="button"
                className={
                  "cancellation__segment" +
                  (formData.adjustmentDirection === "out"
                    ? " cancellation__segment--active"
                    : "")
                }
                onClick={() =>
                  formDataChangeHandler("adjustmentDirection", "out")
                }
              >
                <i className="bx bx-minus" />
                ลดยอด
              </button>
            </div>
          </div>
        )}

        {canAttachTransaction && transactionAttachmentOptions.length > 0 && (
          <div>
            <p className="addBooking__label">แนบรายการที่ปรับ</p>
            <Select<OptionType>
              styles={customStyles<OptionType>()}
              classNamePrefix="rs"
              options={transactionAttachmentOptions}
              placeholder="เลือกรายการเดิม"
              formatOptionLabel={formatTransactionTypeLabel}
              menuPortalTarget={document.body}
              menuPosition="fixed"
              value={
                transactionAttachmentOptions.find(
                  (option) => option.value === formData.relatedTransactionId,
                ) || null
              }
              onChange={(option: SingleValue<OptionType>) =>
                formDataChangeHandler(
                  "relatedTransactionId",
                  option?.value || "",
                )
              }
            />
          </div>
        )}

        <div>
          <p className="addBooking__label">จ่ายผ่าน</p>
          <Select<OptionType>
            styles={customStyles<OptionType>()}
            classNamePrefix="rs"
            options={availablePaymentMethodOptions}
            placeholder="เลือกช่องทางการชำระเงิน"
            formatOptionLabel={formatPaymentMethodLabel}
            menuPortalTarget={document.body}
            menuPosition="fixed"
            value={
              availablePaymentMethodOptions.find(
                (option) => option.value === formData.paymentMethod,
              ) || null
            }
            onChange={(option: SingleValue<OptionType>) =>
              formDataChangeHandler("paymentMethod", option?.value || "")
            }
          />
        </div>

        {needsNote && (
          <div>
            <p className="addBooking__label">หมายเหตุ</p>
            <input
              className="boxInput"
              type="text"
              value={formData.note}
              placeholder="เช่น คืนมัดจำบางส่วน / ปรับราคาตามหน้างาน"
              onChange={(e) => formDataChangeHandler("note", e.target.value)}
            />
          </div>
        )}

        {shouldShowCardSurcharge && validAmount > 0 && (
          <div className="addTransaction__cardPreview">
            <div className="addTransaction__cardPreviewList">
              <div className="addTransaction__cardPreviewRow">
                <p>ยอดรายการ</p>
                <p>{formatCurrency(validAmount)} บาท</p>
              </div>
              <div className="addTransaction__cardPreviewRow">
                <p>
                  ค่าธรรมเนียมบัตร 3%{" "}
                  <span className="addTransaction__paymentTag card">Card</span>
                </p>
                <p>{formatCurrency(cardSurcharge)} บาท</p>
              </div>
            </div>
            <div className="addTransaction__cardPreviewTotal">
              <div className="addTransaction__cardPreviewBreakdown">
                <div className="addTransaction__cardPreviewTotalRow">
                  <p>ยอดที่ต้องเก็บจากลูกค้า</p>
                  <p className="addTransaction__cardPreviewTotalText">
                    {formatCurrency(totalGuestPays)} บาท
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="addTransaction__actions">
        <ActionButton text="ยกเลิก" icon="bx-x" onClick={onClose} />
        <ActionButton
          text="บันทึกรายการ"
          icon="bx-save"
          highlight
          disabled={submitting}
          onClick={() =>
            toast.promise(submitHandler(), {
              loading: "กำลังบันทึกรายการ...",
              success: "เพิ่มรายการใช้จ่ายสำเร็จ",
              error: (err) => {
                if (axios.isAxiosError(err)) {
                  return (
                    err.response?.data?.message ||
                    "เกิดข้อผิดพลาดในการเพิ่มรายการใช้จ่าย"
                  );
                }

                if (err instanceof Error) return err.message;
                return "เกิดข้อผิดพลาดในการเพิ่มรายการใช้จ่าย";
              },
            })
          }
        />
      </div>
    </div>
  );
};

export default AddTransaction;
