import { useEffect, useMemo, useState } from "react";
import Select, { type SingleValue } from "react-select";
import axios from "axios";
import toast from "react-hot-toast";
import ActionButton from "../../components/ActionButton";
import ModalCloseButton from "../../components/ModalCloseButton";
import CashShiftNudge from "../../components/CashShiftNudge";
import Tooltip from "../../components/Tooltip";
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
type FinalStatus = "checkedOut" | "cancelled" | "noShow";
type SpecialCaseFinalStatus = Exclude<FinalStatus, "noShow">;
type RoomReleaseStatus = "released" | "blocked";
type MoneyActionId =
  | "none"
  | "refund_guest"
  | "collect_extra"
  | "correct_payment";

export type ResolveVariant = "noShow" | "specialCase" | "postClose";

type SettlementRow = {
  id: number;
  type: TransactionType;
  paymentMethod: Exclude<PaymentMethod, "Unpaid">;
  amount: string;
  direction: TransactionDirection;
  note: string;
  relatedTransactionId: string;
};

type MoneyActionConfig = {
  id: Exclude<MoneyActionId, "none">;
  label: string;
  helper: string;
  icon: string;
  row: Omit<SettlementRow, "id" | "amount" | "note" | "relatedTransactionId">;
};

const reasonOptions: OptionType[] = [
  { value: "guest_unhappy_room", label: "ลูกค้าไม่พอใจห้องพัก" },
  { value: "early_checkout", label: "Early Check-Out" },
  { value: "no_show", label: "No-Show" },
  { value: "ota_cancellation", label: "ยกเลิกผ่าน OTA" },
  { value: "payment_error", label: "บันทึกการชำระเงินผิด" },
  { value: "manager_approved_refund", label: "ผู้จัดการอนุมัติคืนเงิน" },
  { value: "staff_entry_error", label: "พนักงานบันทึกข้อมูลผิด" },
  { value: "other", label: "อื่น ๆ" },
];

const directionOptions: OptionType[] = [
  { value: "out", label: "เงินออก" },
  { value: "in", label: "เงินเข้า" },
];

const outwardTransactionTypes = new Set<TransactionType>([
  "depositRefund",
  "cancellationRefund",
  "roomRefund",
  "compensation",
]);

const transactionReferenceColor = (transaction: Transaction) => {
  if (outwardTransactionTypes.has(transaction.type)) return "#fb7185";
  if (transaction.type === "deposit" || transaction.type === "depositKept") {
    return "#e7a23b";
  }
  if (
    transaction.type === "adjustment" ||
    transaction.type === "paymentCorrection"
  ) {
    return "#a78bfa";
  }
  if (transaction.paymentMethod === "Unpaid") return "#94a3b8";
  return "#22c55e";
};

const finalStatusLabels: Record<FinalStatus, string> = {
  checkedOut: "Check-Out แล้ว",
  cancelled: "ยกเลิกแล้ว",
  noShow: "No-Show",
};

const specialCaseStatusOptions: OptionType[] = [
  { value: "cancelled", label: "Cancelled", color: "#dc2626" },
  { value: "checkedOut", label: "Checked-Out", color: "orange" },
];

const moneyActions: MoneyActionConfig[] = [
  {
    id: "refund_guest",
    label: "คืนเงินลูกค้า",
    helper: "บันทึกเงินที่จ่ายคืนให้ลูกค้า",
    icon: "bx-undo",
    row: {
      type: "roomRefund",
      paymentMethod: "Cash",
      direction: "out",
    },
  },
  {
    id: "collect_extra",
    label: "เก็บเงินเพิ่ม",
    helper: "บันทึกเงินที่รับเพิ่มจากลูกค้า",
    icon: "bx-plus-circle",
    row: {
      type: "settlementCharge",
      paymentMethod: "Cash",
      direction: "in",
    },
  },
  {
    id: "correct_payment",
    label: "แก้ไขการชำระเงิน",
    helper: "Admin แก้รายการที่บันทึกผิดหลังปิด Booking",
    icon: "bx-edit",
    row: {
      type: "paymentCorrection",
      paymentMethod: "Cash",
      direction: "in",
    },
  },
];

const settlementPaymentMethodOptions = paymentMethodOptions.filter(
  (option) => option.value !== "Unpaid",
);

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "THB",
    minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
  }).format(amount);

