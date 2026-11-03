import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

const frontendSrc = path.resolve(__dirname, "../../frontend/src");
const readFrontendFile = (relativePath: string) =>
  fs.readFileSync(path.join(frontendSrc, relativePath), "utf8");

const loadBookingHelpers = () => {
  const source = readFrontendFile("helpers/bookingHelpers.ts");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const moduleExports: Record<string, any> = {};
  const sandbox = {
    exports: moduleExports,
    module: { exports: moduleExports },
    require: () => ({}),
  };
  vm.runInNewContext(transpiled, sandbox);
  return sandbox.module.exports as {
    bookingHasRecordedPayments: (booking: any) => boolean;
    firstUnpaidRoomChargeTransaction: (booking: any) => any;
    remainingForRoomCharge: (booking: any, roomCharge: any) => number;
    roomChargeOutstandingAmount: (booking: any) => number;
  };
};

const {
  bookingHasRecordedPayments,
  firstUnpaidRoomChargeTransaction,
  remainingForRoomCharge,
  roomChargeOutstandingAmount,
} = loadBookingHelpers();

test("bookingHasRecordedPayments detects active paid transactions and ignores unpaid or zeroed-out mistakes", () => {
  const baseBooking: any = {
    bookingId: "TEST-1",
    status: "booked",
    transactions: [
      {
        _id: "tx-room",
        type: "roomCharge",
        paymentMethod: "Unpaid",
        amount: 600,
      },
    ],
    transactionCorrections: [],
  };

  assert.equal(bookingHasRecordedPayments(baseBooking), false);

  const paidBooking: any = {
    ...baseBooking,
    transactions: [
      {
        _id: "tx-room",
        type: "roomCharge",
        paymentMethod: "Transfer",
        amount: 600,
      },
    ],
  };
  assert.equal(bookingHasRecordedPayments(paidBooking), true);

  const correctedToZeroBooking: any = {
    ...paidBooking,
    transactionCorrections: [
      {
        _id: "corr-1",
        targetTransactionId: "tx-room",
        before: {
          type: "roomCharge",
          paymentMethod: "Transfer",
          amount: 600,
        },
        after: {
          type: "roomCharge",
          paymentMethod: "Transfer",
          amount: 0,
        },
        correctionType: "recorded_mistake",
        reasonCode: "duplicate_entry",
        note: "Mistaken entry",
        correctedBy: "admin",
        correctedAt: new Date().toISOString(),
        financialChange: true,
      },
    ],
  };
  assert.equal(bookingHasRecordedPayments(correctedToZeroBooking), false);
});

test("remainingForRoomCharge and firstUnpaidRoomChargeTransaction track partial and full room settlements", () => {
  const roomCharge = {
    _id: "rc-1",
    type: "roomCharge" as const,
    paymentMethod: "Unpaid" as const,
    amount: 1000,
  };
  const bookingWithPartial: any = {
    bookingId: "TEST-2",
    status: "checkedIn",
    transactions: [
      roomCharge,
      {
        _id: "sc-1",
        type: "settlementCharge",
        paymentMethod: "Cash",
        relatedTransactionType: "roomCharge",
        relatedTransactionId: "rc-1",
        amount: 400,
        direction: "in",
      },
    ],
  };

  assert.equal(remainingForRoomCharge(bookingWithPartial, roomCharge), 600);
  assert.equal(roomChargeOutstandingAmount(bookingWithPartial), 600);
  assert.equal(
    firstUnpaidRoomChargeTransaction(bookingWithPartial)?._id,
    "rc-1",
  );

  const fullySettled: any = {
    ...bookingWithPartial,
    transactions: [
      ...bookingWithPartial.transactions,
      {
        _id: "sc-2",
        type: "settlementCharge",
        paymentMethod: "Transfer",
        relatedTransactionType: "roomCharge",
        relatedTransactionId: "rc-1",
        amount: 600,
        direction: "in",
      },
    ],
  };

  assert.equal(remainingForRoomCharge(fullySettled, roomCharge), 0);
  assert.equal(roomChargeOutstandingAmount(fullySettled), 0);
  assert.equal(firstUnpaidRoomChargeTransaction(fullySettled), null);
});

test("CorrectCheckIn uses preview endpoint and requires explicit deposit disposition when deposit exists", () => {
  const correctCheckIn = readFrontendFile(
    "features/bookings/CorrectCheckIn.tsx",
  );

  assert.match(correctCheckIn, /\/check-in-corrections\/preview/);
  assert.match(correctCheckIn, /depositOutcome === "not_received"/);
  assert.match(correctCheckIn, /depositOutcome === "refunded"/);
  assert.match(correctCheckIn, /ยังไม่ได้รับเงินมัดจำจริง/);
  assert.match(correctCheckIn, /รับเงินมัดจำมาแล้ว และคืนเงินสดให้แขกแล้ว/);
  assert.match(correctCheckIn, /refundConfirmed/);
});

test("ViewBooking and CheckOut wire unpaid room charge settlement and gate invalid lifecycle actions", () => {
  const viewBooking = readFrontendFile("features/bookings/ViewBooking.tsx");
  const checkOut = readFrontendFile("features/bookings/CheckOut.tsx");
  const confirmationModal = readFrontendFile(
    "components/ConfirmationModal.tsx",
  );

  assert.match(checkOut, /roomChargeOutstandingAmount\(booking\)/);
  assert.match(viewBooking, /firstUnpaidRoomChargeTransaction\(data\)/);
  assert.match(viewBooking, /setReopenCheckOutAfterRoomPayment\(true\)/);
  assert.match(
    viewBooking,
    /\(data\.status === "booked" \|\|\s*data\.status === "checkedIn"\)/,
  );
  assert.match(
    viewBooking,
    /disabled=\{data\.status !== "booked" \|\| Boolean\(data\.voided\)\}/,
  );
  assert.match(
    viewBooking,
    /user\?\.admin && !data\.voided && data\.status === "booked"/,
  );
  assert.match(viewBooking, /disabled=\{hasRecordedPayments\}/);
  assert.match(
    viewBooking,
    /แก้ไขข้อมูล Passport ผู้จองหลักได้เฉพาะระหว่างที่กำลังเข้าพัก \(Checked-In\)/,
  );
  assert.match(confirmationModal, /bookingHasRecordedPayments/);
});

