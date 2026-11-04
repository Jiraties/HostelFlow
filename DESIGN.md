# HostelFlow interface design reference

This guide captures the existing home dashboard, ViewBooking modal, and shared form language so future screens feel like the same application. It is based on the current working tree, including local ViewBooking changes. It describes source behavior; rendered geometry has not been verified for this document.

Use this alongside [the broader design system](docs/hostelflow-design-system.md). The linked components and styles are authoritative when implementation changes. Values below are existing patterns, not a new token system. Accessibility guidance marked as a requirement for new work does not imply every existing screen already meets it.

## 1. The visual essence

A calm, practical front desk workspace: clear information, soft white surfaces, generous but useful spacing, and a small number of obvious actions. The home page helps staff decide what needs attention. ViewBooking brings one booking into focus and supports the next action without losing its context.

- Use **IBM Plex Sans Thai** for Thai, English, numbers, and controls; body weight `400`, line height `1.5`.
- Use black primary text and muted supporting text. Reserve medium or semibold weight for titles, important values, and selected states.
- Build hierarchy with spacing, grouping, and type size. Keep most surfaces white or soft neutral.
- Use cyan for the primary action and active controls; red for destructive actions and errors; green for positive states.
- Reuse Boxicons (`bx`) and existing components. Keep icons functional and visually secondary to the information.
- Keep Thai workflow copy concise. Retain familiar terms such as Booking, Check-In, Check-Out, and No-Show where the owning screen uses them.

### Shared foundations

| Foundation | Existing value or pattern |
| --- | --- |
| Primary | `--primary-color: #51d1dc` |
| Main surface / inset surface | `--background: #fff` / `--light-background: #f6f6f6` |
| Main text | `--text: #000` |
| Positive / destructive | `--green: rgb(30, 203, 131)` / `--red: #fd4169` |
| Field validation | `--field-error-color: #dc2626` |
| Dashboard shadow | `--light-shadow`: `rgba(149, 157, 165, 0.129) 0 8px 24px` |
| Form and floating surface shadow | `--main-shadow`: `rgba(149, 157, 165, 0.25) 0 8px 24px` |
| Dashboard card radius | Commonly `1.5rem` |
| Modal / basic input radius | `1rem` / `0.5rem` |
| Action radius | `2rem`; circular for icon-only actions |

Muted text colors vary by component; there is no single global muted token. Use existing variables where available and the closest owning stylesheet for local values. Pair semantic color with readable text or an icon.

## 2. Home page: overview first, work next

The actual `/` route renders [Main.tsx](frontend/src/pages/Main.tsx), styled by [Main.css](frontend/src/pages/Main.css) and shared [Home.css](frontend/src/pages/Home.css). The component named `Home` serves Arrivals, Departures, and the master booking list; it is a related operational reference rather than the root dashboard.

### Composition and rhythm

Read the page from top to bottom:

1. **PageHeader:** the date anchors the day; refresh, last-updated information, and profile controls use the shared header.
2. **Quick actions:** left-aligned, wrapping row. `เพิ่มการจองใหม่` is the cyan highlighted action; `เพิ่มรายการใช้จ่ายแขกนอก` is secondary.
3. **Compact statistics:** a repeated card grid with muted labels, prominent figures, and helper explanations. Reuse `StatCard` for loading and value presentation.
4. **Today's overview:** a larger revenue panel with a clear total and subordinate breakdown or service chips. Details stay inside the relevant panel.
5. **Admin monthly overview:** role-gated revenue, trend, occupancy, and channel panels, with the month control alongside the section heading. Preserve the distinction between each metric's meaning.
6. **Cash-shift panel:** a rounded section with icon, status, supporting metadata, and an expand control; detailed inputs and the action stay together when expanded.
7. **Today's work lists:** review items, arrivals, and departures. When review items exist, they take the leading position; arrivals and departures remain visible in the adjacent stack.

Desktop page padding is `2.5rem`; the dashboard uses a `1.5rem` section gap. The statistics grid begins with five columns and `1rem` gaps; cards use `1rem` padding and a light shadow. Larger panels group their own title, content, and controls rather than repeating a page-level toolbar.

### What to preserve

- Let figures lead and helper text support them. Avoid making every label bold.
- Keep each panel's controls near its heading and its detail link near its content.
- Keep loading, empty, and review states legible. An empty work list should explain that there is nothing to handle.
- Allow long names and metadata to wrap without pushing the layout wider. Use `min-width: 0` and `minmax(0, 1fr)` where appropriate.
- Keep the desktop sidebar and independent main-page scroll. On mobile, preserve the navigation dock and safe-area space.
- Reflow the dashboard using its existing `1180px`, `920px`, `720px`, and `520px` adjustments. Do not force one breakpoint across unrelated components.

