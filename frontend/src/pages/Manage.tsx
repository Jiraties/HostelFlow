import "./Manage.css";

import axios from "axios";
import toast from "react-hot-toast";
import ActionButton from "../components/ActionButton";
import PageHeader from "../components/PageHeader";
import ViewActivities from "../features/activities/ViewActivities";

import { useEffect, useMemo, useState } from "react";
import { API_URL } from "../config/api";
import { profilePictureUrl } from "../helpers/profilePictureUrl";
import { Modal } from "@mui/material";
import type { actionType, activity } from "../types/activitiesTypes";
import CreateNewUser from "../components/CreateNewUser";
import ManageUser from "../components/ManageUser";
import { useAuth } from "../context/AuthContext";
import type { ManagedStaffUser } from "../components/ManageUser";
import { requestUnsavedModalClose } from "../helpers/modalGuards";
import UnsavedChangesModal from "../components/UnsavedChangesModal";
import usePageTitle from "../hooks/useTitle";
import { formatDisplayDateTime } from "../helpers/displayDate";
import type { DateFormatPreference } from "../types/userSettings";
import type { LegacyDepositAudit } from "../types/cashShiftTypes";

type StaffUser = ManagedStaffUser;

type ActivityStats = {
  totalActions: number;
  byStaff: Array<{ staffUsername: string; count: number }>;
  byAction: Array<{ action: actionType; count: number }>;
};

type ReviewTransaction = {
  _id?: string;
  bookingId?: string;
  guestName?: string;
  staffUsername?: string;
  type: string;
  paymentMethod: string;
  amount: number;
  direction?: "in" | "out" | "neutral";
  createdAt?: string | Date;
  reference?: string;
  reviewFlags?: string[];
  reviewStatus?: "none" | "needs_review" | "reviewed";
  reviewedBy?: string;
  reviewedAt?: string | Date;
  note?: string;
};

type CashAuditWarning = {
  code: string;
  severity: "warning" | "critical";
  message: string;
};

type CashAuditMovements = {
  operatingCashIn: number;
  operatingCashOut: number;
};

type CashAuditShift = {
  _id: string;
  shiftNumber: number;
  status: "open" | "closed";
  openingMode: "counted" | "accepted_handoff";
  operatingOpeningCash: number;
  operatingCashIn: number;
  operatingCashOut: number;
  operatingExpectedCash: number;
  operatingActualCash?: number;
  operatingVariance?: number;
  isFinalDayClose?: boolean;
  legacyDeposit?: LegacyDepositAudit;
  note?: string;
  startedAt: string | Date;
  endedAt?: string | Date;
  staff?: { username: string; name?: string; profilePictureUrl?: string };
  warnings: CashAuditWarning[];
  flaggedTransactions: ReviewTransaction[];
  auditResolution?: {
    note: string;
    reviewedBy: string;
    reviewedAt: string | Date;
  };
  handoff?: {
    fromShiftNumber: number;
    mode: "counted" | "accepted_handoff";
    elapsedMinutes: number;
    expectedOperatingOpening: number;
    operatingDifference: number;
    movements: CashAuditMovements;
    mismatch: boolean;
  };
};

type CashShiftAudit = {
  businessDate: string;
  threshold: number;
  shifts: CashAuditShift[];
  gaps: Array<{
    from: string | Date;
    to: string | Date;
    movements: CashAuditMovements;
    warning: CashAuditWarning;
  }>;
};

type NewUserForm = {
  username: string;
  name: string;
  password: string;
  admin: boolean;
};

