import assert from "node:assert/strict";
import test from "node:test";

import {
  occupancySummaryForRange,
  occupiedCapacityOnDate,
} from "../src/controller/booking";
import type { booking } from "../src/models/booking";
import { HOUSE_USE_ROOM_BLOCK_REASON, type roomBlock } from "../src/models/roomBlock";

const dayStart = new Date("2026-07-17T17:00:00.000Z");
const dayEnd = new Date("2026-07-18T17:00:00.000Z");
const secondDayEnd = new Date("2026-07-19T17:00:00.000Z");
const thirdDayEnd = new Date("2026-07-20T17:00:00.000Z");

const occupancyBooking = (
  roomIds: string[],
  overrides: Partial<booking> = {},
) =>
  ({
    status: "booked",
    roomStays: [
      {
        roomIds,
        from: dayStart,
        to: dayEnd,
      },
    ],
    ...overrides,
  }) as booking;

const occupancyBlock = (overrides: Partial<roomBlock> = {}) => ({
  roomIds: ["Balcony"],
  from: dayStart,
  to: thirdDayEnd,
  reason: HOUSE_USE_ROOM_BLOCK_REASON,
  reasonType: "house_use" as const,
  ...overrides,
});

test("internal-use blocks count full room capacity without duplicating bookings or blocks", () => {
  const blocks = [
    occupancyBlock(),
    occupancyBlock({ roomId: "Balcony", roomIds: undefined }),
    occupancyBlock({ roomIds: ["Siesta 1", "Legacy Room"] }),
  ];
  assert.equal(
    occupiedCapacityOnDate([occupancyBooking(["Balcony"])], dayStart, dayEnd, blocks),
    3,
  );
});

test("other block types change neither occupied nor available bed-nights", () => {
  const blocks = (["temporary_hold", "cleaning", "maintenance", "other"] as const)
    .map((reasonType) => occupancyBlock({ reasonType }));
  const summary = occupancySummaryForRange([], dayStart, thirdDayEnd, blocks);
  assert.equal(summary.occupiedBedNights, 0);
  assert.equal(summary.availableBedNights, 156);
  assert.equal(summary.occupancyRate, 0);
});

test("legacy internal-use blocks require the exact saved label and no explicit category", () => {
  assert.equal(occupiedCapacityOnDate([], dayStart, dayEnd, [
    occupancyBlock({ reasonType: undefined }),
  ]), 2);
  assert.equal(occupiedCapacityOnDate([], dayStart, dayEnd, [
    occupancyBlock({ reasonType: undefined, reason: "ใช้ภายใน" }),
    occupancyBlock({ reasonType: "other" }),
  ]), 0);
});

test("internal-use stays are half-open and retain past nights after early release", () => {
  const blocks = [occupancyBlock({
    releasedAt: new Date("2026-07-19T05:00:00.000Z"),
  })];
  assert.equal(occupiedCapacityOnDate([], dayStart, dayEnd, blocks), 2);
  assert.equal(occupiedCapacityOnDate([], dayEnd, secondDayEnd, blocks), 0);
  const summary = occupancySummaryForRange([], dayStart, thirdDayEnd, blocks);
  assert.equal(summary.occupiedBedNights, 2);
  assert.equal(summary.availableBedNights, 156);
});

test("release uses Bangkok's date and a block cancelled before its start never counts", () => {
  // This UTC timestamp is already 19 July in Bangkok.
  const blocks = [occupancyBlock({
    releasedAt: new Date("2026-07-18T18:00:00.000Z"),
  })];
  assert.equal(occupiedCapacityOnDate([], dayStart, dayEnd, blocks), 2);
  assert.equal(occupiedCapacityOnDate([], dayEnd, secondDayEnd, blocks), 0);
  assert.equal(occupancySummaryForRange([], dayStart, thirdDayEnd, [
    occupancyBlock({ releasedAt: new Date("2026-07-17T05:00:00.000Z") }),
  ]).occupiedBedNights, 0);
});

test("release after a block's planned end does not extend its occupancy", () => {
  const blocks = [occupancyBlock({
    to: dayEnd,
    releasedAt: new Date("2026-07-21T05:00:00.000Z"),
  })];
  assert.equal(occupancySummaryForRange([], dayStart, thirdDayEnd, blocks).occupiedBedNights, 2);
});

