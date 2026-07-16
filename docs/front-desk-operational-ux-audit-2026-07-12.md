# HostelFlow Front-Desk Operational UX Audit

Audit date: 12 July 2026  
Training date: 13 July 2026  
Business timezone reviewed: Asia/Bangkok

## Scope and confidence

This review traced the React UI, form state, Axios requests, Express routes, backend validation, MongoDB mutations, transaction helpers, locking, and idempotency code for the main reception workflows.

The frontend and backend production builds pass, and the backend unit suite passes. A browser-level walkthrough could not be completed because this environment has no available browser runtime. No claim in this report should therefore be read as a successful authenticated end-to-end test against real booking data.

## A. Executive summary

### Readiness for training

HostelFlow is **conditionally ready for supervised staff training**, but not yet safe to present as “all exception cases can be handled without help.” The normal path—create a booking, assign one or more rooms, check in with passport/deposit details, record a payment, and check out—has clear screens and meaningful backend protection. Room overlaps are checked under locks, sensitive mutations have server-side idempotency, closed-booking financial changes require admin access, and Bangkok business-day boundaries are used in the important daily queries.

A newly trained receptionist should be able to complete the normal path if the training uses these rules:

- enter the **total room price for the entire stay**;
- do not add a separate deposit before check-in;
- collect and refund normal deposits in Cash;
- settle unpaid room charges before checkout whenever possible;
- use Cancellation for an ordinary pre-arrival cancellation and ask an admin to use Resolve/after-close tools for exceptions;
- use the arrivals/departures or master lists—not the calendar—as the record of completed/cancelled stays;
- make sure the correct cash shift is open before receiving or refunding Cash.

### Largest remaining risks

1. A deposit recorded manually before arrival causes the check-in endpoint to reject the booking because check-in insists that no deposit transaction already exists.
2. Automatic checkout refunds are always recorded as Cash, even though the general transaction form can record a deposit by Card or Transfer.
3. Checkout permits a remaining unpaid balance after a UI checkbox, but the backend neither validates nor persists that acknowledgement.
4. The calendar excludes released cancelled/checked-out/no-show stays while displaying a legend for those statuses. It also advertises an unpaid outline that the calendar data and rendering do not implement.
5. Resolve is powerful and comparatively technical. A new receptionist can create refunds, corrections, status changes, and room-release changes in one operation without a second confirmation step.

### Most confusing workflows

- Resolve / “แก้ไขหลังปิด” and its transaction directions;
- manual deposits, refunds, and payment corrections;
- multiple room stays and transition dates;
- the difference between booking status and room-release status;
- cash-shift handoff versus simply recording a cash transaction;
- the calendar’s meaning after a cancellation or checkout.

### Fix before training begins

The cancellation over-refund bug, zero-deposit checkout blocker, availability failure state, total-price wording, failed-booking retry state, non-admin Delete action, and duplicate room-stay submission state were fixed during this audit. Before training, the team should additionally either restrict deposits to Cash and to the check-in workflow, or explicitly train that temporary policy. Staff should also be told never to approve checkout with a remaining unpaid balance unless the owner/admin is handling the debt.

## B. Critical pre-training fixes

### 1. Net prior refunds before calculating cancellation refund — fixed

- **Severity:** High
- **Workflow:** Cancellation / financial transactions
- **Location:** `api/src/helpers/financeHelpers.ts:115` (`summarizeReceivedPaymentsByMethod`), `api/src/controller/booking.ts:2548` (`cancelBooking`), `frontend/src/features/bookings/Cancellation.tsx:35-101`
- **Realistic scenario:** Staff record a ฿200 deposit refund or an outgoing correction, then cancel a ฿1,000 paid booking as refundable.
- **Previous behavior:** The backend added every non-Unpaid transaction amount, including prior refunds, as money received. The UI handled only deposit refunds specially. The endpoint could refund more than the guest had actually paid and could disagree with the preview.
- **Current behavior:** Both preview and backend net incoming, outgoing, and neutral transactions by payment method and refund only positive net receipts.
- **Operational risk:** Direct over-refund and incorrect cash/card reconciliation.
- **Recommended fix:** Implemented, with a regression unit test.
- **Effort:** Small
- **Safe immediately:** Yes

### 2. Prevent a pre-arrival deposit from blocking check-in — outstanding