const actionMap = {
  NEW_BOOKING: { icon: "bx-plus", text: "เพิ่ม Booking" },
  EXTEND_BOOKING: { icon: "bx-calendar-plus", text: "Add Nights" },
  REMOVE_BOOKING: { icon: "bx-trash", text: "ลบ Booking" },
  EDIT_BOOKING: { icon: "bx-edit", text: "แก้ไข Booking" },
  CHECK_IN: { icon: "bx-check-circle", text: "Check-In" },
  CHECK_OUT: { icon: "bx-door-open", text: "Check-Out" },
  CANCEL_BOOKING: { icon: "bx-calendar-x", text: "ยกเลิก Booking" },
  RESOLVE_STAY: { icon: "bx-receipt", text: "เคลียร์การเข้าพัก" },
  POST_CLOSE_ADJUSTMENT: {
    icon: "bx-history",
    text: "แก้ไขหลังปิด",
  },
  MANAGE_ROOM_STAYS: { icon: "bx-calendar-cog", text: "แก้ช่วงการเข้าพัก" },
  ADD_TRANSACTION: { icon: "bx-dollar", text: "เพิ่มรายการใช้จ่าย" },
  CREATE_USER: { icon: "bx-user-plus", text: "สร้างผู้ใช้" },
  RESET_USER_PASSWORD: { icon: "bx-key", text: "เปลี่ยนรหัสผ่าน" },
  UPDATE_USER: { icon: "bx-cog", text: "แก้ไขผู้ใช้" },
  UPDATE_USER_SETTINGS: { icon: "bx-cog", text: "แก้ไขการตั้งค่า" },
  DEACTIVATE_USER: { icon: "bx-user-x", text: "ปิดใช้งานผู้ใช้" },
  REACTIVATE_USER: { icon: "bx-user-check", text: "เปิดใช้งานผู้ใช้" },
  LOGIN: { icon: "bx-arrow-in-right-square-half", text: "เข้าสู่ระบบ" },
  LOGOUT: { icon: "bx-arrow-out-right-square-half", text: "ออกจากระบบ" },
  DAILY_CLOSE: { icon: "bx-currency-notes", text: "ปิดยอดเงินสดประจำวัน" },
  REVIEW_TRANSACTION: { icon: "bx-check-shield", text: "อนุมัติรายการ" },
  VIEW_PASSPORT: { icon: "bx-lock-keyhole", text: "ดูข้อมูล Passport" },
  EXPORT_PASSPORT_REPORT: {
    icon: "bx-file",
    text: "ส่งออกรายงาน Passport",
  },
} satisfies Record<actionType, { icon: string; text: string }>;

const transactionTypeLabels: Record<string, string> = {
  roomCharge: "ค่าห้อง",
  deposit: "รับมัดจำ",
  adjustment: "ปรับราคา",
  depositRefund: "คืนมัดจำ",
  cancellationRefund: "คืนเงินยกเลิก",
  roomRefund: "คืนค่าห้อง",
  settlementCharge: "Settlement Charge",
  compensation: "ชดเชยลูกค้า",
  depositKept: "เก็บมัดจำเป็นรายได้",
  paymentCorrection: "แก้ไขการชำระเงิน",
  towel: "ผ้าเช็ดตัว",
  motorbike: "มอเตอร์ไซค์",
  slowBoat: "Slow Boat",
  joinTour: "Join Tour",
  extraBed: "เตียงเสริม",
  pickACraft: "Pick A Craft",
  trek2D: "Trek 2D",
  setMenu: "Set Menu",
  sleeperBus: "Sleeper Bus",
  onlyWalk: "Only Walk",
  laundry: "Laundry",
  bicycle: "Bicycle",
  car: "Car",
  misc: "Misc",
  cardSurcharge: "ค่าธรรมเนียมบัตร",
};

const reviewFlagLabels: Record<string, string> = {
  negative_adjustment: "ปรับยอดติดลบ",
  refund: "คืนเงิน",
  large_refund: "คืนเงินสูง",
  large_cash: "เงินสดสูง",
  adjustment: "ปรับราคา",
  repeated_sensitive_type: "รายการซ้ำ",
};

const emptyNewUserForm: NewUserForm = {
  username: "",
  name: "",
  password: "",
  admin: false,
};

const formatDateTime = (
  date: string | Date,
  dateFormat: DateFormatPreference,
) => formatDisplayDateTime(date, dateFormat);

const formatTime = (date: string | Date) =>
  new Intl.DateTimeFormat("th-TH", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(date));

const todayInputValue = () => {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
};

const formatMoney = (value: number) =>
  value.toLocaleString("th-TH", {
    minimumFractionDigits: value % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });

const transactionKey = (transaction: ReviewTransaction, index = 0) =>
  transaction._id ||
  `${transaction.bookingId || "booking"}-${transaction.type}-${transaction.amount}-${index}`;

const transactionLabel = (type: string) => transactionTypeLabels[type] || type;

const reviewFlagLabel = (flag: string) => reviewFlagLabels[flag] || flag;

const signedTransactionAmount = (transaction: ReviewTransaction) => {
  if (transaction.direction === "out")
    return -Math.abs(transaction.amount || 0);
  if (transaction.direction === "neutral") return 0;
  return Math.abs(transaction.amount || 0);
};

const hasCashMismatch = (shift: CashAuditShift) =>
  shift.warnings.some((warning) =>
    ["operating_variance", "handoff_mismatch"].includes(
      warning.code,
    ),
  );