test("occupancy counts each active sellable bed only once", () => {
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

test("occupancy counts expanded whole-dorm selections and private-room capacity", () => {
  const homespanBeds = Array.from(
    { length: 8 },
    (_, index) => `Homespan ${index + 1}`,
  );

  assert.equal(
    occupiedCapacityOnDate(
      [occupancyBooking([...homespanBeds, "Pottery 1"])],
      dayStart,
      dayEnd,
    ),
    11,
  );
});

test("booking to check-in transitions do not change occupancy", () => {
  for (const status of ["booked", "checkedIn", "checkedOut"] as const) {
    assert.equal(
      occupiedCapacityOnDate(
        [occupancyBooking(["Siesta 1"], { status })],
        dayStart,
        dayEnd,
      ),
      1,
    );
  }
});

test("cancelled, no-show, and voided bookings never count as occupied", () => {
  const bookings = [
    occupancyBooking(["Siesta 1"], {
      status: "cancelled",
      cancellation: {
        roomReleaseStatus: "blocked",
      } as booking["cancellation"],
    }),
    occupancyBooking(["Siesta 2"], {
      status: "noShow",
      resolution: {
        roomReleaseStatus: "blocked",
      } as booking["resolution"],
    }),
    occupancyBooking(["Siesta 3"], { voided: true }),
  ];

  assert.equal(occupiedCapacityOnDate(bookings, dayStart, dayEnd), 0);
});

test("early checkout ends occupancy even when remaining nights stay blocked", () => {
  for (const roomReleaseStatus of ["released", "blocked"] as const) {
    const currentBooking = occupancyBooking(["Siesta 1"], {
      status: "checkedOut",
      roomStays: [
        {
          roomIds: ["Siesta 1"],
          from: dayStart,
          to: secondDayEnd,
        },
      ],
      checkout: {
        earlyCheckOut: true,
        checkedOutAt: new Date("2026-07-19T05:00:00.000Z"),
        roomReleaseStatus,
      } as booking["checkout"],
    });

    assert.equal(
      occupiedCapacityOnDate([currentBooking], dayStart, dayEnd),
      1,
    );
    assert.equal(
      occupiedCapacityOnDate([currentBooking], dayEnd, secondDayEnd),
      0,
    );
  }
});

test("range occupancy is weighted by total occupied and available bed-nights", () => {
  const fullRangeBooking = occupancyBooking(["Siesta 1"], {
    roomStays: [
      {
        roomIds: ["Siesta 1"],
        from: dayStart,
        to: thirdDayEnd,
      },
    ],
  });
  const firstNightPrivateRoom = occupancyBooking(["Balcony"]);

  const summary = occupancySummaryForRange(
    [fullRangeBooking, firstNightPrivateRoom],
    dayStart,
    thirdDayEnd,
  );

  assert.equal(summary.occupiedBedNights, 5);
  assert.equal(summary.availableBedNights, 156);
  assert.equal(summary.averageOccupiedCapacity, 5 / 3);
  assert.equal(summary.occupancyRate, 5 / 156);
});

test("range occupancy weights a partial week by its actual number of nights", () => {
  const nineDaysLater = new Date(dayStart.getTime() + 9 * 86400000);
  const twoDaysLater = new Date(dayStart.getTime() + 2 * 86400000);
  const bookings = [
    occupancyBooking(["Siesta 1"], {
      roomStays: [
        { roomIds: ["Siesta 1"], from: dayStart, to: nineDaysLater },
      ],
    }),
    occupancyBooking(["Balcony"], {
      roomStays: [
        { roomIds: ["Balcony"], from: dayStart, to: twoDaysLater },
      ],
    }),
  ];

  const summary = occupancySummaryForRange(bookings, dayStart, nineDaysLater);

  assert.equal(summary.occupiedBedNights, 13);
  assert.equal(summary.availableBedNights, 468);
  assert.equal(summary.occupancyRate, 13 / 468);
});

test("range occupancy weights months with different lengths by bed-nights", () => {
  const februaryStart = new Date("2026-01-31T17:00:00.000Z");
  const marchStart = new Date("2026-02-28T17:00:00.000Z");
  const aprilStart = new Date("2026-03-31T17:00:00.000Z");
  const bookings = [
    occupancyBooking(["Siesta 1"], {
      roomStays: [
        { roomIds: ["Siesta 1"], from: februaryStart, to: marchStart },
      ],
    }),
    occupancyBooking(["Balcony"], {
      roomStays: [
        { roomIds: ["Balcony"], from: marchStart, to: aprilStart },
      ],
    }),
  ];

  const summary = occupancySummaryForRange(
    bookings,
    februaryStart,
    aprilStart,
  );

  assert.equal(summary.occupiedBedNights, 90);
  assert.equal(summary.availableBedNights, 52 * 59);
  assert.equal(summary.occupancyRate, 90 / (52 * 59));
});
