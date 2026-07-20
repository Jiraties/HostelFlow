import { useEffect, useState } from "react";
import axios from "axios";
import Select, { type SingleValue } from "react-select";
import toast from "react-hot-toast";
import ActionButton from "../../components/ActionButton";
import CashShiftNudge from "../../components/CashShiftNudge";
import ModalCloseButton from "../../components/ModalCloseButton";
import { API_URL } from "../../config/api";
import { useAuth } from "../../context/AuthContext";
import { formatBookingDates } from "../../helpers/bookingHelpers";
import { paymentMethodOptions } from "../../helpers/options";
import { customStyles, type OptionType } from "../../helpers/selectStyling";
import { transactionTypeOptions } from "../../helpers/transactionFormOptions";
import type {
  booking,
  TransactionCorrectionReason,
  TransactionCorrectionType,
  TransactionType,
} from "../../types/bookingTypes";
import "./AddTransaction.css";
import "./Cancellation.css";
import "./CorrectTransaction.css";

type Transaction = booking["transactions"][number];

const transactionLabels: Record<TransactionType, string> = {
  roomCharge: "ค่าห้อง",
  deposit: "รับมัดจำ",
  adjustment: "รายการปรับยอดเดิม",
  depositRefund: "คืนมัดจำ",
  cancellationRefund: "คืนเงินยกเลิก",
  roomRefund: "คืนค่าห้อง",
  roomChargeWriteOff: "ปิดยอดค่าห้องที่เหลือ",
  settlementCharge: "รับชำระยอดค้าง",
  compensation: "ชดเชยลูกค้า",
  depositKept: "เก็บมัดจำเป็นรายได้",
  paymentCorrection: "แก้ไขการชำระเงิน",
  towel: "Towel",
  motorbike: "Motorbike",
  slowBoat: "Slow Boat",
  joinTour: "Join Tour",
  extraBed: "Extra Bed",
  pickACraft: "Pick A Craft",
  trek2D: "Trek 2D",
  setMenu: "Set Menu",
  sleeperBus: "Sleeper Bus",
  onlyWalk: "Only Walk",
  laundry: "Laundry",
  bicycle: "Bicycle",
  car: "Car",
  misc: "Misc",
  rainCoat: "Rain Coat",
  passwordLock: "Password Lock",
  cooking: "Cooking",
  cardSurcharge: "ค่าธรรมเนียมบัตร 3%",
};

const serviceTypes: TransactionType[] = [
  "towel",
  "motorbike",
  "slowBoat",
  "joinTour",
  "extraBed",
  "pickACraft",
  "trek2D",
  "setMenu",
  "sleeperBus",
  "onlyWalk",
  "laundry",
  "bicycle",
  "car",
  "misc",
  "rainCoat",
  "passwordLock",
  "cooking",
];

const transactionColorByType = new Map(
  transactionTypeOptions.map((option) => [option.value, option.color]),
);

const formatCategoryLabel = ({ label, color }: OptionType) => (
  <div className="correctTransaction__categoryOption">
    <span style={{ backgroundColor: color || "#dddddd" }} />
    {label}
  </div>
);

const reasonOptions: Record<TransactionCorrectionType, OptionType[]> = {
  recorded_mistake: [
    { value: "incorrect_amount", label: "กรอกจำนวนเงินผิด" },
    { value: "incorrect_payment_method", label: "เลือกช่องทางชำระผิด" },
    { value: "incorrect_category", label: "เลือกประเภทรายการผิด" },
    { value: "incorrect_note", label: "ข้อมูลหรือหมายเหตุผิด" },
    { value: "other", label: "อื่น ๆ" },
  ],
  charge_change: [
    { value: "manager_discount", label: "ส่วนลดที่ผู้จัดการอนุมัติ" },
    { value: "waived_fee", label: "ยกเว้นค่าบริการ" },
    { value: "agreed_rate_correction", label: "แก้ราคาที่ตกลงกับแขก" },
    { value: "cancelled_service", label: "ยกเลิกบริการ" },
    { value: "guest_compensation", label: "ชดเชยให้แขก" },
    { value: "other", label: "อื่น ๆ" },
  ],
};

const chargeTypes = new Set<TransactionType>(["roomCharge", ...serviceTypes]);