const CashCloseAudit = ({
  audit,
  reviewEvents,
  financeDate,
  onDateChange,
  onApproveTransaction,
  onResolveShift,
  approvingTransactionId,
  loading,
  dateFormat,
}: {
  audit: CashShiftAudit | null;
  reviewEvents: ReviewTransaction[];
  financeDate: string;
  onDateChange: (value: string) => void;
  onApproveTransaction: (transaction: ReviewTransaction) => void;
  onResolveShift: (shiftId: string, note: string) => Promise<void>;
  approvingTransactionId: string | null;
  loading: boolean;
  dateFormat: DateFormatPreference;
}) => {
  const [expandedShiftId, setExpandedShiftId] = useState<string | null>(null);
  const [resolutionNotes, setResolutionNotes] = useState<
    Record<string, string>
  >({});
  const [resolvingShiftId, setResolvingShiftId] = useState<string | null>(null);
  const shifts = audit?.shifts || [];
  const closedShiftCount = shifts.filter(
    (shift) => shift.status === "closed",
  ).length;
  const openShiftCount = shifts.length - closedShiftCount;
  const variance = shifts.reduce(
    (total, shift) =>
      total + Math.abs(shift.operatingVariance || 0),
    0,
  );
  const unresolvedCount =
    (audit?.gaps.length || 0) +
    shifts.filter((shift) => shift.warnings.length && !shift.auditResolution)
      .length;

  const resolveShift = async (shiftId: string) => {
    const note = resolutionNotes[shiftId]?.trim();
    if (!note) {
      toast.error("กรุณาระบุสรุปการตรวจสอบก่อนรับทราบ");
      return;
    }
    setResolvingShiftId(shiftId);
    try {
      await onResolveShift(shiftId, note);
      setResolutionNotes((current) => ({ ...current, [shiftId]: "" }));
      toast.success("บันทึกการรับทราบแล้ว");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "บันทึกการรับทราบไม่สำเร็จ",
      );
    } finally {
      setResolvingShiftId(null);
    }
  };

  return (
    <section className="manage__finance">
      <div className="manage__cashAuditHero">
        <div className="manage__cashAuditHeroIcon">
          <i
            className={openShiftCount ? "bx bx-currency-notes" : "bx bx-check"}
          />
        </div>
        <div className="manage__cashAuditHeroCopy">
          <p>ตรวจสอบเงินสดประจำวัน</p>
          <h2>
            {loading
              ? "กำลังตรวจสอบเงินสด"
              : unresolvedCount
                ? "มีเงินสดที่ต้องตรวจสอบ"
                : openShiftCount
                  ? "ยังมีเงินสดที่รอปิดยอด"
                  : shifts.length
                    ? "ยอดเงินสดวันนี้เรียบร้อย"
                    : "ยังไม่มีการปิดยอดเงินสด"}
          </h2>
          <span>
            {shifts.length
              ? `${unresolvedCount} จุดที่ต้องตรวจ · ปิดยอดแล้ว ${closedShiftCount} รายการ`
              : "เลือกวันที่ต้องการตรวจสอบ"}
          </span>
        </div>
        <div className="manage__cashAuditToolbar">
          <strong
            className={
              "manage__cashAuditBadge" +
              (unresolvedCount
                ? " manage__cashAuditBadge--attention"
                : openShiftCount
                  ? " manage__cashAuditBadge--open"
                  : shifts.length
                    ? " manage__cashAuditBadge--complete"
                    : "")
            }
          >
            {unresolvedCount
              ? "ต้องตรวจ"
              : openShiftCount
                ? "รอปิดยอด"
                : shifts.length
                  ? "เรียบร้อย"
                  : "ไม่มีข้อมูล"}
          </strong>
          <input
            className="boxInput manage__dateInput"
            type="date"
            value={financeDate}
            onChange={(event) => onDateChange(event.target.value)}
          />
        </div>
      </div>

      <div className="manage__auditOverview">
        <div>
          <p>ปิดยอดแล้ว</p>
          <strong>
            {closedShiftCount}/{shifts.length}
          </strong>
        </div>
        <div>
          <p>กะที่ยังเปิด</p>
          <strong className={openShiftCount ? "manage__auditWarningText" : ""}>
            {openShiftCount}
          </strong>
        </div>
        <div>
          <p>ยอดต่างรวม</p>
          <strong
            className={
              variance > (audit?.threshold || 0)
                ? "manage__auditDangerText"
                : ""
            }
          >
            {formatMoney(variance)} ฿
          </strong>
        </div>
        <div>
          <p>ข้อยกเว้นค้าง</p>
          <strong className={unresolvedCount ? "manage__auditDangerText" : ""}>
            {unresolvedCount}
          </strong>
        </div>
      </div>

      <div className="manage__cashChain" aria-label="Cash custody chain">
        {loading ? (
          <div className="manage__emptyState">
            <i className="bx bx-loader-lines" />
            <p>กำลังโหลดสายรับผิดชอบเงินสด</p>
          </div>
        ) : shifts.length === 0 ? (
          <div className="manage__emptyState">
            <i className="bx bx-wallet" />
            <p>ยังไม่มีกะเงินสดในวันเลือก</p>
          </div>
        ) : (
          shifts.map((shift, index) => (
            <div className="manage__cashChainItem" key={shift._id}>
              {index > 0 && shift.handoff && (
                <div
                  className={
                    "manage__handoff " +
                    (shift.handoff.mismatch ? "manage__handoff--warning" : "")
                  }
                >
                  <div className="manage__handoffLine" />
                  <span>
                    {shift.handoff.mode === "accepted_handoff"
                      ? "ส่งต่อเงินสด"
                      : "นับรับเงินใหม่"}
                  </span>
                </div>
              )}
              <article
                className={
                  "manage__cashShiftCard " +
                  (shift.warnings.length ? "manage__cashShiftCard--alert" : "")
                }
              >
                <div className="manage__cashShiftBody">
                <div className="manage__cashShiftHeader">
                  <div>
                    <strong>
                      {shift.staff?.name ||
                        shift.staff?.username ||
                        "ไม่ทราบผู้รับผิดชอบ"}
                    </strong>
                    <small>
                      {shift.endedAt
                        ? `เริ่ม ${formatTime(shift.startedAt)} · ปิด ${formatTime(shift.endedAt)}`
                        : `เริ่ม ${formatTime(shift.startedAt)} · ยังไม่ปิดยอด`}
                    </small>
                  </div>
                  <div className="manage__cashShiftStatusGroup">
                    {hasCashMismatch(shift) && (
                      <span
                        className="manage__cashMismatchIcon"
                        title="ยอดเงินสดไม่ตรง"
                      >
                        <i className="bx bx-alert-triangle" />
                      </span>
                    )}
                    <span
                      className={
                        "manage__shiftStatus manage__shiftStatus--" +
                        shift.status
                      }
                    >
                      {shift.status === "closed" ? "ปิดยอดแล้ว" : "ยังเปิดอยู่"}
                    </span>
                    {shift.isFinalDayClose && (
                      <span className="manage__shiftStatus manage__shiftStatus--final">
                        ปิดวันแล้ว
                      </span>
                    )}
                  </div>
                </div>
                <div className="manage__cashMath">
                  <div className="manage__cashMathTile manage__cashMathTile--operating">
                    <div className="manage__cashMathTileHeader">
                      <i className="bx bx-wallet" />
                      <span>เงินสดทั่วไป</span>
                    </div>
                    <strong>
                      {formatMoney(
                        shift.operatingActualCash ??
                          shift.operatingExpectedCash,
                      )}{" "}
                      ฿
                    </strong>
                    <small>
                      คาดไว้ {formatMoney(shift.operatingExpectedCash)} · ต่าง{" "}
                      {formatMoney(shift.operatingVariance || 0)}
                    </small>
                  </div>
                </div>
                {shift.warnings.length > 0 && (
                  <div className="manage__auditBadges">
                    {shift.warnings.map((warning) => (
                      <span
                        key={warning.code}
                        className={
                          warning.severity === "critical"
                            ? "manage__auditBadge--critical"
                            : ""
                        }
                      >
                        {warning.message}
                      </span>
                    ))}
                  </div>
                )}
                {expandedShiftId === shift._id && (
                  <div className="manage__auditDetails">
                    <div className="manage__auditEquations">
                      <p>
                        เงินสดทั่วไป: {formatMoney(shift.operatingOpeningCash)} +{" "}
                        {formatMoney(shift.operatingCashIn)} −{" "}
                        {formatMoney(shift.operatingCashOut)} ={" "}
                        {formatMoney(shift.operatingExpectedCash)} ฿
                      </p>
                    </div>
                    {shift.handoff && (
                      <p className="manage__auditHandoffDetail">
                        ยอดเงินสดทั่วไปที่รับจากคนก่อน:{" "}
                        {formatMoney(shift.handoff.expectedOperatingOpening)} ฿
                      </p>
                    )}
                    {shift.note && (
                      <p className="manage__auditNote">
                        หมายเหตุ: {shift.note}
                      </p>
                    )}
                    {shift.legacyDeposit && (
                      <div className="manage__depositPreparationAudit">
                        <strong>ข้อมูลกองมัดจำเดิม (อ่านอย่างเดียว)</strong>
                        <p>
                          เริ่ม {formatMoney(shift.legacyDeposit.openingCash || 0)} ฿ ·
                          เข้า {formatMoney(shift.legacyDeposit.cashIn || 0)} ฿ ·
                          ออก {formatMoney(shift.legacyDeposit.cashOut || 0)} ฿ ·
                          คาดไว้ {formatMoney(shift.legacyDeposit.expectedCash || 0)} ฿ ·
                          นับได้ {formatMoney(shift.legacyDeposit.actualCash || 0)} ฿
                        </p>
                      </div>
                    )}
                    {shift.flaggedTransactions.length > 0 && (
                      <div className="manage__auditFlaggedTransactions">
                        <strong>รายการที่ต้องตรวจสอบ</strong>
                        {shift.flaggedTransactions.map(
                          (transaction, transactionIndex) => (
                            <p
                              key={transactionKey(
                                transaction,
                                transactionIndex,
                              )}
                            >
                              {transaction.guestName ||
                                transaction.bookingId ||
                                "-"}{" "}
                              · {transactionLabel(transaction.type)} ·{" "}
                              {formatMoney(
                                signedTransactionAmount(transaction),
                              )}{" "}
                              ฿
                            </p>
                          ),
                        )}
                      </div>
                    )}
                    {shift.auditResolution ? (
                      <p className="manage__auditResolved">
                        รับทราบโดย {shift.auditResolution.reviewedBy}:{" "}
                        {shift.auditResolution.note}
                      </p>
                    ) : shift.warnings.length > 0 ? (
                      <div className="manage__auditResolve">
                        <textarea
                          value={resolutionNotes[shift._id] || ""}
                          onChange={(event) =>
                            setResolutionNotes((current) => ({
                              ...current,
                              [shift._id]: event.target.value,
                            }))
                          }
                          placeholder="สรุปสิ่งที่ตรวจพบและการดำเนินการ"
                        />
                        <button
                          type="button"
                          disabled={resolvingShiftId === shift._id}
                          onClick={() => void resolveShift(shift._id)}
                        >
                          รับทราบข้อยกเว้น
                        </button>
                      </div>
                    ) : null}
                  </div>
                )}
                </div>
                <button
                  type="button"
                  className="manage__auditDetailsButton"
                  onClick={() =>
                    setExpandedShiftId(
                      expandedShiftId === shift._id ? null : shift._id,
                    )
                  }
                >
                  <span>
                    {expandedShiftId === shift._id
                      ? "ซ่อนรายละเอียด"
                      : "เปิดรายละเอียด"}
                  </span>
                  <i
                    className={
                      expandedShiftId === shift._id
                        ? "bx bx-chevron-up"
                        : "bx bx-chevron-down"
                    }
                  />
                </button>
              </article>
            </div>
          ))
        )}
      </div>

      {audit?.gaps.length ? (
        <div className="manage__cashGaps">
          {audit.gaps.map((gap, index) => (
            <p key={`${gap.from}-${index}`}>
              <i className="bx bx-alert-circle" /> {gap.warning.message} ·
              ระหว่าง {formatTime(gap.from)} – {formatTime(gap.to)}
            </p>
          ))}
        </div>
      ) : null}

      <div className="manage__financePanel">
        <div className="manage__financePanelHeader">
          <h3>คิวอนุมัติรายการ</h3>
          <span>{reviewEvents.length}</span>
        </div>
        <div className="manage__reviewList">
          {loading ? (
            <div className="manage__emptyState">
            <i className="bx bx-loader-lines" />
              <p>กำลังโหลดรายการตรวจสอบ</p>
            </div>
          ) : reviewEvents.length === 0 ? (
            <div className="manage__emptyState">
              <i className="bx bx-check-shield" />
              <p>ไม่มีรายการที่ต้องตรวจ</p>
            </div>
          ) : (
            reviewEvents.map((transaction, index) => (
              <div
                className="manage__reviewItem"
                key={transactionKey(transaction, index)}
              >
                <div className="manage__reviewMain">
                  <div className="manage__reviewTitleRow">
                    <strong>
                      {transaction.guestName || transaction.bookingId || "-"}
                    </strong>
                    <span
                      className={
                        "manage__reviewAmount" +
                        (signedTransactionAmount(transaction) < 0
                          ? " manage__reviewAmount--out"
                          : "")
                      }
                    >
                      {formatMoney(signedTransactionAmount(transaction))} ฿
                    </span>
                  </div>
                  <p>
                    {transactionLabel(transaction.type)} ·{" "}
                    {transaction.paymentMethod} ·{" "}
                    {transaction.staffUsername || "-"}
                  </p>
                  <div className="manage__reviewMeta">
                    {transaction.bookingId && (
                      <span>{transaction.bookingId}</span>
                    )}
                    {transaction.createdAt && (
                      <span>
                        {formatDateTime(transaction.createdAt, dateFormat)}
                      </span>
                    )}
                    {transaction.reference && (
                      <span>Ref: {transaction.reference}</span>
                    )}
                  </div>
                  {(transaction.reviewFlags || []).length > 0 && (
                    <div className="manage__reviewFlags">
                      {transaction.reviewFlags?.map((flag) => (
                        <span key={flag}>{reviewFlagLabel(flag)}</span>
                      ))}
                    </div>
                  )}
                  {transaction.note && (
                    <p className="manage__reviewNote">{transaction.note}</p>
                  )}
                </div>
                <div className="manage__reviewActions">
                  <button
                    type="button"
                    aria-label="อนุมัติรายการ"
                    disabled={
                      !transaction._id ||
                      !transaction.bookingId ||
                      approvingTransactionId === transaction._id
                    }
                    className="manage__approveAction"
                    onClick={() => onApproveTransaction(transaction)}
                  >
                    <i
                      className={`bx ${approvingTransactionId === transaction._id ? "bx-loader-lines" : "bx-check"}`}
                    />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  );
};

const Manage = () => {
  usePageTitle("HostelFlow · จัดการระบบ");
  const { user: currentUser } = useAuth();
  const dateFormat = currentUser?.settings.dateFormat || "dd/MM/yyyy";
  const [users, setUsers] = useState<StaffUser[]>([]);
  const [activities, setActivities] = useState<activity[]>([]);
  const [stats, setStats] = useState<ActivityStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [createNewUserIsOpen, setCreateNewUserIsOpen] = useState(false);
  const [createNewUserIsDirty, setCreateNewUserIsDirty] = useState(false);
  const [pendingUnsavedClose, setPendingUnsavedClose] = useState<
    (() => void) | null
  >(null);
  const [creatingUser, setCreatingUser] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [newUserForm, setNewUserForm] = useState<NewUserForm>(emptyNewUserForm);
  const [user, setUser] = useState<StaffUser | null>(null);
  const [managedUser, setManagedUser] = useState<StaffUser | null>(null);
  const [savingUserId, setSavingUserId] = useState<string | null>(null);
  const [resettingPasswordUserId, setResettingPasswordUserId] = useState<
    string | null
  >(null);
  const [financeDate, setFinanceDate] = useState(todayInputValue());
  const [cashShiftAudit, setCashShiftAudit] = useState<CashShiftAudit | null>(
    null,
  );
  const [reviewEvents, setReviewEvents] = useState<ReviewTransaction[]>([]);
  const [approvingTransactionId, setApprovingTransactionId] = useState<
    string | null
  >(null);

  const fetchManageData = async () => {
    const [
      usersResponse,
      activitiesResponse,
      statsResponse,
      reviewEventsResponse,
      cashShiftAuditResponse,
    ] = await Promise.all([
      axios.get(`${API_URL}/auth/users`, { withCredentials: true }),
      axios.get(`${API_URL}/activities/admin`, { withCredentials: true }),
      axios.get(`${API_URL}/activities/admin/stats`, {
        withCredentials: true,
      }),
      axios.get(`${API_URL}/finance/review-events`, {
        params: { date: financeDate },
        withCredentials: true,
      }),
      axios.get(`${API_URL}/finance/cash-shift-audit`, {
        params: { date: financeDate },
        withCredentials: true,
      }),
    ]);

    setUsers(usersResponse.data.users);
    setActivities(activitiesResponse.data.activities);
    setStats(statsResponse.data);
    setReviewEvents(reviewEventsResponse.data.transactions);
    setCashShiftAudit(cashShiftAuditResponse.data);
    setLastUpdated(new Date());
  };

  useEffect(() => {
    let ignore = false;

    const load = async () => {
      setLoading(true);
      try {
        const [
          usersResponse,
          activitiesResponse,
          statsResponse,
          reviewEventsResponse,
          cashShiftAuditResponse,
        ] = await Promise.all([
          axios.get(`${API_URL}/auth/users`, { withCredentials: true }),
          axios.get(`${API_URL}/activities/admin`, { withCredentials: true }),
          axios.get(`${API_URL}/activities/admin/stats`, {
            withCredentials: true,
          }),
          axios.get(`${API_URL}/finance/review-events`, {
            params: { date: financeDate },
            withCredentials: true,
          }),
          axios.get(`${API_URL}/finance/cash-shift-audit`, {
            params: { date: financeDate },
            withCredentials: true,
          }),
        ]);

        if (ignore) return;
        setUsers(usersResponse.data.users);
        setActivities(activitiesResponse.data.activities);
        setStats(statsResponse.data);
        setReviewEvents(reviewEventsResponse.data.transactions);
        setCashShiftAudit(cashShiftAuditResponse.data);
        setLastUpdated(new Date());
      } finally {
        if (!ignore) setLoading(false);
      }
    };

    void load();

    return () => {
      ignore = true;
    };
  }, [financeDate]);

  const mostActiveStaff = stats?.byStaff[0];
  const mostCommonAction = stats?.byAction[0];

  const statCards = useMemo(
    () => [
      { label: "จำนวน Action เดือนนี้", value: stats?.totalActions || 0 },
      { label: "จำนวน Staff", value: users.length },
      {
        label: "Staff ที่ใช้งานมากสุด",
        value: mostActiveStaff?.staffUsername || "-",
      },
      {
        label: "Action ที่พบบ่อยสุด",
        value: mostCommonAction
          ? actionMap[mostCommonAction.action]?.text || "กิจกรรม"
          : "-",
      },
    ],
    [mostActiveStaff, mostCommonAction, stats?.totalActions, users.length],
  );

  const updateNewUserForm = (
    field: keyof NewUserForm,
    value: string | boolean,
  ) => {
    setNewUserForm((prev) => ({ ...prev, [field]: value }));
  };

  const createUserHandler = async () => {
    if (!newUserForm.username || !newUserForm.name || !newUserForm.password) {
      throw new Error("กรุณากรอกข้อมูลผู้ใช้ให้ครบ");
    }

    setCreatingUser(true);
    try {
      await axios.post(`${API_URL}/auth/admin/createUser`, newUserForm, {
        withCredentials: true,
      });
      setNewUserForm(emptyNewUserForm);
      await fetchManageData();
    } finally {
      setCreatingUser(false);
    }
  };

  const updateUserHandler = async (
    user: StaffUser,
    updates: { name: string; admin: boolean; active: boolean },
  ) => {
    setSavingUserId(user.userId);
    try {
      const response = await axios.patch(
        `${API_URL}/auth/users/${user.userId}`,
        updates,
        { withCredentials: true },
      );
      await fetchManageData();
      setManagedUser(response.data.user);
    } finally {
      setSavingUserId(null);
    }
  };

  const resetPasswordHandler = async (user: StaffUser, password: string) => {
    setResettingPasswordUserId(user.userId);
    try {
      await axios.patch(
        `${API_URL}/auth/users/${user.userId}/password`,
        { password },
        { withCredentials: true },
      );
      await fetchManageData();
    } finally {
      setResettingPasswordUserId(null);
    }
  };

  const approveTransactionHandler = async (transaction: ReviewTransaction) => {
    if (!transaction.bookingId || !transaction._id) {
      toast.error("ไม่พบข้อมูลรายการที่ต้องอนุมัติ");
      return;
    }

    setApprovingTransactionId(transaction._id);

    try {
      await axios.patch(
        `${API_URL}/finance/review-events/${transaction.bookingId}/${transaction._id}/approve`,
        {},
        { withCredentials: true },
      );
      setReviewEvents((prev) =>
        prev.filter((event) => event._id !== transaction._id),
      );
      await fetchManageData();
      toast.success("อนุมัติรายการสำเร็จ");
    } catch (err) {
      console.error(err);
      toast.error("ไม่สามารถอนุมัติรายการได้");
    } finally {
      setApprovingTransactionId(null);
    }
  };

  const resolveCashShiftAuditHandler = async (
    shiftId: string,
    note: string,
  ) => {
    try {
      await axios.patch(
        `${API_URL}/finance/cash-shifts/${shiftId}/audit-resolution`,
        { note },
        { withCredentials: true },
      );
      await fetchManageData();
    } catch (err) {
      if (axios.isAxiosError(err)) {
        throw new Error(
          err.response?.data?.message || "บันทึกการรับทราบไม่สำเร็จ",
        );
      }
      throw err;
    }
  };

  const manageApi = {
    actionMap,
    activities,
    createUserHandler,
    creatingUser,
    fetchManageData,
    formatDateTime,
    loading,
    newUserForm,
    resetPasswordHandler,
    statCards,
    stats,
    updateNewUserForm,
    users,
  };

  void manageApi;

  return (
    <main className="manage">
      <Modal
        open={!!user}
        className="home__modalCenter"
        onClose={() => setUser(null)}
      >
        <>{user && <ViewActivities userId={user.userId} name={user.name} />}</>
      </Modal>
      <Modal
        open={!!managedUser}
        className="home__modalCenter"
        onClose={() => setManagedUser(null)}
      >
        <>
          {managedUser && (
            <ManageUser
              user={managedUser}
              currentUserId={currentUser?.userId}
              onClose={() => setManagedUser(null)}
              onSave={(updates) => updateUserHandler(managedUser, updates)}
              onResetPassword={(password) =>
                resetPasswordHandler(managedUser, password)
              }
              saving={savingUserId === managedUser.userId}
              resettingPassword={resettingPasswordUserId === managedUser.userId}
            />
          )}
        </>
      </Modal>
      <Modal
        open={createNewUserIsOpen}
        className="home__modalCenter"
        onClose={() =>
          requestUnsavedModalClose(
            createNewUserIsDirty,
            () => setCreateNewUserIsOpen(false),
            () =>
              setPendingUnsavedClose(() => () => setCreateNewUserIsOpen(false)),
          )
        }
      >
        <CreateNewUser
          form={newUserForm}
          onChange={updateNewUserForm}
          onClose={() => setCreateNewUserIsOpen(false)}
          onSubmit={createUserHandler}
          submitting={creatingUser}
          onDirtyChange={setCreateNewUserIsDirty}
        />
      </Modal>
      <Modal
        open={!!pendingUnsavedClose}
        className="home__modalCenter"
        onClose={() => setPendingUnsavedClose(null)}
      >
        <UnsavedChangesModal
          onClose={() => setPendingUnsavedClose(null)}
          onDiscard={() => {
            pendingUnsavedClose?.();
            setPendingUnsavedClose(null);
          }}
        />
      </Modal>

      <PageHeader
        title="จัดการ Staff"
        onRefresh={fetchManageData}
        lastUpdated={lastUpdated}
      />

      <section className="main__actions">
        <ActionButton
          text="สร้างบัญชีผู้ใช้ใหม่"
          icon="bx-user-plus"
          onClick={() => {
            setCreateNewUserIsOpen(true);
          }}
        />
      </section>

      <section className="manage__overview">
        {statCards.map((card) => (
          <div className="manage__overviewCard" key={card.label}>
            <p>{card.label}</p>
            <strong>{card.value}</strong>
          </div>
        ))}
      </section>

      <CashCloseAudit
        audit={cashShiftAudit}
        reviewEvents={reviewEvents}
        financeDate={financeDate}
        onDateChange={setFinanceDate}
        onApproveTransaction={approveTransactionHandler}
        onResolveShift={resolveCashShiftAuditHandler}
        approvingTransactionId={approvingTransactionId}
        loading={loading}
        dateFormat={dateFormat}
      />

      <section className="manage__staffSection">
        <div className="manage__sectionHeader">
          <div>
            <i className="bx bx-group" />
            <div>
              <h2>Staff</h2>
              <p>จัดการบัญชีและดูประวัติการทำงาน</p>
            </div>
          </div>
          <span>{users.length} คน</span>
        </div>
        <div className="manage__users">
          {users.map((staffUser) => (
            <div
              className={
                "manage__user" +
                (!staffUser.active ? " manage__user--inactive" : "")
              }
              key={staffUser.userId}
            >
              <img src={profilePictureUrl(staffUser.profilePictureUrl)} alt="" />
              <div className="manage__userInfo">
                <div>
                  <h3>
                    <span className="manage__userName">{staffUser.name}</span>
                    {staffUser.admin && (
                      <span className="settings__adminTag">Admin</span>
                    )}
                    {!staffUser.active && (
                      <span className="manage__inactiveTag">Inactive</span>
                    )}
                  </h3>
                  <p>@{staffUser.username}</p>
                </div>
                <div className="manage__userActions">
                  <ActionButton
                    text=""
                    icon="bx-cog"
                    onClick={() => setManagedUser(staffUser)}
                  />
                  <ActionButton
                    text="ประวัติ"
                    icon="bx-history"
                    onClick={() => setUser(staffUser)}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
};

export default Manage;
