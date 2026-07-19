import axios from "axios";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useLocation } from "react-router";
import { API_URL } from "../../config/api";
import type {
  activity,
  roomStay,
  transaction,
} from "../../types/activitiesTypes";
import {
  formatCompactRoomNames,
  formatRoomStayRooms,
} from "../../helpers/roomStayHelpers";
import { useAuth } from "../../context/AuthContext";
import {
  formatDisplayDate,
  formatDisplayDateTime,
} from "../../helpers/displayDate";

const ACTIVITY_PAGE_SIZE = 10;

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
  MANAGE_ROOM_STAYS: {
    icon: "bx-calendar-cog",
    text: "แก้ช่วงการเข้าพัก",
  },
  ADD_TRANSACTION: {
    icon: "bx-dollar",
    text: "เพิ่มรายการใช้จ่าย",
  },
  CORRECT_TRANSACTION: {
    icon: "bx-edit",
    text: "แก้ไขรายการ",
  },
  CREATE_USER: {
    icon: "bx-user-plus",
    text: "สร้างผู้ใช้",
  },
  RESET_USER_PASSWORD: {
    icon: "bx-key",
    text: "เปลี่ยนรหัสผ่าน",
  },
  UPDATE_USER: {
    icon: "bx-cog",
    text: "แก้ไขผู้ใช้",
  },
  UPDATE_USER_SETTINGS: {
    icon: "bx-cog",
    text: "แก้ไขการตั้งค่า",
  },
  DEACTIVATE_USER: {
    icon: "bx-user-x",
    text: "ปิดใช้งานผู้ใช้",
  },
  REACTIVATE_USER: {
    icon: "bx-user-check",
    text: "เปิดใช้งานผู้ใช้",
  },
  LOGOUT: {
    icon: "bx-arrow-out-right-square-half",
    text: "ออกจากระบบ",
  },
  LOGIN: {
    icon: "bx-arrow-in-right-square-half",
    text: "เข้าสู่ระบบ",
  },
  DAILY_CLOSE: {
    icon: "bx-currency-notes",
    text: "ปิดยอดเงินสดประจำวัน",
  },
  ADD_STANDALONE_SALE: {
    icon: "bx-receipt",
    text: "เพิ่มรายการใช้จ่ายแขกนอก",
  },
  ADJUST_STANDALONE_SALE: {
    icon: "bx-edit-alt",
    text: "ปรับรายการแขกนอก",
  },
  REVIEW_TRANSACTION: {
    icon: "bx-check-shield",
    text: "อนุมัติรายการ",
  },
  VIEW_PASSPORT: {
    icon: "bx-lock-keyhole",
    text: "ดูข้อมูล Passport",
  },
  EXPORT_PASSPORT_REPORT: {
    icon: "bx-file",
    text: "ส่งออกรายงาน Passport",
  },
} satisfies Record<activity["action"], { icon: string; text: string }>;

const unknownAction = { icon: "bx-history", text: "กิจกรรม" };

const transactionLabelMap = {
  roomCharge: "ค่าห้อง",
  deposit: "รับมัดจำ",
  adjustment: "ปรับราคา",
  depositRefund: "คืนมัดจำ",
  cancellationRefund: "คืนเงินยกเลิก",
  roomRefund: "คืนค่าห้อง",
  roomChargeWriteOff: "ปิดยอดค่าห้องที่เหลือ",
  settlementCharge: "เก็บเงินเพิ่ม",
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
  cardSurcharge: "ค่าธรรมเนียมบัตร",
} satisfies Record<transaction["type"], string>;

const formatCurrency = (amount: number) =>
  amount.toLocaleString("th-TH", {
    minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });

const formatDate = (
  date: string | Date,
  dateFormat: "dd/MM/yyyy" | "d MMM yyyy",
) => formatDisplayDate(date, dateFormat);

