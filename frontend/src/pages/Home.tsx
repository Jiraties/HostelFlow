import StatCard from "../features/dashboard/StatCard";
import axios from "axios";
import Select from "react-select";
import type { SingleValue } from "react-select";

import ActionButton from "../components/ActionButton";
import ModalCloseButton from "../components/ModalCloseButton";
import PageHeader from "../components/PageHeader";
import Spreadsheet from "../features/dashboard/Spreadsheet";
import AddBooking from "../features/bookings/AddBooking";
import toast from "react-hot-toast";
import ViewBooking from "../features/bookings/ViewBooking";
import ConfirmationModal from "../components/ConfirmationModal";
import UnsavedChangesModal from "../components/UnsavedChangesModal";

import { useCallback, useEffect, useRef, useState } from "react";
import { Modal } from "@mui/material";
import { useLocation, useSearchParams } from "react-router";
import {
  formatBookingDates,
  formatBookingsDates,
} from "../helpers/bookingHelpers";
import { platformOptions, roomIdOptions } from "../helpers/options";
import { customStyles } from "../helpers/selectStyling";
import { API_URL } from "../config/api";
import { requestUnsavedModalClose } from "../helpers/modalGuards";

import type { booking } from "../types/bookingTypes";
import type { OptionType } from "../helpers/selectStyling";

import "./Home.css";

type HomeStatus = "arrivals" | "departures" | "master";

