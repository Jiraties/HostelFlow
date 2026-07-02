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
type FinalStatus = "checkedOut" | "cancelled" | "noShow";
type RoomReleaseStatus = "released" | "blocked";
type ResolveMode = "open" | "checkedIn" | "closed";
type ScenarioId =
  | "no_show"
  | "guest_left"
  | "cancel_before_arrival"
  | "cancel_after_checkin"
  | "manual_checkout"
  | "post_close_adjustment";
type QuickActionId =
  | "refund_guest"
  | "collect_extra"
  | "keep_deposit"
  | "correct_payment";

type SettlementRow = {
  id: number;
  type: TransactionType;
  paymentMethod: Exclude<PaymentMethod, "Unpaid">;
  amount: string;
  direction: TransactionDirection;
  note: string;
  relatedTransactionId: string;
};

type ScenarioConfig = {
  id: ScenarioId;
  label: string;
  description: string;
  icon: string;
  outcome: ResolutionOutcome;
  finalStatus: FinalStatus;
  reasonCode?: string;
  quickAction?: QuickActionId;
};

type QuickActionConfig = {
  id: QuickActionId;
  label: string;
  helper: string;
  icon: string;
  row: Omit<SettlementRow, "id" | "amount" | "note" | "relatedTransactionId">;
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
  { value: "noShow", label: "No-Show" },
];

const scenarioOptionsByMode: Record<ResolveMode, ScenarioConfig[]> = {
  open: [
    {
      id: "cancel_before_arrival",
      label: "ยกเลิกก่อนเข้าพัก",
      description: "ยกเลิก booking ที่ยังไม่ได้ Check-In",
      icon: "bx-calendar-x",
      outcome: "cancelled_before_arrival",
      finalStatus: "cancelled",
      reasonCode: "ota_cancellation",
      quickAction: "refund_guest",
    },
    {
      id: "no_show",
      label: "No-Show",
      description: "ลูกค้าไม่มาเข้าพักและต้องปิดเป็น No-Show",
      icon: "bx-user-x",
      outcome: "no_show",
      finalStatus: "noShow",
      reasonCode: "no_show",
    },
    {
      id: "guest_left",
      label: "ลูกค้าไม่เข้าพัก / เคลียร์เอง",
      description: "ใช้เมื่อเคสไม่เข้า flow ยกเลิกปกติแต่ต้องปิดรายการ",
      icon: "bx-exit",
      outcome: "guest_left",
      finalStatus: "checkedOut",
      reasonCode: "other",
    },
  ],
  checkedIn: [
    {
      id: "guest_left",
      label: "ลูกค้าออกก่อน / เคสพิเศษ",
      description: "ลูกค้าออกจากที่พักก่อนกำหนดหรือมีเหตุให้ปิดรายการ",
      icon: "bx-run",
      outcome: "guest_left",
      finalStatus: "checkedOut",
      reasonCode: "early_checkout",
      quickAction: "refund_guest",
    },
    {
      id: "manual_checkout",
      label: "เคลียร์ Check-Out เอง",
      description: "ปิดเป็น Check-Out พร้อมบันทึกยอดคืนหรือยอดเก็บเพิ่ม",
      icon: "bx-receipt",
      outcome: "normal_checkout",
      finalStatus: "checkedOut",
      reasonCode: "other",
    },
    {
      id: "cancel_after_checkin",
      label: "ยกเลิกหลัง Check-In",
      description: "เปลี่ยนเป็นยกเลิกหลังลูกค้าเข้าพักแล้ว",
      icon: "bx-calendar-exclamation",
      outcome: "cancelled_after_checkin",
      finalStatus: "cancelled",
      reasonCode: "other",
      quickAction: "refund_guest",
    },
  ],
  closed: [
    {
      id: "post_close_adjustment",
      label: "แก้ไขหลังปิด",
      description: "สำหรับ admin แก้ยอดหรือเหตุผลย้อนหลังหลัง booking ปิดแล้ว",
      icon: "bx-history",
      outcome: "post_close_adjustment",
      finalStatus: "checkedOut",
      reasonCode: "payment_error",
      quickAction: "correct_payment",
    },
  ],
};

