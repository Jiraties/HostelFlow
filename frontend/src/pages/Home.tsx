import StatCard from "../features/dashboard/StatCard";
import axios from "axios";
import Select from "react-select";
import type { SingleValue } from "react-select";

import ActionButton from "../components/ActionButton";
import Spreadsheet from "../features/dashboard/Spreadsheet";
import AddBooking from "../features/bookings/AddBooking";
import toast from "react-hot-toast";
import ViewBooking from "../features/bookings/ViewBooking";
import ConfirmationModal from "../components/ConfirmationModal";

import { useCallback, useEffect, useRef, useState } from "react";
import { Modal } from "@mui/material";
import { useAuth } from "../context/AuthContext";
import { Link, useLocation } from "react-router";
import {
  formatBookingDates,
  formatBookingsDates,
} from "../helpers/bookingHelpers";
import { platformOptions, roomIdOptions } from "../helpers/options";
import { customStyles } from "../helpers/selectStyling";
import { API_URL } from "../config/api";

import type { booking } from "../types/bookingTypes";
import type { OptionType } from "../helpers/selectStyling";

import "./Home.css";
import CheckIn from "../features/bookings/CheckIn";

type HomeStatus = "arrivals" | "departures" | "master";

type MasterFilters = {
  from: string;
  to: string;
  name: string;
  room: string;
  channel: string;
};

const formatInputDate = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
};

const getDefaultMasterFilters = (): MasterFilters => {
  const today = new Date();
  const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const lastDayOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);

  return {
    from: formatInputDate(firstDayOfMonth),
    to: formatInputDate(lastDayOfMonth),
    name: "",
    room: "",
    channel: "",
  };
};

const getFetchErrorMessage = (err: unknown) => {
  if (axios.isAxiosError(err) && err.response?.data?.message) {
    return err.response.data.message;
  }

  return "เกิดข้อผิดพลาดในการโหลดข้อมูล";
};