const formatActivityDate = (
  date: Date,
  dateFormat: "dd/MM/yyyy" | "d MMM yyyy",
) => formatDisplayDateTime(date, dateFormat);

const formatRoomStay = (
  stay: roomStay,
  dateFormat: "dd/MM/yyyy" | "d MMM yyyy",
) =>
  `${formatRoomStayRooms(stay)}: ${formatDate(
    stay.from,
    dateFormat,
  )} - ${formatDate(stay.to, dateFormat)}`;

const getAddedTransactions = (item: activity) => {
  const summaryTransactions = item.details.summary?.addedTransactions;
  if (summaryTransactions?.length) return summaryTransactions;

  const transactions = item.details.changes?.transactions;
  if (!transactions) return [];

  return transactions.after.slice(transactions.before.length);
};

const getRoomStayChange = (item: activity) => {
  if (item.action !== "MANAGE_ROOM_STAYS") return null;

  const summary = item.details.summary;
  if (summary?.beforeRoomStays?.length || summary?.afterRoomStays?.length) {
    return {
      before: summary.beforeRoomStays || [],
      after: summary.afterRoomStays || [],
    };
  }

  const roomStays = item.details.changes?.roomStays;
  if (!roomStays) return null;

  return {
    before: roomStays.before,
    after: roomStays.after,
  };
};

const detailLabels: Record<string, string> = {
  name: "ชื่อผู้เข้าพัก",
  checkIn: "Check In",
  checkOut: "Check Out",
  platformId: "ช่องทางการจอง",
  note: "หมายเหตุ",
  pinned: "ปัก Booking",
  starred: "ปัก Booking",
  status: "สถานะ",
  checkInByStaffUsername: "พนักงาน Check-In",
  checkedInAt: "เวลา Check-In",
  targetName: "ชื่อผู้ใช้",
  targetUsername: "Username",
  createdName: "ชื่อผู้ใช้",
  createdUsername: "Username",
  resetName: "ชื่อผู้ใช้",
  resetUsername: "Username",
  admin: "สิทธิ์ Admin",
  active: "สถานะใช้งาน",
  bookingId: "Booking ID",
  outcome: "ผลการดำเนินการ",
  finalStatus: "สถานะสุดท้าย",
  reasonCode: "เหตุผล",
  roomReleaseStatus: "สถานะห้อง",
  sensitiveOutTotal: "ยอดจ่ายออกที่ต้องตรวจสอบ",
  amendedAfterClose: "แก้ไขหลังปิดยอด",
  transactionId: "Transaction ID",
  guestName: "ชื่อผู้เข้าพัก",
  type: "ประเภทรายการ",
  paymentMethod: "ช่องทางการชำระ",
  amount: "จำนวนเงิน",
  flags: "เหตุผลที่ต้องตรวจสอบ",
  reviewedBy: "ตรวจสอบโดย",
  reviewedAt: "เวลาตรวจสอบ",
  updatedSettings: "การตั้งค่าที่แก้ไข",
  reportType: "ประเภทรายงาน",
  businessDate: "วันที่ข้อมูล",
  bookingCount: "จำนวน Booking",
  voidReason: "เหตุผลที่ลบ",
  voidedBy: "ลบโดย",
  transactionCount: "จำนวนรายการการเงิน",
};

const cashActionTitles: Record<string, string> = {
  START_CASH_SHIFT: "เปิดกะเงินสด",
  CLOSE_CASH_SHIFT: "ปิดกะเงินสด",
  SAVE_DAILY_RECONCILIATION: "บันทึกยอดเงินสดประจำวัน",
  REVIEW_CASH_SHIFT_AUDIT: "ตรวจสอบข้อยกเว้นเงินสด",
};

const getActivityAction = (item: activity) => {
  const action = actionMap[item.action] || unknownAction;
  if (item.action !== "DAILY_CLOSE") return action;

  const cashAction = item.details.summary?.action;
  return typeof cashAction === "string" && cashActionTitles[cashAction]
    ? { ...action, text: cashActionTitles[cashAction] }
    : action;
};

