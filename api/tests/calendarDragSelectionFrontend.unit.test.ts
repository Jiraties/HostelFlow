import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const source = (relativePath: string) =>
  readFileSync(
    path.resolve(__dirname, "../../frontend/src", relativePath),
    "utf8",
  );

test("calendar preserves click booking and adds pointer range selection", () => {
  const calendar = source("pages/Calendar.tsx");
  const calendarCss = source("pages/Calendar.css");
  assert.match(calendar, /handleAddBooking\(room\.roomId, day\)/);
  assert.match(calendar, /onPointerDown=\{\(event\) =>/);
  assert.match(calendar, /onPointerMove=\{handleSelectionPointerMove\}/);
  assert.match(calendar, /event\.pointerType === "touch"/);
  assert.match(calendar, /selectionContainsNight\(room\.roomId, dayIndex\)/);
  assert.match(calendar, /roomIndexAtPointer\(event\.clientY\)/);
  assert.match(calendar, /startRoomIndex/);
  assert.match(calendar, /clampSelectionRoomIndex/);
  assert.match(calendar, /timeline__selectionGhost/);
  assert.match(calendar, /setDragSelection\(selection\)/);
  assert.match(calendar, /suppressNextClickRef\.current/);
  assert.match(calendarCss, /\.calendar__legend ~ \.timeline__wrapper/);
  assert.doesNotMatch(calendarCss, /\.calendar__legend \+ \.timeline__wrapper/);
});

test("range booking passes both dates into AddBooking", () => {
  const calendar = source("pages/Calendar.tsx");
  const addBooking = source("features/bookings/AddBooking.tsx");
  assert.match(calendar, /checkIn: range\.from,[\s\S]*checkOut: range\.to/);
  assert.match(calendar, /roomIds: range\.roomIds/);
  assert.match(addBooking, /checkOut\?: string \| null/);
  assert.match(addBooking, /checkOut: clickInfo\?\.checkOut \|\| ""/);
});

test("calendar exposes room-block creation, rendering, and release UI", () => {
  const calendar = source("pages/Calendar.tsx");
  const modal = source("features/bookings/RoomBlockModal.tsx");
  assert.match(calendar, /บล็อก[\s\S]*วันที่/);
  assert.match(calendar, /timeline__roomBlockItem/);
  assert.match(calendar, /blocks\?: CalendarRoomBlock\[\]/);
  assert.match(modal, /\/bookings\/room-blocks/);
  assert.match(modal, /\/release/);
  assert.match(modal, /ซ่อมบำรุง/);
  assert.match(modal, /ทำความสะอาด/);
  assert.match(modal, /กันห้องไว้ชั่วคราว/);
  assert.match(modal, /reasonOption === "other"/);
  assert.match(modal, /<Select<OptionType>/);
  assert.match(modal, /styles=\{customStyles<OptionType>\(\)\}/);
  assert.match(modal, /roomBlockModal__dateJourney/);
  assert.match(modal, /เริ่มบล็อก/);
  assert.match(modal, /เปิดให้จอง/);
  assert.match(modal, /roomBlockModal__existingDetails/);
  assert.match(modal, /formatCompactRoomNames\(roomIds\)/);
  assert.match(modal, /maxLength=\{500\}/);
});
