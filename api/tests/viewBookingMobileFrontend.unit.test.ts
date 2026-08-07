import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const viewBookingSource = () =>
  readFileSync("../frontend/src/features/bookings/ViewBooking.tsx", "utf8");
const viewBookingStyles = () =>
  readFileSync("../frontend/src/features/bookings/ViewBooking.css", "utf8");

test("mobile ViewBooking uses the compact reference header", () => {
  const styles = viewBookingStyles();

  assert.match(
    styles,
    /\.viewBooking__wrapper\s*{[\s\S]*?width: 100vw !important;[\s\S]*?height: calc\(100dvh - 0\.5rem - env\(safe-area-inset-top\)\);[\s\S]*?border-radius: 1rem 1rem 0 0 !important;/,
  );
  assert.match(
    styles,
    /@media \(max-width: 760px\)[\s\S]*?\.viewBooking__top\s*{\s*position: sticky;\s*top: -1\.1rem;[\s\S]*?display: grid;/,
  );
  assert.match(
    styles,
    /\.viewBooking__top\s*{[\s\S]*?background-color: var\(--background\);/,
  );
  assert.ok(styles.includes("margin-left: -1.1rem"));
  assert.ok(styles.includes("margin-right: -1.1rem"));
  assert.ok(styles.includes("padding-top: calc(1.1rem + 0.35rem)"));
  assert.ok(styles.includes("padding-left: 1.1rem"));
  assert.match(
    styles,
    /\.viewBooking__top > \.modalCloseButton\s*{[\s\S]*?position: static;[\s\S]*?align-self: center;[\s\S]*?z-index: 21;/,
  );
  assert.match(
    styles,
    /\.viewBooking__roomAndIsCheckedIn\s*{[\s\S]*?align-items: flex-end;/,
  );
  assert.match(
    styles,
    /\.viewBooking__name\s*{[\s\S]*?min-width: 0;[\s\S]*?overflow: hidden;[\s\S]*?overflow-wrap: anywhere;/,
  );
  assert.match(
    styles,
    /\.viewBooking__roomAndIsCheckedIn\s*{[\s\S]*?max-width: min\(9\.5rem, 36vw\);/,
  );
});

test("mobile ViewBooking actions are two circles and a primary pill", () => {
  const source = viewBookingSource();
  const styles = viewBookingStyles();

  assert.ok(source.includes('className="viewBooking__noteAction"'));
  assert.ok(source.includes('className="viewBooking__mobileMoreAction"'));
  assert.ok(source.includes('"viewBooking__primaryAction"'));
  assert.match(
    styles,
    /\.viewBooking__secondaryActions \.viewBooking__mobileExtendAction\s*{\s*display: none;/,
  );
  assert.match(
    styles,
    /\.viewBooking__secondaryActions \.viewBooking__pinAction\s*{\s*display: none;/,
  );
  assert.match(
    styles,
    /\.viewBooking__actionsRow \.home__action:not\(\.home__actionIconOnly\)\s*{[\s\S]*?min-width: 8\.9rem;/,
  );
});