const CorrectTransaction = ({
  booking: currentBooking,
  transaction,
  onClose,
  onUpdated,
  onDirtyChange,
}: {
  booking: booking;
  transaction: Transaction;
  onClose: () => void;
  onUpdated?: (booking: booking) => void;
  onDirtyChange?: (dirty: boolean) => void;
}) => {
  const { user } = useAuth();
  const [correctionType, setCorrectionType] =
    useState<TransactionCorrectionType>("recorded_mistake");
  const [correctedCategory, setCorrectedCategory] = useState<TransactionType>(
    transaction.type,
  );
  const [correctedAmount, setCorrectedAmount] = useState(
    String(transaction.amount),
  );
  const [correctedPaymentMethod, setCorrectedPaymentMethod] = useState(
    transaction.paymentMethod,
  );
  const [correctedNote, setCorrectedNote] = useState(transaction.note || "");
  const [reasonCode, setReasonCode] = useState<TransactionCorrectionReason | "">(
    "",
  );
  const [submitting, setSubmitting] = useState(false);
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const numericAmount = Number(correctedAmount);
  const isCharge = chargeTypes.has(transaction.type);
  const categoryOptions = (serviceTypes.includes(transaction.type)
    ? serviceTypes
    : [transaction.type]
  ).map((type) => ({
    value: type,
    label: transactionLabels[type],
    color: transactionColorByType.get(type),
  }));
  const correctionPaymentMethodOptions = paymentMethodOptions.filter((option) =>
    transaction.type === "deposit"
      ? option.value === transaction.paymentMethod
      : transaction.paymentMethod === "Unpaid" || option.value !== "Unpaid",
  );
  const activeReasonOptions = reasonOptions[correctionType];
  const financialChanged =
    Number.isFinite(numericAmount) &&
    (numericAmount !== transaction.amount ||
      correctedPaymentMethod !== transaction.paymentMethod ||
      correctedCategory !== transaction.type);

  useEffect(() => {
    onDirtyChange?.(
      correctedCategory !== transaction.type ||
        correctedAmount !== String(transaction.amount) ||
        correctedPaymentMethod !== transaction.paymentMethod ||
        correctedNote !== (transaction.note || "") ||
        correctionType !== "recorded_mistake" ||
        Boolean(reasonCode),
    );
    return () => onDirtyChange?.(false);
  }, [
    correctedAmount,
    correctedCategory,
    correctedNote,
    correctedPaymentMethod,
    correctionType,
    onDirtyChange,
    reasonCode,
    transaction,
  ]);

  const chooseCorrectionType = (value: TransactionCorrectionType) => {
    if (submitting) return;
    setCorrectionType(value);
    setReasonCode("");
  };

  const submit = async () => {
    if (submitting) return;
    if (!Number.isFinite(numericAmount) || numericAmount < 0) {
      throw new Error("ยอดที่ถูกต้องต้องไม่ติดลบ");
    }
    if (!reasonCode) throw new Error("กรุณาเลือกเหตุผลที่แก้ไข");
    if (!correctedNote.trim()) {
      throw new Error("กรุณาระบุหมายเหตุ");
    }
    if (correctionType === "charge_change" && !user?.admin) {
      throw new Error("การปรับยอดเรียกเก็บต้องให้ Admin ดำเนินการ");
    }

    setSubmitting(true);
    try {
      const response = await axios.post(
        `${API_URL}/bookings/${currentBooking.bookingId}/transactions/${
          transaction.originalTransactionId || transaction._id
        }/corrections`,
        {
          expectedRevision: currentBooking.revision,
          correctedAmount: numericAmount,
          correctedPaymentMethod,
          correctedCategory,
          correctedNote,
          correctionType,
          reasonCode,
          note: correctedNote.trim(),
        },
        {
          withCredentials: true,
          headers: { "Idempotency-Key": idempotencyKey },
        },
      );
      onUpdated?.(formatBookingDates(response.data.booking));
      onClose();
    } catch (error) {
      const message = axios.isAxiosError<{ message?: string; error?: string }>(
        error,
      )
        ? error.response?.data.message || error.response?.data.error
        : null;
      throw new Error(message || "ไม่สามารถแก้ไขรายการได้");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="addBooking__wrapper correctTransaction__wrapper">
      <ModalCloseButton onClick={onClose} />
      <header className="correctTransaction__header">
        <h1 className="addBooking__title">แก้ไขรายการ</h1>
        <p>แก้ไขข้อมูลที่บันทึกผิด โดยระบบจะเก็บประวัติเดิมไว้</p>
      </header>

      <div className="correctTransaction__form">
        {financialChanged && correctedPaymentMethod === "Cash" && (
          <CashShiftNudge />
        )}
        {user?.admin && (
          <section className="correctTransaction__section">
            <p className="addBooking__label">สิ่งที่ต้องการทำ</p>
            <div className="cancellation__segmentedControl">
              <button
                type="button"
                className={`cancellation__segment${
                  correctionType === "recorded_mistake"
                    ? " cancellation__segment--active"
                    : ""
                }`}
                onClick={() => chooseCorrectionType("recorded_mistake")}
              >
                แก้ข้อมูลที่บันทึกผิด
              </button>
              {isCharge && (
                <button
                  type="button"
                  className={`cancellation__segment${
                    correctionType === "charge_change"
                      ? " cancellation__segment--active"
                      : ""
                  }`}
                  onClick={() => chooseCorrectionType("charge_change")}
                >
                  ปรับยอดเรียกเก็บ
                </button>
              )}
            </div>
          </section>
        )}

        <div className="correctTransaction__grid">
          <label>
            <span className="addBooking__label">ประเภทรายการที่ถูกต้อง</span>
            <Select<OptionType>
              styles={customStyles<OptionType>()}
              classNamePrefix="rs"
              options={categoryOptions}
              value={categoryOptions.find((item) => item.value === correctedCategory)}
              formatOptionLabel={formatCategoryLabel}
              isDisabled={categoryOptions.length === 1 || submitting}
              menuPortalTarget={document.body}
              menuPosition="fixed"
              onChange={(option: SingleValue<OptionType>) =>
                setCorrectedCategory((option?.value || transaction.type) as TransactionType)
              }
            />
          </label>
          <label>
            <span className="addBooking__label">จำนวนเงินที่ถูกต้อง (฿)</span>
            <input
              className="boxInput"
              type="number"
              min="0"
              step="0.01"
              value={correctedAmount}
              disabled={submitting}
              onChange={(event) => setCorrectedAmount(event.target.value)}
            />
          </label>
          <label>
            <span className="addBooking__label">ช่องทางที่ถูกต้อง</span>
            <Select<OptionType>
              styles={customStyles<OptionType>()}
              classNamePrefix="rs"
              options={correctionPaymentMethodOptions}
              value={correctionPaymentMethodOptions.find(
                (item) => item.value === correctedPaymentMethod,
              )}
              isDisabled={transaction.type === "deposit" || submitting}
              menuPortalTarget={document.body}
              menuPosition="fixed"
              onChange={(option: SingleValue<OptionType>) =>
                setCorrectedPaymentMethod(
                  (option?.value || transaction.paymentMethod) as Transaction["paymentMethod"],
                )
              }
            />
          </label>
          <label>
            <span className="addBooking__label">เหตุผลที่แก้ไข</span>
            <Select<OptionType>
              styles={customStyles<OptionType>()}
              classNamePrefix="rs"
              options={activeReasonOptions}
              placeholder="เลือกเหตุผล"
              value={activeReasonOptions.find((item) => item.value === reasonCode)}
              isDisabled={submitting}
              menuPortalTarget={document.body}
              menuPosition="fixed"
              onChange={(option: SingleValue<OptionType>) =>
                setReasonCode((option?.value || "") as TransactionCorrectionReason | "")
              }
            />
          </label>
        </div>

        <label>
          <span className="addBooking__label">หมายเหตุ</span>
          <textarea
            className="boxInput correctTransaction__note"
            value={correctedNote}
            disabled={submitting}
            placeholder="อธิบายข้อมูลที่ถูกต้องหรือเหตุผลที่แก้ไข"
            onChange={(event) => setCorrectedNote(event.target.value)}
          />
        </label>

        <p className="correctTransaction__immutableNotice">
          <i className="bx bx-history" /> รายการเดิมยังดูได้ในประวัติ
        </p>
      </div>

      <div className="addTransaction__actions">
        <ActionButton
          text="ยืนยันการแก้ไข"
          icon="bx-save"
          highlight
          disabled={submitting}
          onClick={() =>
            toast.promise(submit(), {
              loading: "กำลังแก้ไขรายการ...",
              success: "แก้ไขรายการสำเร็จ และเก็บข้อมูลเดิมไว้แล้ว",
              error: (error) =>
                error instanceof Error ? error.message : "ไม่สามารถแก้ไขรายการได้",
            })
          }
        />
      </div>
    </div>
  );
};

export default CorrectTransaction;
