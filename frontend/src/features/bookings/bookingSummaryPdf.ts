import hostelFlowLogoUrl from "../../../logo.svg";
import ibmPlexSansThaiBoldUrl from "@ibm/plex-sans-thai/fonts/complete/woff2/IBMPlexSansThai-Bold.woff2?url";
import ibmPlexSansThaiMediumUrl from "@ibm/plex-sans-thai/fonts/complete/woff2/IBMPlexSansThai-Medium.woff2?url";
import ibmPlexSansThaiRegularUrl from "@ibm/plex-sans-thai/fonts/complete/woff2/IBMPlexSansThai-Regular.woff2?url";
import ibmPlexSansThaiSemiBoldUrl from "@ibm/plex-sans-thai/fonts/complete/woff2/IBMPlexSansThai-SemiBold.woff2?url";
import { platformMap } from "../../helpers/maps";
import {
  isRoomChargeSettlementTransaction,
  roomChargeOutstandingAmount,
  roomChargeSettlementTransactions,
} from "../../helpers/bookingHelpers";
import {
  formatCompactRoomNames,
  formatRoomStayRooms,
  getRoomStayRoomIds,
} from "../../helpers/roomStayHelpers";
import { getTransactionDisplay } from "../../helpers/transactionDisplay";
import type {
  booking,
  transcation,
  TransactionType,
} from "../../types/bookingTypes";

const PAGE_WIDTH = 1240;
const PAGE_HEIGHT = 1754;
const PAGE_MARGIN = 58;
const CONTENT_BOTTOM = PAGE_HEIGHT - 108;
const TEAL = "#20aeba";
const TEAL_PALE = "#eaf8f9";
const TEXT = "#182126";
const MUTED = "#667077";
const BORDER = "#dce5e7";
const RED = "#dc2626";
const PDF_FONT_NAME = "IBM Plex Sans Thai";
const FONT_FAMILY = `"${PDF_FONT_NAME}", sans-serif`;
const PDF_FONT_SOURCES = [
  { weight: "400", url: ibmPlexSansThaiRegularUrl },
  { weight: "500", url: ibmPlexSansThaiMediumUrl },
  { weight: "600", url: ibmPlexSansThaiSemiBoldUrl },
  { weight: "700", url: ibmPlexSansThaiBoldUrl },
] as const;

let pdfFontsPromise: Promise<void> | null = null;

const ensurePdfFonts = () => {
  if (pdfFontsPromise) return pdfFontsPromise;

  pdfFontsPromise = Promise.all(
    PDF_FONT_SOURCES.map(async ({ weight, url }) => {
      const font = new FontFace(PDF_FONT_NAME, `url(${url})`, {
        style: "normal",
        weight,
      });
      const loadedFont = await font.load();
      document.fonts.add(loadedFont);
    }),
  )
    .then(async () => {
      await document.fonts.ready;
      const missingWeight = PDF_FONT_SOURCES.find(
        ({ weight }) => !document.fonts.check(`${weight} 20px "${PDF_FONT_NAME}"`),
      );
      if (missingWeight) {
        throw new Error(`Font weight ${missingWeight.weight} unavailable`);
      }
    })
    .catch((error: unknown) => {
      pdfFontsPromise = null;
      const detail = error instanceof Error ? `: ${error.message}` : "";
      throw new Error(`ไม่สามารถโหลด IBM Plex Sans Thai สำหรับ PDF ได้${detail}`);
    });

  return pdfFontsPromise;
};

type ResolveStaffName = (username?: string | null) => string;

type BookingSummaryLanguage = "en" | "th";

const DEFAULT_BOOKING_SUMMARY_LANGUAGE: BookingSummaryLanguage = "en";