- **Severity:** High
- **Workflow:** Transactions → Check-in
- **Location:** `frontend/src/features/bookings/AddTransaction.tsx:30-47` exposes “รับมัดจำ”; `frontend/src/features/bookings/ViewBooking.tsx:1113-1116` exposes the transaction form on an open booking; `api/src/controller/booking.ts:1591-1597` rejects check-in if any deposit exists.
- **Realistic scenario:** Staff receive a key/room deposit early, choose “รับมัดจำ,” then cannot check the guest in later.
- **Current behavior:** The transaction saves successfully, but check-in later returns “booking นี้มีรายการมัดจำแล้ว.” There is no normal correction path for a non-admin.
- **Operational risk:** A reasonable-looking action makes the core arrival workflow unusable and requires developer/admin help.
- **Recommended fix:** Either hide/reject manual deposit transactions while status is `booked`, or update check-in to reuse an existing valid deposit rather than adding another. Until decided, train “record deposit only inside Check In.”
- **Effort:** Small if restricted; Medium if existing deposits are reused
- **Safe immediately:** Restriction is safe only after confirming the business policy.

### 3. Keep checkout deposit refund method consistent — outstanding

- **Severity:** High
- **Workflow:** Transactions / Check-out / cash close
- **Location:** `frontend/src/features/bookings/AddTransaction.tsx:45-50,289-307` permits Cash/Card/Transfer deposits; `api/src/controller/booking.ts:1895-1910` creates every automatic checkout `depositRefund` with `paymentMethod: "Cash"`; `frontend/src/features/bookings/CheckOut.tsx:70-110` displays the first deposit’s method but describes a cash refund.
- **Realistic scenario:** Staff record a ฿500 deposit by Card, then check out the guest.
- **Current behavior:** The UI may show Card on the deposit, but checkout writes a ฿500 Cash refund and reduces the cash deposit stash.
- **Operational risk:** Wrong cash drawer expectation and wrong payment-method audit trail.
- **Recommended fix:** Short-term: restrict deposits and deposit refunds to Cash in UI and backend. Longer-term: refund each remaining deposit by its original method and preview the breakdown.
- **Effort:** Small for restriction; Medium for method-aware allocation
- **Safe immediately:** Only after confirming deposits are operationally Cash-only.

### 4. Persist or block checkout with unpaid room balance — outstanding

- **Severity:** High
- **Workflow:** Check-out / unpaid bookings
- **Location:** `frontend/src/features/bookings/CheckOut.tsx:85-108,133-149,220-254`; `api/src/controller/booking.ts:1808-1979`
- **Realistic scenario:** A busy receptionist ticks “ยืนยันว่าเช็คเอาท์โดยยังค้างชำระ” and completes checkout with ฿1,200 still due.
- **Current behavior:** The client sends `confirmedStillUnpaid`, but the backend ignores the field and records no acknowledgement, debt reason, or staff decision.
- **Operational risk:** Management cannot distinguish an intentional debt exception from an accidental missed collection.
- **Recommended fix:** Prefer blocking ordinary checkout while balance remains and route the exception through Resolve with required reason/note; alternatively persist a checkout debt acknowledgement and audit details.
- **Effort:** Medium
- **Safe immediately:** No—requires workflow and data decision. For tomorrow, train staff to settle first and escalate exceptions.

### 5. Clarify that booking price is the total stay price — fixed

- **Severity:** High
- **Workflow:** Create booking
- **Location:** `frontend/src/features/bookings/AddBooking.tsx:630-650`; backend stores the value as one room charge at `api/src/controller/booking.ts:625-659`.
- **Realistic scenario:** Staff see “ราคา” and enter ฿500 nightly for a four-night stay that should be ฿2,000.
- **Previous behavior:** No indication whether the number was nightly or total.
- **Current behavior:** The label says “ราคารวมค่าห้องตลอดการเข้าพัก” with “กรอกยอดรวมทุกคืน ไม่ใช่ราคาต่อคืน.”
- **Operational risk:** Under/overstated booking revenue and wrong guest collection.
- **Recommended fix:** Implemented.
- **Effort:** Tiny
- **Safe immediately:** Yes

### 6. Do not treat an availability API failure as “all rooms available” — fixed

