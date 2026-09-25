import { useEffect, useState } from "react";
import Select, { type SingleValue } from "react-select";
import toast from "react-hot-toast";
import axios from "axios";
import ActionButton from "../../components/ActionButton";
import ModalCloseButton from "../../components/ModalCloseButton";
import CashShiftNudge from "../../components/CashShiftNudge";
import { API_URL } from "../../config/api";
import {
  bookingFinancialPosition,
  formatBookingDates,
} from "../../helpers/bookingHelpers";
import { paymentMethodOptions } from "../../helpers/options";
import { customStyles, type OptionType } from "../../helpers/selectStyling";
import {
  addTransactionPaymentMethodOptions,
  transactionPresets,
  transactionTypeOptions,
} from "../../helpers/transactionFormOptions";
import type { booking } from "../../types/bookingTypes";
import "./AddTransaction.css";
import "./Cancellation.css";
import "./ResolveBooking.css";

type Transaction = booking["transactions"][number];
type TransactionType = Transaction["type"];
type PaymentMethod = Transaction["paymentMethod"];
type AdjustmentDirection = "in" | "out";

const rankedTransactionTypes = [
  "towel",
  "slowBoat",
  "motorbike",
  "pickACraft",
  "laundry",
  "deposit",
  "joinTour",
  "extraBed",
  "misc",
  "onlyWalk",
  "rainCoat",
  "setMenu",
];
const addTransactionTypePriority = new Map(
  rankedTransactionTypes.map((type, index) => [type, index]),
);

const prioritizedTransactionTypeOptions = [...transactionTypeOptions].sort(
  (first, second) =>
    (addTransactionTypePriority.get(first.value) ?? Number.MAX_SAFE_INTEGER) -
      (addTransactionTypePriority.get(second.value) ?? Number.MAX_SAFE_INTEGER) ||
    first.label.localeCompare(second.label, "en"),
);
const frequentTransactionTypes = new Set(rankedTransactionTypes.slice(0, 5));
const focusedTransactionTypeOptions: OptionType[] = [
  { value: "compensation", label: "ชดเชยลูกค้า", color: "#38bdf8" },
  { value: "roomRefund", label: "คืนเงินลูกค้า", color: "#fb7185" },
];

