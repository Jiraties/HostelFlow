# HostelFlow Staff Workflow and Workaround Review

Review date: 17 July 2026  
Business timezone: Asia/Bangkok  
Prepared from: current frontend, API, financial-ledger, room-lock, and booking-lifecycle code

## Purpose

This note identifies workflows that may frustrate reception staff enough that they invent a workaround. The important question is not only whether the system rejects an invalid action; it is whether the easiest-looking workaround creates incorrect payments, room assignments, booking status, reporting, or audit history.

The findings marked **confirmed** follow directly from current code. Findings marked **validate with staff** are credible behavior risks that should be observed during a real shift before deciding the final design.

## Priority 1 — Redesign the extension commercial workflow

**Status:** Confirmed  
**Why this is first:** Extensions are common front-desk actions involving availability, room moves, price negotiation, booking source, payment, and revenue recognition. The current workflow is technically safe but commercially too rigid.

### Current staff experience

Staff must enter a new checkout date, extension room or beds, booking channel, one total amount, and a paid payment method. `Unpaid` is not allowed. The amount is entered manually rather than calculated from nightly rates. The extension is then saved as a paid room-charge transaction at the same time as the reservation change.

### Likely workarounds

- Select Cash, Transfer, Card, or OTA even when the guest has not paid yet.
- Enter a guessed total because no nightly price recommendation is shown.
- Select an OTA as the extension channel even when the OTA has not approved or synchronized the change.
- Add the extension as an extra transaction instead of using Extend when the correct room or payment choice is unclear.
- Create a separate booking to represent the extra nights, fragmenting the guest stay and deposit history.
- Repeatedly retry after a generic conflict because the UI replaces specific 409 causes with one refresh message.

### Unwanted consequences

- Payment records can say money was collected when it was not.
- OTA commission, channel attribution, and inventory can disagree with the channel extranet.
- Staff can undercharge or overcharge because the system has no nightly rate calculation.
- The whole extension amount is recognized on the transaction date instead of being allocated across service nights.
- Separate-booking workarounds can duplicate guest records, deposits, check-in work, and departures.

### Recommended design

1. Separate the reservation extension charge from payment collection.
2. Allow an extension to create an outstanding balance.
3. Show a nightly breakdown by room/bed and service date.
4. Suggest the normal rate and require permission plus a reason for overrides.
5. Distinguish direct-at-property extensions from confirmed OTA modifications.
6. Require an OTA confirmation/reference when an OTA modification is selected.
7. Show the old balance, added charges, payment collected now, and new balance due.
8. Support date-by-date room allocation when an extension requires more than one room move.
9. Preserve the existing idempotency, room locks, booking revisions, atomic cash handling, commercial segments, and audit activity.

### Tomorrow's validation questions

- How often does a guest agree to extend before actually paying?
- How is the extension price decided today: standard nightly rate, negotiation, OTA rate, or manager decision?
- When staff say an extension is from Booking.com/Hostelworld/Agoda, was it actually changed in that channel?
- Do staff ever create a second booking for extra nights? Why?
- How often does the guest need to move more than once during the added nights?

## Priority 2 — Checkout with an unpaid balance records no acknowledgement

**Status:** Confirmed

The checkout screen allows staff to tick “check out while still unpaid” and sends `confirmedStillUnpaid`. The API does not validate or store that field. A checked-out booking therefore contains no reliable indication that staff intentionally accepted the debt.

**Likely workaround:** Tick the checkbox to finish the departure and explain the debt in a note, chat, or memory.

**Unwanted behavior:** Management cannot distinguish an approved debt exception from a missed collection. Follow-up can be lost between shifts.

**Recommendation:** Ordinary staff should settle the balance before checkout. An exception should require a debt reason, amount, follow-up owner, due date, and audit record, or be routed through an admin approval workflow.

**Observe tomorrow:** Ask staff what they currently do when a guest leaves owing money and where they expect that debt to appear.

## Priority 2 — Non-cash deposits can produce a cash refund

**Status:** Confirmed

After check-in, Add Transaction permits a deposit using Cash, Card, or Transfer. Checkout totals all remaining deposits but always writes the automatic deposit refund or retained-deposit movement as Cash. The UI also uses the first deposit's payment method to describe what can be a combined balance.

**Likely workaround:** Select Cash at checkout even when staff return money by transfer/card, or manually add a refund before checkout and then attempt to avoid a second refund.

