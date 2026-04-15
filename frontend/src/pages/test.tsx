

export const dummyBooking: booking = {
  name: "Ananya Prasert",
  bookingId: "BK20260415001",

  platformId: "AGOD",
  status: "checkedIn",

  checkIn: new Date("2026-04-15T00:00:00.000+00:00"),
  checkOut: new Date("2026-04-18T00:00:00.000+00:00"),
  nights: 3,

  roomStays: [
    {
      roomId: "Balcony",
      from: new Date("2026-04-15T00:00:00.000+00:00"),
      to: new Date("2026-04-18T00:00:00.000+00:00"),
    },
  ],

  transactions: [
    {
      type: "roomCharge",
      paymentMethod: "OTA",
      amount: 4500,
    },
    {
      type: "deposit",
      paymentMethod: "Cash",
      amount: 1000,
    },
  ],

  staffUsername: "admin01",
  checkInByStaffUsername: "admin01",

  note: "Late check-in, arriving around 9 PM",
};
