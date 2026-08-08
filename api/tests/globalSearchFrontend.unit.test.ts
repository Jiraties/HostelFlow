import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import path from "node:path";

const frontendRoot = path.resolve(__dirname, "../../frontend/src");
const source = (relativePath: string) =>
  readFileSync(path.join(frontendRoot, relativePath), "utf8");

test("global palette uses desktop sidebar and mobile More triggers with MUI accessible primitives", () => {
  const app = source("App.tsx");
  const header = source("components/PageHeader.tsx");
  const sidebar = source("components/Sidebar.tsx");
  const sidebarStyles = source("components/Sidebar.css");
  const paletteStyles = source("features/search/GlobalSearchPalette.css");
  const palette = source("features/search/GlobalSearchPalette.tsx");
  const context = source("context/CommandPaletteContext.tsx");

  assert.match(app, /<CommandPaletteProvider>/);
  assert.doesNotMatch(header, /pageHeader__searchAction/);
  assert.match(sidebar, /sidebar__searchAction/);
  assert.match(sidebar, /aria-keyshortcuts="Control\+K Meta\+K"/);
  assert.match(sidebar, /mobileMore__item--search/);
  assert.match(sidebar, /requestAnimationFrame\(\(\) => openPalette\(\)\)/);
  assert.match(sidebarStyles, /\.sidebar__searchAction/);
  assert.match(paletteStyles, /width: min\(\d+rem, calc\(100vw - 2rem\)\)/);
  assert.match(context, /event\.metaKey/);
  assert.match(context, /event\.ctrlKey/);
  assert.match(context, /document\.querySelector\("\.MuiModal-root"\)/);
  assert.match(palette, /<Dialog/);
  assert.match(palette, /useAutocomplete<PaletteOption>/);
  assert.match(palette, /filterOptions: \(available\) => available/);
  assert.match(palette, /getOptionProps/);
  assert.match(palette, /open: options\.length > 0/);
  assert.match(palette, /useForkRef\(autocompleteInputProps\.ref, inputRef\)/);
  assert.match(palette, /focus\(\{ preventScroll: true \}\)/);
  assert.match(source("features/search/GlobalSearchPalette.css"), /\.Mui-focusVisible/);
});

test("all MUI input modals default to their first usable field", () => {
  const app = source("App.tsx");
  const autofocus = source("hooks/useModalInputAutofocus.ts");

  assert.match(app, /useModalInputAutofocus\(\)/);
  assert.match(autofocus, /\.MuiModal-root/);
  assert.match(autofocus, /MutationObserver/);
  assert.match(autofocus, /MODAL_FIELD_SELECTOR/);
  assert.match(autofocus, /not\(\[disabled\]\)/);
  assert.match(autofocus, /not\(\[readonly\]\)/);
  assert.match(autofocus, /field\.focus\(\{ preventScroll: true \}\)/);
  assert.match(autofocus, /data-disable-input-autofocus/);
  assert.match(autofocus, /focusedModals/);
});

test("desktop sidebar groups related workflows and anchors settings separately", () => {
  const sidebar = source("components/Sidebar.tsx");
  const styles = source("components/Sidebar.css");

  assert.match(sidebar, /id: "stays"/);
  assert.match(sidebar, /"\/arrivals", "\/departures", "\/calendar", "\/master"/);
  assert.match(sidebar, /id: "tools"/);
  assert.match(sidebar, /sidebar__navGroup/);
  assert.match(sidebar, /sidebar__settingsAction/);
  assert.match(styles, /\.sidebar__navGroup ul/);
  assert.match(styles, /\.sidebar__navItem--active::before/);
  assert.match(styles, /\.sidebar__settingsAction::before/);
  const expandedGroupRule =
    styles.match(/\.sidebar__navGroup ul \{([^}]*)\}/)?.[1] || "";
  assert.doesNotMatch(expandedGroupRule, /box-shadow/);
  assert.match(styles, /\.sidebar__settingsAction/);
  assert.match(styles, /\.sidebar--collapsed \.sidebar__settingsAction/);
  assert.match(styles, /@media \(max-width: 760px\)[\s\S]*\.sidebar__settingsAction/);
});