**Unwanted behavior:** The cash drawer, deposit stash, payment-method totals, and guest refund history can be wrong.

**Recommendation:** Either enforce a clearly documented Cash-only deposit policy, or allocate refunds back to the original payment methods and show the method-by-method breakdown before checkout.

**Observe tomorrow:** Confirm whether operational deposits are ever accepted or returned by Card/Transfer.

## Priority 2 — Cash actions can be recorded against another staff member's shift

**Status:** Confirmed

The cash warning tells staff when another person's shift is open, but it does not prevent the transaction. The ledger attaches the cash movement to the currently open shift, not necessarily the logged-in staff member. If no shift exists, the warning says the transaction will not be linked, while the API actually rejects cash-bearing actions that require the cash ledger.

**Likely workarounds:**

- Continue using another person's shift to avoid delaying the guest.
- Select Transfer instead of Cash to get past the operational interruption.
- Ask the shift owner to record the transaction under their account.
- Keep the cash movement on paper and enter it later.

**Unwanted behavior:** Shift accountability becomes ambiguous, payment methods can be falsified, and transactions may be entered late or under the wrong actor.

**Recommendation:** Provide an explicit “receive on behalf of current shift” handoff action with both staff names, or require a shift transfer before cash entry. Make the warning accurately describe whether the action will be blocked.

**Observe tomorrow:** Watch what happens when reception changes staff while guests are waiting and one shift remains open.

## Priority 2 — In-house room moves are presented but rejected

**Status:** Confirmed

“Manage Room Stays” remains visible on the booking screen for checked-in guests, but the API only permits it while the status is `booked`. Extensions can move an in-house guest for the added period, but a normal in-house move without an extension is rejected.

**Likely workarounds:**

- Edit or extend dates solely to gain access to a room move.
- Temporarily manipulate booking status.
- Record the real room only in a note while leaving the calendar wrong.
- Create a second booking for the replacement room.

**Unwanted behavior:** Housekeeping and availability can show the wrong occupied bed, duplicate bookings may be created, and audit history no longer describes the actual event.

**Recommendation:** Add a dedicated in-house room-move workflow that preserves check-in, passport, deposit, charges, and status while updating room segments atomically. Hide actions that the current lifecycle cannot perform.

**Observe tomorrow:** Ask for examples of room moves caused by maintenance, guest complaints, upgrades, or bed swaps.

## Priority 2 — Walk-in Booking ID is mandatory and has no generator

**Status:** Confirmed; workaround frequency must be validated

Every new booking requires a Booking ID / confirmation number, including Walk-In bookings. The form provides no documented format or automatic generator.

**Likely workarounds:** Use a phone number, date, repeated placeholder, random digits, or a manually maintained numbering system.

**Unwanted behavior:** Duplicate-ID conflicts, exposure of guest phone numbers as identifiers, inconsistent search behavior, and time wasted inventing IDs.

**Recommendation:** Generate immutable internal booking IDs server-side. Keep an optional external confirmation field for OTA references.

**Observe tomorrow:** Ask each staff member what they enter for a walk-in; inconsistent answers confirm the problem.

## Priority 2 — Booking source can leave a stale payment method

**Status:** Confirmed

Selecting Booking.com or Traveloka automatically changes payment to OTA, and Hostelworld changes it to Unpaid. Changing the source afterward to Walk-In or another source does not reset or revalidate that automatic payment choice.

**Likely workaround:** Staff assume the form updated both fields and save without reopening the payment selector.

**Unwanted behavior:** A direct booking can be recorded as OTA-paid, or a channel booking can retain the wrong collection state.

**Recommendation:** Define valid source/payment combinations. When the source changes, either choose a safe valid default or require staff to confirm payment again.

**Observe tomorrow:** Test changing BOOK → WALK and HOST → WALK with staff and ask what payment they expect to remain selected.

## Priority 2 — Room-management availability failure is silent

**Status:** Confirmed

When availability loading fails in Manage Room Stays, the component silently clears occupied-room information. Staff are not told that availability is unknown. The API still prevents an actual conflict at save, but only after the room plan has been entered.

**Likely workaround:** Keep changing rooms and retrying Save, or rely on another calendar/paper record.

**Unwanted behavior:** Repeated data entry, reduced trust in availability, and attempts to bypass the normal form.

**Recommendation:** Show loading, failure, and retry states just like New Booking. Disable room selection when availability is unknown and preserve the staff's previous selection while rechecking.

## Priority 3 — Closed bookings expose a transaction form staff cannot use