- **Severity:** High
- **Workflow:** Create booking / room availability
- **Location:** `frontend/src/features/bookings/AddBooking.tsx:40,64-200,359-370,568-604`
- **Realistic scenario:** Wi-Fi/API briefly fails after dates are selected.
- **Previous behavior:** Occupied rooms were cleared and every room appeared selectable. The backend would reject the eventual conflict, but only after staff completed the form.
- **Current behavior:** Room choice is disabled while checking or after failure, and submission gives a specific retry instruction. Backend overlap protection remains authoritative.
- **Operational risk:** False availability, wasted time, and loss of trust in the calendar/form.
- **Recommended fix:** Implemented.
- **Effort:** Small
- **Safe immediately:** Yes

### 7. Replace endless booking-detail skeleton with an error and retry — fixed

- **Severity:** Medium
- **Workflow:** Open booking from calendar
- **Location:** `frontend/src/features/bookings/ViewBooking.tsx:106-108,191-252`; `frontend/src/features/bookings/ViewBooking.css`
- **Realistic scenario:** Staff click a calendar booking while the detail request times out.
- **Previous behavior:** The error was logged only to the console and the modal remained as an endless loading skeleton.
- **Current behavior:** Staff see “โหลดข้อมูลการจองไม่สำเร็จ,” the returned safe message, and “ลองโหลดอีกครั้ง.” Calendar-load failures also show a toast from `frontend/src/pages/Calendar.tsx:436-464`.
- **Operational risk:** Staff assume the system is frozen and need developer help.
- **Recommended fix:** Implemented.
- **Effort:** Small
- **Safe immediately:** Yes

### 8. Allow zero-deposit checkout without false confirmation — fixed

- **Severity:** Medium
- **Workflow:** Check-out
- **Location:** `frontend/src/features/bookings/CheckOut.tsx:128-137,277-300`; backend already accepts no refund at `api/src/controller/booking.ts:1860-1869`.
- **Realistic scenario:** A booking checked in with a ฿0 deposit reaches checkout.
- **Previous behavior:** Staff had to tick “ยืนยันคืนเงิน” even though nothing was returned.
- **Current behavior:** The confirmation appears only when a positive deposit remains; otherwise the screen says there is no deposit to refund.
- **Operational risk:** False operational confirmation and staff uncertainty.
- **Recommended fix:** Implemented.
- **Effort:** Tiny
- **Safe immediately:** Yes

### 9. Hide unavailable Delete and lock destructive submission — fixed

- **Severity:** Medium
- **Workflow:** Booking correction/deletion
- **Location:** `frontend/src/features/bookings/ViewBooking.tsx:1176-1188`; `frontend/src/components/ConfirmationModal.tsx:31-67,103-127`; backend authorization at `api/src/controller/booking.ts:1447-1468`.
- **Realistic scenario:** A normal receptionist selects Delete, confirms it, then receives a generic failure.
- **Previous behavior:** Delete appeared for everyone even though the backend allows only admins; the modal dropped the backend message and allowed repeated clicks.
- **Current behavior:** Delete is shown only to admins, the button locks while deleting, and backend messages are preserved.
- **Operational risk:** Confusion about authority and repeated destructive requests.
- **Recommended fix:** Implemented.
- **Effort:** Tiny
- **Safe immediately:** Yes

### 10. Lock room-stay save and explain the minimum — fixed

- **Severity:** Medium
- **Workflow:** Multiple room stays
- **Location:** `frontend/src/features/bookings/ManageRoomStays.tsx:83-86,183-230,366-401`
- **Realistic scenario:** A busy receptionist double-clicks Save or tries to remove the final stay.
- **Previous behavior:** No submitting state; removing the last stay emitted an empty toast.
- **Current behavior:** Add/remove/save actions lock during the request and the minimum-stay guard says “ต้องมีช่วงพักอย่างน้อย 1 ช่วง.”
- **Operational risk:** Duplicate activity records and unexplained blocked actions.
- **Recommended fix:** Implemented.
- **Effort:** Tiny
- **Safe immediately:** Yes

## C. Workflow-by-workflow findings

### 1. Calendar and room availability

**What works well**

- Sticky room/date headers and horizontally scrollable month grid support the real bed inventory (`frontend/src/pages/Calendar.tsx:189-379`, `Calendar.css:11-96`).
- Multi-bed stays are merged vertically when adjacent, and long stays are clipped correctly at month boundaries.
- Booking blocks include guest name, status text, and nights; empty cells open a prefilled create form.
- Create/edit/manage endpoints re-check conflicts on the backend under per-room/date locks (`api/src/services/roomMutationLocks.ts`).

**What is confusing or can fail**

