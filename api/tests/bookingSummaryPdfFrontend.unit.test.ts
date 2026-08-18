import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const frontendRoot = path.resolve(__dirname, "../../frontend/src");
const source = (relativePath: string) =>
  readFileSync(path.join(frontendRoot, relativePath), "utf8");

test("ViewBooking exposes a direct PDF download action backed by a fresh booking response", () => {
  const viewBooking = source("features/bookings/ViewBooking.tsx");

  assert.match(viewBooking, /ดาวน์โหลด PDF/);
  assert.match(viewBooking, /getBookingById\/\$\{data\.bookingId\}/);
  assert.match(viewBooking, /import\(\s*"\.\/bookingSummaryPdf\.ts"\s*\)/);
  assert.match(viewBooking, /downloadBookingSummaryPdf\(\{/);
  assert.match(viewBooking, /disabled=\{pdfExporting\}/);
});

test("booking summary PDF uses authoritative projections and keeps deposits distinct", () => {
  const pdf = source("features/bookings/bookingSummaryPdf.ts");

  assert.match(pdf, /if \(!currentBooking\.financialSummary\)/);
  assert.match(pdf, /currentBooking\.effectiveTransactions !== undefined/);
  assert.match(pdf, /summary\.bookingTotal/);
  assert.match(pdf, /summary\.amountReceived/);
  assert.match(pdf, /summary\.outstandingBalance/);
  assert.match(pdf, /summary\.guestCredit/);
  assert.match(pdf, /summary\.remainingDeposit/);
  assert.match(pdf, /มัดจำคงเหลือ/);
  assert.doesNotMatch(pdf, /cashShiftId|correctionId|idempotency|revision/);
});

test("booking summary PDF mirrors ViewBooking room-charge settlement presentation", () => {
  const pdf = source("features/bookings/bookingSummaryPdf.ts");
  const viewBooking = source("features/bookings/ViewBooking.tsx");
  const viewBookingCss = source("features/bookings/ViewBooking.css");

  assert.match(pdf, /roomChargeSettlementTransactions/);
  assert.match(pdf, /roomChargeOutstandingAmount/);
  assert.match(pdf, /isRoomChargeSettlementTransaction/);
  assert.match(pdf, /return "ค่าห้องทั้งหมด"/);
  assert.match(pdf, /return "รับชำระค่าห้อง"/);
  assert.match(viewBooking, /return "รับชำระค่าห้อง"/);
  assert.doesNotMatch(pdf, /ชำระค่าห้องส่วนที่เหลือ/);
  assert.doesNotMatch(viewBooking, /ชำระค่าห้องส่วนที่เหลือ/);
  assert.match(pdf, /roomChargeOutstandingAmount\(currentBooking\) > 0 \? "Unpaid" : "Paid"/);
  assert.match(pdf, /transactionDescriptionWithMeta/);
  assert.match(pdf, /transaction\.corrected \? " · มีการแก้ไข"/);
  assert.match(pdf, /transaction\.reviewStatus === "needs_review"/);
  assert.match(pdf, /label: "ยอดค้างชำระ"/);
  assert.doesNotMatch(pdf, /summary\.outstandingBalance > 0\s*\? \[\{ label: "ยอดค้างชำระ"/);
  assert.match(pdf, /header: "Charge"/);
  assert.match(pdf, /header: "Payment"/);
  assert.match(pdf, /header: "Deposit"/);
  assert.match(pdf, /transactionFolioAmounts/);
  assert.match(pdf, /payment: isPaid \? signedAmount : undefined/);
  assert.match(pdf, /return \{ deposit: signedAmount \}/);
  assert.match(viewBooking, /return `ชำระ \$\{amountText\} THB`/);
  assert.match(viewBooking, /viewBooking__priceChildAmount--payment/);
  assert.match(viewBookingCss, /\.viewBooking__priceChildAmount--payment/);
});

test("booking summary PDF paginates variable content and uses repository branding assets", () => {
  const pdf = source("features/bookings/bookingSummaryPdf.ts");

  assert.match(pdf, /import hostelFlowLogoUrl from "\.\.\/\.\.\/\.\.\/logo\.svg"/);
  assert.match(pdf, /platformMap\[platformId\]\.logo/);
  assert.match(pdf, /if \(cursorY \+ requiredHeight > CONTENT_BOTTOM\) addPage\(\)/);
  assert.match(pdf, /รายการธุรกรรม/);
  assert.match(pdf, /if \(effectiveTransactions\.length\)/);
  assert.doesNotMatch(pdf, /ยังไม่มีรายการธุรกรรม|N\/A/);
  assert.match(pdf, /Booking summary - not a tax invoice/);
  assert.match(pdf, /createBookingSummaryFilename/);
  assert.match(pdf, /replace\(\/\[<>:/);
});

test("booking summary PDF loads IBM Plex Sans Thai before drawing", () => {
  const pdf = source("features/bookings/bookingSummaryPdf.ts");
  const packageJson = JSON.parse(
    readFileSync(path.resolve(__dirname, "../../frontend/package.json"), "utf8"),
  ) as { dependencies?: Record<string, string> };

  assert.equal(packageJson.dependencies?.["@ibm/plex-sans-thai"], "^1.1.0");
  assert.match(pdf, /const PDF_FONT_NAME = "IBM Plex Sans Thai"/);
  assert.match(pdf, /IBMPlexSansThai-Regular\.woff2\?url/);
  assert.match(pdf, /IBMPlexSansThai-Medium\.woff2\?url/);
  assert.match(pdf, /IBMPlexSansThai-SemiBold\.woff2\?url/);
  assert.match(pdf, /IBMPlexSansThai-Bold\.woff2\?url/);
  assert.match(pdf, /await ensurePdfFonts\(\)/);
  assert.match(pdf, /document\.fonts\.check/);
  assert.doesNotMatch(pdf, /Noto Sans Thai|Thonburi|Leelawadee/);
});

test("booking summary PDF status mirrors ViewBooking on the right with channels to its left", () => {
  const pdf = source("features/bookings/bookingSummaryPdf.ts");

  assert.match(pdf, /const drawStatusBadge/);
  assert.match(pdf, /context\.arc\(/);
  assert.match(pdf, /const statusBadgeWidth/);
  assert.match(pdf, /16 \* 2 \+ 10 \+ 12 \+ context\.measureText\(status\.label\)\.width/);
  assert.match(pdf, /color: "#00adef", background: "#e0f5fc"/);
  assert.match(pdf, /color: "rgb\(30, 203, 131\)"/);
  assert.match(pdf, /color: "#ffa500"/);
  assert.match(pdf, /color: "#fd4169"/);
  assert.match(pdf, /color: "#4b5563"/);
  assert.match(
    pdf,
    /const statusX = PAGE_WIDTH - PAGE_MARGIN - statusBadgeWidth\(context, status\)/,
  );
  assert.match(pdf, /channelLogoStartX =\s*statusX - 18/);
  assert.match(pdf, /channelLogos\.forEach/);
  assert.match(pdf, /drawStatusBadge\(context, status, statusX, 182\)/);
  assert.match(pdf, /header: "Type"/);
  assert.doesNotMatch(pdf, /header: "วิธี"/);
  const badgeRenderer = pdf.match(
    /const drawStatusBadge = \([\s\S]*?\n\};/,
  )?.[0];
  assert.ok(badgeRenderer);
  assert.doesNotMatch(badgeRenderer, /stroke\(/);
});

test("booking summary PDF only shows guest count when passport data exists", () => {
  const pdf = source("features/bookings/bookingSummaryPdf.ts");

  assert.match(
    pdf,
    /if \(currentBooking\.passport\) \{\s*guestRows\.push\(\{\s*label: "จำนวนแขก"/,
  );
  assert.match(pdf, /1 \+ \(currentBooking\.additionalGuests\?\.length \|\| 0\)/);
});