const quickActionOptions: QuickActionConfig[] = [
  {
    id: "refund_guest",
    label: "คืนเงินลูกค้า",
    helper: "ใช้กับค่าห้อง มัดจำ หรือเงินยกเลิกที่ต้องจ่ายออก",
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
    helper: "ใช้เมื่อที่พักต้องรับเงินเพิ่มจากลูกค้า",
    icon: "bx-plus-circle",
    row: {
      type: "settlementCharge",
      paymentMethod: "Cash",
      direction: "in",
    },
  },
  {
    id: "keep_deposit",
    label: "เก็บมัดจำ",
    helper: "บันทึกการเก็บมัดจำโดยไม่มีเงินเข้าออกใหม่",
    icon: "bx-lock-alt",
    row: {
      type: "depositKept",
      paymentMethod: "Cash",
      direction: "neutral",
    },
  },
  {
    id: "correct_payment",
    label: "แก้ไขการชำระเงิน",
    helper: "ใช้กับรายการที่บันทึกช่องทางหรือยอดผิด",
    icon: "bx-edit",
    row: {
      type: "paymentCorrection",
      paymentMethod: "Cash",
      direction: "neutral",
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
  quickAction: QuickActionId = "refund_guest",
): SettlementRow => {
  const selectedAction =
    quickActionOptions.find((option) => option.id === quickAction) ||
    quickActionOptions[0];

  return {
    id,
    ...selectedAction.row,
    amount: "",
    note: "",
    relatedTransactionId: "",
  };
};

const getMode = (currentBooking: booking): ResolveMode => {
  if (
    currentBooking.status === "checkedOut" ||
    currentBooking.status === "cancelled" ||
    currentBooking.status === "noShow"
  ) {
    return "closed";
  }

  return currentBooking.status === "checkedIn" ? "checkedIn" : "open";
};

const getInitialScenario = (
  mode: ResolveMode,
  currentBooking: booking,
  initialOutcome?: ResolutionOutcome,
): ScenarioConfig => {
  const scenarios = scenarioOptionsByMode[mode];
  const matchedScenario = scenarios.find(
    (scenario) => scenario.outcome === initialOutcome,
  );

  if (matchedScenario) return matchedScenario;

  if (mode === "closed") {
    return {
      ...scenarios[0],
      finalStatus:
        currentBooking.status === "cancelled" ||
        currentBooking.status === "noShow"
          ? currentBooking.status
          : "checkedOut",
    };
  }

  return scenarios[0];
};

const getStatusLabel = (status: FinalStatus) =>
  finalStatusOptions.find((option) => option.value === status)?.label || status;

const ResolveBooking = ({
  booking,
  initialOutcome,
  initialFinalStatus,
  onClose,
  onUpdated,
  onDirtyChange,
}: {
  booking: booking;
  initialOutcome?: ResolutionOutcome;
  initialFinalStatus?: FinalStatus;
  onClose?: () => void;
  onUpdated?: (booking: booking) => void;
  onDirtyChange?: (isDirty: boolean) => void;
}) => {
  const { user } = useAuth();
  const mode = getMode(booking);
  const bookingIsClosed = mode === "closed";
  const initialScenario = getInitialScenario(mode, booking, initialOutcome);
  const [scenarioId, setScenarioId] = useState<ScenarioId>(initialScenario.id);
  const [outcome, setOutcome] = useState<ResolutionOutcome>(
    initialScenario.outcome,
  );
  const [finalStatus, setFinalStatus] = useState<FinalStatus>(
    initialFinalStatus || initialScenario.finalStatus,
  );
  const [roomReleaseStatus, setRoomReleaseStatus] =
    useState<RoomReleaseStatus>("released");
  const [reasonCode, setReasonCode] = useState(
    initialScenario.reasonCode || "",
  );
  const [note, setNote] = useState("");
  const [moneyAdjustmentEnabled, setMoneyAdjustmentEnabled] =
    useState(bookingIsClosed);
  const [advancedRowsOpen, setAdvancedRowsOpen] = useState(bookingIsClosed);
  const [rows, setRows] = useState<SettlementRow[]>(
    initialScenario.quickAction
      ? [createRow(Date.now(), initialScenario.quickAction)]
      : [createRow(Date.now())],
  );
  const [submitting, setSubmitting] = useState(false);

  const availableScenarios = scenarioOptionsByMode[mode].map((scenario) => {
    if (bookingIsClosed) {
      const closedFinalStatus: FinalStatus =
        booking.status === "cancelled" || booking.status === "noShow"
          ? booking.status
          : "checkedOut";

      return {
        ...scenario,
        finalStatus: closedFinalStatus,
      };
    }

    return scenario;
  });
  const selectedScenario =
    availableScenarios.find((scenario) => scenario.id === scenarioId) ||
    availableScenarios[0];

  const transactionAttachmentOptions: OptionType[] = booking.transactions
    .filter((transaction) => transaction._id)
    .map((transaction) => ({
      value: transaction._id || "",
      label: `${transaction.type} · ${transaction.paymentMethod} · ${formatCurrency(
        transaction.amount,
      )}`,
    }));

  const activeRows = moneyAdjustmentEnabled ? rows : [];

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

  const rowErrors = useMemo(() => {
    const errors = new Map<number, string>();

    activeRows.forEach((row) => {
      const rowHasDetails = row.amount || row.note || row.relatedTransactionId;
      if (!rowHasDetails) return;

      const amount = Number(row.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        errors.set(row.id, "กรุณาระบุจำนวนเงินมากกว่า 0");
        return;
      }

      if (row.type === "depositKept" && row.direction !== "neutral") {
        errors.set(row.id, "รายการเก็บมัดจำต้องเลือกไม่มีเงินเข้า/ออก");
      }
    });

    return errors;
  }, [activeRows]);

  const reasonError = !reasonCode ? "กรุณาเลือกเหตุผล" : "";
  const noteError = !note.trim()
    ? "กรุณาระบุหมายเหตุสำหรับตรวจสอบย้อนหลัง"
    : "";
  const canSubmit =
    Boolean(reasonCode && note.trim()) &&
    rowErrors.size === 0 &&
    !(bookingIsClosed && !user?.admin) &&
    !submitting;

  useEffect(() => {
    onDirtyChange?.(
      Boolean(
        scenarioId !== initialScenario.id ||
        reasonCode !== (initialScenario.reasonCode || "") ||
        note ||
        roomReleaseStatus !== "released" ||
        moneyAdjustmentEnabled !== bookingIsClosed ||
        rows.some(
          (row) =>
            row.amount ||
            row.note ||
            row.relatedTransactionId ||
            row.type !== createRow(0).type ||
            row.paymentMethod !== "Cash" ||
            row.direction !== createRow(0).direction,
        ),
      ),
    );

    return () => onDirtyChange?.(false);
  }, [
    bookingIsClosed,
    initialScenario.id,
    initialScenario.reasonCode,
    moneyAdjustmentEnabled,
    note,
    onDirtyChange,
    reasonCode,
    roomReleaseStatus,
    rows,
    scenarioId,
  ]);

  const applyScenario = (scenario: ScenarioConfig) => {
    setScenarioId(scenario.id);
    setOutcome(scenario.outcome);
    setFinalStatus(scenario.finalStatus);
    setReasonCode(scenario.reasonCode || "");

    if (!bookingIsClosed) {
      setMoneyAdjustmentEnabled(false);
      setAdvancedRowsOpen(false);
    }

    if (scenario.quickAction) {
      setRows([createRow(Date.now(), scenario.quickAction)]);
    }
  };

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

  const applyQuickAction = (quickAction: QuickActionId) => {
    setMoneyAdjustmentEnabled(true);
    setRows((prevRows) => {
      const [firstRow, ...otherRows] = prevRows;
      const nextRow = {
        ...createRow(firstRow?.id || Date.now(), quickAction),
        amount: firstRow?.amount || "",
        note: firstRow?.note || "",
        relatedTransactionId: firstRow?.relatedTransactionId || "",
      };

      return [nextRow, ...otherRows];
    });
  };

  const addRow = () =>
    setRows((prevRows) => [...prevRows, createRow(Date.now(), "refund_guest")]);

  const removeRow = (id: number) =>
    setRows((prevRows) =>
      prevRows.length === 1
        ? prevRows
        : prevRows.filter((row) => row.id !== id),
    );

  const submitHandler = async () => {
    if (submitting) return;

    if (bookingIsClosed && !user?.admin) {
      throw new Error("การแก้ไขหลังปิด Booking ต้องให้ Admin ดำเนินการ");
    }

    if (!reasonCode || !note.trim()) {
      throw new Error("กรุณาเลือกเหตุผลและระบุหมายเหตุ");
    }

    if (rowErrors.size > 0) {
      throw new Error(Array.from(rowErrors.values())[0]);
    }

    const settlementTransactions = activeRows
      .filter((row) => row.amount || row.note || row.relatedTransactionId)
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

  const formatOptionLabel = ({
    label,
    color,
  }: {
    label: string;
    color?: string;
  }) => (
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
          {bookingIsClosed
            ? "แก้ไขหลังปิด"
            : `Resolve การจองของ ${booking.name}`}
        </h1>

        {bookingIsClosed && (
          <p className="resolveBooking__warning">
            Booking นี้ปิดแล้ว เฉพาะ Admin เท่านั้นที่บันทึกการแก้ไขย้อนหลังได้
          </p>
        )}
      </div>

      <section className="resolveBooking__section">
        <p className="addBooking__label">เกิดอะไรขึ้นกับรายการจองนี้?</p>
        <div className="resolveBooking__scenarioGrid">
          {availableScenarios.map((scenario) => (
            <button
              type="button"
              key={scenario.id}
              className={
                "resolveBooking__scenario" +
                (scenario.id === selectedScenario.id
                  ? " resolveBooking__scenario--active"
                  : "")
              }
              onClick={() => applyScenario(scenario)}
            >
              <i className={`bx ${scenario.icon}`} />
              <span>{scenario.label}</span>
              <small>{scenario.description}</small>
            </button>
          ))}
        </div>
      </section>

      <section className="resolveBooking__section">
        <div className="resolveBooking__twoColumn">
          <div>
            <p className="addBooking__label">สถานะหลังจบเคส</p>
            <div className="resolveBooking__statusPreview">
              <div className={`resolveBooking__statusInline ${finalStatus}`}>
                <div className="viewBooking__statusDot" />
                <p>{getStatusLabel(finalStatus)}</p>
              </div>
            </div>
          </div>
          <div>
            <p className="addBooking__label">ห้องหลังจบเคส</p>
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
        </div>
      </section>

      <section className="resolveBooking__section">
        <div className="resolveBooking__sectionHeader">
          <div>
            <p className="addBooking__label">มีรายการเงินที่ต้องแก้ไหม?</p>
          </div>
          <button
            type="button"
            className={
              "resolveBooking__toggle" +
              (!moneyAdjustmentEnabled ? " resolveBooking__toggle--active" : "")
            }
            onClick={() => setMoneyAdjustmentEnabled(false)}
          >
            ไม่มีรายการเงิน
          </button>
        </div>

        <div className="resolveBooking__quickActions">
          {quickActionOptions.map((action) => (
            <button
              type="button"
              key={action.id}
              className={
                "resolveBooking__quickAction" +
                (moneyAdjustmentEnabled && rows[0]?.type === action.row.type
                  ? " resolveBooking__quickAction--active"
                  : "")
              }
              onClick={() => applyQuickAction(action.id)}
            >
              <i className={`bx ${action.icon}`} />
              <span>{action.label}</span>
              <small>{action.helper}</small>
            </button>
          ))}
        </div>

        {moneyAdjustmentEnabled && (
          <div className="resolveBooking__rows">
            {rows.map((row, index) => (
              <div className="resolveBooking__row" key={row.id}>
                <div>
                  <p className="addBooking__label">รายการที่ {index + 1}</p>
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
                      updateRow(
                        row.id,
                        "type",
                        (option?.value as TransactionType) || row.type,
                      )
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
                    onChange={(event) =>
                      updateRow(row.id, "amount", event.target.value)
                    }
                  />
                  {rowErrors.has(row.id) && (
                    <p className="resolveBooking__fieldError">
                      {rowErrors.get(row.id)}
                    </p>
                  )}
                </div>

                <button
                  type="button"
                  className="resolveBooking__advancedToggle"
                  onClick={() => setAdvancedRowsOpen((isOpen) => !isOpen)}
                >
                  <i
                    className={`bx ${
                      advancedRowsOpen ? "bx-chevron-up" : "bx-chevron-down"
                    }`}
                  />
                  รายละเอียดขั้นสูง
                </button>

                {advancedRowsOpen && (
                  <>
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
                            (option?.value as TransactionDirection) ||
                              row.direction,
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
                            (option?.value as Exclude<
                              PaymentMethod,
                              "Unpaid"
                            >) || row.paymentMethod,
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
                            (option) =>
                              option.value === row.relatedTransactionId,
                          ) || null
                        }
                        isClearable
                        placeholder="ไม่บังคับ"
                        menuPortalTarget={document.body}
                        menuPosition="fixed"
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
                )}

                <ActionButton
                  text=""
                  icon="bx-trash"
                  className="resolveBooking__removeButton"
                  disabled={rows.length === 1}
                  onClick={() => removeRow(row.id)}
                />
              </div>
            ))}
            <button
              type="button"
              className="resolveBooking__linkButton"
              onClick={addRow}
            >
              <i className="bx bx-plus" />
              เพิ่มรายการเงินอีกหนึ่งรายการ
            </button>
          </div>
        )}
      </section>

      <section className="resolveBooking__section">
        <div className="resolveBooking__twoColumn">
          <div>
            <p className="addBooking__label">เหตุผล</p>
            <Select<OptionType>
              styles={customStyles<OptionType>()}
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
            {reasonError && (
              <p className="resolveBooking__fieldError">{reasonError}</p>
            )}
          </div>
          <div>
            <p className="addBooking__label">หมายเหตุ</p>
            <textarea
              className="boxInput resolveBooking__note"
              value={note}
              placeholder="สรุปเหตุผลให้ทีมอ่านย้อนหลังเข้าใจ"
              onChange={(event) => setNote(event.target.value)}
            />
            {noteError && (
              <p className="resolveBooking__fieldError">{noteError}</p>
            )}
          </div>
        </div>
      </section>

      <section className="cancellation__section">
        <p className="addBooking__label">สรุปก่อนบันทึก</p>
        <div className="cancellation__paymentConfirmation">
          <div className="cancellation__paymentConfirmationList">
            <div className="cancellation__paymentRow">
              <p>รับเงินเพิ่มจากลูกค้า</p>
              <p>{formatCurrency(totals.moneyIn)}</p>
            </div>
            <div className="cancellation__paymentRow">
              <p>คืนเงินให้ลูกค้า</p>
              <p>{formatCurrency(totals.moneyOut)}</p>
            </div>
            {!moneyAdjustmentEnabled && (
              <div className="cancellation__paymentRow">
                <p>รายการเงิน</p>
                <p>ไม่มีรายการเงิน</p>
              </div>
            )}
          </div>

          <div className="cancellation__paymentConfirmationTotal">
            <div className="cancellation__totalsBreakdown">
              <div className="cancellation__totalRowFlex">
                <div className="cancellation__totalRow">
                  <p>สุทธิ</p>
                  <p className="cancellation__paymentConfirmationTotalText">
                    {formatCurrency(totals.moneyIn - totals.moneyOut)}
                  </p>
                </div>
                <div className="cancellation__totalRow other-total">
                  <p>สถานะ Booking</p>
                  <p className="cancellation__paymentConfirmationTotalText">
                    {getStatusLabel(finalStatus)}
                  </p>
                </div>
                <div className="cancellation__totalRow other-total">
                  <p>สถานะห้อง:</p>
                  <p className="cancellation__paymentConfirmationTotalText">
                    {roomReleaseStatus === "released"
                      ? "เปิดให้จอง"
                      : "ไม่เปิดให้จอง"}
                  </p>
                </div>
                <div className="cancellation__totalRow other-total">
                  <p>ข้อมูลตรวจสอบ</p>
                  <p className="cancellation__paymentConfirmationTotalText">
                    {reasonCode && note.trim() ? "ครบแล้ว" : "ยังไม่ครบ"}
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
          text={bookingIsClosed ? "บันทึกการแก้ไข" : "บันทึกการเคลียร์เคส"}
          icon={bookingIsClosed ? "bx-history" : "bx-receipt"}
          highlight
          disabled={!canSubmit}
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