const hasValue = (value: unknown) =>
  value !== undefined && value !== null && value !== "";

const DetailRow = ({ label, value }: { label: string; value: ReactNode }) => {
  if (!hasValue(value)) return null;
  return (
    <p>
      <strong>{label}:</strong> {value}
    </p>
  );
};

const formatGenericValue = (
  key: string,
  value: unknown,
  dateFormat: "dd/MM/yyyy" | "d MMM yyyy",
  resolveStaffName: (username?: string | null) => string,
): ReactNode => {
  if (!hasValue(value)) return null;
  if (typeof value === "boolean") return value ? "ใช่" : "ไม่ใช่";
  if (typeof value === "number") {
    return /(amount|cash|variance|total)$/i.test(key)
      ? `${formatCurrency(value)} บาท`
      : value.toLocaleString("th-TH");
  }
  if (Array.isArray(value)) return value.map(String).join(", ");
  if (value instanceof Date) return formatActivityDate(value, dateFormat);
  if (typeof value === "object") return null;

  if (
    typeof value === "string" &&
    (/(?:staffUsername)$/i.test(key) || /By$/i.test(key))
  ) {
    return resolveStaffName(value);
  }

  if (
    typeof value === "string" &&
    /(At|Date|checkIn|checkOut|from|to)$/i.test(key) &&
    !Number.isNaN(new Date(value).getTime())
  ) {
    return /At$/i.test(key)
      ? formatActivityDate(new Date(value), dateFormat)
      : formatDate(value, dateFormat);
  }

  const translatedValues: Record<string, Record<string, string>> = {
    status: {
      booked: "จองแล้ว",
      checkedIn: "Check-In แล้ว",
      checkedOut: "Check-Out แล้ว",
      cancelled: "ยกเลิกแล้ว",
      noShow: "No-show",
    },
    finalStatus: {
      checkedOut: "Check-Out แล้ว",
      cancelled: "ยกเลิกแล้ว",
      noShow: "No-show",
    },
    roomReleaseStatus: { released: "เปิดขายแล้ว", blocked: "ยังบล็อกห้อง" },
    openingMode: { counted: "นับเงินใหม่", accepted_handoff: "รับยอดส่งต่อ" },
    outcome: {
      normal_checkout: "Check-Out ปกติ",
      early_checkout: "Check-Out ก่อนกำหนด",
      cancelled_before_arrival: "ยกเลิกก่อนเข้าพัก",
      cancelled_after_checkin: "ยกเลิกหลัง Check-In",
      no_show: "No-show",
      guest_left: "แขกออกจากที่พัก",
      post_close_adjustment: "แก้ไขหลังปิดยอด",
    },
    reportType: {
      immigration: "รายงานตรวจคนเข้าเมือง",
      hotel_accommodation: "รายงานผู้เข้าพัก",
    },
  };
  return translatedValues[key]?.[String(value)] || String(value);
};