type MasterFilters = {
  from: string;
  to: string;
  name: string;
  bookingId: string;
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
  const thirtyDaysAgo = new Date(today);
  const thirtyDaysFromNow = new Date(today);

  thirtyDaysAgo.setDate(today.getDate() - 30);
  thirtyDaysFromNow.setDate(today.getDate() + 30);

  return {
    from: formatInputDate(thirtyDaysAgo),
    to: formatInputDate(thirtyDaysFromNow),
    name: "",
    bookingId: "",
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
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const isMaster = status === "master";
  const bookingIdQuery = isMaster
    ? searchParams.get("bookingId")?.trim() || ""
    : "";
  const [addBookingIsOpen, setAddBookingIsOpen] = useState(false);
  const [addBookingIsDirty, setAddBookingIsDirty] = useState(false);
  const [pendingUnsavedClose, setPendingUnsavedClose] = useState<
    (() => void) | null
  >(null);
  const [viewBookingBooking, setViewBookingBooking] = useState<booking | null>(
    null,
  );
  const [bookings, setBookings] = useState<booking[]>([]);
  const [occupancy, setOccupancy] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [filtersModalIsOpen, setFiltersModalIsOpen] = useState(false);
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
  const openedBookingIdFromQueryRef = useRef("");

  useEffect(() => {
    masterFiltersRef.current = masterFilters;
  }, [masterFilters]);

  useEffect(() => {
    if (!isMaster) return;

    openedBookingIdFromQueryRef.current = "";

    if (!bookingIdQuery) return;

    setMasterFilters((prev) =>
      prev.bookingId === bookingIdQuery
        ? prev
        : { ...prev, bookingId: bookingIdQuery },
    );
  }, [bookingIdQuery, isMaster]);

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

  const clearBookingIdQueryParam = () => {
    if (!isMaster || !searchParams.has("bookingId")) return;

    const nextSearchParams = new URLSearchParams(searchParams);
    nextSearchParams.delete("bookingId");
    setSearchParams(nextSearchParams, { replace: true });
  };

  const closeViewBookingModal = () => {
    setViewBookingBooking(null);
    clearBookingIdQueryParam();
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

  const handleViewBookingUpdated = (booking: booking) => {
    const formattedBooking = formatBookingDates(booking);

    setViewBookingBooking(formattedBooking);
    setBookings((prevBookings) =>
      prevBookings.map((prevBooking) =>
        prevBooking.bookingId === formattedBooking.bookingId
          ? formattedBooking
          : prevBooking,
      ),
    );
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

  useEffect(() => {
    if (
      !isMaster ||
      loading ||
      !bookingIdQuery ||
      openedBookingIdFromQueryRef.current === bookingIdQuery
    ) {
      return;
    }

    const bookingToOpen = bookings.find(
      (booking) => booking.bookingId === bookingIdQuery,
    );

    if (!bookingToOpen) return;

    openedBookingIdFromQueryRef.current = bookingIdQuery;
    setViewBookingBooking(bookingToOpen);
  }, [bookingIdQuery, bookings, isMaster, loading]);

  const renderMasterFilterFields = () => (
    <div className="home__masterFiltersInner">
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
        <p className="home__filterLabel">Booking ID</p>
        <input
          className="boxInput home__filterInput"
          type="text"
          value={masterFilters.bookingId}
          placeholder="ค้นหา Booking ID"
          onChange={(e) => updateMasterFilter("bookingId", e.target.value)}
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
  );

  return (
    <main className="home">
      <Modal
        open={addBookingIsOpen}
        className="home__modalCenter"
        onClose={() =>
          requestUnsavedModalClose(
            addBookingIsDirty,
            () => setAddBookingIsOpen(false),
            () => setPendingUnsavedClose(() => () => setAddBookingIsOpen(false)),
          )
        }
      >
        <AddBooking
          appendToBookings={appendToBookings}
          onClose={() => setAddBookingIsOpen(false)}
          onDirtyChange={setAddBookingIsDirty}
        />
      </Modal>
      <Modal
        open={!!pendingUnsavedClose}
        className="home__modalCenter"
        onClose={() => setPendingUnsavedClose(null)}
      >
        <UnsavedChangesModal
          onClose={() => setPendingUnsavedClose(null)}
          onDiscard={() => {
            pendingUnsavedClose?.();
            setPendingUnsavedClose(null);
          }}
        />
      </Modal>
      <Modal
        open={!!viewBookingBooking}
        onClose={closeViewBookingModal}
        className="home__modalCenter"
      >
        <ViewBooking
          booking={viewBookingBooking as booking}
          onClose={closeViewBookingModal}
          onUpdated={handleViewBookingUpdated}
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
          onClose={() =>
            setConfirmationModalIsOpen((prev) => ({ ...prev, isOpen: false }))
          }
          closeAllModals={closeAllModals}
        />
      </Modal>
      <Modal
        open={filtersModalIsOpen}
        className="home__modalCenter"
        onClose={() => setFiltersModalIsOpen(false)}
      >
        <div className="home__filtersModal">
          <ModalCloseButton onClick={() => setFiltersModalIsOpen(false)} />
          <div className="home__filtersModalHeader">
            <h2>ตัวกรอง</h2>
            <i
              className="bx bx-x"
              onClick={() => setFiltersModalIsOpen(false)}
            />
          </div>
          <div className="home__mobileFilters">
            {renderMasterFilterFields()}
          </div>
        </div>
      </Modal>
      <PageHeader
        title={`${status === "arrivals" ? "เช็คอินวันนี้ | " : status === "departures" ? "เช็คเอาท์วันนี้ | " : ""}${fullFormattedDate}`}
        lastUpdated={lastUpdated}
        onRefresh={fetchBookings}
      />
      {isMaster && (
        <section className="home__masterControls">
          <div className="home__masterFilters">
            {renderMasterFilterFields()}
          </div>
          <div className="home__masterActions">
            <ActionButton
              text="ตัวกรอง"
              icon="bx-filter-alt"
              className="home__mobileFilterAction"
              onClick={() => setFiltersModalIsOpen(true)}
            />
            <ActionButton
              text="เพิ่มการจองใหม่"
              icon="bx-plus"
              className="home__addBookingAction"
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
            {/* <ActionButton
              text="เรียกเก็บเงิน"
              icon="bx-dollar"
              onClick={() => {}}
            /> */}
            <ActionButton
              text="เพิ่มการจองใหม่"
              icon="bx-plus"
              className="home__addBookingAction"
              onClick={() => setAddBookingIsOpen(true)}
            />
          </div>
        </div>
      )}
      <div className="home__gridArea">
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
        <ActionButton
          text="เพิ่มการจองใหม่"
          icon="bx-plus"
          className="home__gridFab"
          onClick={() => setAddBookingIsOpen(true)}
        />
      </div>
      {/* <button onClick={logoutHandler}>logout</button> */}
    </main>
  );
};

export default Home;