const BOOKING_SUMMARY_COPY = {
  en: {
    statusWaitingCheckIn: "Waiting for Check-In",
    statusBooked: "Booked",
    statusCheckedIn: "Checked In",
    statusCheckedOut: "Checked Out",
    statusCancelled: "Cancelled",
    statusNoShow: "No-Show",
    addedDeposit: "Additional deposit",
    cashRounding: "Cash rounding",
    advanceRoomCharge: "Advance room payment",
    extensionBefore: "Additional nights before check-in",
    extensionAfter: "Additional nights after check-out",
    totalRoomCharge: "Total room charge",
    roomPayment: "Room payment",
    writeOff: "Write-off",
    corrected: "Corrected",
    needsReview: "Needs review",
    reviewed: "Reviewed",
    continuation: "continued",
    nationality: "Nationality",
    guests: "Guests",
    peopleUnit: "guests",
    nights: "Nights",
    nightsUnit: "nights",
    room: "Room",
    actualCheckIn: "Actual Check-In",
    actualCheckOut: "Actual Check-Out",
    guestInformation: "Guest Information",
    stayInformation: "Stay Information",
    addedBeforeCheckIn: "Added before check-in",
    addedAfterCheckOut: "Added after check-out",
    channel: "Channel",
    extendedVia: "Extended via",
    recordedBy: "Recorded by",
    checkedInBy: "Checked in by",
    bookingTotal: "Booking total",
    amountReceived: "Amount received",
    outstandingBalance: "Outstanding balance",
    guestCredit: "Guest credit",
    remainingDeposit: "Remaining deposit (separate)",
    bookingDetails: "Booking Details",
    financialSummary: "Financial Summary",
    roomAssignments: "Room Assignments",
    from: "From",
    to: "To",
    transactions: "Transactions",
    date: "Date",
    description: "Description",
    type: "Type",
    charge: "Charge",
    payment: "Payment",
    deposit: "Deposit",
    note: "Note",
  },
  th: {
    statusWaitingCheckIn: "รอ Check-In",
    statusBooked: "จองแล้ว",
    statusCheckedIn: "Check-In แล้ว",
    statusCheckedOut: "Check-Out แล้ว",
    statusCancelled: "ถูกยกเลิก",
    statusNoShow: "No-Show",
    addedDeposit: "รับมัดจำเพิ่ม",
    cashRounding: "ปัดเศษยอดเงินสด",
    advanceRoomCharge: "ค่าห้องล่วงหน้า",
    extensionBefore: "ค่าเพิ่มคืนก่อนวันเข้า",
    extensionAfter: "ค่าเพิ่มคืนหลังวันออก",
    totalRoomCharge: "ค่าห้องทั้งหมด",
    roomPayment: "รับชำระค่าห้อง",
    writeOff: "ปิดยอด",
    corrected: "มีการแก้ไข",
    needsReview: "รอตรวจสอบ",
    reviewed: "อนุมัติแล้ว",
    continuation: "ต่อ",
    nationality: "สัญชาติ",
    guests: "จำนวนแขก",
    peopleUnit: "คน",
    nights: "จำนวนคืน",
    nightsUnit: "คืน",
    room: "ห้อง",
    actualCheckIn: "Check-In จริง",
    actualCheckOut: "Check-Out จริง",
    guestInformation: "ข้อมูลผู้เข้าพัก",
    stayInformation: "ข้อมูลการเข้าพัก",
    addedBeforeCheckIn: "เพิ่มก่อนวันเข้า",
    addedAfterCheckOut: "เพิ่มหลังวันออก",
    channel: "ช่องทาง",
    extendedVia: "ต่อคืนผ่าน",
    recordedBy: "บันทึกโดย",
    checkedInBy: "Check-In โดย",
    bookingTotal: "ยอดรวม Booking",
    amountReceived: "รับชำระแล้ว",
    outstandingBalance: "ยอดค้างชำระ",
    guestCredit: "เครดิตของแขก",
    remainingDeposit: "มัดจำคงเหลือ (แยก)",
    bookingDetails: "รายละเอียด Booking",
    financialSummary: "สรุปการเงิน",
    roomAssignments: "การจัดห้องพัก",
    from: "จาก",
    to: "ถึง",
    transactions: "รายการธุรกรรม",
    date: "วันที่",
    description: "รายการ",
    type: "Type",
    charge: "Charge",
    payment: "Payment",
    deposit: "Deposit",
    note: "หมายเหตุ",
  },
} as const;

const ENGLISH_TRANSACTION_NAMES: Record<TransactionType, string> = {
  roomCharge: "Room charge",
  deposit: "Deposit received",
  adjustment: "Price adjustment",
  depositRefund: "Deposit refund",
  cancellationRefund: "Cancellation refund",
  roomRefund: "Room refund",
  roomChargeWriteOff: "Room-charge write-off",
  settlementCharge: "Additional charge",
  compensation: "Guest compensation",
  depositKept: "Deposit retained as revenue",
  paymentCorrection: "Payment correction",
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
  cardSurcharge: "3% card surcharge",
};

type PdfOptions = {
  booking: booking;
  generatedAt?: Date;
  resolveStaffName?: ResolveStaffName;
  language?: BookingSummaryLanguage;
};

type CanvasPage = {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
};

type InfoRow = {
  label: string;
  value: string;
  valueColor?: string;
  strong?: boolean;
};

type ChannelRow = {
  platformId: booking["platformId"];
  from: string | Date;
  to: string | Date;
  channelBookingId?: string;
  placement?: "before" | "after";
};

type TableColumn<T> = {
  header: string;
  width: number;
  align?: CanvasTextAlign;
  value: (row: T) => string;
  color?: (row: T) => string;
};

const setFont = (
  context: CanvasRenderingContext2D,
  size: number,
  weight: 400 | 500 | 600 | 700 = 400,
) => {
  context.font = `${weight} ${size}px ${FONT_FAMILY}`;
};

const drawTextRight = (
  context: CanvasRenderingContext2D,
  text: string,
  right: number,
  y: number,
) => {
  const previousAlign = context.textAlign;
  context.textAlign = "left";
  context.fillText(text, right - context.measureText(text).width, y);
  context.textAlign = previousAlign;
};

const drawImageContained = (
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  maxWidth: number,
  maxHeight: number,
) => {
  const scale = Math.min(maxWidth / image.naturalWidth, maxHeight / image.naturalHeight);
  const width = image.naturalWidth * scale;
  const height = image.naturalHeight * scale;
  context.drawImage(image, x + (maxWidth - width) / 2, y + (maxHeight - height) / 2, width, height);
};

const createPage = (): CanvasPage => {
  const canvas = document.createElement("canvas");
  canvas.width = PAGE_WIDTH;
  canvas.height = PAGE_HEIGHT;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("ไม่สามารถเตรียมเอกสาร PDF ได้");

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT);
  context.textBaseline = "top";
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  return { canvas, context };
};

const loadImage = (source: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`โหลดรูปภาพไม่สำเร็จ: ${source}`));
    image.src = source;
  });

