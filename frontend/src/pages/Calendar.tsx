import { Link } from "react-router";
import { useAuth } from "../context/AuthContext";
import moment from "moment";
import { useMemo, useState } from "react";
import type { booking } from "../types/bookingTypes";
import ViewBooking from "../features/bookings/ViewBooking";
import { Modal } from "@mui/material";
import {
  calculateNights,
  populateDummyBookings,
} from "../helpers/bookingHelpers";
// import { dummyBooking } from "./test.tsx";

import "./Calendar.css";

type roomId =
  | "Balcony"
  | "Window"
  | "Pottery 1"
  | "Pottery 2"
  | "Siesta 1"
  | "Siesta 2"
  | "Siesta 3"
  | "Siesta 4"
  | "Siesta 5"
  | "Siesta 6"
  | "Siesta 7"
  | "Siesta 8"
  | "Siesta 9"
  | "Siesta 10"
  | "Siesta 11"
  | "Siesta 12"
  | "Siesta 13"
  | "Siesta 14"
  | "Marquisette 1"
  | "Marquisette 2"
  | "Marquisette 3"
  | "Marquisette 4"
  | "Marquisette 5"
  | "Marquisette 6"
  | "Marquisette 7"
  | "Marquisette 8"
  | "Homespan 1"
  | "Homespan 2"
  | "Homespan 3"
  | "Homespan 4"
  | "Homespan 5"
  | "Homespan 6"
  | "Homespan 7"
  | "Homespan 8"
  | "Veranda 1"
  | "Veranda 2"
  | "Veranda 3"
  | "Veranda 4"
  | "Veranda 5"
  | "Veranda 6"
  | "Wicker 1"
  | "Wicker 2"
  | "Wicker 3"
  | "Wicker 4"
  | "Wicker 5"
  | "Wicker 6";

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

  const [rooms, setRooms] = useState([
    {
      roomId: "Balcony",
      bookings: [
        {
          name: "Ananya P.",
          from: new Date("2026-04-15T00:00:00.000+00:00"),
          to: new Date("2026-04-18T00:00:00.000+00:00"),
        },
        {
          name: "Somchai K.",
          from: new Date("2026-04-20T00:00:00.000+00:00"),
          to: new Date("2026-04-23T00:00:00.000+00:00"),
        },
      ],
    },
    {
      roomId: "Window",
      bookings: [
        {
          name: "Krit S.",
          from: new Date("2026-04-10T00:00:00.000+00:00"),
          to: new Date("2026-04-13T00:00:00.000+00:00"),
        },
      ],
    },
    {
      roomId: "Pottery 1",
      bookings: [
        {
          name: "Mali C.",
          from: new Date("2026-04-05T00:00:00.000+00:00"),
          to: new Date("2026-04-09T00:00:00.000+00:00"),
        },
      ],
    },
    {
      roomId: "Pottery 2",
      bookings: [
        {
          name: "Arthit W.",
          from: new Date("2026-04-22T00:00:00.000+00:00"),
          to: new Date("2026-04-26T00:00:00.000+00:00"),
        },
      ],
    },

    ...Array.from({ length: 14 }, (_, i) => ({
      roomId: `Siesta ${i + 1}`,
      bookings:
        i % 3 === 0
          ? [
              {
                name: `Guest S${i + 1}`,
                from: new Date(
                  `2026-04-${String(3 + i).padStart(2, "0")}T00:00:00.000+00:00`,
                ),
                to: new Date(
                  `2026-04-${String(6 + i).padStart(2, "0")}T00:00:00.000+00:00`,
                ),
              },
            ]
          : [],
    })),

    ...Array.from({ length: 8 }, (_, i) => ({
      roomId: `Marquisette ${i + 1}`,
      bookings:
        i % 2 === 0
          ? [
              {
                name: `Guest M${i + 1}`,
                from: new Date(
                  `2026-04-${String(8 + i).padStart(2, "0")}T00:00:00.000+00:00`,
                ),
                to: new Date(
                  `2026-04-${String(11 + i).padStart(2, "0")}T00:00:00.000+00:00`,
                ),
              },
            ]
          : [],
    })),

    ...Array.from({ length: 8 }, (_, i) => ({
      roomId: `Homespan ${i + 1}`,
      bookings:
        i % 2 !== 0
          ? [
              {
                name: `Guest H${i + 1}`,
                from: new Date(
                  `2026-04-${String(12 + i).padStart(2, "0")}T00:00:00.000+00:00`,
                ),
                to: new Date(
                  `2026-04-${String(15 + i).padStart(2, "0")}T00:00:00.000+00:00`,
                ),
              },
            ]
          : [],
    })),

    ...Array.from({ length: 6 }, (_, i) => ({
      roomId: `Veranda ${i + 1}`,
      bookings:
        i < 3
          ? [
              {
                name: `Guest V${i + 1}`,
                from: new Date(
                  `2026-04-${String(18 + i).padStart(2, "0")}T00:00:00.000+00:00`,
                ),
                to: new Date(
                  `2026-04-${String(21 + i).padStart(2, "0")}T00:00:00.000+00:00`,
                ),
              },
            ]
          : [],
    })),

    ...Array.from({ length: 6 }, (_, i) => ({
      roomId: `Wicker ${i + 1}`,
      bookings:
        i % 2 === 0
          ? [
              {
                name: `Guest W${i + 1}`,
                from: new Date(
                  `2026-04-${String(22 + i).padStart(2, "0")}T00:00:00.000+00:00`,
                ),
                to: new Date(
                  `2026-04-${String(25 + i).padStart(2, "0")}T00:00:00.000+00:00`,
                ),
              },
            ]
          : [],
    })),
  ]);

  let roomRows: any = [];

  const nextMonth = () => {
    if (month + 1 < 11) return setMonth(month + 1);

    setYear(year + 1);
    setMonth(0);
  };

  const renderedDayHeaders = calendarDays.map((day, i) => {
    const monthAndDate = new Intl.DateTimeFormat("th-TH", {
      day: "numeric",
      month: "short",
      calendar: "gregory",
    }).format(day);

    return (
      <div className="timeline__item timeline__dateItem" key={i}>
        <p>{monthAndDate.split(" ")[0]}</p>
        <p>{monthAndDate.split(" ")[1]}</p>
      </div>
    );
  });

  rooms.forEach((room) => {
    const roomRow = [];

    const today = new Date();
    const thisYear = today.getFullYear();

    roomRow.push(
      <div
        className="timeline__item timeline__roomIdItem"
        style={{ gridColumn: "1" }}
        key={room.roomId}
      >
        <p>{room.roomId}</p>
      </div>,
    );

    room.bookings.forEach((booking, index) => {
      const startingDate = calendarDays.findIndex(
        (day) =>
          day.getFullYear() === booking.from.getFullYear() &&
          day.getMonth() === booking.from.getMonth() &&
          day.getDate() === booking.from.getDate(),
      );
      console.log(
        `${startingDate} / span ${calculateNights(booking.from, booking.to)}`,
      );

      roomRow.push(
        <div
          className="timeline__item timeline__bookedRoomItem"
          style={{
            gridColumn: `${startingDate + 2} / span ${calculateNights(booking.from, booking.to)}`,
          }}
          key={index}
          onDoubleClick={() => {}}
        >
          <p>{booking.name}</p>
        </div>,
      );
    });

    // calendarDays.forEach((day, i) => {
    //   const bookingWithMatchingDay = room.bookings?.find((booking) =>
    //     isWithinDateRange(booking.from, booking.to, day),
    //   );

    //   if (!bookingWithMatchingDay) {
    //     roomRow.push(
    //       <div className="timeline__item" key={i}>
    //         <p></p>
    //       </div>,
    //     );
    //     return;
    //   }

    //   roomRow.push(
    //     <div
    //       className="timeline__item timeline__bookedRoomItem"
    //       key={i}
    //       onDoubleClick={() =>
    //         setViewBookingBooking({
    //           name: "Ananya Prasert",
    //           bookingId: "BK20260415001",

    //           platformId: "AGOD",
    //           status: "checkedIn",

    //           checkIn: new Date("2026-04-15T00:00:00.000+00:00"),
    //           checkOut: new Date("2026-04-18T00:00:00.000+00:00"),
    //           nights: 3,

    //           roomStays: [
    //             {
    //               roomId: "Balcony",
    //               from: new Date("2026-04-15T00:00:00.000+00:00"),
    //               to: new Date("2026-04-18T00:00:00.000+00:00"),
    //             },
    //           ],

    //           transactions: [
    //             {
    //               type: "roomCharge",
    //               paymentMethod: "OTA",
    //               amount: 4500,
    //             },
    //             {
    //               type: "deposit",
    //               paymentMethod: "Cash",
    //               amount: 1000,
    //             },
    //           ],

    //           staffUsername: "admin01",
    //           checkInByStaffUsername: "admin01",

    //           note: "Late check-in, arriving around 9 PM",
    //         })
    //       }
    //     >
    //       <p>{bookingWithMatchingDay.name}</p>
    //     </div>,
    //   );
    // });

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
            gridTemplateRows: `repeat(${rooms.length}, 3.5rem)`,
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