test("admin Manage navigation shows the canonical review queue badge", () => {
  const sidebar = source("components/Sidebar.tsx");
  const styles = source("components/Sidebar.css");
  const manage = source("pages/Manage.tsx");

  assert.match(sidebar, /finance\/review-events\/count/);
  assert.match(sidebar, /item\.link === "\/manage"/);
  assert.match(sidebar, /sidebar__notificationBadge/);
  assert.match(sidebar, /reviewQueueCount > 99 \? "99\+"/);
  assert.match(sidebar, /REVIEW_QUEUE_UPDATED_EVENT/);
  assert.match(styles, /background: var\(--red\)/);
  assert.match(styles, /\.sidebar--collapsed \.sidebar__notificationBadge/);
  assert.match(sidebar, /sidebar__notificationBadge--mobileNav/);
  assert.match(
    styles,
    /\.mobileNav__item \.sidebar__notificationBadge--mobileNav/,
  );
  assert.ok(
    (manage.match(/notifyReviewQueueUpdated\(\)/g) || []).length >= 2,
    "transaction approval and cash-audit acknowledgement both refresh the badge",
  );
  assert.match(manage, /reviewEventKind\?: "transactionCorrection"/);
  assert.match(manage, /correctionId=\$\{encodeURIComponent/);
  assert.match(manage, /material_amount_correction/);
});

test("dashboard header always shows the full Bangkok date", () => {
  const dashboard = source("pages/Main.tsx");

  assert.match(dashboard, /timeZone: "Asia\/Bangkok"/);
  assert.match(dashboard, /formatDashboardHeaderDate/);
  assert.match(dashboard, /day: "2-digit"/);
  assert.match(dashboard, /month: "long"/);
  assert.match(dashboard, /weekday: "long"/);
  assert.match(dashboard, /year: "numeric"/);
  assert.match(dashboard, /title=\{fullFormattedDate\}/);
  assert.match(dashboard, /setInterval\([\s\S]{0,80}60_000/);
});

test("palette protects IME input and controls request timing and stale responses", () => {
  const palette = source("features/search/GlobalSearchPalette.tsx");

  assert.match(palette, /new AbortController\(\)/);
  assert.match(palette, /window\.setTimeout\(request, 250\)/);
  assert.match(palette, /setShowLoading\(true\), 200/);
  assert.match(palette, /requestSequenceRef\.current !== sequence/);
  assert.match(palette, /onCompositionStart/);
  assert.match(palette, /onCompositionEnd/);
  assert.match(palette, /nativeEvent\.isComposing/);
  assert.match(palette, /handleHomeEndKeys: true/);
  assert.match(palette, /autoHighlight: true/);
});

test("recent storage is user-namespaced and contains identifiers and timestamps only", () => {
  const recents = source("helpers/recentBookings.ts");

  assert.match(recents, /hostelflow:recent-bookings:\$\{userId\}/);
  assert.match(recents, /bookingId: string/);
  assert.match(recents, /openedAt: number/);
  assert.match(recents, /MAX_RECENT_BOOKINGS = 8/);
  assert.doesNotMatch(recents, /guestName|passport|transaction|amount/);
});

test("one typed resolver owns booking, transaction, action, and room destinations", () => {
  const resolver = source("helpers/searchDestinations.ts");
  const types = source("types/searchTypes.ts");

  assert.match(types, /kind: "bookingTransaction"/);
  assert.match(types, /kind: "bookingAction"/);
  assert.match(types, /kind: "room"/);
  assert.match(types, /kind: "transaction"; transactionId: string/);
  assert.match(types, /kind: "roomDate"; roomId: string; date: string/);
  assert.match(resolver, /pathname: "\/master"/);
  assert.match(resolver, /params\.set\("transactionId"/);
  assert.match(resolver, /params\.set\("action"/);
  assert.match(resolver, /pathname: "\/calendar"/);
  assert.match(resolver, /params\.set\("room"/);
  assert.match(resolver, /params\.set\("date"/);
});

test("transaction and room highlights announce, scroll once, and preserve normal focus", () => {
  const viewBooking = source("features/bookings/ViewBooking.tsx");
  const calendar = source("pages/Calendar.tsx");

  for (const consumer of [viewBooking, calendar]) {
    assert.match(consumer, /aria-live="polite"/);
    assert.match(consumer, /aria-current=/);
    assert.match(consumer, /scrollIntoView/);
    assert.doesNotMatch(consumer, /target\.focus\(/);
  }
  assert.match(viewBooking, /data-search-transaction-id/);
  assert.match(viewBooking, /ไม่พบรายการที่ตรงกัน/);
  assert.match(calendar, /data-search-room-id/);
  assert.match(calendar, /data-search-date/);
  assert.match(calendar, /ไม่พบห้องหรือวันที่ที่ตรงกัน/);
});

test("transaction search results reuse the ViewBooking icon and color map", () => {
  const palette = source("features/search/GlobalSearchPalette.tsx");
  const viewBooking = source("features/bookings/ViewBooking.tsx");
  const display = source("helpers/transactionDisplay.ts");

  assert.match(palette, /getTransactionDisplay\(result\.type\)\.icon/);
  assert.match(palette, /getTransactionDisplay\(result\.type\)\.color/);
  assert.match(viewBooking, /transactionMap/);
  assert.match(viewBooking, /helpers\/transactionDisplay/);
  assert.match(display, /roomCharge: \{ icon: "bx-bed-alt"/);
  assert.match(display, /fallbackTransactionDisplay/);
});

test("palette supports add slash commands and marks transaction booking-pick mode", () => {
  const palette = source("features/search/GlobalSearchPalette.tsx");
  const styles = source("features/search/GlobalSearchPalette.css");

  assert.match(palette, /aliases: \["\/addBooking"\]/);
  assert.match(palette, /aliases: \["\/addTransaction"\]/);
  assert.match(palette, /normalizedQuery\.startsWith\("\/"\)/);
  assert.match(palette, /className=\{`globalSearch__modeTag/);
  assert.match(palette, /เพิ่ม Transaction/);
  assert.match(styles, /\.globalSearch__modeTag/);
});

test("mode tags are centrally configured and removable like input text", () => {
  const palette = source("features/search/GlobalSearchPalette.tsx");
  const context = source("context/CommandPaletteContext.tsx");

  assert.match(palette, /const modeTags: Partial</);
  assert.match(palette, /event\.key === "Backspace" \|\| event\.key === "Delete"/);
  assert.match(palette, /onClick=\{clearModeTag\}/);
  assert.match(palette, /onMouseDown=\{\(event\) => event\.preventDefault\(\)\}/);
  assert.match(context, /setMode\("search"\)/);
  assert.match(context, /onClearMode=\{clearPaletteMode\}/);
});

test("palette result dates respect the authenticated user's date format", () => {
  const palette = source("features/search/GlobalSearchPalette.tsx");

  assert.match(palette, /user\?\.settings\.dateFormat \|\| "dd\/MM\/yyyy"/);
  assert.match(palette, /formatDisplayDate\(result\.checkIn, dateFormat\)/);
  assert.match(palette, /formatDisplayDate\(result\.businessDate, dateFormat\)/);
  assert.match(palette, /formatDisplayDate\(result\.date, dateFormat\)/);
  assert.doesNotMatch(palette, /new Intl\.DateTimeFormat\("th-TH"/);
});

test("check-in slash mode provides preferred-format typing and a calendar picker", () => {
  const palette = source("features/search/GlobalSearchPalette.tsx");
  const context = source("context/CommandPaletteContext.tsx");
  const modeTypes = source("context/commandPalette.ts");

  assert.match(modeTypes, /"checkInDate"/);
  assert.match(palette, /aliases: \["\/check-in"\]/);
  assert.match(palette, /formatDateModeDraft/);
  assert.match(palette, /dateFormatPlaceholder\(dateFormat\)/);
  assert.match(palette, /type="date"/);
  assert.match(palette, /bookingDateField: dateField/);
  assert.match(context, /setMode\("checkInDate"\)/);
});

test("check-out slash mode mirrors preferred-format check-in date search", () => {
  const palette = source("features/search/GlobalSearchPalette.tsx");
  const context = source("context/CommandPaletteContext.tsx");
  const modeTypes = source("context/commandPalette.ts");

  assert.match(modeTypes, /"checkOutDate"/);
  assert.match(palette, /aliases: \["\/check-out"\]/);
  assert.match(palette, /label: "Check-out"/);
  assert.match(palette, /\? "checkIn"[\s\S]{0,80}: mode === "checkOutDate"/);
  assert.match(context, /setMode\("checkOutDate"\)/);
});

test("global search and AddBooking share the numeric date draft formatter", () => {
  const palette = source("features/search/GlobalSearchPalette.tsx");
  const bookingDates = source("features/bookings/BookingDateRangePicker.tsx");

  assert.match(palette, /formatNumericDateDraft\(value, previousValue\)/);
  assert.match(bookingDates, /formatNumericDateDraft\(event\.target\.value, checkInDraft\)/);
  assert.match(bookingDates, /formatNumericDateDraft\(event\.target\.value, checkOutDraft\)/);
});

test("Tab toggles an actions-only command mode without clearing the query", () => {
  const palette = source("features/search/GlobalSearchPalette.tsx");
  const context = source("context/CommandPaletteContext.tsx");
  const modeTypes = source("context/commandPalette.ts");

  assert.match(modeTypes, /"commands"/);
  assert.match(palette, /label: "คำสั่ง"/);
  assert.match(palette, /mode === "commands"[\s\S]{0,80}\? "ค้นหาคำสั่ง"/);
  assert.match(palette, /event\.key === "Tab"/);
  assert.match(palette, /mode === "search" \|\| mode === "commands"/);
  assert.match(palette, /if \(mode === "commands"\) return \[\]/);
  assert.match(context, /currentMode === "commands" \? "search" : "commands"/);
  assert.doesNotMatch(context, /toggleCommandMode[\s\S]{0,200}setQuery/);
});

test("commands use semantic action accents while command mode stays generic", () => {
  const palette = source("features/search/GlobalSearchPalette.tsx");
  const styles = source("features/search/GlobalSearchPalette.css");

  assert.doesNotMatch(palette, /globalSearch__modeTag--commands/);
  assert.match(palette, /commandColorClass/);
  assert.match(palette, /globalSearch__option--action-/);
  assert.match(palette, /globalSearch__option--command/);
  assert.match(palette, /globalSearch__optionIcon--command/);
  assert.match(styles, /--global-search-transaction-action-color/);
  assert.match(styles, /--global-search-transaction-action-color: #22c55e/);
  assert.match(styles, /--global-search-sale-action-color/);
  assert.match(styles, /--global-search-navigation-action-color/);
  assert.match(styles, /--global-search-date-action-color/);
  assert.match(styles, /--global-search-action-color: var\(--primary-color\)/);
  assert.doesNotMatch(
    styles,
    /globalSearch__option--command \.globalSearch__optionCopy strong/,
  );
  assert.doesNotMatch(styles, /global-search-command-color/);
  assert.match(styles, /\.globalSearch__option--command\.Mui-focused/);
  assert.match(
    styles,
    /\.globalSearch__option--command\.Mui-focusVisible \{[\s\S]{0,100}outline: 2px solid/,
  );
});

test("follow-up mode tags inherit their command category color", () => {
  const palette = source("features/search/GlobalSearchPalette.tsx");
  const styles = source("features/search/GlobalSearchPalette.css");

  assert.match(palette, /modeTagColorClass/);
  assert.match(palette, /bookingPick[\s\S]{0,80}modeTag--transaction/);
  assert.match(palette, /checkInDate[\s\S]{0,100}modeTag--date/);
  assert.match(styles, /\.globalSearch__modeTag--transaction/);
  assert.match(styles, /\.globalSearch__modeTag--date/);
});

test("room results use a distinct room accent", () => {
  const palette = source("features/search/GlobalSearchPalette.tsx");
  const styles = source("features/search/GlobalSearchPalette.css");

  assert.match(palette, /globalSearch__option--room/);
  assert.match(palette, /globalSearch__optionIcon--room/);
  assert.match(styles, /--global-search-room-color: #5fa8d3/);
  assert.match(styles, /\.globalSearch__option--room\.Mui-focused/);
  assert.match(
    styles,
    /\.globalSearch__option--room\.Mui-focusVisible \{[\s\S]{0,100}outline: 2px solid/,
  );
});