const formatDate = (date: string | Date, includeTime = false) => {
  const value = new Date(date);
  if (Number.isNaN(value.getTime())) return "";

  const formattedDate = new Intl.DateTimeFormat("en-GB", {
    calendar: "gregory",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(value);
  if (!includeTime) return formattedDate;

  return `${formattedDate}, ${value.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
};

const dateKey = (date: string | Date) => {
  const value = new Date(date);
  if (Number.isNaN(value.getTime())) return "booking";
  return [
    value.getFullYear(),
    String(value.getMonth() + 1).padStart(2, "0"),
    String(value.getDate()).padStart(2, "0"),
  ].join("-");
};

const formatMoney = (amount: number) =>
  `฿${Number(amount || 0).toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const sanitizedFilenamePart = (value: string) =>
  value
    .normalize("NFKC")
    .replace(/[<>:"/\\|?*]/g, " ")
    .replaceAll(/./g, (character) =>
      character.charCodeAt(0) < 32 ? " " : character,
    )
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "")
    .slice(0, 80);

export const createBookingSummaryFilename = (currentBooking: booking) => {
  const guest = sanitizedFilenamePart(currentBooking.name) || "Guest";
  return `Booking-Summary-${guest}-${dateKey(currentBooking.checkIn)}.pdf`;
};

const tokenize = (text: string) => {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return [];

  const words = normalized.split(" ");
  if (words.length > 1) return words.map((word, index) => (index ? ` ${word}` : word));
  return Array.from(normalized);
};

const wrapText = (
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
) => {
  const paragraphs = String(text).split(/\r?\n/);
  const lines: string[] = [];

  paragraphs.forEach((paragraph, paragraphIndex) => {
    const tokens = tokenize(paragraph);
    if (!tokens.length) {
      lines.push("");
      return;
    }

    let line = "";
    tokens.forEach((token) => {
      const candidate = `${line}${token}`;
      if (line && context.measureText(candidate).width > maxWidth) {
        lines.push(line.trim());
        line = token.trimStart();
      } else {
        line = candidate;
      }
    });
    if (line) lines.push(line.trim());
    if (paragraphIndex < paragraphs.length - 1 && paragraph) lines.push("");
  });

  return lines;
};

const roundedRect = (
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius = 12,
) => {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
};

const drawSectionTitle = (
  context: CanvasRenderingContext2D,
  title: string,
  x: number,
  y: number,
) => {
  context.fillStyle = TEAL;
  roundedRect(context, x, y + 2, 8, 27, 4);
  context.fill();
  setFont(context, 23, 700);
  context.fillStyle = TEXT;
  context.fillText(title, x + 22, y);
};

const measureInfoCard = (
  context: CanvasRenderingContext2D,
  width: number,
  rows: InfoRow[],
  prominentValue?: string,
) => {
  let height = 76;
  if (prominentValue) {
    setFont(context, 37, 700);
    height += Math.max(wrapText(context, prominentValue, width - 46).length, 1) * 46 + 13;
  }
  rows.forEach((row) => {
    setFont(context, 21, row.strong ? 700 : 500);
    height += Math.max(wrapText(context, row.value, width * 0.56).length, 1) * 28 + 16;
  });
  return height + 15;
};

const drawInfoCard = (
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  title: string,
  rows: InfoRow[],
  prominentValue?: string,
) => {
  context.fillStyle = "#ffffff";
  context.strokeStyle = BORDER;
  context.lineWidth = 1.5;
  roundedRect(context, x, y, width, height, 8);
  context.fill();
  context.stroke();

  drawSectionTitle(context, title, x + 25, y + 24);
  let cursorY = y + 72;

  if (prominentValue) {
    setFont(context, 37, 700);
    context.fillStyle = TEXT;
    const lines = wrapText(context, prominentValue, width - 50);
    lines.forEach((line) => {
      context.fillText(line, x + 25, cursorY);
      cursorY += 46;
    });
    cursorY += 10;
  }

  rows.forEach((row, index) => {
    setFont(context, 19, 500);
    context.fillStyle = MUTED;
    context.fillText(row.label, x + 25, cursorY + 2);

    setFont(context, 21, row.strong ? 700 : 500);
    context.fillStyle = row.valueColor || TEXT;
    const lines = wrapText(context, row.value, width * 0.56);
    lines.forEach((line, lineIndex) => {
      drawTextRight(
        context,
        line,
        x + width - 25,
        cursorY + lineIndex * 28,
      );
    });
    cursorY += Math.max(lines.length, 1) * 28 + 15;

    if (index < rows.length - 1) {
      context.strokeStyle = "#edf1f2";
      context.beginPath();
      context.moveTo(x + 25, cursorY - 7);
      context.lineTo(x + width - 25, cursorY - 7);
      context.stroke();
    }
  });
};

type StatusDetails = { label: string; color: string; background: string };

const bookingStatusDetails = (
  currentBooking: booking,
  generatedAt: Date,
  text: (typeof BOOKING_SUMMARY_COPY)[BookingSummaryLanguage],
): StatusDetails => {
  if (currentBooking.status === "booked") {
    const checkIn = new Date(currentBooking.checkIn);
    const checkInIsToday =
      checkIn.getFullYear() === generatedAt.getFullYear() &&
      checkIn.getMonth() === generatedAt.getMonth() &&
      checkIn.getDate() === generatedAt.getDate();

    return checkInIsToday
      ? { label: text.statusWaitingCheckIn, color: "#00adef", background: "#e0f5fc" }
      : { label: text.statusBooked, color: "#2a2a2a", background: "#f7f7f7" };
  }

  const details: Record<Exclude<booking["status"], "booked">, StatusDetails> = {
    checkedIn: {
      label: text.statusCheckedIn,
      color: "rgb(30, 203, 131)",
      background: "#e8faf2",
    },
    checkedOut: {
      label: text.statusCheckedOut,
      color: "#ffa500",
      background: "rgb(255, 242, 230)",
    },
    cancelled: {
      label: text.statusCancelled,
      color: "#fd4169",
      background: "#fff2f5",
    },
    noShow: { label: text.statusNoShow, color: "#4b5563", background: "#f3f4f6" },
  };

  return details[currentBooking.status];
};

const drawStatusBadge = (
  context: CanvasRenderingContext2D,
  status: StatusDetails,
  x: number,
  y: number,
) => {
  setFont(context, 18, 600);
  const dotSize = 10;
  const gap = 12;
  const horizontalPadding = 16;
  const height = 44;
  const width = statusBadgeWidth(context, status);

  context.fillStyle = status.background;
  roundedRect(context, x, y, width, height, height / 2);
  context.fill();

  context.fillStyle = status.color;
  context.beginPath();
  context.arc(
    x + horizontalPadding + dotSize / 2,
    y + height / 2,
    dotSize / 2,
    0,
    Math.PI * 2,
  );
  context.fill();
  context.fillText(
    status.label,
    x + horizontalPadding + dotSize + gap,
    y + 10,
  );
};

const statusBadgeWidth = (
  context: CanvasRenderingContext2D,
  status: StatusDetails,
) => {
  setFont(context, 18, 600);
  return 16 * 2 + 10 + 12 + context.measureText(status.label).width;
};

const buildChannelRows = (currentBooking: booking): ChannelRow[] => {
  const segments = currentBooking.commercialSegments || [];
  const original = segments.find((segment) => segment.kind === "original");
  const extensions = segments.filter((segment) => segment.kind === "extension");

  return [
    {
      platformId: original?.platformId || currentBooking.platformId,
      from: original?.from || currentBooking.checkIn,
      to: original?.to || extensions[0]?.from || currentBooking.checkOut,
      channelBookingId: original?.channelBookingId || currentBooking.bookingId,
      placement: undefined,
    },
    ...extensions.map((segment) => ({
      platformId: segment.platformId,
      from: segment.from,
      to: segment.to,
      channelBookingId: segment.channelBookingId,
      placement: segment.placement || "after",
    })),
  ].sort(
    (left, right) =>
      new Date(left.from).getTime() - new Date(right.from).getTime(),
  );
};

const transactionDescription = (
  currentBooking: booking,
  transaction: transcation,
  language: BookingSummaryLanguage,
  text: (typeof BOOKING_SUMMARY_COPY)[BookingSummaryLanguage],
) => {
  if (transaction.type === "misc" && transaction.note?.trim()) {
    return `Misc · ${transaction.note.trim()}`;
  }
  if (transaction.type === "deposit" && transaction.sourceAction === "ADD_TRANSACTION") {
    return text.addedDeposit;
  }
  if (transaction.type === "adjustment" && transaction.reasonOfAdjustment === "rounding") {
    return text.cashRounding;
  }
  const advancePayment = currentBooking.advancePayment;
  if (advancePayment && transaction._id === advancePayment.transactionId) {
    return advancePayment.calculationMode === "amount"
      ? text.advanceRoomCharge
      : `${text.advanceRoomCharge} ${advancePayment.percentage}%`;
  }
  if (transaction.type === "roomCharge" && transaction.sourceAction === "EXTEND_BOOKING") {
    const platformId =
      transaction.platformId ||
      (currentBooking.commercialSegments || []).find(
        (segment) => segment.transactionId === transaction._id,
      )?.platformId;
    const platform = platformId ? platformMap[platformId]?.label : "";
    const placement = (currentBooking.commercialSegments || []).find(
      (segment) => segment.transactionId === transaction._id,
    )?.placement;
    const extensionLabel =
      placement === "before" ? text.extensionBefore : text.extensionAfter;
    return `${platform ? `${platform} · ` : ""}${extensionLabel}`;
  }
  if (
    transaction.type === "roomCharge" &&
    transaction.sourceAction !== "EXTEND_BOOKING" &&
    roomChargeSettlementTransactions(currentBooking).length > 0
  ) {
    return text.totalRoomCharge;
  }
  if (isRoomChargeSettlementTransaction(currentBooking, transaction)) {
    return text.roomPayment;
  }
  return language === "en"
    ? ENGLISH_TRANSACTION_NAMES[transaction.type]
    : getTransactionDisplay(transaction.type).name;
};

const transactionTypeLabel = (
  currentBooking: booking,
  transaction: transcation,
  text: (typeof BOOKING_SUMMARY_COPY)[BookingSummaryLanguage],
) => {
  if (transaction.type === "roomChargeWriteOff") return text.writeOff;
  if (
    transaction.type === "roomCharge" &&
    transaction.sourceAction !== "EXTEND_BOOKING" &&
    roomChargeSettlementTransactions(currentBooking).length > 0
  ) {
    return roomChargeOutstandingAmount(currentBooking) > 0 ? "Unpaid" : "Paid";
  }
  return transaction.paymentMethod;
};

const isLinkedTransaction = (
  currentBooking: booking,
  transaction: transcation,
) =>
  transaction.type === "cardSurcharge" ||
  transaction.type === "depositRefund" ||
  transaction.type === "cancellationRefund" ||
  transaction.type === "roomChargeWriteOff" ||
  transaction._id === currentBooking.advancePayment?.transactionId ||
  isRoomChargeSettlementTransaction(currentBooking, transaction) ||
  (transaction.type === "roomCharge" && transaction.sourceAction === "EXTEND_BOOKING") ||
  (transaction.type === "deposit" && transaction.sourceAction === "ADD_TRANSACTION") ||
  (transaction.type === "adjustment" && Boolean(transaction.relatedTransactionId));

const transactionDescriptionWithMeta = (
  currentBooking: booking,
  transaction: transcation,
  language: BookingSummaryLanguage,
  text: (typeof BOOKING_SUMMARY_COPY)[BookingSummaryLanguage],
) => {
  const description = transactionDescription(
    currentBooking,
    transaction,
    language,
    text,
  );
  const note = transaction.note?.trim() && transaction.type !== "misc"
    ? ` · ${transaction.note.trim()}`
    : "";
  const correction = transaction.corrected ? ` · ${text.corrected}` : "";
  const review = transaction.reviewStatus === "needs_review"
    ? ` · ${text.needsReview}`
    : transaction.reviewStatus === "reviewed"
      ? ` · ${text.reviewed}`
      : "";
  return `${isLinkedTransaction(currentBooking, transaction) ? "- " : ""}${description}${note}${correction}${review}`;
};

type FolioAmounts = {
  charge?: number;
  payment?: number;
  deposit?: number;
};

const folioChargeTypes = new Set<transcation["type"]>([
  "roomCharge",
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
  "cardSurcharge",
]);

const transactionFolioAmounts = (transaction: transcation): FolioAmounts => {
  const amount = Math.abs(transaction.amount || 0);
  const signedAmount = transaction.direction === "out" ? -amount : amount;
  const isPaid = transaction.paymentMethod !== "Unpaid";

  if (folioChargeTypes.has(transaction.type)) {
    return {
      charge: signedAmount,
      payment: isPaid ? signedAmount : undefined,
    };
  }
  if (transaction.type === "adjustment") {
    return {
      charge: signedAmount,
      payment: isPaid ? signedAmount : undefined,
    };
  }
  if (["settlementCharge", "paymentCorrection"].includes(transaction.type)) {
    return { payment: isPaid ? signedAmount : undefined };
  }
  if (transaction.type === "roomChargeWriteOff") {
    return { charge: -amount };
  }
  if (["cancellationRefund", "roomRefund", "compensation"].includes(transaction.type)) {
    return { charge: -amount, payment: isPaid ? -amount : undefined };
  }
  if (transaction.type === "deposit") return { deposit: signedAmount };
  if (["depositRefund", "depositKept"].includes(transaction.type)) {
    return { deposit: -amount };
  }
  return {};
};

const folioAmountText = (amount?: number) => {
  if (amount === undefined) return "";
  return `${amount < 0 ? "-" : ""}${formatMoney(Math.abs(amount))}`;
};

const folioAmountColor = (amount?: number) =>
  amount !== undefined && amount < 0 ? RED : TEXT;

const roomStayNights = (from: string | Date, to: string | Date) => {
  const start = new Date(from);
  const end = new Date(to);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return "";
  return String(Math.max(Math.round((end.getTime() - start.getTime()) / 86_400_000), 0));
};

const canvasToJpeg = (canvas: HTMLCanvasElement) =>
  new Promise<Uint8Array>((resolve, reject) => {
    canvas.toBlob(
      async (blob) => {
        if (!blob) {
          reject(new Error("ไม่สามารถสร้างหน้า PDF ได้"));
          return;
        }
        resolve(new Uint8Array(await blob.arrayBuffer()));
      },
      "image/jpeg",
      0.96,
    );
  });

const encodeText = (value: string) => new TextEncoder().encode(value);

const buildPdf = (images: Uint8Array[]) => {
  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const objectCount = 2 + images.length * 3;
  const objects = new Map<number, Array<string | Uint8Array>>();
  const pageObjectIds = images.map((_, index) => 3 + index * 3);

  objects.set(1, [`<< /Type /Catalog /Pages 2 0 R >>`]);
  objects.set(2, [
    `<< /Type /Pages /Count ${images.length} /Kids [${pageObjectIds
      .map((id) => `${id} 0 R`)
      .join(" ")}] >>`,
  ]);

  images.forEach((image, index) => {
    const pageId = 3 + index * 3;
    const imageId = pageId + 1;
    const contentId = pageId + 2;
    const content = `q\n${pageWidth} 0 0 ${pageHeight} 0 0 cm\n/Im0 Do\nQ\n`;

    objects.set(pageId, [
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`,
    ]);
    objects.set(imageId, [
      `<< /Type /XObject /Subtype /Image /Width ${PAGE_WIDTH} /Height ${PAGE_HEIGHT} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.byteLength} >>\nstream\n`,
      image,
      "\nendstream",
    ]);
    objects.set(contentId, [
      `<< /Length ${encodeText(content).byteLength} >>\nstream\n${content}endstream`,
    ]);
  });

  const chunks: Array<string | Uint8Array> = ["%PDF-1.4\n%HostelFlow\n"];
  const offsets = new Array<number>(objectCount + 1).fill(0);
  let length = encodeText(chunks[0] as string).byteLength;

  for (let objectId = 1; objectId <= objectCount; objectId += 1) {
    offsets[objectId] = length;
    const start = `${objectId} 0 obj\n`;
    chunks.push(start);
    length += encodeText(start).byteLength;
    for (const chunk of objects.get(objectId) || []) {
      chunks.push(chunk);
      length += typeof chunk === "string" ? encodeText(chunk).byteLength : chunk.byteLength;
    }
    const end = "\nendobj\n";
    chunks.push(end);
    length += encodeText(end).byteLength;
  }

  const xrefOffset = length;
  let xref = `xref\n0 ${objectCount + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => {
    xref += `${String(offset).padStart(10, "0")} 00000 n \n`;
  });
  xref += `trailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  chunks.push(xref);

  return new Blob(
    chunks.map((chunk) =>
      typeof chunk === "string" ? chunk : new Uint8Array(chunk).buffer,
    ),
    { type: "application/pdf" },
  );
};

const drawFooter = (
  page: CanvasPage,
  pageIndex: number,
  pageCount: number,
) => {
  const { context } = page;
  const y = PAGE_HEIGHT - 78;
  context.strokeStyle = TEAL;
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(PAGE_MARGIN, y - 20);
  context.lineTo(PAGE_WIDTH - PAGE_MARGIN, y - 20);
  context.stroke();

  setFont(context, 17, 600);
  context.fillStyle = MUTED;
  context.fillText("Generated by HostelFlow", PAGE_MARGIN, y);
  context.textAlign = "center";
  context.fillText("Booking summary - not a tax invoice", PAGE_WIDTH / 2, y);
  drawTextRight(
    context,
    `Page ${pageIndex + 1} of ${pageCount}`,
    PAGE_WIDTH - PAGE_MARGIN,
    y,
  );
  context.textAlign = "left";
};

const drawContinuationHeader = (page: CanvasPage, currentBooking: booking) => {
  const { context } = page;
  setFont(context, 27, 700);
  context.fillStyle = TEXT;
  context.fillText("BOOKING SUMMARY", PAGE_MARGIN, 46);
  setFont(context, 19, 500);
  context.fillStyle = MUTED;
  drawTextRight(
    context,
    `${currentBooking.name} · ${currentBooking.bookingId}`,
    PAGE_WIDTH - PAGE_MARGIN,
    51,
  );
  context.textAlign = "left";
  context.strokeStyle = TEAL;
  context.beginPath();
  context.moveTo(PAGE_MARGIN, 92);
  context.lineTo(PAGE_WIDTH - PAGE_MARGIN, 92);
  context.stroke();
};

const renderPdfPages = async ({
  booking: currentBooking,
  generatedAt = new Date(),
  resolveStaffName = (username) => username || "",
  language = DEFAULT_BOOKING_SUMMARY_LANGUAGE,
}: PdfOptions) => {
  if (!currentBooking.financialSummary) {
    throw new Error("ไม่พบข้อมูลสรุปการเงินล่าสุด กรุณาโหลด Booking ใหม่แล้วลองอีกครั้ง");
  }

  await ensurePdfFonts();
  const text = BOOKING_SUMMARY_COPY[language];

  const channelRows = buildChannelRows(currentBooking);
  const imageEntries = await Promise.all([
    loadImage(hostelFlowLogoUrl).then((image) => ["hostelflow", image] as const),
    ...Array.from(new Set(channelRows.map((row) => row.platformId))).map((platformId) =>
      loadImage(platformMap[platformId].logo).then(
        (image) => [platformId, image] as const,
      ),
    ),
  ]);
  const images = new Map(imageEntries);
  const pages: CanvasPage[] = [createPage()];
  let page = pages[0];
  let { context } = page;
  let cursorY = 0;

  const addPage = () => {
    page = createPage();
    pages.push(page);
    context = page.context;
    drawContinuationHeader(page, currentBooking);
    cursorY = 122;
  };

  const ensureSpace = (requiredHeight: number) => {
    if (cursorY + requiredHeight > CONTENT_BOTTOM) addPage();
  };

  const drawTable = <T>(
    title: string,
    rows: T[],
    columns: TableColumn<T>[],
    emptyText?: string,
  ) => {
    const titleHeight = 50;
    const headerHeight = 42;
    ensureSpace(titleHeight + headerHeight + 54);
    drawSectionTitle(context, title, PAGE_MARGIN + 15, cursorY);
    cursorY += titleHeight;

    const drawHeader = () => {
      context.fillStyle = TEAL_PALE;
      context.fillRect(PAGE_MARGIN, cursorY, PAGE_WIDTH - PAGE_MARGIN * 2, headerHeight);
      setFont(context, 18, 700);
      context.fillStyle = "#364148";
      let x = PAGE_MARGIN;
      columns.forEach((column) => {
        const textX =
          column.align === "right" ? x + column.width - 16 : x + 16;
        if (column.align === "right") {
          drawTextRight(context, column.header, textX, cursorY + 10);
        } else {
          context.fillText(column.header, textX, cursorY + 10);
        }
        x += column.width;
      });
      context.textAlign = "left";
      cursorY += headerHeight;
    };

    drawHeader();
    if (!rows.length && emptyText) {
      context.strokeStyle = BORDER;
      context.strokeRect(PAGE_MARGIN, cursorY, PAGE_WIDTH - PAGE_MARGIN * 2, 56);
      setFont(context, 18, 400);
      context.fillStyle = MUTED;
      context.fillText(emptyText, PAGE_MARGIN + 16, cursorY + 16);
      cursorY += 56;
    }

    rows.forEach((row) => {
      setFont(context, 18, 400);
      const lineSets = columns.map((column) =>
        wrapText(context, column.value(row), column.width - 32),
      );
      const rowHeight = Math.max(46, Math.max(...lineSets.map((lines) => lines.length)) * 23 + 20);

      if (cursorY + rowHeight > CONTENT_BOTTOM) {
        addPage();
        drawSectionTitle(
          context,
          `${title} (${text.continuation})`,
          PAGE_MARGIN + 15,
          cursorY,
        );
        cursorY += titleHeight;
        drawHeader();
      }

      context.strokeStyle = BORDER;
      context.strokeRect(PAGE_MARGIN, cursorY, PAGE_WIDTH - PAGE_MARGIN * 2, rowHeight);
      let x = PAGE_MARGIN;
      columns.forEach((column, columnIndex) => {
        const lines = lineSets[columnIndex];
        context.fillStyle = column.color?.(row) || TEXT;
        const textX = column.align === "right" ? x + column.width - 16 : x + 16;
        lines.forEach((line, lineIndex) => {
          if (column.align === "right") {
            drawTextRight(context, line, textX, cursorY + 11 + lineIndex * 23);
          } else {
            context.fillText(line, textX, cursorY + 11 + lineIndex * 23);
          }
        });
        x += column.width;
      });
      context.textAlign = "left";
      cursorY += rowHeight;
    });
    cursorY += 28;
  };

  // First-page brand and title block.
  const logo = images.get("hostelflow");
  if (logo) context.drawImage(logo, PAGE_MARGIN, 48, 72, 72);
  setFont(context, 34, 700);
  context.fillStyle = "#354047";
  context.fillText("HostelFlow", PAGE_MARGIN + 88, 65);

  setFont(context, 20, 700);
  context.fillStyle = TEXT;
  drawTextRight(context, "BAAN MAI KRADAN", PAGE_WIDTH - PAGE_MARGIN, 51);
  setFont(context, 16, 500);
  context.fillStyle = MUTED;
  drawTextRight(context, "Hostel", PAGE_WIDTH - PAGE_MARGIN, 80);

  setFont(context, 41, 700);
  context.fillStyle = TEXT;
  context.fillText("BOOKING SUMMARY", PAGE_MARGIN, 159);
  setFont(context, 21, 500);
  context.fillStyle = TEXT;
  context.fillText("Booking ID:", PAGE_MARGIN, 222);
  setFont(context, 23, 700);
  context.fillStyle = TEAL;
  context.fillText(currentBooking.bookingId, PAGE_MARGIN + 132, 219);
  const status = bookingStatusDetails(currentBooking, generatedAt, text);
  const statusX = PAGE_WIDTH - PAGE_MARGIN - statusBadgeWidth(context, status);
  const channelLogos = Array.from(
    new Set(channelRows.map((channel) => channel.platformId)),
  ).flatMap((platformId) => {
    const image = images.get(platformId);
    return image ? [image] : [];
  });
  const channelLogoSlotWidth = 74;
  const channelLogoStartX =
    statusX - 18 - channelLogos.length * channelLogoSlotWidth;
  channelLogos.forEach((channelLogo, index) => {
    drawImageContained(
      context,
      channelLogo,
      channelLogoStartX + index * channelLogoSlotWidth,
      187,
      66,
      34,
    );
  });
  drawStatusBadge(context, status, statusX, 182);
  setFont(context, 17, 400);
  context.fillStyle = MUTED;
  context.fillText(`Generated on: ${formatDate(generatedAt, true)}`, PAGE_MARGIN, 258);
  cursorY = 310;

  const guestRows: InfoRow[] = [];
  if (currentBooking.passport?.nationality) {
    guestRows.push({
      label: text.nationality,
      value: currentBooking.passport.nationality,
    });
  }
  if (currentBooking.passport) {
    guestRows.push({
      label: text.guests,
      value: `${1 + (currentBooking.additionalGuests?.length || 0)} ${text.peopleUnit}`,
    });
  }

  const rooms = formatCompactRoomNames(
    currentBooking.roomStays.flatMap(getRoomStayRoomIds),
  );
  const stayRows: InfoRow[] = [
    { label: "Check-In", value: formatDate(currentBooking.checkIn) },
    { label: "Check-Out", value: formatDate(currentBooking.checkOut) },
    { label: text.nights, value: `${currentBooking.nights} ${text.nightsUnit}` },
    ...(rooms ? [{ label: text.room, value: rooms }] : []),
  ];
  if (currentBooking.checkedInAt) {
    stayRows.push({
      label: text.actualCheckIn,
      value: formatDate(currentBooking.checkedInAt, true),
    });
  }
  const actualCheckout = currentBooking.checkout?.checkedOutAt || currentBooking.resolution?.resolvedAt;
  if (actualCheckout && currentBooking.status === "checkedOut") {
    stayRows.push({
      label: text.actualCheckOut,
      value: formatDate(actualCheckout, true),
    });
  }

  const gap = 20;
  const cardWidth = (PAGE_WIDTH - PAGE_MARGIN * 2 - gap) / 2;
  const guestHeight = measureInfoCard(context, cardWidth, guestRows, currentBooking.name);
  const stayHeight = measureInfoCard(context, cardWidth, stayRows);
  const firstCardsHeight = Math.max(guestHeight, stayHeight);
  drawInfoCard(
    context,
    PAGE_MARGIN,
    cursorY,
    cardWidth,
    firstCardsHeight,
    text.guestInformation,
    guestRows,
    currentBooking.name,
  );
  drawInfoCard(
    context,
    PAGE_MARGIN + cardWidth + gap,
    cursorY,
    cardWidth,
    firstCardsHeight,
    text.stayInformation,
    stayRows,
  );
  cursorY += firstCardsHeight + 20;

  const channelInfoRows = channelRows.map((channel, index) => {
    const label = platformMap[channel.platformId]?.label || channel.platformId;
    const bookingNumber = channel.channelBookingId ? ` · No. ${channel.channelBookingId}` : "";
    return {
      label:
        channel.placement === "before"
          ? text.addedBeforeCheckIn
          : channel.placement === "after"
            ? text.addedAfterCheckOut
            : index === 0
              ? text.channel
              : text.extendedVia,
      value: `${label} · ${formatDate(channel.from)} - ${formatDate(channel.to)}${bookingNumber}`,
    };
  });
  const bookingRows: InfoRow[] = [
    ...channelInfoRows,
    {
      label: text.recordedBy,
      value: resolveStaffName(currentBooking.staffUsername),
    },
  ];
  if (currentBooking.checkInByStaffUsername) {
    bookingRows.push({
      label: text.checkedInBy,
      value: resolveStaffName(currentBooking.checkInByStaffUsername),
    });
  }

  const summary = currentBooking.financialSummary;
  const financialRows: InfoRow[] = [
    { label: text.bookingTotal, value: formatMoney(summary.bookingTotal) },
    { label: text.amountReceived, value: formatMoney(summary.amountReceived) },
    {
      label: text.outstandingBalance,
      value: formatMoney(summary.outstandingBalance),
      valueColor: summary.outstandingBalance > 0 ? RED : TEXT,
      strong: true,
    },
    ...(summary.guestCredit > 0
      ? [{ label: text.guestCredit, value: formatMoney(summary.guestCredit), valueColor: TEAL, strong: true }]
      : []),
    ...(summary.remainingDeposit > 0
      ? [{ label: text.remainingDeposit, value: formatMoney(summary.remainingDeposit), valueColor: "#8a5a00", strong: true }]
      : []),
  ];

  const bookingHeight = measureInfoCard(context, cardWidth, bookingRows);
  const financeHeight = measureInfoCard(context, cardWidth, financialRows);
  const secondCardsHeight = Math.max(bookingHeight, financeHeight);
  ensureSpace(secondCardsHeight + 20);
  drawInfoCard(
    context,
    PAGE_MARGIN,
    cursorY,
    cardWidth,
    secondCardsHeight,
    text.bookingDetails,
    bookingRows,
  );
  drawInfoCard(
    context,
    PAGE_MARGIN + cardWidth + gap,
    cursorY,
    cardWidth,
    secondCardsHeight,
    text.financialSummary,
    financialRows,
  );
  cursorY += secondCardsHeight + 28;

  drawTable(
    text.roomAssignments,
    currentBooking.roomStays,
    [
      { header: text.room, width: 400, value: (stay) => formatRoomStayRooms(stay) },
      { header: text.from, width: 260, value: (stay) => formatDate(stay.from) },
      { header: text.to, width: 260, value: (stay) => formatDate(stay.to) },
      {
        header: text.nights,
        width: PAGE_WIDTH - PAGE_MARGIN * 2 - 920,
        align: "right",
        value: (stay) => roomStayNights(stay.from, stay.to),
      },
    ],
  );

  const effectiveTransactions = (
    currentBooking.effectiveTransactions !== undefined
      ? currentBooking.effectiveTransactions
      : currentBooking.transactions
  ).filter((transaction) => transaction.type !== "cardSurcharge" || transaction.amount > 0);
  const transactionDisplayBooking: booking = {
    ...currentBooking,
    transactions: effectiveTransactions,
  };
  if (effectiveTransactions.length) {
    drawTable(
      text.transactions,
      effectiveTransactions,
      [
        {
          header: text.date,
          width: 200,
          value: (transaction) =>
            transaction.createdAt ? formatDate(transaction.createdAt, true) : "",
        },
        {
          header: text.description,
          width: 350,
          value: (transaction) =>
            transactionDescriptionWithMeta(
              transactionDisplayBooking,
              transaction,
              language,
              text,
            ),
        },
        {
          header: text.type,
          width: 130,
          value: (transaction) =>
            transactionTypeLabel(transactionDisplayBooking, transaction, text),
          color: (transaction) => {
            const typeLabel = transactionTypeLabel(
              transactionDisplayBooking,
              transaction,
              text,
            );
            if (typeLabel === "Unpaid") return RED;
            if (typeLabel === "Paid") return "rgb(30, 203, 131)";
            if (typeLabel === text.writeOff) return MUTED;
            return TEXT;
          },
        },
        {
          header: text.charge,
          width: 148,
          align: "right",
          value: (transaction) =>
            folioAmountText(transactionFolioAmounts(transaction).charge),
          color: (transaction) =>
            folioAmountColor(transactionFolioAmounts(transaction).charge),
        },
        {
          header: text.payment,
          width: 148,
          align: "right",
          value: (transaction) =>
            folioAmountText(transactionFolioAmounts(transaction).payment),
          color: (transaction) =>
            folioAmountColor(transactionFolioAmounts(transaction).payment),
        },
        {
          header: text.deposit,
          width: PAGE_WIDTH - PAGE_MARGIN * 2 - 976,
          align: "right",
          value: (transaction) =>
            folioAmountText(transactionFolioAmounts(transaction).deposit),
          color: (transaction) =>
            folioAmountColor(transactionFolioAmounts(transaction).deposit),
        },
      ],
    );
  }

  if (currentBooking.note?.trim()) {
    setFont(context, 20, 400);
    const noteLines = wrapText(
      context,
      currentBooking.note.trim(),
      PAGE_WIDTH - PAGE_MARGIN * 2 - 48,
    );
    const noteHeight = 58 + noteLines.length * 26;
    ensureSpace(noteHeight + 20);
    context.fillStyle = "#fbfefe";
    context.strokeStyle = TEAL;
    context.lineWidth = 1.5;
    roundedRect(
      context,
      PAGE_MARGIN,
      cursorY,
      PAGE_WIDTH - PAGE_MARGIN * 2,
      noteHeight,
      8,
    );
    context.fill();
    context.stroke();
    drawSectionTitle(context, text.note, PAGE_MARGIN + 18, cursorY + 14);
    setFont(context, 19, 400);
    context.fillStyle = TEXT;
    noteLines.forEach((line, index) => {
      context.fillText(line, PAGE_MARGIN + 24, cursorY + 51 + index * 26);
    });
    cursorY += noteHeight + 20;
  }

  pages.forEach((currentPage, index) => drawFooter(currentPage, index, pages.length));
  return pages;
};

export const printBookingSummaryPdf = async (options: PdfOptions) => {
  const pages = await renderPdfPages(options);
  const pdf = buildPdf(await Promise.all(pages.map((page) => canvasToJpeg(page.canvas))));
  const url = URL.createObjectURL(pdf);
  const printFrame = document.createElement("iframe");
  printFrame.title = `ปริ้น ${createBookingSummaryFilename(options.booking)}`;
  printFrame.style.position = "fixed";
  printFrame.style.right = "0";
  printFrame.style.bottom = "0";
  printFrame.style.width = "0";
  printFrame.style.height = "0";
  printFrame.style.border = "0";

  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    printFrame.remove();
    URL.revokeObjectURL(url);
  };

  printFrame.addEventListener(
    "load",
    () => {
      const printWindow = printFrame.contentWindow;
      if (!printWindow) {
        cleanup();
        return;
      }
      printWindow.addEventListener("afterprint", cleanup, { once: true });
      printWindow.focus();
      printWindow.print();
    },
    { once: true },
  );
  printFrame.src = url;
  document.body.appendChild(printFrame);
  window.setTimeout(cleanup, 120_000);
};