- The calendar endpoint filters with `ROOM_BLOCKING_BOOKING_FILTER` (`api/src/controller/booking.ts:2008-2012`), so released checked-out/cancelled/no-show stays disappear. Yet the UI legend includes those statuses (`frontend/src/pages/Calendar.tsx:64-70`).
- “ค้างชำระ” appears in the legend, but the calendar DTO has no transaction/balance field and no outline is applied to blocks.
- In source-color mode, status depends on a small text chip rather than color.
- Multiple historical and active bookings cannot simply be rendered in one grid cell without a stacking rule, so changing the backend query alone is unsafe.

**Likely training question:** “Why did the cancelled/checked-out booking disappear, and is the bed really free?”

**Recommendation:** Explain that the calendar is current room blocking, not full history. Shortly after training, rename the legend/heading accordingly or add a completed-bookings display mode with stacking. Remove the unpaid legend until implemented.

### 2. Creating a booking

**What works well**

- Required fields have inline Thai errors; invalid date order and non-positive price are caught before the request.
- Room availability now has loading/error/ready states and occupied choices are disabled with a reason.
- Backend validates source, payment method, duplicate room IDs, dates, price, duplicate Booking ID, and overlap under locks (`api/src/controller/booking.ts:540-711`).
- The save action is disabled while submitting and unsaved form changes are guarded by parent modals.

**What is confusing or can fail**

- Booking ID is mandatory even for Walk-In; staff need a documented numbering convention.
- Payment labels mix internal English codes (OTA, Unpaid, Transfer) with Thai UI.
- New-booking creation is protected by room locks and unique Booking ID, but does not use the mutation-idempotency service. Two rapid requests should not create two overlapping records, but can produce one success followed by a confusing conflict toast.
- Backend catch-all errors sometimes return only `error`, while this form mainly reads `message`.

**Likely training question:** “For a walk-in, what do I put in Booking ID, and is price per night?”

**Recommendation:** Put the walk-in ID format in the quick guide. The total-price ambiguity is fixed. Add a server-generated walk-in ID later.

### 3. Editing bookings and room stays

**What works well**

- Editing check-in/check-out automatically moves only the first/last stay boundary and rejects invalid, discontinuous, or conflicting results (`api/src/controller/booking.ts:792-953`).
- Manage Room Stays locks the booking boundaries in the UI, mirrors a changed transition date to the adjacent stay, and the backend enforces exact start/end/no-gap rules (`frontend/src/features/bookings/ManageRoomStays.tsx:49-78,287-356`; `api/src/controller/booking.ts:2091-2253`).
- Availability checks exclude the booking being edited.
- Unsaved-change confirmation exists.

**What is confusing or can fail**

- Adding a stay creates an entirely blank row at the end; staff must understand that the previous transition and new dates must be rebuilt.
- “เพิ่มช่วงพัก/ลดช่วงพัก” always adds/removes at the end; there is no reorder or remove-specific-row control.
- Availability request failure in Manage Room Stays is silent and clears the disabled-room information (`ManageRoomStays.tsx:165-168`); the backend still prevents a conflict at save.
- Edit and Manage Room Stays remain visible on some closed/cancelled cases; backend rules are not uniform (`editBooking` blocks checked-out only; `manageRoomStays` also blocks checked-out only).

**Likely training question:** “Which date do I change when the guest moves rooms, and why did the other date change too?”

**Recommendation:** Demonstrate one two-room example. Add per-row remove/reorder and a visible availability failure state after training. Hide ordinary edit/room tools on all closed statuses unless a deliberate admin workflow is defined.

### 4. Check-in

**What works well**

- Passport number/name, title, nationality, deposit, and unpaid payment method are visible in one flow.
- The payment summary separates deposit, room charge, card surcharge, Cash total, and other-method total.
- UI disables Check In during submission; backend is idempotent and conditionally updates only a `booked` booking.
- Backend rejects early arrival, arrival after checkout, invalid deposit, duplicate check-in, and missing unpaid settlement method (`api/src/controller/booking.ts:1519-1806`).
- Passport values are encrypted at rest and the booking response removes sensitive fields.

**What is confusing or can fail**

- Any pre-existing deposit blocks check-in rather than being reused.
- The “รับเงินสดไม่ตรงค่าห้อง” rounding feature records the difference as an incoming adjustment; staff must not use it when ordinary change is returned.
- The confirmation label “ยืนยันรับเงิน” applies even when the only action may be a zero deposit or a non-cash room settlement.
- A missing/misconfigured encryption secret would expose the technical message `CRYPTO_SECRET Missing` to staff.