const createRow = (
  id: number,
  action: Exclude<MoneyActionId, "none"> = "refund_guest",
): SettlementRow => {
  const selectedAction =
    moneyActions.find((option) => option.id === action) || moneyActions[0];

  return {
    id,
    ...selectedAction.row,
    amount: "",
    note: "",
    relatedTransactionId: "",
  };
};

const getClosedStatus = (currentBooking: booking): FinalStatus => {
  if (
    currentBooking.status === "cancelled" ||
    currentBooking.status === "noShow"
  ) {
    return currentBooking.status;
  }

  return "checkedOut";
};

const getInitialRoomStatus = (currentBooking: booking): RoomReleaseStatus =>
  currentBooking.resolution?.roomReleaseStatus ||
  currentBooking.checkout?.roomReleaseStatus ||
  currentBooking.cancellation?.roomReleaseStatus ||
  "released";

const defaultDirectionForType = (
  type: TransactionType,
): TransactionDirection =>
  ["roomRefund", "cancellationRefund", "compensation"].includes(type)
    ? "out"
    : "in";

const ResolveBooking = ({
  booking,
  variant,
  onClose,
  onUpdated,
  onDirtyChange,
}: {
  booking: booking;
  variant: ResolveVariant;
  onClose?: () => void;
  onUpdated?: (booking: booking) => void;
  onDirtyChange?: (isDirty: boolean) => void;
}) => {
  const { user } = useAuth();
  const isNoShow = variant === "noShow";
  const isPostClose = variant === "postClose";
  const initialRoomStatus = isPostClose
    ? getInitialRoomStatus(booking)
    : isNoShow
      ? null
      : "released";
  const initialReasonCode = isPostClose
    ? booking.resolution?.reasonCode || "payment_error"
    : "";
  const [specialCaseFinalStatus, setSpecialCaseFinalStatus] =
    useState<SpecialCaseFinalStatus | null>(null);
  const [statusTouched, setStatusTouched] = useState(false);
  const [roomReleaseStatus, setRoomReleaseStatus] =
    useState<RoomReleaseStatus | null>(initialRoomStatus);
  const [reasonCode, setReasonCode] = useState(initialReasonCode);
  const [note, setNote] = useState("");
  const [moneyAction, setMoneyAction] = useState<MoneyActionId>("none");
  const [advancedRowsOpen, setAdvancedRowsOpen] = useState(false);
  const [rows, setRows] = useState<SettlementRow[]>(() => [
    createRow(Date.now()),
  ]);
  const [submitting, setSubmitting] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [noteTouched, setNoteTouched] = useState(false);
  const [touchedRowIds, setTouchedRowIds] = useState<Set<number>>(
    () => new Set(),
  );
  const [confirmedDepositReturn, setConfirmedDepositReturn] = useState(false);
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  const outcome: ResolutionOutcome | null = isNoShow
    ? "no_show"
    : isPostClose
      ? "post_close_adjustment"
      : specialCaseFinalStatus === null
        ? null
        : specialCaseFinalStatus === "cancelled"
          ? "cancelled_after_checkin"
          : "guest_left";
  const finalStatus: FinalStatus | null = isNoShow
    ? "noShow"
    : isPostClose
      ? getClosedStatus(booking)
      : specialCaseFinalStatus;
  const effectiveReasonCode = isNoShow
    ? "no_show"
    : isPostClose
      ? reasonCode
      : specialCaseFinalStatus === null
        ? ""
        : specialCaseFinalStatus === "cancelled"
          ? "other"
          : "early_checkout";
  const finalStatusLabel = finalStatus
    ? finalStatusLabels[finalStatus]
    : "ยังไม่ได้เลือก";
  const refundTransactionType: TransactionType =
    finalStatus === "cancelled" ? "cancellationRefund" : "roomRefund";
  const transactionTypeOptions: OptionType[] = [
    {
      value: refundTransactionType,
      label: "คืนเงินลูกค้า",
      color: "#fb7185",
    },
    { value: "compensation", label: "ชดเชยลูกค้า", color: "#38bdf8" },
    { value: "settlementCharge", label: "เก็บเงินเพิ่ม", color: "#22c55e" },
    ...(isPostClose
      ? [
          {
            value: "paymentCorrection",
            label: "แก้ไขการชำระเงิน",
            color: "#a78bfa",
          },
        ]
      : []),
    { value: "adjustment", label: "ปรับยอด", color: "#94a3b8" },
  ];
  const transactionTypeHelp = (
    <div className="resolveBooking__typeHelp">
      <span>คืนเงินลูกค้า — เงินที่คืนจากค่าห้องหรือการยกเลิก</span>
      <span>ชดเชยลูกค้า — เงินชดเชยเพิ่มเติมที่ไม่ใช่ยอดคืน</span>
      <span>เก็บเงินเพิ่ม — เงินที่รับเพิ่มจากลูกค้า</span>
      {isPostClose ? (
        <span>แก้ไขการชำระเงิน — แก้ยอดชำระที่บันทึกไว้เดิม</span>
      ) : null}
      <span>ปรับยอด — เพิ่มหรือลดยอดเมื่อประเภทอื่นไม่ตรง</span>
    </div>
  );

  const remainingDepositAmount = Math.max(
    booking.transactions.reduce((total, transaction) => {
      if (transaction.type === "deposit") return total + transaction.amount;
      if (
        transaction.type === "depositRefund" ||
        transaction.type === "depositKept"
      ) {
        return total - transaction.amount;
      }
      return total;
    }, 0),
    0,
  );
  const depositReturnRequired =
    variant === "specialCase" && remainingDepositAmount > 0;

  const activeRows = useMemo(
    () => (moneyAction === "none" || isNoShow ? [] : rows),
    [isNoShow, moneyAction, rows],
  );
  const totals = useMemo(
    () =>
      activeRows.reduce(
        (summary, row) => {
          const amount = Number(row.amount) || 0;
          if (row.direction === "in") summary.moneyIn += amount;
          if (row.direction === "out") summary.moneyOut += amount;
          return summary;
        },
        { moneyIn: 0, moneyOut: 0 },
      ),
    [activeRows],
  );
  const totalMoneyOut =
    totals.moneyOut + (depositReturnRequired ? remainingDepositAmount : 0);
  const hasCashMovement =
    depositReturnRequired ||
    activeRows.some(
      (row) =>
        row.paymentMethod === "Cash" &&
        row.direction !== "neutral" &&
        Number(row.amount) > 0,
    );

  const transactionAttachmentOptions: OptionType[] = booking.transactions
    .filter((transaction) => transaction._id)
    .map((transaction) => ({
      value: transaction._id || "",
      label: `${transaction.type} · ${transaction.paymentMethod} · ${formatCurrency(
        transaction.amount,
      )}`,
      color: transactionReferenceColor(transaction),
    }));

  const rowErrors = useMemo(() => {
    const errors = new Map<number, string>();

    activeRows.forEach((row, index) => {
      const rowHasDetails =
        index === 0 || row.amount || row.note || row.relatedTransactionId;
      if (!rowHasDetails) return;

      const amount = Number(row.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        errors.set(row.id, "กรุณาระบุจำนวนเงินมากกว่า 0");
      }
    });

    return errors;
  }, [activeRows]);

  const noteError = !note.trim()
    ? "กรุณาระบุหมายเหตุเพื่อให้ทีมตรวจสอบย้อนหลังได้"
    : "";
  const canSubmit =
    !(isPostClose && !user?.admin) &&
    (!isNoShow || roomReleaseStatus !== null) &&
    !submitting;
  const detailedTransactionsVisible = !isPostClose || advancedRowsOpen;

  useEffect(() => {
    const defaultRow = createRow(0);
    const rowsAreDirty = rows.some(
      (row) =>
        row.amount ||
        row.note ||
        row.relatedTransactionId ||
        row.type !== defaultRow.type ||
        row.paymentMethod !== defaultRow.paymentMethod ||
        row.direction !== defaultRow.direction,
    );

    onDirtyChange?.(
      Boolean(
        specialCaseFinalStatus !== null ||
        roomReleaseStatus !== initialRoomStatus ||
        reasonCode !== initialReasonCode ||
        note ||
        moneyAction !== "none" ||
        confirmedDepositReturn ||
        rowsAreDirty,
      ),
    );

    return () => onDirtyChange?.(false);
  }, [
    confirmedDepositReturn,
    initialReasonCode,
    initialRoomStatus,
    moneyAction,
    note,
    onDirtyChange,
    reasonCode,
    roomReleaseStatus,
    rows,
    specialCaseFinalStatus,
  ]);

  const applyMoneyAction = (action: MoneyActionId) => {
    setMoneyAction(action);
    setAdvancedRowsOpen(false);
    setTouchedRowIds(new Set());

    if (action === "none") {
      setRows([createRow(Date.now())]);
      return;
    }

    setRows((previousRows) => {
      const firstRow = previousRows[0];
      const actionRow = createRow(firstRow?.id || Date.now(), action);
      const contextualRow =
        !isPostClose &&
        action === "refund_guest" &&
        specialCaseFinalStatus === "cancelled"
          ? { ...actionRow, type: "cancellationRefund" as TransactionType }
          : actionRow;

      return [
        {
          ...contextualRow,
          amount: firstRow?.amount || "",
          note: firstRow?.note || "",
          relatedTransactionId: firstRow?.relatedTransactionId || "",
        },
      ];
    });
  };

  const changeSpecialCaseStatus = (status: SpecialCaseFinalStatus | null) => {
    setSpecialCaseFinalStatus(status);

    if (moneyAction !== "refund_guest" || status === null) return;

    setRows((previousRows) =>
      previousRows.map((row, index) =>
        index === 0 &&
        (row.type === "roomRefund" || row.type === "cancellationRefund")
          ? {
              ...row,
              type:
                status === "cancelled" ? "cancellationRefund" : "roomRefund",
            }
          : row,
      ),
    );
  };

  const updateRow = <K extends keyof SettlementRow>(
    id: number,
    field: K,
    value: SettlementRow[K],
  ) => {
    setRows((previousRows) =>
      previousRows.map((row) =>
        row.id === id ? { ...row, [field]: value } : row,
      ),
    );
  };

  const updateRowType = (id: number, type: TransactionType) => {
    setRows((previousRows) =>
      previousRows.map((row) =>
        row.id === id
          ? { ...row, type, direction: defaultDirectionForType(type) }
          : row,
      ),
    );
  };

  const addRow = () =>
    setRows((previousRows) => [
      ...previousRows,
      {
        ...createRow(Date.now(), "refund_guest"),
        type:
          !isPostClose && specialCaseFinalStatus === "cancelled"
            ? "cancellationRefund"
            : "roomRefund",
      },
    ]);

  const removeRow = (id: number) =>
    setRows((previousRows) =>
      previousRows.length === 1
        ? previousRows
        : previousRows.filter((row) => row.id !== id),
    );

  const submitHandler = async () => {
    if (submitting) return;
    setSubmitAttempted(true);
    if (isPostClose && !user?.admin) {
      throw new Error("การแก้ไขหลังปิด Booking ต้องให้ Admin ดำเนินการ");
    }
    if (variant === "specialCase" && (!outcome || !finalStatus)) {
      throw new Error("กรุณาเลือกสถานะหลังปิดเคส");
    }
    if (!effectiveReasonCode || !note.trim()) {
      throw new Error("กรุณาระบุหมายเหตุ");
    }
    if (!roomReleaseStatus) {
      throw new Error("กรุณาเลือกว่าจะเปิดห้องให้จองต่อหรือกันห้องไว้");
    }
    if (rowErrors.size > 0) {
      throw new Error(Array.from(rowErrors.values())[0]);
    }
    if (depositReturnRequired && !confirmedDepositReturn) {
      throw new Error("กรุณายืนยันการคืนมัดจำก่อนปิดเคส");
    }

    const settlementTransactions = activeRows
      .filter(
        (row, index) =>
          index === 0 || row.amount || row.note || row.relatedTransactionId,
      )
      .map((row) => ({
        type: row.type,
        paymentMethod: row.paymentMethod,
        amount: Number(row.amount),
        direction: row.direction,
        note: row.note.trim() || undefined,
        relatedTransactionId: row.relatedTransactionId || undefined,
      }));

    setSubmitting(true);

    try {
      const response = isNoShow
        ? await axios.post(
            `${API_URL}/bookings/${booking.bookingId}/no-show`,
            {
              expectedRevision: booking.revision,
              roomReleaseStatus,
              note: note.trim(),
            },
            {
              withCredentials: true,
              headers: { "Idempotency-Key": idempotencyKey },
            },
          )
        : await axios.patch(
            `${API_URL}/bookings/resolveBooking/${booking.bookingId}`,
            {
              expectedRevision: booking.revision,
              outcome,
              finalStatus,
              roomReleaseStatus,
              reasonCode: effectiveReasonCode,
              note: note.trim(),
              depositReturned: confirmedDepositReturn,
              transactions: settlementTransactions,
            },
            {
              withCredentials: true,
              headers: { "Idempotency-Key": idempotencyKey },
            },
          );

      if (response.data.booking) {
        onUpdated?.(formatBookingDates(response.data.booking));
      }

      onClose?.();
    } finally {
      setSubmitting(false);
    }
  };

  const title = isNoShow
    ? `ยืนยัน No-Show ให้ ${booking.name}`
    : isPostClose
      ? `แก้ไขหลังปิด · ${booking.name}`
      : `เคลียร์เคสพิเศษของ ${booking.name}`;
  const submitText = isNoShow
    ? "ยืนยัน No-Show"
    : isPostClose
      ? "บันทึกการแก้ไข"
      : totalMoneyOut > 0
        ? `ปิดเคสและคืน ${formatCurrency(totalMoneyOut)}`
        : totals.moneyIn > 0
          ? `ปิดเคสและรับ ${formatCurrency(totals.moneyIn)}`
          : "ปิดเคสพิเศษ";
  const availableMoneyActions = isPostClose
    ? moneyActions
    : moneyActions.filter((action) => action.id !== "correct_payment");

  const formatOptionLabel = ({
    label,
    color,
  }: {
    label: string;
    color?: string;
  }) => (
    <div className="resolveBooking__option">
      {color ? <span style={{ backgroundColor: color }} /> : null}
      {label}
    </div>
  );

  const roomReleaseControl = (
    <div className="cancellation__segmentedControl resolveBooking__segmentedControl">
      <button
        type="button"
        className={`cancellation__segment${
          roomReleaseStatus === "released"
            ? " cancellation__segment--active"
            : ""
        }`}
        aria-pressed={roomReleaseStatus === "released"}
        onClick={() => setRoomReleaseStatus("released")}
      >
        <i className="bx bx-door-open" aria-hidden="true" />
        เปิดให้จอง
      </button>
      <button
        type="button"
        className={`cancellation__segment${
          roomReleaseStatus === "blocked"
            ? " cancellation__segment--active"
            : ""
        }`}
        aria-pressed={roomReleaseStatus === "blocked"}
        onClick={() => setRoomReleaseStatus("blocked")}
      >
        <i className="bx bx-lock-keyhole" aria-hidden="true" />
        ไม่เปิดให้จอง
      </button>
    </div>
  );

  return (
    <div
      className={`addBooking__wrapper resolveBooking__wrapper${
        isNoShow ? " resolveBooking__wrapper--compact" : ""
      }`}
    >
      {onClose ? <ModalCloseButton onClick={onClose} /> : null}

      <div className="resolveBooking__header">
        <h1 className="addBooking__title">{title}</h1>
        {isNoShow || isPostClose ? (
          <p className="resolveBooking__intro">
            {isNoShow
              ? "ใช้เมื่อลูกค้าไม่มาเข้าพัก ระบบจะปิด Booking เป็น No-Show"
              : "สถานะ Booking จะไม่เปลี่ยน การแก้ไขนี้จะถูกบันทึกพร้อมชื่อ Admin"}
          </p>
        ) : null}
        {isPostClose && !user?.admin ? (
          <p className="resolveBooking__warning">
            เฉพาะ Admin เท่านั้นที่แก้ไข Booking หลังปิดได้
          </p>
        ) : null}
      </div>

      {hasCashMovement ? <CashShiftNudge /> : null}

      {!isNoShow && !isPostClose ? (
        <section className="resolveBooking__section">
          <div className="resolveBooking__twoColumn">
            <div>
              <p className="addBooking__label">สถานะหลังปิดเคส</p>
              <Select<OptionType>
                styles={customStyles<OptionType>()}
                className={`resolveBooking__statusSelect ${
                  specialCaseFinalStatus === null &&
                  (submitAttempted || statusTouched)
                    ? "formField--error"
                    : ""
                }`}
                classNamePrefix="resolveSelect"
                aria-invalid={
                  specialCaseFinalStatus === null &&
                  (submitAttempted || statusTouched)
                }
                options={specialCaseStatusOptions}
                value={
                  specialCaseStatusOptions.find(
                    (option) => option.value === specialCaseFinalStatus,
                  ) || null
                }
                menuPortalTarget={document.body}
                menuPosition="fixed"
                formatOptionLabel={formatOptionLabel}
                placeholder="เลือกสถานะ"
                onBlur={() => setStatusTouched(true)}
                onChange={(option: SingleValue<OptionType>) =>
                  changeSpecialCaseStatus(
                    (option?.value as SpecialCaseFinalStatus) || null,
                  )
                }
              />
              {specialCaseFinalStatus === null &&
              (submitAttempted || statusTouched) ? (
                <p className="formField__error">
                  กรุณาเลือกสถานะหลังปิดเคส
                </p>
              ) : null}
            </div>
            <div>
              <p className="addBooking__label">
                ต้องการเปิดห้องให้จองต่อหรือไม่?
              </p>
              {roomReleaseControl}
            </div>
          </div>
        </section>
      ) : null}

      {isPostClose ? (
        <section
          className="resolveBooking__lockedStatus"
          aria-label="สถานะ Booking"
        >
          <i className="bx bx-lock-keyhole" aria-hidden="true" />
          <div>
            <span>สถานะเดิมจะไม่เปลี่ยน</span>
            <strong>{finalStatusLabel}</strong>
          </div>
        </section>
      ) : null}

      {isNoShow || isPostClose ? (
        <section className="resolveBooking__section">
          <p className="addBooking__label">ต้องการเปิดห้องให้จองต่อหรือไม่?</p>
          {roomReleaseControl}
        </section>
      ) : null}

      {!isNoShow ? (
        <section className="resolveBooking__section">
          <p className="addBooking__label">
            ต้องบันทึกรายการเงินพร้อมการปิดเคสหรือไม่?
          </p>
          <div className="resolveBooking__quickActions">
            <button
              type="button"
              className={`resolveBooking__quickAction${
                moneyAction === "none"
                  ? " resolveBooking__quickAction--active"
                  : ""
              }`}
              aria-pressed={moneyAction === "none"}
              onClick={() => applyMoneyAction("none")}
            >
              <i className="bx bx-check" aria-hidden="true" />
              <span>ไม่มีรายการเงิน</span>
              <small>ปิดเคสโดยไม่คืนหรือรับเงินเพิ่ม</small>
            </button>
            {availableMoneyActions.map((action) => (
              <button
                type="button"
                key={action.id}
                className={`resolveBooking__quickAction${
                  moneyAction === action.id
                    ? " resolveBooking__quickAction--active"
                    : ""
                }`}
                aria-pressed={moneyAction === action.id}
                onClick={() => applyMoneyAction(action.id)}
              >
                <i className={`bx ${action.icon}`} aria-hidden="true" />
                <span>{action.label}</span>
                <small>{action.helper}</small>
              </button>
            ))}
          </div>

          {moneyAction !== "none" ? (
            <div className="resolveBooking__rows">
              {rows.map((row, index) => (
                <div className="resolveBooking__row" key={row.id}>
                  <div className="resolveBooking__rowHeader">
                    <p className="correctionHistory__badge">
                      รายการเงิน {index + 1}
                    </p>
                    {detailedTransactionsVisible && rows.length > 1 ? (
                      <button
                        type="button"
                        className="resolveBooking__rowRemove"
                        onClick={() => removeRow(row.id)}
                      >
                        <i className="bx bx-trash" aria-hidden="true" />
                        ลบรายการ
                      </button>
                    ) : null}
                  </div>

                  {detailedTransactionsVisible ? (
                    <div>
                      <div className="resolveBooking__labelWithInfo">
                        <p className="addBooking__label">ประเภทรายการ</p>
                        <Tooltip
                          content={transactionTypeHelp}
                          ariaLabel="คำอธิบายประเภทรายการ"
                        >
                          <i className="bx bx-info-circle" aria-hidden="true" />
                        </Tooltip>
                      </div>
                      <Select<OptionType>
                        styles={customStyles<OptionType>()}
                        classNamePrefix="resolveSelect"
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
                          updateRowType(
                            row.id,
                            (option?.value as TransactionType) || row.type,
                          )
                        }
                      />
                    </div>
                  ) : null}

                  <div>
                    <p className="addBooking__label">จำนวนเงิน</p>
                    <input
                      className={`boxInput ${
                        rowErrors.has(row.id) &&
                        (submitAttempted || touchedRowIds.has(row.id))
                          ? "boxInput--error"
                          : ""
                      }`}
                      type="number"
                      min="0"
                      inputMode="decimal"
                      value={row.amount}
                      placeholder="0"
                      aria-invalid={
                        rowErrors.has(row.id) &&
                        (submitAttempted || touchedRowIds.has(row.id))
                      }
                      aria-describedby={
                        rowErrors.has(row.id) &&
                        (submitAttempted || touchedRowIds.has(row.id))
                          ? `resolve-row-error-${row.id}`
                          : undefined
                      }
                      onChange={(event) =>
                        updateRow(row.id, "amount", event.target.value)
                      }
                      onBlur={() =>
                        setTouchedRowIds((currentIds) => {
                          const nextIds = new Set(currentIds);
                          nextIds.add(row.id);
                          return nextIds;
                        })
                      }
                    />
                    {rowErrors.has(row.id) &&
                    (submitAttempted || touchedRowIds.has(row.id)) ? (
                      <p
                        id={`resolve-row-error-${row.id}`}
                        className="formField__error"
                      >
                        {rowErrors.get(row.id)}
                      </p>
                    ) : null}
                  </div>

                  <div>
                    <p className="addBooking__label">ช่องทาง</p>
                    <Select<OptionType>
                      styles={customStyles<OptionType>()}
                      classNamePrefix="resolveSelect"
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

                  {isPostClose && index === 0 ? (
                    <button
                      type="button"
                      className="resolveBooking__advancedToggle"
                      aria-expanded={advancedRowsOpen}
                      onClick={() => setAdvancedRowsOpen((isOpen) => !isOpen)}
                    >
                      <i
                        className={`bx ${
                          advancedRowsOpen ? "bx-chevron-up" : "bx-chevron-down"
                        }`}
                        aria-hidden="true"
                      />
                      {advancedRowsOpen
                        ? "ซ่อนรายละเอียดขั้นสูง"
                        : "แสดงรายละเอียดขั้นสูง"}
                    </button>
                  ) : null}

                  {detailedTransactionsVisible ? (
                    <>
                      <div>
                        <p className="addBooking__label">ทิศทางเงิน</p>
                        <Select<OptionType>
                          styles={customStyles<OptionType>()}
                          classNamePrefix="resolveSelect"
                          options={directionOptions}
                          isDisabled={row.type !== "adjustment"}
                          value={
                            directionOptions.find(
                              (option) => option.value === row.direction,
                            ) || null
                          }
                          menuPortalTarget={document.body}
                          menuPosition="fixed"
                          onChange={(option: SingleValue<OptionType>) =>
                            updateRow(
                              row.id,
                              "direction",
                              (option?.value as TransactionDirection) ||
                                row.direction,
                            )
                          }
                        />
                      </div>
                      <div>
                        <p className="addBooking__label">อ้างอิงรายการเดิม</p>
                        <Select<OptionType>
                          styles={customStyles<OptionType>()}
                          classNamePrefix="resolveSelect"
                          options={transactionAttachmentOptions}
                          value={
                            transactionAttachmentOptions.find(
                              (option) =>
                                option.value === row.relatedTransactionId,
                            ) || null
                          }
                          isClearable
                          placeholder="ไม่บังคับ"
                          menuPortalTarget={document.body}
                          menuPosition="fixed"
                          formatOptionLabel={formatOptionLabel}
                          onChange={(option: SingleValue<OptionType>) =>
                            updateRow(
                              row.id,
                              "relatedTransactionId",
                              option?.value || "",
                            )
                          }
                        />
                      </div>
                      <div className="resolveBooking__rowNote">
                        <p className="addBooking__label">หมายเหตุรายการ</p>
                        <input
                          className="boxInput"
                          value={row.note}
                          placeholder="ไม่บังคับ"
                          onChange={(event) =>
                            updateRow(row.id, "note", event.target.value)
                          }
                        />
                      </div>
                    </>
                  ) : null}
                </div>
              ))}

              {detailedTransactionsVisible ? (
                <button
                  type="button"
                  className="resolveBooking__linkButton resolveBooking__addTransaction"
                  onClick={addRow}
                >
                  <i className="bx bx-plus" aria-hidden="true" />
                  เพิ่มรายการเงิน
                </button>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}

      {depositReturnRequired ? (
        <section className="resolveBooking__depositNotice">
          <i className="bx bx-wallet" aria-hidden="true" />
          <div>
            <strong>
              ต้องคืนมัดจำ {formatCurrency(remainingDepositAmount)}
            </strong>
            <p>
              เมื่อบันทึก ระบบจะเพิ่มรายการคืนมัดจำจำนวนนี้ใน Booking
              โดยอัตโนมัติ
            </p>
            <label className="checkbox resolveBooking__depositReturn">
              ยืนยันว่าคืนมัดจำให้ลูกค้าแล้ว
              <input
                type="checkbox"
                checked={confirmedDepositReturn}
                onChange={(event) =>
                  setConfirmedDepositReturn(event.target.checked)
                }
              />
              <span className="box" />
            </label>
          </div>
        </section>
      ) : null}

      <section className="resolveBooking__section">
        <div className={isPostClose ? "resolveBooking__twoColumn" : undefined}>
          {isPostClose ? (
            <div>
              <p className="addBooking__label">เหตุผลที่แก้ไข</p>
              <Select<OptionType>
                styles={customStyles<OptionType>()}
                classNamePrefix="resolveSelect"
                options={reasonOptions}
                value={
                  reasonOptions.find((option) => option.value === reasonCode) ||
                  null
                }
                menuPortalTarget={document.body}
                menuPosition="fixed"
                onChange={(option: SingleValue<OptionType>) =>
                  setReasonCode(option?.value || "")
                }
              />
            </div>
          ) : null}
          <div>
            <p className="addBooking__label">
              {isNoShow ? "หมายเหตุ No-Show" : "หมายเหตุ"}
            </p>
            <textarea
              className={`boxInput resolveBooking__note ${
                noteError && (submitAttempted || noteTouched)
                  ? "boxInput--error"
                  : ""
              }`}
              value={note}
              aria-invalid={
                Boolean(noteError) && (submitAttempted || noteTouched)
              }
              placeholder={
                isNoShow
                  ? "เช่น ติดต่อทางโทรศัพท์แล้ว ลูกค้ายืนยันว่าไม่เข้าพัก"
                  : "สรุปเหตุการณ์และสิ่งที่ดำเนินการให้ทีมอ่านย้อนหลัง"
              }
              aria-describedby={
                noteError && (submitAttempted || noteTouched)
                  ? "resolve-note-error"
                  : undefined
              }
              onChange={(event) => setNote(event.target.value)}
              onBlur={() => setNoteTouched(true)}
            />
            {noteError && (submitAttempted || noteTouched) ? (
              <p id="resolve-note-error" className="formField__error">
                {noteError}
              </p>
            ) : null}
          </div>
        </div>
      </section>

      <section className="resolveBooking__summary" aria-live="polite">
        <p className="addBooking__label">หลังบันทึก</p>
        <ul>
          <li>
            <i className="bx bx-check-circle" aria-hidden="true" />
            Booking เป็น <strong>{finalStatusLabel}</strong>
          </li>
          <li>
            <i className="bx bx-bed" aria-hidden="true" />
            {roomReleaseStatus === "released"
              ? "เปิดคืนที่เหลือให้ลูกค้าคนอื่นจอง"
              : roomReleaseStatus === "blocked"
                ? "กันห้องไว้ ไม่เปิดให้จอง"
                : "กรุณาเลือกผลต่อห้องก่อนบันทึก"}
          </li>
          {!isNoShow ? (
            <li>
              <i className="bx bx-wallet" aria-hidden="true" />
              {moneyAction === "none" && !depositReturnRequired
                ? "ไม่มีรายการเงินเพิ่ม"
                : [
                    totalMoneyOut > 0
                      ? `คืนเงินรวม ${formatCurrency(totalMoneyOut)}`
                      : "",
                    totals.moneyIn > 0
                      ? `รับเงินเพิ่ม ${formatCurrency(totals.moneyIn)}`
                      : "",
                  ]
                    .filter(Boolean)
                    .join(" และ ")}
            </li>
          ) : null}
        </ul>
      </section>

      <div className="resolveBooking__actions">
        <ActionButton text="ยกเลิก" icon="bx-x" onClick={() => onClose?.()} />
        <ActionButton
          text={submitText}
          icon={
            isNoShow ? "bx-user-x" : isPostClose ? "bx-history" : "bx-receipt"
          }
          highlight
          disabled={!canSubmit}
          onClick={() =>
            toast.promise(submitHandler(), {
              loading: "กำลังบันทึก...",
              success: isNoShow
                ? "บันทึก No-Show สำเร็จ"
                : isPostClose
                  ? "บันทึกการแก้ไขสำเร็จ"
                  : "ปิดเคสพิเศษสำเร็จ",
              error: (error) =>
                error.response?.data?.message ||
                error.message ||
                "เกิดข้อผิดพลาดในการบันทึก",
            })
          }
        />
      </div>
    </div>
  );
};

export default ResolveBooking;