**Status:** Confirmed

“Add Transaction” remains visible for closed bookings. Non-admin staff can complete the form, but the API rejects financial changes on checked-out or cancelled bookings.

**Likely workaround:** Reopen/resolve the booking, ask an admin to repeat the same entry, or attach the correction to a different open booking.

**Unwanted behavior:** Corrections may be recorded against the wrong stay, and staff lose time entering a form that was never permitted.

**Recommendation:** Hide or disable the action with an explanation for ordinary staff. Give admins a clearly labelled after-close correction route with approval and audit context.

## Priority 3 — Cancellation supports full refund or full retention, not ordinary partial cases

**Status:** Confirmed; operational frequency must be validated

The standard cancellation flow calculates all net received money and offers either full refund or full retention. It does not directly support a partial cancellation fee or refund.

**Likely workaround:** Add a refund/adjustment first, then cancel as non-refundable; use Resolve; or perform an external payment without matching system records.

**Unwanted behavior:** Multiple loosely related transactions make the audit trail hard to interpret and can leave revenue, deposit, or payment-method totals inconsistent.

**Recommendation:** Add a policy-driven cancellation breakdown showing amount received, cancellation fee, refundable amount, retained amount, and refund method. Require an override reason when staff depart from the configured policy.

**Observe tomorrow:** Ask for the last three cancellations and whether any were partially refundable.

## Priority 3 — Check-in has no “information pending” or save-draft path

**Status:** Validate with staff

Check-in requires identity number, full name, title, nationality, next destination, deposit information, and payment confirmation in one submission. This supports reporting completeness, but a guest or group may not have every detail ready while reception is busy.

**Possible workaround:** Enter placeholder passport/ID data or a guessed next destination so the guest can receive a bed and complete details later.

**Unwanted behavior:** Incorrect encrypted identity data and inaccurate hotel/TM30 reporting may appear complete and avoid later review.

**Recommendation:** Do not simply make compliance fields optional. Consider a controlled “arrival pending documents” state with a visible task, deadline, restricted privileges, and completion audit.

**Observe tomorrow:** Watch whether staff ever type temporary values during a queue and whether they reliably return to correct them.

## Priority 3 — Resolve remains powerful enough to become a universal workaround

**Status:** Confirmed

Resolve can combine lifecycle outcome, final status, room release, financial adjustments, refunds, compensation, deposit retention, and notes. This is valuable for genuine exceptions, but it can become the answer whenever a simpler workflow blocks staff.

**Likely workaround:** Use Resolve instead of cancellation, checkout, payment settlement, room move, or extension because it offers more choices.

**Unwanted behavior:** Staff may choose technically valid but semantically incorrect transaction types or statuses. Reports then describe the workaround rather than the real guest event.

**Recommendation:** Track Resolve usage by staff and reason. Add a second confirmation summarizing status, room inventory, money in/out, and deposit effect. Where one reason is common, create a dedicated safer workflow instead.

## Recently resolved — pre-check-in deposit dead end

The earlier workflow where staff could add a deposit before check-in and then become unable to check the guest in has been corrected. Existing outstanding deposits are reused during check-in without compounding, and new deposit transactions are blocked before check-in. Keep this in regression testing, but it is no longer an open workflow recommendation.

## Suggested observation plan for 17 July

Use real examples or synthetic bookings; do not ask only whether staff “understand” a screen.

1. Ask a staff member to extend a checked-in guest who will pay tomorrow.
2. Ask them to extend an OTA booking directly at reception.
3. Ask them to move an in-house guest without changing checkout.
4. Ask them to check out a guest who still owes money.
5. Ask them to return one Cash deposit and one Transfer deposit.
6. Change staff while another person's cash shift remains open and process a Cash payment.
7. Create a Walk-In and observe how the Booking ID is chosen.
8. Change booking source BOOK → WALK and ask what payment method should apply.
9. Simulate an availability failure during a multi-room plan.
10. Ask staff how they process a 50% cancellation refund.

For each task, record:

- first action attempted;
- point of confusion or rejection;
- workaround suggested without prompting;
- whether the workaround changes payment method, status, room, date, or customer identity;
- whether staff expect an admin to repair the record later;
- time and number of screens required.

## Decision rule

A workflow should be promoted above its current priority when either of these is observed:

- two staff independently choose the same inaccurate workaround; or
- one workaround can misstate cash, deposit liability, room availability, OTA status, guest identity, or outstanding debt.