const BookingSnapshotDetails = ({
  item,
  dateFormat,
  resolveStaffName,
}: {
  item: activity;
  dateFormat: "dd/MM/yyyy" | "d MMM yyyy";
  resolveStaffName: (username?: string | null) => string;
}) => {
  const snapshot = item.details.snapshot;
  const roomIds =
    snapshot?.roomIds || (snapshot?.roomId ? [snapshot.roomId] : []);
  const bookingId = item.bookingId || snapshot?.bookingId;
  const standardSnapshotKeys = new Set([
    "name", "checkIn", "checkOut", "platformId", "roomId", "roomIds",
    "price", "paymentMethod", "bookingId",
  ]);

  return (
    <>
      <DetailRow label="Booking ID" value={bookingId} />
      <DetailRow label="ชื่อผู้เข้าพัก" value={snapshot?.name} />
      <DetailRow
        label="Check In"
        value={snapshot?.checkIn ? formatDate(snapshot.checkIn, dateFormat) : null}
      />
      <DetailRow
        label="Check Out"
        value={snapshot?.checkOut ? formatDate(snapshot.checkOut, dateFormat) : null}
      />
      <DetailRow
        label="ห้อง"
        value={roomIds.length ? formatCompactRoomNames(roomIds) : null}
      />
      <DetailRow label="ช่องทางการจอง" value={snapshot?.platformId} />
      <DetailRow
        label="ราคา"
        value={
          typeof snapshot?.price === "number"
            ? `${formatCurrency(snapshot.price)} บาท`
            : null
        }
      />
      <DetailRow label="ช่องทางการจ่าย" value={snapshot?.paymentMethod} />
      {Object.entries(snapshot || {})
        .filter(([key]) => !standardSnapshotKeys.has(key))
        .map(([key, value]) => (
          <DetailRow
            key={key}
            label={detailLabels[key] || key}
            value={formatGenericValue(
              key,
              value,
              dateFormat,
              resolveStaffName,
            )}
          />
        ))}
    </>
  );
};

const TransactionDetails = ({ item }: { item: activity }) => {
  const transactions = getAddedTransactions(item);
  return (
    <>
      {transactions.map((transaction, index) => (
        <p key={transaction._id || `${transaction.type}-${transaction.amount}-${index}`}>
          <strong>{transactionLabelMap[transaction.type]}:</strong>{" "}
          {formatCurrency(transaction.amount)} บาท ({transaction.paymentMethod})
          {transaction.note ? ` · ${transaction.note}` : ""}
        </p>
      ))}
    </>
  );
};

const GenericChanges = ({
  item,
  dateFormat,
  resolveStaffName,
}: {
  item: activity;
  dateFormat: "dd/MM/yyyy" | "d MMM yyyy";
  resolveStaffName: (username?: string | null) => string;
}) => (
  <>
    {Object.entries(item.details.changes || {})
      .filter(([key]) => key !== "transactions" && key !== "roomStays")
      .map(([key, change]) => {
        if (!change || typeof change !== "object") return null;
        const before = formatGenericValue(
          key,
          change.before,
          dateFormat,
          resolveStaffName,
        );
        const after = formatGenericValue(
          key,
          change.after,
          dateFormat,
          resolveStaffName,
        );
        if (!hasValue(before) && !hasValue(after)) return null;
        return (
          <DetailRow
            key={key}
            label={detailLabels[key] || key}
            value={
              <>
                {before ?? "-"} → {after ?? "-"}
              </>
            }
          />
        );
      })}
  </>
);