const Home = ({ status }: { status: HomeStatus }) => {
  const { user } = useAuth();
  const location = useLocation();
  const isMaster = status === "master";
  const [addBookingIsOpen, setAddBookingIsOpen] = useState(false);
  const [viewBookingBooking, setViewBookingBooking] = useState<booking | null>(
    null,
  );
  const [bookings, setBookings] = useState<booking[]>([]);
  const [occupancy, setOccupancy] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [checkInIsOpen, setCheckInIsOpen] = useState(false);
  const [confirmationModalIsOpen, setConfirmationModalIsOpen] = useState<{
    isOpen: boolean;
    booking: booking | null;
  }>({
    isOpen: false,
    booking: null,
  });
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [masterFilters, setMasterFilters] = useState<MasterFilters>(
    getDefaultMasterFilters,
  );
  const masterFiltersRef = useRef(masterFilters);

  useEffect(() => {
    masterFiltersRef.current = masterFilters;
  }, [masterFilters]);

  const fullFormattedDate = new Intl.DateTimeFormat("th-TH", {
    day: "numeric",
    month: "long",
    year: "numeric",
    calendar: "gregory",
  }).format(new Date());

  const today = new Date();
  const bookingCheckInIsToday = (booking: booking) =>
    booking.checkIn.toDateString() === today.toDateString();

  const bookingCheckOutIsToday = (booking: booking) =>
    booking.checkOut.toDateString() === today.toDateString();

  const roomChargeTransaction = (booking: booking) =>
    booking.transactions.find(
      (transaction) => transaction.type === "roomCharge",
    )!;

  const sumBookingTransactions = (
    booking: booking,
    predicate: (transaction: booking["transactions"][number]) => boolean,
  ) =>
    booking.transactions.reduce(
      (sum, transaction) =>
        predicate(transaction) ? sum + transaction.amount : sum,
      0,
    );

  const arrivalsToday = bookings.filter(bookingCheckInIsToday);
  const departuresToday = bookings.filter(bookingCheckOutIsToday);
  const depositToReturn = departuresToday.reduce((sum, booking) => {
    const deposits = sumBookingTransactions(
      booking,
      (transaction) => transaction.type === "deposit",
    );
    const refundedDeposits = sumBookingTransactions(
      booking,
      (transaction) => transaction.type === "depositRefund",
    );

    return sum + Math.max(deposits - refundedDeposits, 0);
  }, 0);
  const cashRefundedToday = departuresToday.reduce(
    (sum, booking) =>
      sum +
      sumBookingTransactions(
        booking,
        (transaction) =>
          transaction.type === "depositRefund" &&
          transaction.paymentMethod === "Cash",
      ),
    0,
  );

  const stats = {
    arrivalsToday: arrivalsToday.length,
    departuresToday: departuresToday.length,
    unpaidCheckins: isMaster
      ? 0
      : arrivalsToday.filter(
          (booking) =>
            roomChargeTransaction(booking).paymentMethod === "Unpaid",
        ).length,
    cashToday:
      isMaster || status === "departures"
        ? 0
        : arrivalsToday.reduce(
            (sum, booking) =>
              sum +
              sumBookingTransactions(
                booking,
                (transaction) =>
                  transaction.paymentMethod === "Cash" &&
                  transaction.type !== "depositRefund",
              ),
            0,
          ),
    cashToReturnToday:
      isMaster || status === "arrivals" ? 0 : cashRefundedToday,
    // revenueToday: bookings.reduce((sum, booking) => {
    //   const tx = roomChargeTransaction(booking);
    //   if (tx.paymentMethod === "Unpaid") return sum;
    //   if (!bookingCheckInIsToday(booking)) return sum;
    //   return sum + (tx.amount ?? 0);
    // }, 0),
    guestsInHouse: occupancy,
    // guestsInHouse: `${Math.trunc((occupancy / 46) * 100)}%`,
    deposit: depositToReturn,
  };

  const statCards = isMaster
    ? []
    : status === "arrivals"
      ? [
          {
            id: "arrivalsToday",
            label: "เช็คอินวันนี้",
            value: stats.arrivalsToday,
          },

          {
            id: "unpaidCheckins",
            label: "ยังไม่ชำระเงิน",
            value: stats.unpaidCheckins,
          },
          // {
          //   id: "revenueToday",
          //   label: "รายได้รวมวันนี้ (฿)",
          //   value: stats.revenueToday,
          // },
          {
            id: "cashToday",
            label: "เงินสดวันนี้ (฿)",
            value: stats.cashToday,
          },
          {
            id: "guestsInHouse",
            label: "แขกที่พักอยู่ตอนนี้",
            value: stats.guestsInHouse,
          },
        ]
      : [
          {
            id: "departuresToday",
            label: "เช็คเอาท์วันนี้",
            value: stats.departuresToday,
          },
          { id: "deposit", label: "มัดจำที่ต้องคืน (฿)", value: stats.deposit },
          // {
          //   id: "deposit",
          //   label: "มัดจำที่ต้องคืน (฿)",
          //   value: stats.cashReturn,
          // },
          {
            id: "guestsInHouse",
            label: "แขกที่พักอยู่ตอนนี้",
            value: stats.guestsInHouse,
          },
        ];

  // ----------- IMPORTANT FUNCTION: every booking sent from backend needs to be formated here ------------
  // const formatBookingsDates = (bookings: booking[]) =>
  //   bookings.map((booking: booking) => {
  //     booking.checkIn = new Date(booking.checkIn);
  //     booking.checkOut = new Date(booking.checkOut);
  //     return booking;
  //   });

  const appendToBookings = (booking: booking) => {
    const formattedBooking = formatBookingsDates([booking])[0];

    if (isMaster) {
      fetchBookings();
    } else if (
      formattedBooking.checkIn.toDateString() === new Date().toDateString() &&
      location.pathname === "/arrivals"
    ) {
      setBookings((prev) => [...prev, formattedBooking]);
    }

    setAddBookingIsOpen(false);
  };

  const closeAllModals = () => {
    setViewBookingBooking(null);
    setConfirmationModalIsOpen({ isOpen: false, booking: null });
    fetchBookings();
  };

  const fetchBookingsWithFilters = useCallback(
    async (filters: MasterFilters) => {
      setLoading(true);
      try {
        const response = await axios.get(
          `${API_URL}/bookings/getMasterBookings`,
          {
            withCredentials: true,
            params: filters,
          },
        );

        const bookingsData = response.data.bookings;
        setLastUpdated(new Date());
        setOccupancy(response.data.occupancy);
        setBookings(formatBookingsDates(bookingsData));
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const fetchBookings = useCallback(async () => {
    if (isMaster) {
      await fetchBookingsWithFilters(masterFiltersRef.current);
      return;
    }

    setLoading(true);
    try {
      const response = await axios.get(
        `${API_URL}/bookings/getTodayBookings/${status}`,
        {
          withCredentials: true,
        },
      );

      const bookingsData = response.data.bookings;
      setLastUpdated(new Date());
      setOccupancy(response.data.occupancy);
      setBookings(formatBookingsDates(bookingsData));
    } finally {
      setLoading(false);
    }
  }, [fetchBookingsWithFilters, isMaster, status]);

  const updateMasterFilter = (key: keyof MasterFilters, value: string) => {
    setMasterFilters((prev) => ({ ...prev, [key]: value }));
  };

  const removeBookingHandler = (booking: booking) => {
    setConfirmationModalIsOpen({ isOpen: true, booking });
  };

  const handleCheckInSuccess = (booking: booking) => {
    const formattedBooking = formatBookingDates(booking);

    setViewBookingBooking(formattedBooking);
    setBookings((prevBookings) =>
      prevBookings.map((prevBooking) =>
        prevBooking.bookingId === formattedBooking.bookingId
          ? formattedBooking
          : prevBooking,
      ),
    );
    setCheckInIsOpen(false);
    fetchBookings();
  };

  useEffect(() => {
    if (isMaster) return;
    fetchBookings().catch((err) => toast.error(getFetchErrorMessage(err)));
  }, [fetchBookings, isMaster, location.pathname]);

  useEffect(() => {
    if (!isMaster) return;

    const timeoutId = window.setTimeout(() => {
      fetchBookingsWithFilters(masterFilters).catch((err) =>
        toast.error(getFetchErrorMessage(err)),
      );
    }, 500);

    return () => window.clearTimeout(timeoutId);
  }, [fetchBookingsWithFilters, isMaster, masterFilters]);

  return (
    <main className="home">
      <Modal
        open={addBookingIsOpen}
        className="home__modalCenter"
        onClose={() => setAddBookingIsOpen(false)}
      >
        <AddBooking appendToBookings={appendToBookings} />
      </Modal>
      <Modal
        open={!!viewBookingBooking}
        onClose={() => setViewBookingBooking(null)}
        className="home__modalCenter"
      >
        <ViewBooking
          booking={viewBookingBooking as booking}
          setCheckInIsOpen={setCheckInIsOpen}
          removeBookingHandler={removeBookingHandler}
        />
      </Modal>
      <Modal
        open={confirmationModalIsOpen.isOpen}
        onClose={() =>
          setConfirmationModalIsOpen((prev) => ({ ...prev, isOpen: false }))
        }
        className="home__modalCenter"
      >
        <ConfirmationModal
          booking={confirmationModalIsOpen.booking}
          closeAllModals={closeAllModals}
        />
      </Modal>
      {viewBookingBooking && (
        <Modal
          open={checkInIsOpen}
          className="home__modalCenter"
          onClose={() => setCheckInIsOpen(false)}
        >
          <CheckIn
            booking={viewBookingBooking}
            // fetchBookings={fetchBookings}
            handleCheckInSuccess={handleCheckInSuccess}
          />
        </Modal>
      )}
      <header className="home__header">
        <div>
          <h1>
            {status === "arrivals"
              ? "Arrivals |"
              : status === "departures"
                ? "Departures |"
                : ""}{" "}
            {fullFormattedDate}
          </h1>
          <div style={{ display: "flex", gap: "0.3rem" }}>
            <p>
              ข้อมูลอัปเดตล่าสุดเมื่อ {lastUpdated?.getHours()}:
              {lastUpdated?.getMinutes().toString().padStart(2, "0")}
            </p>
            <i
              className="bx bx-refresh home__refreshIcon"
              onClick={() => {
                toast.promise(fetchBookings(), {
                  loading: "กำลังอัปเดตข้อมูล...",
                  success: "อัปเดตข้อมูลสำเร็จ",
                  error: "เกิดข้อผิดพลาดในการอัปเดตข้อมูล",
                });
              }}
            />
          </div>
        </div>

        <div className="home__headerProfile">
          <p>
            {user?.name} <strong>{"  " + (user?.admin ? " Admin" : "")}</strong>
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
      {isMaster && (
        <section className="home__masterControls">
          <div className="home__masterFilters">
            <div className="home__dateFilter">
              <div className="home__filterLabels">
                <p className="home__filterLabel">จากวันที่</p>
                <p className="home__filterLabel">ถึงวันที่</p>
              </div>
              <div className="home__dateInputs">
                <input
                  type="date"
                  value={masterFilters.from}
                  onChange={(e) => updateMasterFilter("from", e.target.value)}
                  className="boxInput home__dateInput"
                />
                <input
                  type="date"
                  value={masterFilters.to}
                  onChange={(e) => updateMasterFilter("to", e.target.value)}
                  className="boxInput home__dateInput"
                />
              </div>
            </div>
            <div className="home__filterField">
              <p className="home__filterLabel">ชื่อ</p>
              <input
                className="boxInput home__filterInput"
                type="text"
                value={masterFilters.name}
                placeholder="ค้นหาชื่อแขก"
                onChange={(e) => updateMasterFilter("name", e.target.value)}
              />
            </div>
            <div className="home__filterField">
              <p className="home__filterLabel">ห้อง</p>
              <Select<OptionType>
                styles={customStyles<OptionType>()}
                classNamePrefix="rs"
                placeholder="ทุกห้อง"
                isClearable
                menuPortalTarget={document.body}
                options={roomIdOptions}
                value={
                  roomIdOptions.find(
                    (option) => option.value === masterFilters.room,
                  ) || null
                }
                onChange={(option: SingleValue<OptionType>) =>
                  updateMasterFilter("room", option?.value || "")
                }
              />
            </div>
            <div className="home__filterField">
              <p className="home__filterLabel">ช่องทางการจอง</p>
              <Select<OptionType>
                styles={customStyles<OptionType>()}
                classNamePrefix="rs"
                placeholder="ทุกช่องทาง"
                isClearable
                menuPortalTarget={document.body}
                options={platformOptions}
                value={
                  platformOptions.find(
                    (option) => option.value === masterFilters.channel,
                  ) || null
                }
                onChange={(option: SingleValue<OptionType>) =>
                  updateMasterFilter("channel", option?.value || "")
                }
              />
            </div>
          </div>
          <div className="home__masterActions">
            <ActionButton
              text="เพิ่มการจองใหม่"
              icon="bx-plus"
              onClick={() => setAddBookingIsOpen(true)}
            />
          </div>
        </section>
      )}
      {!isMaster && (
        <div className="home__statsAndActions">
          <div className="home__stats">
            {statCards.map((stat) => (
              <StatCard
                key={stat.label}
                loading={loading}
                label={stat.label}
                value={stat.value ? stat.value : 0}
              />
            ))}
          </div>
          <div className="home__actions">
            <ActionButton
              text="เรียกเก็บเงิน"
              icon="bx-dollar"
              onClick={() => {}}
            />
            <ActionButton
              text="เพิ่มการจองใหม่"
              icon="bx-plus"
              onClick={() => setAddBookingIsOpen(true)}
            />
          </div>
        </div>
      )}
      <Spreadsheet
        bookings={bookings}
        loading={loading}
        status={status}
        masterRange={
          isMaster
            ? {
                from: masterFilters.from,
                to: masterFilters.to,
              }
            : undefined
        }
        setViewBookingBooking={setViewBookingBooking}
      />
      {/* <button onClick={logoutHandler}>logout</button> */}
    </main>
  );
};

export default Home;