**Likely training question:** “Does the confirmation mean cash deposit, room payment, or both?”

**Recommendation:** Rename the confirmation dynamically to state exact amounts/methods. Restrict/reuse pre-check-in deposits and translate encryption failures to an operational message.

### 5. Transactions and payments

**What works well**

- Common extras, deposit/refund, adjustment direction, payment method, linked original transaction, and required notes are present.
- Card surcharge is previewed and automatically created by the backend.
- Backend validates positive amount, type, payment method, required note/link, large refund admin threshold, and closed-booking admin access; the mutation is idempotent (`api/src/controller/booking.ts:2263-2445`).
- Booking detail groups room settlement, card fee, refund, and correction children and shows review state/notes.

**What is confusing or can fail**

- The screen title “เพิ่มรายการใช้จ่าย” is wrong for deposits, refunds, and corrections; it sounds like every row is a guest expense.
- Attachment options display internal transaction type values such as `roomCharge` rather than staff labels (`AddTransaction.tsx:146-154`).
- There is no explicit “effect after save” summary for non-card transactions (money in/out, revenue change, deposit liability change).
- Add Transaction remains visible to non-admin staff on closed bookings, although the backend rejects them.
- There is no delete/void action; corrections require an adjustment/Resolve and training.

**Likely training question:** “Do I use ปรับราคา, แก้ไขการชำระเงิน, or Resolve when I entered the wrong method?”

**Recommendation:** Rename to “บันทึกรายการเงิน/บริการ,” show direction/liability impact before save, and hide unavailable closed-booking actions. Add the correction decision tree to the quick guide.

### 6. Check-out

**What works well**

- Guest, room, dates, early checkout, deposit received/refunded/remaining, and unpaid balance are shown before the action.
- Staff can jump to record a payment from the unpaid warning.
- Early checkout explicitly asks whether remaining nights should reopen.
- Backend checks status, deposit confirmation, large-refund authority, staff identity, and duplicate submission; it records checkout metadata and room-release status.

**What is confusing or can fail**

- Non-cash manual deposits are automatically refunded as Cash.
- Unpaid checkout acknowledgement is not persisted or backend-enforced.
- Deposit retained/damaged-key cases are not part of ordinary checkout; staff must know to use Resolve and “เก็บมัดจำ.”
- There is no second confirmation dialog after the financial summary; the action button executes immediately.

**Likely training question:** “What do I do if we keep some/all of the deposit, or the guest still owes money?”

**Recommendation:** Put both cases in the quick guide and require Resolve/admin for unpaid or retained-deposit exceptions until checkout models them explicitly.

### 7. Cancellation and problem resolution

**What works well**

- Ordinary cancellation previews refund/kept amount by method and room release state.
- Backend permits cancellation only before check-in, applies admin threshold to large refunds, and uses idempotency.
- Resolve offers scenario presets, required reason/note, final status, room state, money-in/out totals, and admin-only post-close changes.

**What is confusing or can fail**

- There is no restore/undo for an accidental cancellation. Ordinary staff can only escalate to an admin, and even post-close Resolve locks the closed status.
- “Resolve,” “Settlement,” “Outcome,” “Neutral,” and “Post-Close” remain technical concepts even though some surrounding text is Thai.
- Resolve can close a booking and create multiple financial movements from one button without a separate final confirmation.
- Cancellation refund by OTA is recorded as an OTA money-out transaction, but the UI does not explain whether reception must physically pay anything.

**Likely training question:** “What is Resolve, and can I undo a cancellation?”

**Recommendation:** Treat Resolve as owner/admin training, rename the ordinary menu action to “เคลียร์เคสพิเศษ,” and add a typed confirmation for high-impact status/refund combinations.

### 8. Arrivals and departures

**What works well**

- Backend uses Bangkok business-day bounds and includes today’s non-cancelled arrivals/departures with current status.
- The tables expose guest, dates, nights, rooms, source, room price, displayed payment method, Booking ID, check-in staff, note, and status.
- The dashboard separately shows late check-ins and late check-outs needing review.
- Pinned rows can be promoted.

**What is confusing or can fail**

