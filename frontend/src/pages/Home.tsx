import StatCard from "../features/dashboard/StatCard";
import axios from "axios";
import Select from "react-select";
import type { SingleValue } from "react-select";

import ActionButton from "../components/ActionButton";
import ModalCloseButton from "../components/ModalCloseButton";
import PageHeader from "../components/PageHeader";
import { PreferredDateInput } from "../components/PreferredDateInput";
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
  roomChargeOutstandingAmount,
} from "../helpers/bookingHelpers";
import { platformOptions, roomIdOptions } from "../helpers/options";
import { customStyles } from "../helpers/selectStyling";
import { API_URL } from "../config/api";
import { requestUnsavedModalClose } from "../helpers/modalGuards";
import usePageTitle from "../hooks/useTitle";
import { formatHeaderDate } from "../helpers/displayDate";
import { useAuth } from "../context/AuthContext";

import type { booking } from "../types/bookingTypes";
import type { OptionType } from "../helpers/selectStyling";

import "./Home.css";

type HomeStatus = "arrivals" | "departures" | "master";

type MasterFilters = {
  from: string;
  to: string;
  search: string;
  room: string;
  channel: string;
  status: string;
};

type CashPositionData = {
  activeShift: {
    shiftNumber: number;
    staffUsername: string;
  } | null;
  current: {
    operatingCash: number;
  };
};

const MASTER_BOOKINGS_PAGE_SIZE = 75;

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
    search: "",
    room: "",
    channel: "",
    status: "",
  };
};

const bookingStatusOptions: OptionType[] = [
  { value: "", label: "ทุกสถานะ" },
  { value: "booked", label: "ยังไม่ Check-In" },
  { value: "checkedIn", label: "Check-In แล้ว" },
  { value: "checkedOut", label: "Check-Out แล้ว" },
  { value: "cancelled", label: "ยกเลิกแล้ว" },
  { value: "noShow", label: "No-Show" },
];

const getFetchErrorMessage = (err: unknown) => {
  if (axios.isAxiosError(err) && err.response?.data?.message) {
    return err.response.data.message;
  }

  return "เกิดข้อผิดพลาดในการโหลดข้อมูล";
};

const bookingMatchesChannelBookingId = (
  currentBooking: booking,
  bookingId: string,
) => {
  const normalizedBookingId = bookingId.trim().toLocaleLowerCase();
  if (!normalizedBookingId) return false;

  return [
    currentBooking.bookingId,
    ...(currentBooking.commercialSegments || []).map(
      (segment) => segment.channelBookingId || "",
    ),
  ].some(
    (candidate) => candidate.trim().toLocaleLowerCase() === normalizedBookingId,
  );
};