const ActivityDetails = ({
  item,
  dateFormat,
  resolveStaffName,
}: {
  item: activity;
  dateFormat: "dd/MM/yyyy" | "d MMM yyyy";
  resolveStaffName: (username?: string | null) => string;
}) => {
  const summary = item.details.summary || {};

  if (item.action === "MANAGE_ROOM_STAYS") {
    const roomStayChange = getRoomStayChange(item);
    return (
      <div className="settings__activityDetails">
        <DetailRow label="Booking ID" value={item.bookingId} />
        <DetailRow
          label="ก่อนแก้"
          value={roomStayChange?.before.map((stay) => formatRoomStay(stay, dateFormat)).join(", ") || "-"}
        />
        <DetailRow
          label="หลังแก้"
          value={roomStayChange?.after.map((stay) => formatRoomStay(stay, dateFormat)).join(", ") || "-"}
        />
      </div>
    );
  }

  if (item.action === "EXTEND_BOOKING") {
    return (
      <div className="settings__activityDetails">
        <DetailRow label="Booking ID" value={item.bookingId} />
        <DetailRow label="วันที่เดิม" value={summary.originalCheckOut ? formatDate(summary.originalCheckOut as string | Date, dateFormat) : null} />
        <DetailRow label="วันที่ใหม่" value={summary.newCheckOut ? `${formatDate(summary.newCheckOut as string | Date, dateFormat)} (${Number(summary.addedNights || 0)} คืน)` : null} />
        <DetailRow label="ช่องทาง" value={hasValue(summary.originalPlatform) || hasValue(summary.extensionPlatform) ? `${String(summary.originalPlatform || "-")} → ${String(summary.extensionPlatform || "-")}` : null} />
        <DetailRow label="ห้องสำหรับคืนที่เพิ่ม" value={Array.isArray(summary.extensionRooms) ? formatCompactRoomNames(summary.extensionRooms) : null} />
        <DetailRow label="ยอดรับชำระ" value={typeof summary.amount === "number" ? `${formatCurrency(summary.amount)} บาท (${String(summary.paymentMethod || "-")})` : null} />
        <DetailRow label="Transaction ID" value={summary.transactionId as string} />
        <DetailRow label="หมายเหตุ" value={summary.note as string} />
      </div>
    );
  }

  if (item.action === "CHECK_OUT") {
    const disposition = summary.depositDisposition === "returned" ? "คืนมัดจำ" : summary.depositDisposition === "kept" ? "เก็บมัดจำเป็นรายได้" : null;
    return (
      <div className="settings__activityDetails">
        <BookingSnapshotDetails
          item={item}
          dateFormat={dateFormat}
          resolveStaffName={resolveStaffName}
        />
        <DetailRow label="การจัดการมัดจำ" value={disposition} />
        <DetailRow label="ยอดคืนมัดจำ" value={typeof summary.depositRefundAmount === "number" ? `${formatCurrency(summary.depositRefundAmount)} บาท` : null} />
        <DetailRow label="ยอดมัดจำที่เก็บไว้" value={typeof summary.depositKeptAmount === "number" ? `${formatCurrency(summary.depositKeptAmount)} บาท` : null} />
        <DetailRow label="Check Out ก่อนกำหนด" value={typeof summary.earlyCheckOut === "boolean" ? (summary.earlyCheckOut ? "ใช่" : "ไม่ใช่") : null} />
        <DetailRow label="จำนวนคืนก่อนกำหนด" value={typeof summary.nightsEarly === "number" ? `${summary.nightsEarly} คืน` : null} />
        <DetailRow label="สถานะห้อง" value={summary.roomReleaseStatus === "released" ? "เปิดขายแล้ว" : summary.roomReleaseStatus === "blocked" ? "ยังบล็อกห้อง" : null} />
        <TransactionDetails item={item} />
      </div>
    );
  }

  if (item.action === "CANCEL_BOOKING") {
    const cancellationLabels: Record<string, string> = { refundable: "คืนเงิน", non_refundable: "ไม่คืนเงิน", no_payment_received: "ยังไม่ได้รับชำระ" };
    return (
      <div className="settings__activityDetails">
        <BookingSnapshotDetails
          item={item}
          dateFormat={dateFormat}
          resolveStaffName={resolveStaffName}
        />
        <DetailRow label="ประเภทการยกเลิก" value={typeof summary.cancellationType === "string" ? cancellationLabels[summary.cancellationType] || summary.cancellationType : null} />
        <DetailRow label="ยอดคืน" value={typeof summary.refundAmount === "number" ? `${formatCurrency(summary.refundAmount)} บาท` : null} />
        <DetailRow label="ยอดที่เก็บไว้" value={typeof summary.keptAmount === "number" ? `${formatCurrency(summary.keptAmount)} บาท` : null} />
        <DetailRow label="สถานะห้อง" value={summary.roomReleaseStatus === "released" ? "เปิดขายแล้ว" : summary.roomReleaseStatus === "blocked" ? "ยังบล็อกห้อง" : null} />
        <TransactionDetails item={item} />
      </div>
    );
  }

  if (item.action === "DAILY_CLOSE") {
    const cashFields: Array<[string, string, boolean?]> = [
      ["businessDate", "วันที่ปิดยอด"], ["shiftNumber", "กะที่"], ["openingMode", "วิธีเปิดกะ"],
      ["depositOpeningCash", "เงินมัดจำเริ่มต้น", true], ["operatingOpeningCash", "เงินดำเนินงานเริ่มต้น", true],
      ["expectedDepositOpening", "เงินมัดจำที่ควรรับมา", true], ["expectedOperatingOpening", "เงินดำเนินงานที่ควรรับมา", true],
      ["depositCashIn", "เงินมัดจำเข้า", true], ["depositCashOut", "เงินมัดจำออก", true],
      ["depositExpectedCash", "เงินมัดจำที่ควรมี", true], ["depositActualCash", "เงินมัดจำที่นับได้", true], ["depositVariance", "ส่วนต่างเงินมัดจำ", true],
      ["operatingCashIn", "เงินดำเนินงานเข้า", true], ["operatingCashOut", "เงินดำเนินงานออก", true],
      ["operatingExpectedCash", "เงินดำเนินงานที่ควรมี", true], ["operatingActualCash", "เงินดำเนินงานที่นับได้", true], ["operatingVariance", "ส่วนต่างเงินดำเนินงาน", true],
      ["openingCash", "เงินสดเริ่มต้น", true], ["cashIn", "เงินสดเข้า", true], ["cashOut", "เงินสดออก", true],
      ["expectedCash", "เงินสดที่ควรมี", true], ["actualCash", "เงินสดที่นับได้", true], ["variance", "ส่วนต่าง", true],
      ["revision", "Revision"], ["staffUsername", "ยอดของพนักงาน"], ["note", "หมายเหตุ"],
    ];
    return (
      <div className="settings__activityDetails">
        {cashFields.map(([key, label, currency]) => (
          <DetailRow key={key} label={label} value={typeof summary[key] === "number" && currency ? `${formatCurrency(summary[key] as number)} บาท` : formatGenericValue(key, summary[key], dateFormat, resolveStaffName)} />
        ))}
        <DetailRow label="ปิดยอดสุดท้ายของวัน" value={typeof summary.closeDay === "boolean" ? (summary.closeDay ? "ใช่" : "ไม่ใช่") : null} />
        <DetailRow label="รหัสคำเตือน" value={Array.isArray(summary.warningCodes) ? summary.warningCodes.join(", ") : null} />
      </div>
    );
  }

  const showTransactions = ["ADD_TRANSACTION", "RESOLVE_STAY", "POST_CLOSE_ADJUSTMENT"].includes(item.action);
  const ignoredSummaryKeys = new Set(["addedTransactions", "beforeRoomStays", "afterRoomStays"]);
  return (
    <div className="settings__activityDetails">
      <BookingSnapshotDetails
        item={item}
        dateFormat={dateFormat}
        resolveStaffName={resolveStaffName}
      />
      {item.action === "LOGIN" || item.action === "LOGOUT" ? (
        <DetailRow label="ผลลัพธ์" value={item.details.success === false ? "ไม่สำเร็จ" : "สำเร็จ"} />
      ) : null}
      <GenericChanges
        item={item}
        dateFormat={dateFormat}
        resolveStaffName={resolveStaffName}
      />
      {Object.entries(summary)
        .filter(([key, value]) => !ignoredSummaryKeys.has(key) && hasValue(formatGenericValue(key, value, dateFormat, resolveStaffName)))
        .map(([key, value]) => (
          <DetailRow key={key} label={detailLabels[key] || key} value={formatGenericValue(key, value, dateFormat, resolveStaffName)} />
        ))}
      {showTransactions ? <TransactionDetails item={item} /> : null}
    </div>
  );
};