## 3. ViewBooking: one focused record

Use [ViewBooking.tsx](frontend/src/features/bookings/ViewBooking.tsx) and [ViewBooking.css](frontend/src/features/bookings/ViewBooking.css) as the reference for a detailed modal view.

### Desktop structure

The white modal is centered over the backdrop, with `1rem` corners, `2rem` padding, width `min(50rem, calc(100vw - 2rem))`, and maximum height `calc(100vh - 2rem)`. Its content scrolls when necessary.

The hierarchy is:

1. **Identity and state:** guest name, room context, and compact status badges. Status uses a dot plus text; room-release information remains distinguishable from booking status.
2. **Two equal content columns:** `1fr 1fr`, separated by `1.5rem`.
3. **Left: booking context.** Note, channel journey and booking reference, stay dates, nights, room information, and identity sections. The desktop inset panel has `1rem` padding, `1rem` corners, a main shadow, and its own vertical scroll.
4. **Right: transactions and room stays.** Keep transaction labels, payment meaning, amounts, correction history, and contextual actions grouped. Use bounded list scrolling and the existing overflow affordance for long lists.
5. **Bottom: utility actions on the left, the next lifecycle action on the right.**

Use quiet labels such as `ช่องทางการจอง:`, `Check-In`, `Check-Out`, and `ห้อง`, with the value visually stronger. Actual-event times and correction details are supporting information. Preserve the visible distinction between an original entry and its correction.

### Action placement

| Action type | Placement and treatment |
| --- | --- |
| More actions | Left utility group; opens a contextual menu |
| Note, print, pin | Left utility group; compact icon controls with accessible names |
| Extend stay | Desktop: beside the lifecycle action; mobile: compact utility action |
| Check In / Check Out | Right group; cyan highlighted for the normal next action |
| Late Check In / Early Check Out | Same primary position, with the existing exceptional-state treatment |
| No-Show | Contextual alternative beside the lifecycle action, with a red icon |
| Transaction correction / receive payment | Beside the relevant transaction |
| Rare, admin, corrective, or destructive work | More-actions menu, with grouping, eligibility, and Admin tags retained |

Action visibility and disabled states follow the booking state and permissions. In the current local implementation, general booking edits are limited to active pre-check-in bookings; voiding is restricted when recorded payments exist; voided records have restricted correction actions. Preserve these guards and their explanations. This document does not redefine financial or lifecycle rules.

### Mobile structure

At `760px` and below, ViewBooking becomes a near-full-height, full-width bottom sheet with rounded top corners.

- The sticky header keeps identity, status, and the close control available.
- Main content stacks into one column. The desktop left-panel containment and inner scroll are removed, allowing its content to participate in the sheet scroll.
- Channel details become their own light card; the stay summary becomes a compact two-column group.
- The bottom action area is sticky, white, and padded for the safe area. Compact utility controls stay left; the main lifecycle action stays right.
- Keep important actions reachable without hiding the final content rows. Preserve the existing mobile redistribution of utility actions into the More menu.
- Use `ModalCloseButton`; its standard circular target is `2.75rem` with a CSS fallback. The shared control is mobile-only; ViewBooking positions it inside the header.

## 4. Standard forms, fields, and labels

Use [AddBooking](frontend/src/features/bookings/AddBooking.tsx) and [its stylesheet](frontend/src/features/bookings/AddBooking.css) for the base form rhythm. Reuse focused forms such as Check-In, Check-Out, and CorrectCheckIn for workflow-specific summaries and confirmation steps.

### Field anatomy

Keep a predictable vertical sequence: **visible label → control → helper or validation text**.

| Element | Reusable source / convention |
| --- | --- |
| Text, number, textarea | `.boxInput` in [index.css](frontend/src/index.css): full width, `1rem` padding, no border, `0.5rem` radius, main shadow |
| Field label | `.addBooking__label`: `0.5rem` space below; regular readable text |
| Helper | `.addBooking__fieldHelper`: muted, `0.82rem`, `0.5rem` top spacing |
| Select | `react-select` with [customStyles](frontend/src/helpers/selectStyling.ts); `3.3rem` minimum control height, shared font, radius, and shadow |
| Checkbox | The shared `.checkbox` and `.box` pattern in [BookingCheckbox.css](frontend/src/features/bookings/BookingCheckbox.css), using a native checkbox and a visible, centered checkmark |
| Date | [PreferredDateInput](frontend/src/components/PreferredDateInput.tsx) for preference-aware dates; booking forms use [BookingDateRangePicker](frontend/src/features/bookings/BookingDateRangePicker.tsx) for stay ranges |
| Month | [MonthInput](frontend/src/components/MonthInput.tsx), using the same [MonthPickerPanel](frontend/src/components/MonthPickerPanel.tsx) as the calendar page |
| Error | `.formField__error`, `.boxInput--error`, and `.formField--error` |
| Primary / secondary action | [ActionButton](frontend/src/components/ActionButton.tsx) |

