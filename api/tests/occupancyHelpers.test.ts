import assert from "node:assert/strict";
import test from "node:test";

import { occupiedCapacityOnDate } from "../src/controller/booking";
import type { booking } from "../src/models/booking";

const dayStart = new Date("2026-07-18T00:00:00.000Z");
const dayEnd = new Date("2026-07-19T00:00:00.000Z");

const occupancyBooking = (roomIds: string[]) =>
  ({
    status: "booked",
    roomStays: [
      {
        roomIds,
        from: new Date("2026-07-18T00:00:00.000Z"),
        to: new Date("2026-07-19T00:00:00.000Z"),
      },
    ],
  }) as booking;

test("occupancy counts each active physical room only once", () => {
  const bookings = [
    occupancyBooking(["Balcony", "Siesta 1"]),
    occupancyBooking(["Balcony", "Siesta 1", "Window"]),
  ];

  assert.equal(occupiedCapacityOnDate(bookings, dayStart, dayEnd), 5);
});

test("occupancy excludes room IDs outside the active inventory", () => {
  const bookings = [occupancyBooking(["Siesta 1", "Legacy Room"])];

  assert.equal(occupiedCapacityOnDate(bookings, dayStart, dayEnd), 1);
});
