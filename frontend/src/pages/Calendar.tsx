import { Link } from "react-router";
import { useAuth } from "../context/AuthContext";
import moment from "moment";
import { useMemo, useState } from "react";
import type { booking } from "../types/bookingTypes";
import ViewBooking from "../features/bookings/ViewBooking";
import { Modal } from "@mui/material";
// import { dummyBooking } from "./test.tsx";

import "./Calendar.css";

const Reservations = () => {
  const today = new Date();

  const { user, logout } = useAuth();
  const [month, setMonth] = useState(today.getMonth()); // JS MONTH 0=Jan 1=Feb 4=May
  const [year, setYear] = useState(today.getFullYear());
  const [viewBookingBooking, setViewBookingBooking] = useState<booking | null>(
    null,
  );

  const getDateInMonth = (year: number, month: number) => {
    return new Date(year, month + 1, 0).getDate();
  };

  const calendarDays: Date[] = useMemo(() => {
    return Array.from(
      { length: getDateInMonth(year, month) },
      (_, i) => new Date(year, month, i + 1),
    );
  }, [month, year]); // [new Date(1,1,1), new Date(1,1,1), ...]

  const rooms = [
    {
      roomId: "Balcony",
      bookings: [
        {
          name: "Nuntawan Wangsantiporn",
          status: "checkedIn",
          bookingId: "8860311561",
          from: new Date("2026-04-15T00:00:00.000+00:00"),
          to: new Date("2026-04-18T00:00:00.000+00:00"),
        },
        {
          name: "Somchai K.",
          status: "reserved",
          bookingId: "8860311562",
          from: new Date("2026-04-20T00:00:00.000+00:00"),
          to: new Date("2026-04-23T00:00:00.000+00:00"),
        },
      ],
    },

    {
      roomId: "Window",
      bookings: [
        {
          name: "Ananya P.",
          status: "checkedIn",
          bookingId: "8860311563",
          from: new Date("2026-04-10T00:00:00.000+00:00"),
          to: new Date("2026-04-13T00:00:00.000+00:00"),
        },
        {
          name: "Krit S.",
          status: "reserved",
          bookingId: "8860311564",
          from: new Date("2026-04-18T00:00:00.000+00:00"),
          to: new Date("2026-04-21T00:00:00.000+00:00"),
        },
      ],
    },

    {
      roomId: "Pottery 1",
      bookings: [
        {
          name: "Mali C.",
          status: "checkedIn",
          bookingId: "8860311565",
          from: new Date("2026-04-05T00:00:00.000+00:00"),
          to: new Date("2026-04-09T00:00:00.000+00:00"),
        },
        {
          name: "Thanawat R.",
          status: "reserved",
          bookingId: "8860311566",
          from: new Date("2026-04-12T00:00:00.000+00:00"),
          to: new Date("2026-04-16T00:00:00.000+00:00"),
        },
      ],
    },

    {
      roomId: "Pottery 2",
      bookings: [
        {
          name: "Pimchanok L.",
          status: "checkedIn",
          bookingId: "8860311567",
          from: new Date("2026-04-01T00:00:00.000+00:00"),
          to: new Date("2026-04-04T00:00:00.000+00:00"),
        },
        {
          name: "Arthit W.",
          status: "reserved",
          bookingId: "8860311568",
          from: new Date("2026-04-22T00:00:00.000+00:00"),
          to: new Date("2026-04-26T00:00:00.000+00:00"),
        },
      ],
    },

    {
      roomId: "S 1",
      bookings: [
        {
          name: "Chalida N.",
          status: "checkedIn",
          bookingId: "8860311569",
          from: new Date("2026-04-08T00:00:00.000+00:00"),
          to: new Date("2026-04-11T00:00:00.000+00:00"),
        },
        {
          name: "Peerawat T.",
          status: "reserved",
          bookingId: "8860311570",
          from: new Date("2026-04-14T00:00:00.000+00:00"),
          to: new Date("2026-04-17T00:00:00.000+00:00"),
        },
      ],
    },
  ];

  let roomRows: any = [];

  const renderedDayHeaders = calendarDays.map((day, i) => {
    const monthAndDate = new Intl.DateTimeFormat("th-TH", {
      day: "numeric",
      month: "short",
      calendar: "gregory",
    }).format(day);

    return (
      <div className="timeline__item" key={i}>
        <p>{monthAndDate.split(" ")[0]}</p>
        <p>{monthAndDate.split(" ")[1]}</p>
      </div>
    );
  });

  const isWithinDateRange = (from: Date, to: Date, day: Date) => {
    const f = new Date(from.getFullYear(), from.getMonth(), from.getDate());
    const t = new Date(to.getFullYear(), to.getMonth(), to.getDate());
    const d = new Date(day.getFullYear(), day.getMonth(), day.getDate());

    return d >= f && d < t;
  };

  rooms.forEach((room) => {
    const roomRow = [];

    const today = new Date();
    const thisYear = today.getFullYear();

    roomRow.push(
      <div className="timeline__item timeline__roomIdItem" key={room.roomId}>
        <p>{room.roomId}</p>
      </div>,
    );

    calendarDays.forEach((day, i) => {
      const bookingWithMatchingDay = room.bookings?.find((booking) =>
        isWithinDateRange(booking.from, booking.to, day),
      );

      if (!bookingWithMatchingDay) {
        roomRow.push(
          <div className="timeline__item" key={i}>
            <p></p>
          </div>,
        );
        return;
      }

      roomRow.push(
        <div
          className="timeline__item timeline__bookedRoomItem"
          key={i}
          onDoubleClick={() =>
            setViewBookingBooking({
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
            })
          }
        >
          <p>{bookingWithMatchingDay.name}</p>
        </div>,
      );
    });

    roomRows.push(roomRow);
  });

  return (
    <main className="calendar__main">
      <Modal
        open={!!viewBookingBooking}
        onClose={() => setViewBookingBooking(null)}
        className="home__modalCenter"
      >
        <ViewBooking
          booking={viewBookingBooking as booking}
          setCheckInIsOpen={() => {}}
          removeBookingHandler={() => {}}
        />
      </Modal>
      <header className="home__header">
        <div>
          <h1>
            ตารางการจอง |{" "}
            {new Intl.DateTimeFormat("th-TH", {
              day: undefined,
              month: "long",
              year: "numeric",
              calendar: "gregory",
            }).format(new Date(2026, month, 1))}
          </h1>
          <div style={{ display: "flex", gap: "0.3rem" }}>
            <p>
              {/* ข้อมูลอัปเดตล่าสุดเมื่อ {lastUpdated?.getHours()}:
              {lastUpdated?.getMinutes().toString().padStart(2, "0")} */}
            </p>
            <i
              className="bx bx-refresh home__refreshIcon"
              // onClick={() => {
              //   toast.promise(fetchBookings, {
              //     loading: "กำลังอัปเดตข้อมูล...",
              //     success: "อัปเดตข้อมูลสำเร็จ",
              //     error: "เกิดข้อผิดพลาดในการอัปเดตข้อมูล",
              //   });
              // }}
            />
          </div>
        </div>

        <div className="home__headerProfile">
          <p>
            {user?.name} <strong>{"  " + user?.admin && "Admin"}</strong>
          </p>
          <Link to={"/settings"}>
            <img
              className="home__profileImg"
              src="https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcR3m972e8FEvBi7ETC03avlJcZDg8nT9dWLSw&s"
              alt="profilePicture"
            />
          </Link>
        </div>
      </header>

      <div className="timeline__wrapper">
        <div
          className="timeline"
          style={{
            gridTemplateColumns: `10rem repeat(${getDateInMonth(2026, month)}, 7.5rem)`,
          }}
        >
          <div className="timeline__item timeline__roomIdItem">ห้อง / วัน</div>
          {renderedDayHeaders}

          {roomRows}
        </div>
      </div>
    </main>
  );
};

export default Reservations;