- The column heading “สถานะ Check-In” is reused even when showing checked-out/cancelled/no-show states.
- “ยังไม่ชำระเงิน” counts only original room charges whose method is Unpaid; partial or unusual correction cases are harder to interpret.
- API ordering is not explicit; client status sorting may not match reception priority (unpaid/late/pinned).

**Likely training question:** “Why is a checked-out guest still in Departures?”

**Recommendation:** Explain that today lists retain completed rows to show progress. Rename the column to “สถานะการจอง” and add a clear balance-due field rather than inferring from payment method.

### 9. Daily cash close

**What works well**

- Deposit and operating cash are separated.
- The screen shows shift owner, expected drawer values, counted values, variance logic, handoff versus recount, and requires notes above the threshold.
- Backend recalculates movements, limits close permission to the shift owner/admin, locks concurrent start/close, and applies idempotency (`frontend/src/pages/Main.tsx:668-792,1255-1493`; `api/src/controller/finance.ts:1294-1542`).
- Admin audit detects open shifts, variances, handoff mismatch, flagged transactions, and cash outside a shift.

**What is confusing or can fail**

- The primary screen does not list which transactions make up expected deposit/operating Cash; staff must trust the total or use admin tools.
- “รับส่งเงิน” versus “นับใหม่แทนรับส่ง” needs explanation.
- There is no final confirmation dialog showing expected, actual, and variance immediately before closing.
- A closed shift cannot be edited; correction is handled through another shift/audit process, which is not explained inline.

**Likely training question:** “Which drawer does this transaction affect, and how do I correct a wrong close?”

**Recommendation:** Add a compact movement breakdown and confirmation step. Put the correction/escalation procedure in the quick guide.

### 10. Error handling and recovery

**What works well**

- Most mutations retain form state on failure and use toast errors.
- Core financial/status mutation buttons use submitting state; backend messages are usually surfaced.
- Unsaved-change modals protect the important booking forms.

**What is confusing or can fail**

- Backend response shape alternates between `message` and `error`; several clients read only one.
- Auth and several validation errors are still technical English.
- CashShiftNudge silently disappears if its request fails, so absence can mean “same shift,” “no issue,” or “could not check.”
- Some catch-all handlers expose raw database/configuration error text.
- The full lint suite currently fails on pre-existing React hook/compiler rules, reducing confidence that future UI mistakes will be caught automatically.

**Likely training question:** “Did it fail, or is it still working?”

**Recommendation:** Standardize `{ code, message }`, translate at the API boundary, show inline retry for important reads, and reserve raw errors for server logs.

## D. Missing operational guardrails

| Action | Missing guardrail | Recommendation |
|---|---|---|
| Add deposit before check-in | Disabled state / explanation | Hide it for `booked` status or explicitly reuse it at check-in. |
| Refund non-cash deposit at checkout | Method validation / preview | Restrict to Cash temporarily or preview/refund by original method. |
| Checkout with unpaid balance | Backend validation / audit | Block normal checkout or persist reason, amount, and staff acknowledgement. |
| Keep deposit at checkout | Guided path | Add a “refund / keep / partial” choice with financial preview, or route visibly to Resolve. |
| Resolve with status and refunds | Second confirmation | Require confirmation summarizing final status, room availability, each payment method, and net cash. |
| Cancel booking | Undo/correction path | Provide admin restore with overlap revalidation, or clearly state that status cannot be restored. |
| Edit cancelled/no-show booking | Disabled state / admin boundary | Hide ordinary edit/room controls on all closed states. |
| Add transaction to closed booking | Disabled state | Hide for non-admin and label admin post-close correction. |
| Calendar completed-status legend | Explanation | Label calendar as room-blocking view or implement a separate completed/history layer. |
| Calendar unpaid legend | Accurate state | Remove until unpaid data/outline is actually rendered. |
| Cash close | Confirmation / included-items preview | Show movements and variance immediately before closing. |
| Add Booking duplicate click | Explicit idempotency | Add endpoint idempotency, although locks/unique Booking ID currently limit duplicate damage. |
| Manage Room Stays availability failure | Visible retry | Do not silently clear unavailable-room information. |
| Walk-In Booking ID | Safe default | Generate a unique ID or document a required format. |

## E. Error-message audit

