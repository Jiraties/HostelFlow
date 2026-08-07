import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = () =>
  readFileSync("../frontend/src/features/bookings/ViewBooking.tsx", "utf8");
const styles = () =>
  readFileSync("../frontend/src/features/bookings/ViewBooking.css", "utf8");

test("mobile booking summary groups stay essentials without changing their data", () => {
  const markup = source();

  assert.ok(markup.includes('useMediaQuery("(max-width:760px)")'));
  assert.ok(markup.includes('className="viewBooking__staySummary"'));
  assert.ok(markup.includes("viewBooking__item--checkIn"));
  assert.ok(markup.includes("viewBooking__item--checkOut"));
  assert.ok(markup.includes("viewBooking__item--room"));
  assert.ok(markup.includes("viewBooking__item--staff"));
  assert.ok(markup.includes("formatDisplayDate(data.checkIn, dateFormat)"));
  assert.ok(markup.includes("formatDisplayDate(data.checkOut, dateFormat)"));
  assert.ok(markup.includes("resolveStaffName(data.staffUsername)"));
  assert.ok(markup.includes("!isMobileView && identitySection"));
  assert.ok(markup.includes("isMobileView && identitySection"));
  assert.ok(markup.includes('className="viewBooking__mobileIdentity"'));
});

test("mobile main-left panel becomes a native summary layout", () => {
  const css = styles();

  assert.match(
    css,
    /@media \(max-width: 760px\)[\s\S]*?\.viewBooking__mainLeft\s*{[\s\S]*?padding: 0;[\s\S]*?box-shadow: none;/,
  );
  assert.match(
    css,
    /\.viewBooking__staySummary\s*{[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);[\s\S]*?box-shadow: var\(--light-shadow\);/,
  );
  assert.match(
    css,
    /\.viewBooking__item--channel\s*{[\s\S]*?box-shadow: var\(--light-shadow\);/,
  );
  assert.match(
    css,
    /\.viewBooking__mobileIdentity\s*{[\s\S]*?display: grid;[\s\S]*?margin-top: 1\.5rem;/,
  );
});

test("channel dates center against the full channel details on mobile", () => {
  const css = styles();

  assert.match(
    css,
    /@media \(max-width: 480px\)[\s\S]*?\.viewBooking__channelDetails\s*{\s*padding-right: min\(9rem, 38vw\);[\s\S]*?\.viewBooking__channelDates\s*{[\s\S]*?position: absolute;[\s\S]*?top: 50%;[\s\S]*?right: 0;[\s\S]*?transform: translateY\(-50%\);/,
  );
});

test("mobile payment methods stay centered in transaction rows", () => {
  const css = styles();

  assert.match(
    css,
    /@media \(max-width: 760px\)[\s\S]*?\.viewBooking__price,[\s\S]*?\.viewBooking__priceChild\s*{\s*align-items: center;/,
  );
  assert.match(
    css,
    /\.viewBooking__paymentMethod\s*{\s*align-self: center;\s*justify-content: center;/,
  );
});
