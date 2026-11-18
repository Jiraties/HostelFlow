import PaymentMethodChip from "../../components/PaymentMethodChip";
import { useEffect, useId, useState } from "react";
import axios from "axios";
import Select from "../../components/MotionSelect";
import { type SingleValue } from "react-select";
import toast from "react-hot-toast";
import ActionButton from "../../components/ActionButton";
import CashShiftNudge from "../../components/CashShiftNudge";
import ModalCloseButton from "../../components/ModalCloseButton";
import { notifyReviewQueueUpdated } from "../../helpers/reviewQueue";
import { API_URL } from "../../config/api";
import { useAuth } from "../../context/AuthContext";
import { formatBookingDates } from "../../helpers/bookingHelpers";
import { paymentMethodOptions } from "../../helpers/options";
import { customStyles, type OptionType } from "../../helpers/selectStyling";
import { transactionTypeOptions } from "../../helpers/transactionFormOptions";
import { getApiErrorMessage } from "../../helpers/apiErrorMessage";
import { formatDisplayDateTime } from "../../helpers/displayDate";
import { correctionRequestLabels } from "../finance/useCorrectionRequests";
import type {
  booking,
  TransactionCorrectionReason,
  TransactionCorrectionType,
  TransactionType,
} from "../../types/bookingTypes";
import "./AddTransaction.css";
import "./Cancellation.css";
import "./CheckIn.css";
import "./CheckOut.css";
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

const bangkokDateKey = (value: Date | string) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
};