Forms commonly use two equal columns with `2rem` gaps on desktop. AddBooking collapses to one column at `720px`, with `1.25rem` gaps. Keep related controls together, such as Check-In/Check-Out and nights, or amount and payment method. Retain the owning form's responsive rules.

Reuse the calendar page's custom month grid for month selection and the existing booking-calendar appearance for single dates. Do not introduce MUI picker surfaces or browser-native date/month dialogs. Use the existing `react-select` pattern for dropdowns; retain styled text/number inputs and the shared checkboxes. Calendar controls exchange `YYYY-MM` or `YYYY-MM-DD` strings without UTC conversion and preserve their owning screen's date limits and display preference.

Use the same `2rem` field spacing in transaction, correction, and additional-guest forms; use `1.25rem` when those forms stack on narrow screens. Related controls and summary rows may remain closer together. Use the primary color for visible focus treatments on native inputs and shared selects.

Use explicit, short labels: `ชื่อ-สกุล`, `Check-In`, `Check-Out`, `ห้อง`, and `ช่องทางการจอง`. Use the owning form's established money and payment labels. Place units beside the relevant input or value. Placeholder examples supplement the label. State optionality or a constraint where it helps the user decide what to enter.

For new work, associate labels with controls using `label`/`htmlFor` and IDs, and connect helper/error text through `aria-describedby`. Some existing forms use styled paragraphs as labels; reuse their appearance while providing semantic associations. Use `fieldset` and `legend` for related choices, as in deposit-outcome selection.

Use the shared checkbox pattern throughout the app, including future screens: place the native checkbox immediately before its decorative `.box` inside a labelled `.checkbox`, preserve keyboard focus and disabled states, and allow long labels to wrap. The surrounding layout may change to fit its workflow.

Form segmented controls use a soft gray inset track with a raised white selected segment. The remaining-nights room-status control retains its white split surface and green/red selected label and icon. For choices with explanations, reuse the stacked `formChoiceGroup` and `formChoice` radio rows in [index.css](frontend/src/index.css): borderless white shadowed surfaces, regular text, muted helpers, and a primary-color check icon when selected. Preserve native radio interaction and any additional confirmations. Form summaries use a raised white surface, with the section label above it where present. These patterns reflect the current source and still require rendered verification.

Select menus may use `menuPortalTarget={document.body}` and the shared portal layer (`z-index: 9999`) when needed to escape clipping. Keep keyboard navigation and dialog focus behavior working together.

### Form actions

- Put the primary completion action at the bottom right on desktop. AddBooking uses `.addBooking__submit` with `margin-left: auto` and content-sized width.
- Keep secondary back/cancel controls before the primary action when the owning form provides them. Closing and submitting are separate controls.
- On mobile, AddBooking's submit becomes full width; many focused forms use the shared sticky bottom action row in [App.css](frontend/src/App.css). Follow the owning form rather than applying a sticky footer indiscriminately.
- Disable the operation while submitting; preserve draft values on failure. Use the existing `toast.promise` loading/success/error pattern where the workflow uses it.
- Use [UnsavedChangesModal](frontend/src/components/UnsavedChangesModal.tsx) and the existing dirty-state close helpers when closing could discard edits.
- Preserve preview → explanation → explicit confirmation for corrective workflows. CorrectCheckIn shows the deposit outcome, blockers, and resulting state before submission.

### Writing for decisions

- Before adding an eyebrow, description, subtitle, or helper, check whether it helps the user make a decision, take an action, or understand a non-obvious result. Omit copy that repeats the heading, explains an obvious workflow, or only decorates the layout.
- Use at least `1rem` for main interface text, field labels, readiness messages, and counts. Smaller text is reserved for secondary metadata that is useful and does not need to lead the task.
- Use short, direct Thai to say what the person needs to choose and what will happen after confirmation. Keep familiar terms such as Booking and Check-In.
- Summarize the consequences that matter to the decision. Avoid repeating the guest's identity or restating the same explanation in both the choice and summary.
- Keep financial effects precise: distinguish a correction to a recorded amount from recording money already returned. Keep necessary warnings, blockers, and explicit confirmations even when shortening copy.
- Prefer plain action labels and brief, scannable lines over technical or audit-process details. Retain history in the application without explaining it repeatedly in every form.