const Home = ({ status }: { status: HomeStatus }) => {
  usePageTitle(
    `HostelFlow · ${
      status === "arrivals"
        ? "Arrivals"
        : status === "departures"
          ? "Departures"
          : "รายการจองทั้งหมด"
    }`,
  );
  const { user, resolveStaffName } = useAuth();
  const dateFormat = user?.settings.dateFormat || "dd/MM/yyyy";
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const isMaster = status === "master";
  const bookingIdQuery = searchParams.get("bookingId")?.trim() || "";
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
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMoreBookings, setHasMoreBookings] = useState(true);
  const [limitSearchToRange, setLimitSearchToRange] = useState(false);
  const [filtersModalIsOpen, setFiltersModalIsOpen] = useState(false);
  const [confirmationModalIsOpen, setConfirmationModalIsOpen] = useState<{
    isOpen: boolean;
    booking: booking | null;
  }>({
    isOpen: false,
    booking: null,
  });
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [cashPosition, setCashPosition] = useState<CashPositionData | null>(
    null,
  );
  const [masterFilters, setMasterFilters] = useState<MasterFilters>(
    getDefaultMasterFilters,
  );
  const masterFiltersRef = useRef(masterFilters);
  const masterPageRef = useRef(0);
  const masterRequestIdRef = useRef(0);
  const masterLoadingMoreRef = useRef(false);
  const masterAbortControllerRef = useRef<AbortController | null>(null);
  const openedBookingIdFromQueryRef = useRef("");

  useEffect(() => {
    masterFiltersRef.current = masterFilters;
  }, [masterFilters]);

  useEffect(() => {
    if (!isMaster) return;

    openedBookingIdFromQueryRef.current = "";

    if (!bookingIdQuery) return;

    setMasterFilters((prev) =>
      prev.search === bookingIdQuery
        ? prev
        : { ...prev, search: bookingIdQuery },
    );
    setLimitSearchToRange(false);
  }, [bookingIdQuery, isMaster]);

  const fullFormattedDate = formatHeaderDate(new Date(), dateFormat);
  const today = new Date();
  const bookingCheckInIsToday = (booking: booking) =>
    booking.checkIn.toDateString() === today.toDateString();

  const bookingCheckOutIsToday = (booking: booking) =>
    booking.checkOut.toDateString() === today.toDateString();

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
          (booking) => roomChargeOutstandingAmount(booking) > 0,
        ).length,
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
    operatingStash: cashPosition?.current.operatingCash || 0,
  };
  const cashShiftHelperText = cashPosition?.activeShift
    ? `Shift ${cashPosition.activeShift.shiftNumber} · ${
        resolveStaffName(cashPosition.activeShift.staffUsername)
      }`
    : "ยังไม่เปิดกะเงินสด";

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
            id: "operatingStash",
            label: "รายได้เงินสด (฿)",
            value: stats.operatingStash,
            helperText: cashShiftHelperText,
          },
          {
            id: "guestsInHouse",
            label: "เตียงที่เช็คอินอยู่ตอนนี้",
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
          {
            id: "operatingStash",
            label: "รายได้เงินสด (฿)",
            value: stats.operatingStash,
            helperText: cashShiftHelperText,
          },
          // {
          //   id: "deposit",
          //   label: "มัดจำที่ต้องคืน (฿)",
          //   value: stats.cashReturn,
          // },
          {
            id: "guestsInHouse",
            label: "เตียงที่เช็คอินอยู่ตอนนี้",
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
    if (!searchParams.has("bookingId")) return;

    const nextSearchParams = new URLSearchParams(searchParams);
    nextSearchParams.delete("bookingId");
    setSearchParams(nextSearchParams, { replace: true });
  };

  const closeViewBookingModal = () => {
    setViewBookingBooking(null);
    clearBookingIdQueryParam();
  };

  const fetchBookingsWithFilters = useCallback(
    async (
      filters: MasterFilters,
      options: { append?: boolean } = {},
    ) => {
      const append = options.append === true;
      if (append && masterLoadingMoreRef.current) return;
      const normalizedSearch = filters.search.trim();
      const hasGlobalSearch = normalizedSearch.length >= 3;
      const useDateRange = !hasGlobalSearch || limitSearchToRange;
      const otherFilters = {
        room: filters.room,
        channel: filters.channel,
        status: filters.status,
      };

      const requestId = append
        ? masterRequestIdRef.current
        : masterRequestIdRef.current + 1;
      const requestedPage = append ? masterPageRef.current + 1 : 1;

      if (append) {
        masterLoadingMoreRef.current = true;
        setLoadingMore(true);
      } else {
        masterAbortControllerRef.current?.abort();
        masterAbortControllerRef.current = new AbortController();
        masterRequestIdRef.current = requestId;
        masterPageRef.current = 0;
        masterLoadingMoreRef.current = false;
        setLoadingMore(false);
        setHasMoreBookings(true);
        setLoading(true);
      }

      try {
        const response = await axios.get(
          `${API_URL}/bookings/getMasterBookings`,
          {
            withCredentials: true,
            signal: append
              ? undefined
              : masterAbortControllerRef.current?.signal,
            params: {
              ...otherFilters,
              ...(hasGlobalSearch ? { search: normalizedSearch } : {}),
              ...(useDateRange
                ? { from: filters.from, to: filters.to }
                : {}),
              page: requestedPage,
              limit: MASTER_BOOKINGS_PAGE_SIZE,
            },
          },
        );

        if (requestId !== masterRequestIdRef.current) return;

        const bookingsData = formatBookingsDates(response.data.bookings);
        const hasMore = response.data.pagination?.hasMore === true;
        setLastUpdated(new Date());
        if (typeof response.data.occupancy === "number") {
          setOccupancy(response.data.occupancy);
        }
        setBookings((currentBookings) => {
          if (!append) return bookingsData;

          const existingBookingIds = new Set(
            currentBookings.map((currentBooking) => currentBooking.bookingId),
          );
          return [
            ...currentBookings,
            ...bookingsData.filter(
              (currentBooking) =>
                !existingBookingIds.has(currentBooking.bookingId),
            ),
          ];
        });
        masterPageRef.current =
          response.data.pagination?.page || requestedPage;
        setHasMoreBookings(hasMore);
      } catch (err) {
        if (axios.isCancel(err)) return;
        if (requestId === masterRequestIdRef.current) {
          if (!append) setHasMoreBookings(false);
          throw err;
        }
      } finally {
        if (append) masterLoadingMoreRef.current = false;
        if (requestId === masterRequestIdRef.current) {
          if (append) {
            setLoadingMore(false);
          } else {
            setLoading(false);
          }
        }
      }
    },
    [limitSearchToRange],
  );

  const fetchBookings = useCallback(async () => {
    if (isMaster) {
      await fetchBookingsWithFilters(masterFiltersRef.current);
      return;
    }

    setLoading(true);
    try {
      const [response, cashPositionResponse] = await Promise.all([
        axios.get(`${API_URL}/bookings/getTodayBookings/${status}`, {
          withCredentials: true,
        }),
        axios.get(`${API_URL}/finance/cash-position`, {
          withCredentials: true,
        }),
      ]);

      const bookingsData = response.data.bookings;
      setLastUpdated(new Date());
      setOccupancy(response.data.occupancy);
      setBookings(formatBookingsDates(bookingsData));
      setCashPosition(cashPositionResponse.data);
    } finally {
      setLoading(false);
    }
  }, [fetchBookingsWithFilters, isMaster, status]);

  const loadMoreMasterBookings = useCallback(() => {
    if (
      !isMaster ||
      loading ||
      loadingMore ||
      !hasMoreBookings ||
      masterLoadingMoreRef.current
    ) {
      return;
    }

    fetchBookingsWithFilters(masterFiltersRef.current, { append: true }).catch(
      (err) => toast.error(getFetchErrorMessage(err)),
    );
  }, [
    fetchBookingsWithFilters,
    hasMoreBookings,
    isMaster,
    loading,
    loadingMore,
  ]);

  const updateMasterFilter = (key: keyof MasterFilters, value: string) => {
    if (key === "search" && value.trim().length >= 3) {
      setLimitSearchToRange(false);
    }
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
      loading ||
      !bookingIdQuery ||
      openedBookingIdFromQueryRef.current === bookingIdQuery
    ) {
      return;
    }

    const bookingToOpen = bookings.find((currentBooking) =>
      bookingMatchesChannelBookingId(currentBooking, bookingIdQuery),
    );

    if (!bookingToOpen) return;

    openedBookingIdFromQueryRef.current = bookingIdQuery;
    setViewBookingBooking(bookingToOpen);
  }, [bookingIdQuery, bookings, loading]);

  const renderMasterFilterFields = ({
    includeSearch = true,
  }: {
    includeSearch?: boolean;
  } = {}) => (
    <div className="home__masterFiltersInner">
      {includeSearch && (
        <div className="home__filterField home__filterField--search">
          <div className="home__filterLabelRow">
            <p className="home__filterLabel">ค้นหาการจอง</p>
            {masterFilters.search.trim().length >= 3 && (
              <button
                type="button"
                className="home__searchScopeToggle"
                onClick={() =>
                  setLimitSearchToRange((currentValue) => !currentValue)
                }
                title={
                  limitSearchToRange
                    ? "เปลี่ยนเป็นค้นหาทุกช่วงเวลา"
                    : "จำกัดผลลัพธ์ตามช่วงวันที่"
                }
              >
                <i
                  className={`bx ${
                    limitSearchToRange ? "bx-calendar" : "bx-globe"
                  }`}
                  aria-hidden="true"
                />
                <span>
                  {limitSearchToRange ? "ช่วงวันที่" : "ทุกช่วงเวลา"}
                </span>
              </button>
            )}
          </div>
          <div className="home__searchInput">
            <i className="bx bx-search" aria-hidden="true" />
            <input
              className="boxInput home__filterInput"
              type="search"
              value={masterFilters.search}
              placeholder="ชื่อแขก หรือ Booking ID"
              autoComplete="off"
              onChange={(event) =>
                updateMasterFilter("search", event.target.value)
              }
            />
          </div>
        </div>
      )}
      <div className="home__dateFilter">
        <div className="home__filterLabels">
          <p className="home__filterLabel">จากวันที่</p>
          <p className="home__filterLabel">ถึงวันที่</p>
        </div>
        <div className="home__dateInputs">
          <PreferredDateInput
            value={masterFilters.from}
            disabled={
              masterFilters.search.trim().length >= 3 &&
              !limitSearchToRange
            }
            onChange={(e) => updateMasterFilter("from", e.target.value)}
            className="boxInput home__dateInput"
          />
          <PreferredDateInput
            value={masterFilters.to}
            disabled={
              masterFilters.search.trim().length >= 3 &&
              !limitSearchToRange
            }
            onChange={(e) => updateMasterFilter("to", e.target.value)}
            className="boxInput home__dateInput"
          />
        </div>
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
      <div className="home__filterField">
        <p className="home__filterLabel">สถานะ</p>
        <Select<OptionType>
          styles={customStyles<OptionType>()}
          classNamePrefix="rs"
          placeholder="ทุกสถานะ"
          isClearable
          menuPortalTarget={document.body}
          options={bookingStatusOptions}
          value={
            bookingStatusOptions.find(
              (option) => option.value === masterFilters.status,
            ) || null
          }
          onChange={(option: SingleValue<OptionType>) =>
            updateMasterFilter("status", option?.value || "")
          }
        />
      </div>
    </div>
  );

  return (
    <main className={`home${isMaster ? " home--master" : ""}`}>
      <Modal
        open={addBookingIsOpen}
        className="home__modalCenter"
        onClose={() =>
          requestUnsavedModalClose(
            addBookingIsDirty,
            () => setAddBookingIsOpen(false),
            () =>
              setPendingUnsavedClose(() => () => setAddBookingIsOpen(false)),
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
            {renderMasterFilterFields({ includeSearch: false })}
          </div>
        </div>
      </Modal>
      <PageHeader
        title={`${status === "arrivals" ? "Arrivals | " : status === "departures" ? "Departures | " : ""}${fullFormattedDate}`}
        lastUpdated={lastUpdated}
        onRefresh={fetchBookings}
      />
      {isMaster && (
        <>
          <section className="home__masterControls">
            <div className="home__masterFilters">
              {renderMasterFilterFields()}
            </div>
            <div className="home__masterActions">
              <label className="home__mobileNameSearch">
                <i className="bx bx-search" aria-hidden="true" />
                <input
                  type="search"
                  value={masterFilters.search}
                  placeholder="ชื่อแขก หรือ Booking ID"
                  aria-label="ค้นหาด้วยชื่อแขกหรือ Booking ID"
                  autoComplete="off"
                  onChange={(event) =>
                    updateMasterFilter("search", event.target.value)
                  }
                />
              </label>
              {masterFilters.search.trim().length >= 3 && (
                <button
                  type="button"
                  className="home__mobileSearchScopeToggle"
                  onClick={() =>
                    setLimitSearchToRange((currentValue) => !currentValue)
                  }
                  aria-label={
                    limitSearchToRange
                      ? "เปลี่ยนเป็นค้นหาทุกช่วงเวลา"
                      : "จำกัดผลลัพธ์ตามช่วงวันที่"
                  }
                  title={
                    limitSearchToRange
                      ? "ค้นหาตามช่วงวันที่"
                      : "ค้นหาทุกช่วงเวลา"
                  }
                >
                  <i
                    className={`bx ${
                      limitSearchToRange ? "bx-calendar" : "bx-globe"
                    }`}
                    aria-hidden="true"
                  />
                </button>
              )}
              <ActionButton
                text="ตัวกรอง"
                icon="bx-filter"
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
        </>
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
                helperText={stat.helperText}
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
          loadingMore={loadingMore}
          hasMore={hasMoreBookings}
          onLoadMore={isMaster ? loadMoreMasterBookings : undefined}
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