const CorrectTransaction = ({
  booking: currentBooking,
  transaction,
  onClose,
  onUpdated,
  onDirtyChange,
  sourceType = "booking",
  review,
}: {
  booking: booking;
  sourceType?: "booking" | "standaloneSale";
  review?: {
    after: Transaction;
    note: string;
    status: string;
    historical?: boolean;
    requestedBy?: string;
    requestedAt?: string;
    decisionReason?: string;
    admin: boolean;
    onDecide: (action: string, reason?: string) => Promise<void>;
  };
  transaction: Transaction;
  onClose: () => void;
  onUpdated?: (booking: booking) => void;
  onDirtyChange?: (dirty: boolean) => void;
}) => {
  const { user, resolveStaffName } = useAuth();
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
  const [reasonCode, setReasonCode] = useState<
    TransactionCorrectionReason | ""
  >("");
  const [submitting, setSubmitting] = useState(false);
  const [validationAttempted, setValidationAttempted] = useState(false);
  const [preview, setPreview] = useState<{
    requiresApproval: boolean;
    historical: boolean;
    cashDelta: number;
    before: Pick<Transaction, "type" | "amount" | "paymentMethod">;
    after: Pick<Transaction, "type" | "amount" | "paymentMethod">;
  } | null>(null);
  const [closedPeriod, setClosedPeriod] = useState(false);
  const [decisionReason, setDecisionReason] = useState("");
  const [isRejecting, setIsRejecting] = useState(false);
  const fieldId = useId();
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const sourceId = currentBooking.bookingId;
  const revision = currentBooking.revision;
  const transactionId = transaction.originalTransactionId || transaction._id;
  const isReview = Boolean(review);
  useEffect(() => {
    if (isReview || !transactionId) return;

    const controller = new AbortController();
    void axios
      .post<{ historical: boolean }>(
        `${API_URL}/finance/correction-requests/preview`,
        {
          initial: true,
          sourceType,
          sourceId,
          transactionId,
          expectedRevision: revision,
        },
        { withCredentials: true, signal: controller.signal },
      )
      .then(({ data }) => {
        if (!controller.signal.aborted)
          setClosedPeriod(data.historical === true);
      })
      .catch(() => {
        // The full preview still validates the correction before confirming.
      });
    return () => controller.abort();
  }, [isReview, revision, sourceId, sourceType, transactionId]);

  const historical = preview?.historical ?? closedPeriod;
  const showClosedPeriod = closedPeriod || historical;
  const isRequest = !user?.admin && (preview?.requiresApproval ?? closedPeriod);
  const numericAmount = Number(correctedAmount);
  const isCharge = chargeTypes.has(transaction.type);
  const isStaffEditablePendingRoomCharge =
    !user?.admin &&
    currentBooking.status === "booked" &&
    transaction.type === "roomCharge" &&
    ["OTA", "Unpaid"].includes(transaction.paymentMethod) &&
    bangkokDateKey(currentBooking.checkIn) >= bangkokDateKey(new Date());
  const canSelectChargeChange =
    Boolean(user?.admin) || isStaffEditablePendingRoomCharge;
  const categoryOptions = (
    serviceTypes.includes(transaction.type) ? serviceTypes : [transaction.type]
  ).map((type) => ({
    value: type,
    label: transactionLabels[type],
    color: transactionColorByType.get(type),
  }));
  const correctionPaymentMethodOptions = paymentMethodOptions.filter(
    (option) =>
      transaction.type === "deposit"
        ? option.value === transaction.paymentMethod
        : transaction.paymentMethod === "Unpaid" || option.value !== "Unpaid",
  );
  const categoryLocked =
    categoryOptions.length === 1 || isStaffEditablePendingRoomCharge;
  const paymentMethodLocked =
    transaction.type === "deposit" || isStaffEditablePendingRoomCharge;
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
    setPreview(null);
    setCorrectionType(value);
    setReasonCode("");
  };

  const submit = async () => {
    if (submitting) return;
    setValidationAttempted(true);
    if (!Number.isFinite(numericAmount) || numericAmount < 0) {
      throw new Error("ยอดที่ถูกต้องต้องไม่ติดลบ");
    }
    if (!reasonCode) throw new Error("กรุณาเลือกเหตุผลที่แก้ไข");
    if (!correctedNote.trim()) {
      throw new Error("กรุณาระบุหมายเหตุ");
    }
    if (
      correctionType === "charge_change" &&
      !user?.admin &&
      !isStaffEditablePendingRoomCharge
    ) {
      throw new Error("การปรับยอดเรียกเก็บต้องให้ Admin ดำเนินการ");
    }

    setSubmitting(true);
    try {
      const payload = {
        sourceType,
        sourceId: currentBooking.bookingId,
        transactionId: transaction.originalTransactionId || transaction._id,
        expectedRevision: currentBooking.revision,
        correctedAmount: numericAmount,
        correctedPaymentMethod,
        correctedCategory,
        correctedNote,
        correctionType,
        reasonCode,
        note: correctedNote.trim(),
      };
      if (!preview) {
        const { data } = await axios.post(
          `${API_URL}/finance/correction-requests/preview`,
          payload,
          { withCredentials: true },
        );
        setPreview(data);
        return;
      }
      const requestOnly = preview.requiresApproval && !user?.admin;
      const response = await axios.post(
        requestOnly
          ? `${API_URL}/finance/correction-requests`
          : sourceType === "standaloneSale"
            ? `${API_URL}/finance/standalone-sales/${currentBooking.bookingId}/transactions/${payload.transactionId}/corrections`
            : `${API_URL}/bookings/${currentBooking.bookingId}/transactions/${payload.transactionId}/corrections`,
        payload,
        {
          withCredentials: true,
          headers: { "Idempotency-Key": idempotencyKey },
        },
      );
      notifyReviewQueueUpdated();
      if (requestOnly || sourceType === "standaloneSale") {
        onClose();
        return;
      }
      onUpdated?.(formatBookingDates(response.data.booking));
      onClose();
    } catch (error) {
      throw new Error(getApiErrorMessage(error, "ไม่สามารถแก้ไขรายการได้"));
    } finally {
      setSubmitting(false);
    }
  };

  if (review) {
    const { after } = review;
    const pending = review.status === "pending";
    const amountChanged = transaction.amount !== after.amount;
    const sameCategory = transaction.type === after.type;
    const samePaymentMethod = transaction.paymentMethod === after.paymentMethod;
    const noteChanged = (transaction.note || "") !== (after.note || "");
    const showNoteComparison =
      noteChanged &&
      (Boolean(transaction.note) ||
        after.note !== review.note ||
        (!amountChanged && sameCategory && samePaymentMethod));
    const showReason = !showNoteComparison || review.note !== after.note;
    const categoryLabel = transactionLabels[transaction.type];
    const formatAmount = (amount: number) =>
      `${amount.toLocaleString("th-TH")} THB`;
    const changes = [
      {
        label: "จำนวนเงิน",
        before: formatAmount(transaction.amount),
        after: formatAmount(after.amount),
        changed: amountChanged,
      },
      {
        label: "ประเภทรายการ",
        before: categoryLabel,
        after: transactionLabels[after.type],
        changed: !sameCategory,
      },
      {
        label: "ช่องทางชำระ",
        before: <PaymentMethodChip method={transaction.paymentMethod} />,
        after: <PaymentMethodChip method={after.paymentMethod} />,
        changed: !samePaymentMethod,
      },
      {
        label: "หมายเหตุรายการ",
        before: transaction.note || "—",
        after: after.note || "—",
        changed: showNoteComparison,
      },
    ].filter(({ changed }) => changed);
    const decide = async (action: string) => {
      if (submitting) return;
      if (action === "reject" && !decisionReason.trim()) {
        toast.error("กรุณาระบุเหตุผลที่ไม่อนุมัติ");
        return;
      }
      setSubmitting(true);
      try {
        await review.onDecide(
          action,
          action === "reject" ? decisionReason.trim() : undefined,
        );
      } catch (error) {
        toast.error(
          getApiErrorMessage(error, "ดำเนินการไม่สำเร็จ กรุณารีเฟรช"),
        );
      } finally {
        setSubmitting(false);
      }
    };
    return (
      <div className="addBooking__wrapper correctTransaction__wrapper correctionReview">
        <ModalCloseButton onClick={onClose} />
        <header className="correctTransaction__header">
          <h1 className="checkIn__title">ตรวจสอบคำขอแก้ไข</h1>
          <p>
            {currentBooking.name} · {currentBooking.bookingId}
          </p>
        </header>
        {pending && (
          <div className="checkIn__reminder checkOut__earlyReminder">
            <i
              className="bx bx-message-bubble-exclamation"
              aria-hidden="true"
            />
            <p>
              {review.historical
                ? "คำขอนี้เป็นการแก้ไขหลังปิดกะ เมื่ออนุมัติ ยอดปิดกะจะคงเดิม"
                : "เมื่ออนุมัติ ระบบจะแก้ไขรายการเดิมโดยไม่มีเงินเข้าออกเพิ่ม"}
            </p>
          </div>
        )}
        <section
          className="correctionReview__summary"
          aria-labelledby={`${fieldId}-review-transaction`}
        >
          <div className="correctionReview__summaryHeader">
            <div className="correctionReview__transactionContext">
              <h2 id={`${fieldId}-review-transaction`}>
                {sameCategory ? categoryLabel : "เปลี่ยนประเภทรายการ"}
              </h2>
              {!amountChanged && <p>{formatAmount(transaction.amount)}</p>}
              {samePaymentMethod && (
                <PaymentMethodChip method={transaction.paymentMethod} />
              )}
            </div>
            <span
              className={`correctionReview__status correctionReview__status--${review.status}`}
            >
              {correctionRequestLabels[review.status] ?? review.status}
            </span>
          </div>
          {changes.map((change) => (
            <div className="correctionReview__change" key={change.label}>
              <div>
                <span>{change.label}เดิม</span>
                <strong>{change.before}</strong>
              </div>
              <span className="correctionReview__arrow" aria-hidden="true">
                →
              </span>
              <div>
                <span>ที่ขอแก้ไข</span>
                <strong>{change.after}</strong>
              </div>
            </div>
          ))}
          <div className="correctionReview__details">
            {(showReason || review.decisionReason) && (
              <dl>
                {showReason && (
                  <div>
                    <dt>เหตุผล</dt>
                    <dd>{review.note}</dd>
                  </div>
                )}
                {review.decisionReason && (
                  <div>
                    <dt>เหตุผลการพิจารณา</dt>
                    <dd>{review.decisionReason}</dd>
                  </div>
                )}
              </dl>
            )}
            {review.requestedBy && (
              <p className="correctionReview__byline">
                ส่งโดย {resolveStaffName(review.requestedBy)}
                {review.requestedAt &&
                  ` · ${formatDisplayDateTime(review.requestedAt, user?.settings.dateFormat)}`}
              </p>
            )}
          </div>
        </section>
        {pending && review.admin && isRejecting && (
          <div className="correctTransaction__section">
            <label
              className="addBooking__label"
              htmlFor={`${fieldId}-rejection`}
            >
              เหตุผลที่ไม่อนุมัติ
            </label>
            <textarea
              id={`${fieldId}-rejection`}
              className="boxInput correctTransaction__note"
              value={decisionReason}
              disabled={submitting}
              required
              autoFocus
              onChange={(event) => setDecisionReason(event.target.value)}
            />
          </div>
        )}
        {pending && (
          <div className="addTransaction__actions correctionReview__actions">
            {review.admin && isRejecting ? (
              <>
                <ActionButton
                  icon="bx-arrow-back"
                  text="กลับ"
                  disabled={submitting}
                  onClick={() => setIsRejecting(false)}
                />
                <ActionButton
                  icon="bx-x"
                  text="ยืนยันไม่อนุมัติ"
                  disabled={submitting || !decisionReason.trim()}
                  highlight
                  onClick={() => void decide("reject")}
                />
              </>
            ) : review.admin ? (
              <>
                <ActionButton
                  icon="bx-x"
                  text="ไม่อนุมัติ"
                  disabled={submitting}
                  onClick={() => setIsRejecting(true)}
                />
                <ActionButton
                  icon="bx-check"
                  text="อนุมัติการแก้ไข"
                  highlight
                  disabled={submitting}
                  onClick={() => void decide("approve")}
                />
              </>
            ) : (
              <ActionButton
                icon="bx-undo"
                text="ถอนคำขอ"
                disabled={submitting}
                onClick={() => void decide("withdraw")}
              />
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="addBooking__wrapper correctTransaction__wrapper">
      <ModalCloseButton onClick={onClose} />
      <header className="correctTransaction__header">
        <h1 className="checkIn__title">
          {showClosedPeriod
            ? isRequest ? "ขอแก้ไขรายการหลังปิดกะ" : "แก้ไขรายการหลังปิดกะ"
            : "แก้ไขรายการ"}
        </h1>
      </header>

      {showClosedPeriod && (
        <div className="checkIn__reminder checkOut__earlyReminder">
          <i className="bx bx-message-bubble-exclamation" aria-hidden="true" />
          <p>
            {isRequest
              ? "คุณกำลังส่งคำขอแก้ไขหลังปิดกะ ยอดรายการจะคงเดิมจนกว่า Admin จะอนุมัติ"
              : "คุณกำลังแก้ไขรายการหลังปิดกะ ยอดปิดกะจะคงเดิมและไม่มีเงินเข้าออกเพิ่ม"}
          </p>
        </div>
      )}

      <div className="correctTransaction__form">
        {financialChanged &&
          !historical &&
          correctedPaymentMethod === "Cash" && <CashShiftNudge />}
        {canSelectChargeChange && (
          <section className="correctTransaction__section">
            <p className="addBooking__label">สิ่งที่ต้องการทำ</p>
            <div
              className="cancellation__segmentedControl"
              role="group"
              aria-label="สิ่งที่ต้องการทำ"
            >
              <button
                type="button"
                className={`cancellation__segment${
                  correctionType === "recorded_mistake"
                    ? " cancellation__segment--active"
                    : ""
                }`}
                aria-pressed={correctionType === "recorded_mistake"}
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
                  aria-pressed={correctionType === "charge_change"}
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
            <span
              id={`${fieldId}-category-label`}
              className="addBooking__label"
            >
              ประเภทรายการที่ถูกต้อง
            </span>
            <div className="correctTransaction__fieldControl">
              <Select<OptionType>
                inputId={`${fieldId}-category`}
                aria-labelledby={
                  categoryLocked
                    ? `${fieldId}-category-label ${fieldId}-category-lock`
                    : `${fieldId}-category-label`
                }
                styles={customStyles<OptionType>()}
                className={
                  categoryLocked
                    ? "correctTransaction__lockedSelect"
                    : undefined
                }
                classNamePrefix="rs"
                options={categoryOptions}
                value={categoryOptions.find(
                  (item) => item.value === correctedCategory,
                )}
                formatOptionLabel={formatCategoryLabel}
                isDisabled={categoryLocked || submitting}
                menuPortalTarget={document.body}
                menuPosition="fixed"
                onChange={(option: SingleValue<OptionType>) => (
                  setPreview(null),
                  setCorrectedCategory(
                    (option?.value || transaction.type) as TransactionType,
                  )
                )}
              />
              {categoryLocked && (
                <span
                  id={`${fieldId}-category-lock`}
                  className="correctTransaction__lockedIcon"
                  role="img"
                  aria-label="แก้ไขไม่ได้"
                  title="แก้ไขไม่ได้"
                >
                  <i className="bx bx-lock-alt" aria-hidden="true" />
                </span>
              )}
            </div>
          </label>
          <label>
            <span className="addBooking__label">จำนวนเงินที่ถูกต้อง (฿)</span>
            <input
              className="boxInput"
              aria-invalid={
                validationAttempted &&
                (!Number.isFinite(numericAmount) || numericAmount < 0)
              }
              aria-describedby={
                validationAttempted &&
                (!Number.isFinite(numericAmount) || numericAmount < 0)
                  ? `${fieldId}-amount-error`
                  : undefined
              }
              type="number"
              min="0"
              step="0.01"
              value={correctedAmount}
              disabled={submitting}
              onChange={(event) => {
                setPreview(null);
                setCorrectedAmount(event.target.value);
              }}
            />
            {validationAttempted &&
              (!Number.isFinite(numericAmount) || numericAmount < 0) && (
                <span
                  id={`${fieldId}-amount-error`}
                  className="formField__error"
                >
                  ยอดที่ถูกต้องต้องไม่ติดลบ
                </span>
              )}
          </label>
          <label>
            <span id={`${fieldId}-payment-label`} className="addBooking__label">
              ช่องทางที่ถูกต้อง
            </span>
            <div className="correctTransaction__fieldControl">
              <Select<OptionType>
                inputId={`${fieldId}-payment`}
                aria-labelledby={
                  paymentMethodLocked
                    ? `${fieldId}-payment-label ${fieldId}-payment-lock`
                    : `${fieldId}-payment-label`
                }
                styles={customStyles<OptionType>()}
                className={
                  paymentMethodLocked
                    ? "correctTransaction__lockedSelect"
                    : undefined
                }
                classNamePrefix="rs"
                options={correctionPaymentMethodOptions}
                value={correctionPaymentMethodOptions.find(
                  (item) => item.value === correctedPaymentMethod,
                )}
                isDisabled={paymentMethodLocked || submitting}
                menuPortalTarget={document.body}
                menuPosition="fixed"
                onChange={(option: SingleValue<OptionType>) => (
                  setPreview(null),
                  setCorrectedPaymentMethod(
                    (option?.value ||
                      transaction.paymentMethod) as Transaction["paymentMethod"],
                  )
                )}
              />
              {paymentMethodLocked && (
                <span
                  id={`${fieldId}-payment-lock`}
                  className="correctTransaction__lockedIcon"
                  role="img"
                  aria-label="แก้ไขไม่ได้"
                  title="แก้ไขไม่ได้"
                >
                  <i className="bx bx-lock-alt" aria-hidden="true" />
                </span>
              )}
            </div>
          </label>
          <label>
            <span className="addBooking__label">เหตุผลที่แก้ไข</span>
            <Select<OptionType>
              styles={customStyles<OptionType>()}
              classNamePrefix="rs"
              className={
                validationAttempted && !reasonCode
                  ? "formField--error"
                  : undefined
              }
              aria-invalid={validationAttempted && !reasonCode}
              aria-errormessage={
                validationAttempted && !reasonCode
                  ? `${fieldId}-reason-error`
                  : undefined
              }
              options={activeReasonOptions}
              placeholder="เลือกเหตุผล"
              value={activeReasonOptions.find(
                (item) => item.value === reasonCode,
              )}
              isDisabled={submitting}
              menuPortalTarget={document.body}
              menuPosition="fixed"
              onChange={(option: SingleValue<OptionType>) => (
                setPreview(null),
                setReasonCode(
                  (option?.value || "") as TransactionCorrectionReason | "",
                )
              )}
            />
            {validationAttempted && !reasonCode && (
              <span id={`${fieldId}-reason-error`} className="formField__error">
                กรุณาเลือกเหตุผลที่แก้ไข
              </span>
            )}
          </label>
        </div>

        <label>
          <span className="addBooking__label">หมายเหตุ</span>
          <textarea
            className="boxInput correctTransaction__note"
            aria-invalid={validationAttempted && !correctedNote.trim()}
            aria-describedby={
              validationAttempted && !correctedNote.trim()
                ? `${fieldId}-note-error`
                : undefined
            }
            value={correctedNote}
            disabled={submitting}
            placeholder="อธิบายข้อมูลที่ถูกต้องหรือเหตุผลที่แก้ไข"
            onChange={(event) => {
              setPreview(null);
              setCorrectedNote(event.target.value);
            }}
          />
          {validationAttempted && !correctedNote.trim() && (
            <span id={`${fieldId}-note-error`} className="formField__error">
              กรุณาระบุหมายเหตุ
            </span>
          )}
        </label>

        {/* <p className="correctTransaction__immutableNotice">
          <i className="bx bx-history" /> รายการเดิมยังดูได้ในประวัติ
        </p> */}
      </div>

      {preview && (
        <section className="resolveBooking__summary" aria-live="polite">
          {preview.before.amount !== preview.after.amount && (
            <p>
              จำนวนเงิน {preview.before.amount} → {preview.after.amount} ฿
            </p>
          )}
          {preview.before.paymentMethod !== preview.after.paymentMethod && (
            <p>
              ช่องทางชำระ{" "}
              <PaymentMethodChip method={preview.before.paymentMethod} /> →{" "}
              <PaymentMethodChip method={preview.after.paymentMethod} />
            </p>
          )}
          {preview.before.type !== preview.after.type && (
            <p>
              ประเภทรายการ {transactionLabels[preview.before.type]} →{" "}
              {transactionLabels[preview.after.type]}
            </p>
          )}
          {preview.before.amount === preview.after.amount &&
            preview.before.paymentMethod === preview.after.paymentMethod &&
            preview.before.type === preview.after.type && (
              <p>ยอด ช่องทางชำระ และประเภทรายการคงเดิม</p>
            )}
          {preview.historical && preview.cashDelta !== 0 && (
            <p>ผลต่างเงินสดในรอบเดิม {preview.cashDelta} ฿</p>
          )}
          {isRequest && !showClosedPeriod && (
            <p>ต้องให้ Admin อนุมัติ ยอดเดิมจะยังไม่เปลี่ยน</p>
          )}
        </section>
      )}
      <div className="addTransaction__actions">
        <ActionButton
          text={
            !preview
              ? isRequest
                ? showClosedPeriod ? "ตรวจสอบคำขอแก้ไขหลังปิดกะ" : "ตรวจสอบคำขอแก้ไข"
                : showClosedPeriod
                  ? "ตรวจสอบการแก้ไขหลังปิดกะ"
                  : "ตรวจสอบการแก้ไข"
              : isRequest
                ? showClosedPeriod ? "ส่งคำขอแก้ไขหลังปิดกะ" : "ส่งคำขอแก้ไข"
                : showClosedPeriod
                  ? "ยืนยันการแก้ไขหลังปิดกะ"
                  : "ยืนยันการแก้ไข"
          }
          icon={isRequest ? "bx-send" : "bx-save"}
          highlight
          disabled={submitting}
          onClick={() =>
            toast.promise(submit(), {
              loading: !preview
                ? "กำลังตรวจสอบข้อมูล..."
                : isRequest
                  ? "กำลังส่งคำขอ..."
                  : "กำลังแก้ไขรายการ...",
              success: !preview
                ? "ตรวจสอบข้อมูลแล้ว กรุณายืนยัน"
                : preview.requiresApproval && !user?.admin
                  ? "ส่งคำขอแล้ว"
                  : "แก้ไขรายการสำเร็จ และเก็บข้อมูลเดิมไว้แล้ว",
              error: (error) =>
                error instanceof Error
                  ? error.message
                  : "ไม่สามารถแก้ไขรายการได้",
            })
          }
        />
      </div>
    </div>
  );
};

export default CorrectTransaction;