## 5. Buttons and confirmation hierarchy

`ActionButton` is the standard action control: inherited font, `1rem` padding, `0.5rem` internal gap, `2rem` corners, and main shadow. Text precedes the icon in the current component.

| State | Appearance and behavior |
| --- | --- |
| Primary (`highlight`) | Cyan surface, white text and icon |
| Secondary | White surface, normal text, cyan icon |
| Icon-only (`text=""`) | Circular; `3.35rem` desktop, `3rem` at `520px` and below; provide `ariaLabel` or meaningful tooltip/mobile text |
| Disabled | Neutral gray surface/text/icon, no shadow, native `disabled`, no hover transform |
| Destructive confirmation | Existing red treatment in [ConfirmationModal](frontend/src/components/ConfirmationModal.tsx); explicit action text and consequence |

Keep a single visually dominant completion action per task. Do not make every utility cyan-filled. Put destructive operations inside their established confirmation flow and retain explanatory disabled states. The confirmation action row uses reversed flex direction; inspect the resulting visual order when extending it.

## 6. Validation, error animation, and motion

### Existing booking-form errors

Booking forms use **persistent inline feedback**: a `1px` red outline on the invalid input or select, plus a `0.82rem` error message beneath it. Use `aria-invalid` and a specific explanation of what to fix. An operation-level toast can supplement the field message. Do not remove entered values when validation fails.

There is currently **no shared booking-form shake animation** in the inspected sources. Do not document shaking every input or the whole modal as established behavior.

### Existing login error animation

[Login.tsx](frontend/src/pages/Login.tsx) applies `.shake` to its error banner when login fails. [Login.css](frontend/src/pages/Login.css) defines a single `350ms ease-in-out` horizontal shake:

| Progress | Horizontal offset |
| --- | --- |
| 0% | `0` |
| 20% | `-5px` |
| 40% | `5px` |
| 60% | `-4px` |
| 80% | `4px` |
| 100% | `0` |

The banner retains readable error text and alert semantics. If this pattern is deliberately reused, animate the error feedback once per failed attempt and keep the rest of the form stable. For new work, add a `prefers-reduced-motion: reduce` override; the inspected login shake itself has no dedicated reduced-motion override.

### Modal and control motion

- Shared [MotionModal](frontend/src/components/MotionModal.tsx) and [MotionDropdown](frontend/src/components/MotionDropdown.tsx) use the BMA PR motion settings in [surfaceMotion.css](frontend/src/styles/surfaceMotion.css): modals open in `200ms` and close in `150ms` at scale `0.98`; dropdowns open in `160ms` and close in `120ms`, with `translateY(-4px)` and scale `0.97` at both ends. Both use `cubic-bezier(0.25, 1, 0.5, 1)` easing; dropdown origin aligns to the trigger.
- Mobile modals retain the bottom-sheet layout and use the same centered scale motion as desktop. Backdrops follow the same open/close timings. Shared [MotionSelect](frontend/src/components/MotionSelect.tsx) menus use the same dropdown entrance and exit; exiting options immediately become inert and leave the accessibility tree.
- Reduced-motion preferences disable surface movement and transition waiting. Finished surfaces release their transform so fixed calendars and mobile action sheets keep their viewport positioning. The replaced ViewBooking skeleton does not replay the outer modal entrance.
- Legacy `.boxButton` has `200ms` hover/press scaling (`1.05` / `0.97`); `ActionButton` does not define the same scale behavior in its base stylesheet. Preserve component-specific behavior instead of assuming one global animation.
- Avoid hover movement on touch-only devices. For any new motion, respect reduced-motion preferences and keep error text available after the motion ends.

## 7. Consistency checks for future work

1. Start from Main for overview pages, ViewBooking for detailed modal views, and AddBooking or the closest focused workflow for forms.
2. Preserve typography, neutral surfaces, cyan emphasis, spacing, and action placement.
3. Check long labels, narrow screens, scrolling, sticky headers/footers, select portals, and safe areas in the rendered UI.
4. Check focus visibility, accessible names, semantic labels, inline errors, disabled states, loading feedback, and reduced motion. Preserve the existing [modal input autofocus hook](frontend/src/hooks/useModalInputAutofocus.ts), focus handling, and unsaved-change flows.
5. Keep production records, screenshots, operational figures, and personal data out of design examples. Use clearly fabricated content when examples are needed.
6. Report source review and visual verification separately. A stylesheet review alone does not establish the rendered result.