| Current error or condition | Where | Staff currently sees | Staff should see instead | Recommended wording |
|---|---|---|---|---|
| Room availability request fails | `AddBooking.tsx:188-199` | **Fixed:** inline error and disabled room choice | Same, with retry | “ตรวจสอบห้องว่างไม่สำเร็จ กรุณาลองเลือกวันที่อีกครั้งก่อนบันทึก” |
| Calendar request fails | `Calendar.tsx:436-464` | **Fixed:** toast; old calendar remains | Clear failure without clearing last good data | “โหลดตารางห้องไม่สำเร็จ ข้อมูลเดิมยังแสดงอยู่ กรุณากดรีเฟรช” |
| Booking detail request fails | `ViewBooking.tsx:191-252` | **Fixed:** error screen and retry | Same | “โหลดข้อมูลการจองไม่สำเร็จ กรุณาลองอีกครั้ง” |
| Delete rejected by backend | `ConfirmationModal.tsx`, `removeBooking` | **Fixed:** backend message is preserved | Same | “เฉพาะผู้ดูแลระบบเท่านั้นที่สามารถลบการจองได้” |
| No auth cookie | `authMiddleware.ts:20-22` | “Not Authorized” when surfaced | Thai re-login instruction | “เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง” |
| Account used on another device | `authMiddleware.ts:41-48` | English message | Thai explanation and recovery | “บัญชีนี้เข้าสู่ระบบบนอุปกรณ์อื่นแล้ว กรุณาเข้าสู่ระบบใหม่” |
| Invalid/expired token | `authMiddleware.ts:59-62` | “Invalid or expired token” | Thai re-login instruction | “เซสชันไม่ถูกต้องหรือหมดอายุ กรุณาเข้าสู่ระบบใหม่” |
| Booking detail ID not found | `getBookingById`, `booking.ts:2080-2088` | HTTP 200 with `null`, now caught as generic client error | Backend 404 with safe message | “ไม่พบการจองนี้ อาจถูกลบหรือมีการเปลี่ยนแปลงแล้ว” |
| Calendar backend catch-all | `booking.ts:2075-2077` | Raw `error` text may reach toast | Stable Thai message; log detail server-side | “โหลดตารางห้องไม่สำเร็จ กรุณาลองใหม่” |
| Check-in encryption config missing | `booking.ts:1633-1659,1799-1805` | Technical `CRYPTO_SECRET Missing` | Safe operational failure | “บันทึกข้อมูล Passport ไม่สำเร็จ กรุณาติดต่อผู้ดูแลระบบก่อนลองใหม่” |
| Add transaction backend 500 | `booking.ts:2439-2444`, `AddTransaction.tsx:386-395` | Generic add-expense error; backend `error` is ignored | Safe message plus retry guidance | “ยังไม่ได้บันทึกรายการ กรุณาตรวจข้อมูลและลองใหม่” |
| Manage Room Stays backend 500 | `booking.ts:2244-2252`, `ManageRoomStays.tsx:391-400` | Axios technical message if only `error` is returned | Safe no-save confirmation | “ยังไม่ได้เปลี่ยนห้อง กรุณาลองใหม่ หากยังไม่ได้ให้รีเฟรชการจอง” |
| Cash-shift nudge request fails | `CashShiftNudge.tsx:17-31` | Nothing; nudge disappears | Visible “status unavailable” near cash mutation | “ตรวจสอบกะเงินสดไม่ได้ กรุณาเปิดหน้ากะเงินสดก่อนรับ/คืน Cash” |
| Invalid finance date | `finance.ts:849,1180,1212,1233,1302` | Technical English date format | Thai field-specific message | “วันที่ไม่ถูกต้อง กรุณาเลือกวันที่ในรูปแบบ YYYY-MM-DD” |
| Create/edit field changed during submit | `AddBooking.tsx:316-321` | **Fixed:** previously threw “Already Submitting” | Ignore late input; save the submitted snapshot | No message needed. |
| Full frontend lint | repository-wide | Not staff-facing; CI/local lint exits 1 | Clean lint gate or documented baseline | Fix existing hook/compiler errors before relying on lint as release evidence. |

## F. Training friction list

### Should be fixed in the product

- Pre-arrival manual deposit versus check-in deposit conflict.
- Non-cash deposit automatically refunded as Cash.
- Unpaid checkout acknowledgement not persisted.
- Completed/cancelled calendar legend does not match returned data; unpaid outline is not implemented.
- Technical transaction attachment labels and “เพิ่มรายการใช้จ่าย” wording.
- Ordinary actions visible on closed bookings when only admin can complete them.
- Inconsistent `message`/`error` API shape and English auth/config errors.
- No balance-due amount column in arrivals/departures/master.