const ActivityHeader = ({
  item,
  dateFormat,
}: {
  item: activity;
  dateFormat: "dd/MM/yyyy" | "d MMM yyyy";
}) => {
  const action = getActivityAction(item);
  const date = new Date(item.timestamp);

  return (
    <div className="settings__activityHeader">
      <i className={`bx settings__activityIcon ${action.icon}`} />
      <div>
        <h3>{action.text}</h3>
        <p>{formatActivityDate(date, dateFormat)}</p>
      </div>
    </div>
  );
};

const RecentActivities = ({ userId }: { userId?: string }) => {
  const { user, resolveStaffName } = useAuth();
  const dateFormat = user?.settings.dateFormat || "dd/MM/yyyy";
  const [activities, setActivities] = useState<activity[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const activitiesRef = useRef<HTMLDivElement>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const location = useLocation();

  const fetchActivities = useCallback(
    async (pageToFetch: number, replace = false) => {
      if (replace) {
        setLoading(true);
      } else {
        setLoadingMore(true);
      }
      setError("");

      //       activitiesRouter.get("/recentActivities", recentActivities);
      // activitiesRouter.get("/users/:userId/recentActivities", recentActivities);

      const fetchedActivities = await axios.get(
        userId
          ? `${API_URL}/activities/users/${userId}/recentActivities`
          : `${API_URL}/activities/recentActivities`,
        {
          params: {
            page: pageToFetch,
            limit: ACTIVITY_PAGE_SIZE,
          },
          withCredentials: true,
        },
      );

      const nextPageActivities = fetchedActivities.data
        .activities as activity[];
      const totalActivityCount = fetchedActivities.data
        .totalActivitycount as number;

      setActivities((prev) => {
        const nextActivities = replace
          ? nextPageActivities
          : [...prev, ...nextPageActivities];

        setHasMore(
          nextActivities.length < totalActivityCount &&
            nextPageActivities.length > 0,
        );

        return nextActivities;
      });

      setLoading(false);
      setLoadingMore(false);
    },
    [userId],
  );

  useEffect(() => {
    setPage(1);
    fetchActivities(1, true).catch(() => {
      setError("ไม่สามารถโหลดประวัติได้");
      setLoading(false);
      setLoadingMore(false);
    });
  }, [fetchActivities, location]);

  useEffect(() => {
    if (page === 1) return;

    fetchActivities(page).catch(() => {
      setError("ไม่สามารถโหลดประวัติเพิ่มได้");
      setLoadingMore(false);
    });
  }, [fetchActivities, page]);

  useEffect(() => {
    const loadMoreElement = loadMoreRef.current;
    const scrollRoot = activitiesRef.current;

    if (!loadMoreElement || !scrollRoot || loading || loadingMore || !hasMore) {
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setPage((prev) => prev + 1);
        }
      },
      {
        root: scrollRoot,
        rootMargin: "0px 0px 128px 0px",
      },
    );

    observer.observe(loadMoreElement);

    return () => {
      observer.disconnect();
    };
  }, [hasMore, loading, loadingMore]);

  return (
    <div className="settings__activities" ref={activitiesRef}>
      {loading && (
        <div className="settings__activityStatus">กำลังโหลดประวัติ...</div>
      )}

      {activities.map((item) => (
        <div
          className="settings__activity"
          key={item._id || item.timestamp.toString()}
        >
          <ActivityHeader item={item} dateFormat={dateFormat} />
          <ActivityDetails
            item={item}
            dateFormat={dateFormat}
            resolveStaffName={resolveStaffName}
          />
        </div>
      ))}

      {error && <div className="settings__activityStatus">{error}</div>}
      {loadingMore && (
        <div className="settings__activityStatus">กำลังโหลดเพิ่มเติม...</div>
      )}
      {hasMore && !loading && (
        <div className="settings__activityLoadMore" ref={loadMoreRef} />
      )}
    </div>
  );
};

export default RecentActivities;