type AddTransactionFormData = {
  type: TransactionType | "";
  paymentMethod: PaymentMethod | "";
  amount: string;
  note: string;
  reason: string;
  reference: string;
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
  booking: currentBooking,
  onClose,
  onUpdated,
  onDirtyChange,
}: {
  booking: booking;
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
    reason: "",
    reference: "",
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
        formData.reason ||
        formData.reference ||
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
      relatedTransactionId: "",
      reason: "",
      reference: "",
      ...(type === "roomRefund" || type === "compensation"
        ? { paymentMethod: "Cash" as PaymentMethod }
        : prev.paymentMethod === "OTA"
          ? { paymentMethod: "" as const }
          : {}),
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
  const isRefund = formData.type === "roomRefund";
  const isCompensation = formData.type === "compensation";
  const isFocusedFinancialAction = isRefund || isCompensation;
  const validAmount = Number.isFinite(amount) && amount > 0 ? amount : 0;
  const shouldShowCardSurcharge =
    formData.paymentMethod === "Card" &&
    !isFocusedFinancialAction &&
    formData.type !== "depositRefund" &&
    !(formData.type === "adjustment" && formData.adjustmentDirection === "out");
  const cardSurcharge = shouldShowCardSurcharge
    ? Number((validAmount * 0.03).toFixed(2))
    : 0;
  const totalGuestPays = validAmount + cardSurcharge;
  const needsNote =
    formData.type === "adjustment" ||
    formData.type === "depositRefund" ||
    formData.type === "misc" ||
    isFocusedFinancialAction;
  const canAttachTransaction = formData.type === "adjustment" || isRefund;
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
  const effectiveTransactions =
    currentBooking.effectiveTransactions || currentBooking.transactions;
  const remainingRefundableAmount = (transaction: Transaction) => {
    const alreadyRefunded = effectiveTransactions
      .filter(
        (candidate) =>
          ["roomRefund", "cancellationRefund"].includes(candidate.type) &&
          candidate.relatedTransactionId === transaction._id,
      )
      .reduce(
        (total, candidate) => total + Math.abs(candidate.amount || 0),
        0,
      );
    return Math.max(transaction.amount - alreadyRefunded, 0);
  };
  const refundableTransactions = effectiveTransactions.filter(
    (transaction) =>
      transaction._id &&
      transaction.paymentMethod !== "Unpaid" &&
      transaction.direction !== "out" &&
      ![
        "deposit",
        "depositRefund",
        "roomRefund",
        "cancellationRefund",
        "compensation",
        "cardSurcharge",
      ].includes(transaction.type) &&
      remainingRefundableAmount(transaction) > 0,
  );
  const attachableTransactions = isRefund
    ? refundableTransactions
    : currentBooking.transactions;
  const transactionAttachmentOptions: OptionType[] = attachableTransactions
    .filter((transaction) => transaction._id)
    .map((transaction) => ({
      value: transaction._id || "",
      label: isRefund
        ? `${attachmentTransactionLabel(transaction)} · ${transaction.paymentMethod} · คืนได้ ${formatCurrency(remainingRefundableAmount(transaction))} บาท`
        : `${attachmentTransactionLabel(transaction)} · ${transaction.paymentMethod} · ${formatCurrency(transaction.amount)} บาท`,
      color: transactionAttachmentMeta[transaction.type].color,
    }));
  const availableTransactionTypeOptions = [
    ...prioritizedTransactionTypeOptions.filter(
      (option) =>
        option.value !== "deposit" || currentBooking.status === "checkedIn",
    ),
    ...focusedTransactionTypeOptions,
  ];
  const transactionTypeOptionGroups = [
    {
      label: "ใช้บ่อย",
      options: availableTransactionTypeOptions.filter((option) =>
        frequentTransactionTypes.has(option.value),
      ),
    },
    {
      label: "รายการอื่น",
      options: availableTransactionTypeOptions.filter(
        (option) =>
          !frequentTransactionTypes.has(option.value) &&
          !focusedTransactionTypeOptions.some(
            (focusedOption) => focusedOption.value === option.value,
          ),
      ),
    },
    { label: "คืนเงิน / ชดเชย", options: focusedTransactionTypeOptions },
  ];
  const availablePaymentMethodOptions =
    isFocusedFinancialAction
      ? paymentMethodOptions.filter((option) => option.value !== "Unpaid")
      : formData.type === "deposit"
        ? addTransactionPaymentMethodOptions.filter(
            (option) => option.value === "Cash",
          )
        : addTransactionPaymentMethodOptions;
  const currentPosition = bookingFinancialPosition(currentBooking);
  const afterBookingTotal = Math.max(
    currentPosition.bookingTotal - (isFocusedFinancialAction ? validAmount : 0),
    0,
  );
  const afterAmountReceived = Math.max(
    currentPosition.amountReceived - (isFocusedFinancialAction ? validAmount : 0),
    0,
  );
  const afterDifference = Number(
    (afterBookingTotal - afterAmountReceived).toFixed(2),
  );
  const [idempotencyKey] = useState(() => crypto.randomUUID());

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
        throw new Error(
          formData.type === "misc"
            ? "กรุณาระบุเหตุผลสำหรับรายการ Misc"
            : "กรุณาระบุหมายเหตุสำหรับรายการนี้",
        );
      }

      if (isFocusedFinancialAction && !formData.reason.trim()) {
        throw new Error("กรุณาระบุเหตุผลสำหรับรายการนี้");
      }

      if (isRefund && !formData.relatedTransactionId) {
        throw new Error("กรุณาเลือกรายการรับเงินเดิมที่ต้องการคืน");
      }

      if (formData.type === "adjustment" && !formData.relatedTransactionId) {
        throw new Error("กรุณาเลือกรายการเดิมที่ต้องการปรับยอด");
      }

      let response;
      if (isFocusedFinancialAction) {
        let largeAmountConfirmed = false;
        if (amount >= 10000 && amount % 10 === 0) {
          largeAmountConfirmed = window.confirm(
            `ยืนยันยอด ${formatCurrency(amount)} บาท? ระบบตรวจพบว่ายอดอาจมีศูนย์เกิน`,
          );
          if (!largeAmountConfirmed) return;
        }
        response = await axios.post(
          `${API_URL}/bookings/${currentBooking.bookingId}/financial-actions`,
          {
            expectedRevision: currentBooking.revision,
            action: isRefund ? "refund" : "compensation",
            amount,
            paymentMethod: formData.paymentMethod,
            reason: formData.reason.trim(),
            note: formData.note.trim(),
            reference: formData.reference.trim() || undefined,
            relatedTransactionId: isRefund
              ? formData.relatedTransactionId
              : undefined,
            largeAmountConfirmed,
          },
          {
            withCredentials: true,
            headers: { "Idempotency-Key": idempotencyKey },
          },
        );
      } else {
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

        response = await axios.post(
          `${API_URL}/bookings/addTransaction/${currentBooking.bookingId}`,
          { transaction },
          { withCredentials: true },
        );
      }

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
            {currentBooking.status === "checkedOut"
              ? "เพิ่มรายการหลัง Check-Out"
              : "เพิ่มรายการใช้จ่าย"}
          </h1>
          {currentBooking.status === "checkedOut" && (
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
            options={transactionTypeOptionGroups}
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

        {canAttachTransaction && (
          <div>
            <p className="addBooking__label">
              {isRefund ? "รายการรับเงินเดิม (จำเป็น)" : "แนบรายการที่ปรับ"}
            </p>
            <Select<OptionType>
              styles={customStyles<OptionType>()}
              classNamePrefix="rs"
              options={transactionAttachmentOptions}
              placeholder={
                isRefund ? "เลือกรายการที่ต้องการคืนเงิน" : "เลือกรายการเดิม"
              }
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
            {isRefund && transactionAttachmentOptions.length === 0 ? (
              <p className="formField__error">
                ไม่พบรายการรับเงินเดิมที่สามารถคืนเงินได้
              </p>
            ) : null}
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

        {isFocusedFinancialAction ? (
          <div>
            <p className="addBooking__label">เหตุผล (จำเป็น)</p>
            <input
              className="boxInput"
              type="text"
              value={formData.reason}
              maxLength={200}
              placeholder={
                isRefund
                  ? "เช่น ลดจำนวนคืน / คืนค่าบริการ"
                  : "เช่น ห้องมีปัญหา / บริการไม่เป็นไปตามที่ตกลง"
              }
              onChange={(event) =>
                formDataChangeHandler("reason", event.target.value)
              }
            />
          </div>
        ) : null}

        <div>
          <p className="addBooking__label">
            {formData.type === "misc"
              ? "เหตุผล (จำเป็น)"
              : needsNote
                ? "หมายเหตุรายการ (จำเป็น)"
                : (
                    <>
                      หมายเหตุรายการ
                      <span className="addTransaction__optionalLabel">
                        (ไม่บังคับ)
                      </span>
                    </>
                  )}
          </p>
          <input
            className="boxInput"
            type="text"
            value={formData.note}
            maxLength={500}
            placeholder={
              formData.type === "misc"
                ? "ระบุว่ายอดนี้เป็นค่าอะไร"
                : needsNote
                  ? "เช่น คืนมัดจำบางส่วน / ปรับราคาตามหน้างาน"
                  : "รายละเอียดเพิ่มเติมของรายการ"
            }
            onChange={(e) => formDataChangeHandler("note", e.target.value)}
          />
        </div>

        {isFocusedFinancialAction ? (
          <div>
            <p className="addBooking__label">
              เลขอ้างอิง
              <span className="addTransaction__optionalLabel">(ไม่บังคับ)</span>
            </p>
            <input
              className="boxInput"
              type="text"
              value={formData.reference}
              maxLength={200}
              placeholder="เช่น เลขรายการโอน / เอกสารอนุมัติ"
              onChange={(event) =>
                formDataChangeHandler("reference", event.target.value)
              }
            />
          </div>
        ) : null}

        {isFocusedFinancialAction && validAmount > 0 ? (
          <section className="resolveBooking__summary" aria-live="polite">
            <p className="addBooking__label">ตรวจสอบก่อนบันทึก</p>
            <ul>
              <li>
                <i className="bx bx-user" />
                {currentBooking.name} · {currentBooking.bookingId}
              </li>
              <li>
                <i className="bx bx-arrow-from-top" />
                เงินออก {formatCurrency(validAmount)} บาท · {formData.paymentMethod}
              </li>
              <li>
                <i className="bx bx-receipt" />
                ยอด Booking {formatCurrency(currentPosition.bookingTotal)} →{" "}
                {formatCurrency(afterBookingTotal)} บาท
              </li>
              <li>
                <i className="bx bx-wallet" />
                ยอดรับแล้ว {formatCurrency(currentPosition.amountReceived)} →{" "}
                {formatCurrency(afterAmountReceived)} บาท · คงค้าง{" "}
                {formatCurrency(Math.max(afterDifference, 0))} บาท · เครดิตแขก{" "}
                {formatCurrency(Math.max(-afterDifference, 0))} บาท
              </li>
            </ul>
          </section>
        ) : null}

        {isFocusedFinancialAction && validAmount > 2000 ? (
          <p className="resolveBooking__warning">
            รายการเกิน 2,000 บาท ต้องให้ Admin เป็นผู้บันทึก
          </p>
        ) : null}

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
          text={
            isRefund
              ? "บันทึกคืนเงิน"
              : isCompensation
                ? "บันทึกค่าชดเชย"
                : "บันทึกรายการ"
          }
          icon="bx-save"
          highlight
          disabled={submitting}
          onClick={() =>
            toast.promise(submitHandler(), {
              loading: "กำลังบันทึกรายการ...",
              success: isRefund
                ? "บันทึกการคืนเงินสำเร็จ"
                : isCompensation
                  ? "บันทึกค่าชดเชยสำเร็จ"
                  : "เพิ่มรายการใช้จ่ายสำเร็จ",
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