### Acceptable to explain during training

- Adjacent room-stay transition dates move together.
- The first stay starts at booking check-in and the last ends at booking checkout.
- Early checkout can release or retain remaining nights.
- Arrivals/departures keep completed rows for the day.
- Card payment automatically adds a 3% surcharge.
- Cash is split into deposit and operating stashes.
- Only the shift owner/admin can close the active cash shift.

### Add to a quick-reference guide

- Walk-in Booking ID convention.
- “Total stay price, not nightly price.”
- “Record deposit inside Check In only; use Cash until policy changes.”
- Exact unpaid OTA check-in sequence and how to verify room payment versus deposit.
- Room-change worked example with two stays and one transition date.
- Checkout decision tree: refund deposit / keep deposit / unpaid balance / early release.
- Cancellation versus No-Show versus Resolve.
- Which correction type to use after a wrong payment entry.
- Cash-shift start, handoff, recount, close, and escalation for variance.
- Who can perform delete, large refund, and after-close correction.

## G. Recommended fix order

### Fix before tomorrow

- [x] Net outgoing transactions before cancellation refunds.
- [x] Clarify total-stay room price.
- [x] Block create-room selection when availability cannot be confirmed.
- [x] Add visible retry for booking/calendar load failures.
- [x] Remove false zero-deposit refund confirmation.
- [x] Hide Delete from non-admin staff and lock deletion.
- [x] Lock Manage Room Stays while saving and explain the minimum stay.
- [x] Stop form input events from throwing during submission.
- [ ] Confirm and enforce the temporary deposit policy: Check-In only and Cash only, or implement reuse/method-aware refunds.
- [ ] Tell staff not to checkout an unpaid booking through the ordinary checkbox; escalate it until the backend records the decision.
- [ ] Remove or verbally disavow the calendar “ค้างชำระ” and completed-status legend for tomorrow’s training.
- [ ] Prepare a one-page quick-reference guide with the decision rules above.

### Fix shortly after training

- Make checkout method-aware for deposits and model retained/partial deposits directly.
- Make unpaid checkout an audited exception or block it.
- Restrict open/closed booking actions consistently in UI and backend.
- Rename transaction screens and show balance/revenue/cash/deposit impact before save.
- Standardize API errors to `{ code, message }` and translate operational messages.
- Add visible Manage Room Stays availability failure/retry.
- Add a cash-close movement breakdown and confirmation summary.
- Add endpoint/integration tests for create, overlap, check-in, checkout, cancellation, room stays, and cash shift—not only finance helper unit tests.
- Establish an explicit supported correction/restore policy for accidental cancellation.

### Longer-term UX improvements

- Separate “current room blocking” from “booking history” in the calendar, with stacking for re-sold cancelled/early-checkout dates.
- Add a true balance ledger showing expected room revenue, collected room money, extras, deposit liability, refunds, and balance due.
- Replace internal Resolve vocabulary with guided scenario flows and role-based actions.
- Generate walk-in IDs and reduce required manual identifiers.
- Add end-to-end browser tests for the receptionist happy path and high-risk financial exceptions.
- Bring the frontend lint baseline to zero and add it as a release gate.

## Verification performed

- `frontend: npm run build` — passed (TypeScript + Vite production build).
- `api: npm run build` — passed (TypeScript).
- `api: npm test` — passed, 11/11 tests including the new cancellation net-payment regression.
- Targeted ESLint on changed operational components — no new errors; three pre-existing hook dependency warnings remain in `ManageRoomStays.tsx` and `ViewBooking.tsx`.
- Full frontend ESLint — fails on existing hook/compiler rules elsewhere in the repository; details were not changed as part of this operational audit.
- Vite development server — started cleanly on localhost.
- Browser/authenticated end-to-end run — not performed because neither the browser CLI nor an in-app browser instance was available in this environment.

## Final operational answer

**Could a newly trained receptionist complete the normal booking, check-in, payment, room-change, and checkout workflows without damaging data?**

For a supervised normal case, **probably yes after the fixes in this audit**, because the UI now provides clearer totals/failure states and the backend has strong room/status/duplicate protections. For exceptions involving pre-recorded deposits, non-cash deposit refunds, unpaid checkout, cancellation restoration, or Resolve, **not reliably without owner/admin guidance**. Those cases must be explicitly excluded from the normal training script or fixed before staff are expected to handle them alone.
