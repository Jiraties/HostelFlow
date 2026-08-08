import ActionButton from "../../components/ActionButton";
import ModalCloseButton from "../../components/ModalCloseButton";
import UnsavedChangesModal from "../../components/UnsavedChangesModal";
import Tooltip from "../../components/Tooltip";
import axios from "axios";
import Skeleton from "react-loading-skeleton";
import ManageRoomStays from "./ManageRoomStays.tsx";
import AddTransaction from "./AddTransaction.tsx";
import AddBooking from "./AddBooking.tsx";
import PassportView from "./PassportView.tsx";
import AdditionalGuestsPassport from "./AdditionalGuestsPassport.tsx";
import CheckIn from "./CheckIn.tsx";
import CheckOut from "./CheckOut.tsx";
import ResolveBooking, { type ResolveVariant } from "./ResolveBooking.tsx";
import ExtendBooking from "./ExtendBooking.tsx";
import CorrectTransaction from "./CorrectTransaction.tsx";
import TransactionCorrectionHistory from "./TransactionCorrectionHistory.tsx";
import CorrectCheckIn from "./CorrectCheckIn.tsx";
import CorrectBookingStatus from "./CorrectBookingStatus.tsx";
import ClosedRoomAvailability from "./ClosedRoomAvailability.tsx";

import { useCallback, useState, useEffect, useRef } from "react";
import { API_URL } from "../../config/api.ts";
import { platformMap } from "../../helpers/maps.ts";
import {
  advanceRoomPaymentTransaction,
  bookingFinancialPosition,
  formatBookingDates,
  isRoomChargeSettlementTransaction,
  isSameDay,
  roomChargeOutstandingAmount,
  roomChargeSettlementTransactions,
  transactionRequiresReview,
} from "../../helpers/bookingHelpers.ts";
import { requestUnsavedModalClose } from "../../helpers/modalGuards.ts";
import { rememberBooking } from "../../helpers/recentBookings.ts";
import { transactionMap } from "../../helpers/transactionDisplay.ts";
import {
  statusCorrectionActionLabel,
  statusCorrectionForStatus,
} from "../../helpers/statusCorrectionHelpers.ts";
import {
  formatCompactRoomNames,
  formatRoomStayRooms,
  getRoomStayRoomIds,
} from "../../helpers/roomStayHelpers.ts";
import { Modal, useMediaQuery } from "@mui/material";
import { useAuth } from "../../context/AuthContext.tsx";
import {
  formatDisplayDate,
  formatDisplayDateTime,
  formatDisplayTime,
} from "../../helpers/displayDate.ts";

import type { booking } from "../../types/bookingTypes";

import "./ViewBooking.css";
import Cancellation from "./Cancellation.tsx";
import toast from "react-hot-toast";

const paymentMethodIconMap = {
  OTA: "bx-bank",
  Cash: "bx-currency-notes",
  Card: "bx-credit-card-alt",
  Transfer: "bx-arrow-right-left",
  Unpaid: "bx-alert-triangle",
};

const correctableTransactionTypes = new Set<
  booking["transactions"][number]["type"]
>([
  "roomCharge",
  "deposit",
  "depositRefund",
  "cancellationRefund",
  "roomRefund",
  "settlementCharge",
  "compensation",
  "towel",
  "motorbike",
  "slowBoat",
  "joinTour",
  "extraBed",
  "pickACraft",
  "trek2D",
  "setMenu",
  "sleeperBus",
  "onlyWalk",
  "laundry",
  "bicycle",
  "car",
  "misc",
  "rainCoat",
  "passwordLock",
  "cooking",
]);

type CheckInCorrectionMode = "replace_passport" | "undo_check_in";
type CheckInCorrectionEligibility = {
  allowed: boolean;
  message: string | null;
  requiresAdmin: boolean;
  withinStaffShift: boolean;
  staffShiftId: string | null;
};

type StatusCorrectionEligibility = {
  allowed: boolean;
  correctionType: string | null;
  message: string | null;
  requiresAdmin: boolean;
  sameBusinessDate: boolean;
  affectedShiftsOpen: boolean;
};

const fetchCheckInCorrectionEligibility = (
  bookingId: string,
  signal?: AbortSignal,
) =>
  axios.get<CheckInCorrectionEligibility>(
    `${API_URL}/bookings/${bookingId}/check-in-corrections/eligibility`,
    { withCredentials: true, signal },
  );

const fetchStatusCorrectionEligibility = (
  bookingId: string,
  signal?: AbortSignal,
) =>
  axios.get<StatusCorrectionEligibility>(
    `${API_URL}/bookings/${bookingId}/status-corrections/eligibility`,
    { withCredentials: true, signal },
  );

const guestNameLines = (name: string) => {
  const parts = name.trim().split(/\s+/).filter(Boolean);

  if (parts.length <= 3) return parts;

  return [...parts.slice(0, 2), parts.slice(2).join(" ")];
};

const ViewBooking = ({
  booking,
  bookingId,
  onClose,
  onUpdated,
  removeBookingHandler,
  highlightTransactionId,
  initialAction,
  onInitialActionConsumed,
}: {
  booking: booking | null;
  bookingId?: string;
  onClose?: () => void;
  onUpdated?: (booking: booking) => void;
  removeBookingHandler: (booking: booking) => void;
  highlightTransactionId?: string;
  initialAction?: "addTransaction";
  onInitialActionConsumed?: () => void;
}) => {
  const [data, setData] = useState<booking | null>(
    booking ? formatBookingDates(booking) : null,
  );
  const [loadError, setLoadError] = useState("");
  const [loadRetryKey, setLoadRetryKey] = useState(0);
  const [manageRoomStaysIsOpen, setManageRoomStaysIsOpen] = useState(false);
  const [editBookingIsOpen, setEditBookingIsOpen] = useState(false);
  const [addTransactionIsOpen, setAddTransactionIsOpen] = useState(false);
  const [closedRoomAvailabilityIsOpen, setClosedRoomAvailabilityIsOpen] =
    useState(false);
  const [transactionEditMode, setTransactionEditMode] = useState(false);
  const [cancellationIsOpen, setCancellationIsOpen] = useState(false);
  const [checkInIsOpen, setCheckInIsOpen] = useState(false);
  const [adminHistoricalCheckIn, setAdminHistoricalCheckIn] = useState(false);
  const [checkOutIsOpen, setCheckOutIsOpen] = useState(false);
  const [correctCheckInIsOpen, setCorrectCheckInIsOpen] = useState(false);
  const [correctBookingStatusIsOpen, setCorrectBookingStatusIsOpen] =
    useState(false);
  const [checkInCorrectionMode, setCheckInCorrectionMode] =
    useState<CheckInCorrectionMode>("undo_check_in");
  const [checkInCorrectionEligibility, setCheckInCorrectionEligibility] =
    useState<{
      loading: boolean;
      allowed: boolean;
      message: string | null;
    }>({ loading: false, allowed: false, message: null });
  const [statusCorrectionEligibility, setStatusCorrectionEligibility] =
    useState<{
      loading: boolean;
      allowed: boolean;
      message: string | null;
    }>({ loading: false, allowed: false, message: null });
  const [resolveBookingIsOpen, setResolveBookingIsOpen] = useState(false);
  const [resolveVariant, setResolveVariant] =
    useState<ResolveVariant>("specialCase");
  const [extendBookingIsOpen, setExtendBookingIsOpen] = useState(false);
  const [transactionToCorrect, setTransactionToCorrect] = useState<
    booking["transactions"][number] | null
  >(null);
  const [correctionHistoryTransactionId, setCorrectionHistoryTransactionId] =
    useState<string | null>(null);
  const [correctTransactionIsDirty, setCorrectTransactionIsDirty] =
    useState(false);
  const [manageRoomStaysIsDirty, setManageRoomStaysIsDirty] = useState(false);
  const [editBookingIsDirty, setEditBookingIsDirty] = useState(false);
  const [addTransactionIsDirty, setAddTransactionIsDirty] = useState(false);
  const [closedRoomAvailabilityIsDirty, setClosedRoomAvailabilityIsDirty] =
    useState(false);
  const [cancellationIsDirty, setCancellationIsDirty] = useState(false);
  const [checkInIsDirty, setCheckInIsDirty] = useState(false);
  const [checkOutIsDirty, setCheckOutIsDirty] = useState(false);
  const [correctCheckInIsDirty, setCorrectCheckInIsDirty] = useState(false);
  const [correctBookingStatusIsDirty, setCorrectBookingStatusIsDirty] =
    useState(false);
  const [resolveBookingIsDirty, setResolveBookingIsDirty] = useState(false);
  const [extendBookingIsDirty, setExtendBookingIsDirty] = useState(false);
  const [noteIsEditing, setNoteIsEditing] = useState(false);
  const [noteDraft, setNoteDraft] = useState(booking?.note || "");
  const [noteSaving, setNoteSaving] = useState(false);
  const [pinSaving, setPinSaving] = useState(false);
  const [pendingUnsavedClose, setPendingUnsavedClose] = useState<
    (() => void) | null
  >(null);
  const [loading, setLoading] = useState(!booking);
  const [moreActionsIsOpen, setMoreActionsIsOpen] = useState(false);
  const [showTransactionOverflowAlert, setShowTransactionOverflowAlert] =
    useState(false);
  const [highlightedTransactionId, setHighlightedTransactionId] = useState("");
  const [searchAnnouncement, setSearchAnnouncement] = useState("");
  const [
    transactionOverflowAlertDismissed,
    setTransactionOverflowAlertDismissed,
  ] = useState(false);
  const priceListRef = useRef<HTMLDivElement | null>(null);
  const handledHighlightRef = useRef("");
  const handledInitialActionRef = useRef("");
  const { user, resolveStaffName } = useAuth();
  const isMobileView = useMediaQuery("(max-width:760px)");
  const dateFormat = user?.settings.dateFormat || "dd/MM/yyyy";
  const statusCorrectionType = statusCorrectionForStatus(data?.status || "");
  const statusCorrectionLabel =
    statusCorrectionActionLabel(statusCorrectionType);
  const statusCorrectionBookingId = statusCorrectionType
    ? data?.bookingId || null
    : null;

  const updateTransactionOverflowAlert = useCallback(() => {
    const priceList = priceListRef.current;
    if (!priceList) return;

    const hasHiddenTransactions =
      priceList.scrollHeight > priceList.clientHeight + 1;
    const isAtTop = priceList.scrollTop < 4;

    setShowTransactionOverflowAlert(
      hasHiddenTransactions && isAtTop && !transactionOverflowAlertDismissed,
    );
  }, [transactionOverflowAlertDismissed]);

  const scrollToHiddenTransactions = () => {
    const priceList = priceListRef.current;
    if (!priceList) return;

    setTransactionOverflowAlertDismissed(true);
    setShowTransactionOverflowAlert(false);
    priceList.scrollBy({
      top: priceList.clientHeight * 0.8,
      behavior: "smooth",
    });
  };

  const handleTransactionListScroll = () => {
    const priceList = priceListRef.current;
    if (!priceList) return;

    if (priceList.scrollTop >= 4) {
      setTransactionOverflowAlertDismissed(true);
      setShowTransactionOverflowAlert(false);
      return;
    }

    updateTransactionOverflowAlert();
  };

  useEffect(() => {
    if (!booking) return;

    setData(formatBookingDates(booking));
    setLoadError("");
    setNoteDraft(booking.note || "");
    setNoteIsEditing(false);
    setLoading(false);
    setMoreActionsIsOpen(false);
  }, [booking]);

  const correctionEligibilityBookingId =
    data?.status === "checkedIn" ? data.bookingId : null;
  const correctionEligibilityRevision = data?.revision;

  useEffect(() => {
    if (!correctionEligibilityBookingId) return;

    const controller = new AbortController();
    let deadlineTimer: number | undefined;

    const loadEligibility = async () => {
      setCheckInCorrectionEligibility((current) => ({
        ...current,
        loading: true,
      }));
      try {
        const response = await fetchCheckInCorrectionEligibility(
          correctionEligibilityBookingId,
          controller.signal,
        );
        const eligibility = response.data;
        setCheckInCorrectionEligibility({
          loading: false,
          allowed: eligibility.allowed,
          message: eligibility.message,
        });

        if (eligibility.withinStaffShift) {
          deadlineTimer = window.setTimeout(loadEligibility, 15_000);
        }
      } catch (error) {
        if (axios.isCancel(error)) return;
        setCheckInCorrectionEligibility({
          loading: false,
          allowed: false,
          message: "ไม่สามารถตรวจสอบสิทธิ์แก้ไข Check-In ได้",
        });
      }
    };

    void loadEligibility();
    return () => {
      controller.abort();
      if (deadlineTimer !== undefined) window.clearTimeout(deadlineTimer);
    };
  }, [correctionEligibilityBookingId, correctionEligibilityRevision]);

  useEffect(() => {
    if (!statusCorrectionBookingId) return;

    const controller = new AbortController();
    let refreshTimer: number | undefined;

    const loadEligibility = async () => {
      setStatusCorrectionEligibility((current) => ({
        ...current,
        loading: true,
      }));
      try {
        const response = await fetchStatusCorrectionEligibility(
          statusCorrectionBookingId,
          controller.signal,
        );
        const eligibility = response.data;
        setStatusCorrectionEligibility({
          loading: false,
          allowed: eligibility.allowed,
          message: eligibility.message,
        });

        if (
          eligibility.sameBusinessDate &&
          eligibility.affectedShiftsOpen
        ) {
          refreshTimer = window.setTimeout(loadEligibility, 15_000);
        }
      } catch (error) {
        if (axios.isCancel(error)) return;
        setStatusCorrectionEligibility({
          loading: false,
          allowed: false,
          message: "ไม่สามารถตรวจสอบสิทธิ์แก้ไขสถานะได้",
        });
      }
    };

    void loadEligibility();
    return () => {
      controller.abort();
      if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
    };
  }, [statusCorrectionBookingId, data?.revision]);

  const openCheckInCorrection = async (mode: CheckInCorrectionMode) => {
    if (!correctionEligibilityBookingId) return;

    setCheckInCorrectionEligibility((current) => ({
      ...current,
      loading: true,
    }));
    try {
      const response = await fetchCheckInCorrectionEligibility(
        correctionEligibilityBookingId,
      );
      const eligibility = response.data;
      setCheckInCorrectionEligibility({
        loading: false,
        allowed: eligibility.allowed,
        message: eligibility.message,
      });
      if (!eligibility.allowed) return;

      setCheckInCorrectionMode(mode);
      setCorrectCheckInIsOpen(true);
      setMoreActionsIsOpen(false);
    } catch {
      setCheckInCorrectionEligibility({
        loading: false,
        allowed: false,
        message: "ไม่สามารถตรวจสอบสิทธิ์แก้ไข Check-In ได้",
      });
    }
  };

  const openStatusCorrection = async () => {
    if (!statusCorrectionBookingId) return;

    setStatusCorrectionEligibility((current) => ({
      ...current,
      loading: true,
    }));
    try {
      const response = await fetchStatusCorrectionEligibility(
        statusCorrectionBookingId,
      );
      const eligibility = response.data;
      setStatusCorrectionEligibility({
        loading: false,
        allowed: eligibility.allowed,
        message: eligibility.message,
      });
      if (!eligibility.allowed) return;

      setCorrectBookingStatusIsOpen(true);
      setMoreActionsIsOpen(false);
    } catch {
      setStatusCorrectionEligibility({
        loading: false,
        allowed: false,
        message: "ไม่สามารถตรวจสอบสิทธิ์แก้ไขสถานะได้",
      });
    }
  };

  useEffect(() => {
    if (data) return;

    const fetchBooking = async () => {
      try {
        setLoading(true);
        setLoadError("");

        const res = await axios.get(
          `${API_URL}/bookings/getBookingById/` + bookingId,
          { withCredentials: true },
        );

        const formattedBooking = formatBookingDates(res.data);
        setData(formattedBooking);
        setNoteDraft(formattedBooking.note || "");
      } catch (err) {
        const message = axios.isAxiosError<{
          error?: string;
          message?: string;
        }>(err)
          ? err.response?.data.message || err.response?.data.error
          : null;

        setLoadError(
          message || "ไม่สามารถโหลดข้อมูลการจองได้ กรุณาลองอีกครั้ง",
        );
      } finally {
        setLoading(false);
      }
    };

    fetchBooking();
  }, [bookingId, data, loadRetryKey]);

  useEffect(() => {
    const animationFrame = requestAnimationFrame(
      updateTransactionOverflowAlert,
    );

    return () => cancelAnimationFrame(animationFrame);
  }, [data?.transactions.length, updateTransactionOverflowAlert]);

  useEffect(() => {
    if (!data) return;
    rememberBooking(user?.userId, data.bookingId);
  }, [data, user?.userId]);

  useEffect(() => {
    if (
      !data ||
      initialAction !== "addTransaction" ||
      handledInitialActionRef.current === data.bookingId
    ) {
      return;
    }
    handledInitialActionRef.current = data.bookingId;
    setAddTransactionIsOpen(true);
    onInitialActionConsumed?.();
  }, [data, initialAction, onInitialActionConsumed]);

  useEffect(() => {
    if (
      !data ||
      !highlightTransactionId ||
      handledHighlightRef.current === highlightTransactionId
    ) {
      return;
    }
    handledHighlightRef.current = highlightTransactionId;
    let highlightTimeoutId = 0;
    const animationFrame = requestAnimationFrame(() => {
      const target = Array.from(
        priceListRef.current?.querySelectorAll<HTMLElement>(
          "[data-search-transaction-id]",
        ) || [],
      ).find(
        (element) =>
          element.dataset.searchTransactionId === highlightTransactionId,
      );
      if (!target) {
        setSearchAnnouncement("ไม่พบรายการที่ตรงกันใน Booking นี้");
        toast.error("ไม่พบรายการที่ตรงกัน");
        return;
      }
      setHighlightedTransactionId(highlightTransactionId);
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      setSearchAnnouncement("เลื่อนไปยังรายการที่ค้นหาแล้ว");
      highlightTimeoutId = window.setTimeout(
        () => setHighlightedTransactionId(""),
        4000,
      );
    });
    return () => {
      cancelAnimationFrame(animationFrame);
      window.clearTimeout(highlightTimeoutId);
    };
  }, [data, highlightTransactionId]);

  if (!loading && loadError && !data) {
    return (
      <div className="viewBooking__wrapper viewBooking__loadError">
        {onClose && <ModalCloseButton onClick={onClose} />}
        <i className="bx bx-alert-circle" />
        <h1>โหลดข้อมูลการจองไม่สำเร็จ</h1>
        <p>{loadError}</p>
        <ActionButton
          text="ลองโหลดอีกครั้ง"
          icon="bx-refresh-cw"
          highlight
          onClick={() => setLoadRetryKey((key) => key + 1)}
        />
      </div>
    );
  }

  if (loading || !data) {
    return (
      <div className="viewBooking__wrapper">
        <div className="viewBooking__top">
          {onClose && <ModalCloseButton onClick={onClose} />}
          <h1 className="viewBooking__name">
            <Skeleton height={28} width={180} />
            <Skeleton height={28} width={120} />
          </h1>

          <div className="viewBooking__roomAndIsCheckedIn">
            <h1>
              <Skeleton height={24} width={100} />
            </h1>

            <div className="viewBooking__statusBadge">
              <Skeleton height={20} width={100} />
            </div>
          </div>
        </div>

        <div className="viewBooking__main">
          <div className="viewBooking__mainLeft">
            {[...Array(6)].map((_, i) => (
              <div className="viewBooking__item" key={i}>
                <Skeleton width={120} height={16} />
                <Skeleton width={180} height={16} />
              </div>
            ))}
          </div>

          <div className="viewBooking__mainRight">
            <div className="viewBooking__priceList">
              {[...Array(3)].map((_, i) => (
                <div
                  className="viewBooking__price"
                  key={i}
                  style={{ display: "flex", justifyContent: "space-between" }}
                >
                  <div style={{ display: "flex", gap: "1rem" }}>
                    <Skeleton circle width={32} height={32} />
                    <div>
                      <Skeleton width={120} />
                      <Skeleton width={80} />
                    </div>
                  </div>

                  <Skeleton width={80} />
                </div>
              ))}

              <div className="viewBooking__addTransaction">
                <Skeleton width={150} />
              </div>
            </div>

            <div className="viewBooking__roomStays">
              {[...Array(2)].map((_, i) => (
                <div className="viewBooking__roomStay" key={i}>
                  <Skeleton width={80} />
                  <div style={{ display: "flex", gap: "1rem" }}>
                    <Skeleton width={50} />
                    <Skeleton width={50} />
                  </div>
                </div>
              ))}

              <div className="viewBooking__addTransaction">
                <Skeleton width={150} />
              </div>
            </div>
          </div>
        </div>

        <div className="viewBooking__actions">
          <div className="viewBooking__actionsLeft">
            <Skeleton width={120} height={36} />
            <Skeleton width={120} height={36} />
            <Skeleton width={120} height={36} />
          </div>

          <Skeleton width={140} height={36} />
        </div>
      </div>
    );
  }

  const today = new Date();
  const checkInDate = new Date(data.checkIn);
  const checkOutDate = new Date(data.checkOut);
  const todayDateOnly = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );
  const checkInDateOnly = new Date(
    checkInDate.getFullYear(),
    checkInDate.getMonth(),
    checkInDate.getDate(),
  );
  const checkOutDateOnly = new Date(
    checkOutDate.getFullYear(),
    checkOutDate.getMonth(),
    checkOutDate.getDate(),
  );
  const checkInIsBeforeToday = checkInDateOnly < todayDateOnly;
  const nightsLate = Math.max(
    Math.round(
      (todayDateOnly.getTime() - checkInDateOnly.getTime()) / 86400000,
    ),
    0,
  );
  const isPastCheckOutDate = todayDateOnly > checkOutDateOnly;
  const isLateCheckIn =
    data.status === "booked" && checkInIsBeforeToday && !isPastCheckOutDate;
  const isNoShow = data.status === "booked" && isPastCheckOutDate;
  const isEarlyCheckOut =
    data.status === "checkedIn" && todayDateOnly < checkOutDateOnly;
  const hasCheckedIn =
    Boolean(data.checkedInAt) ||
    data.status === "checkedIn" ||
    data.status === "checkedOut";
  const actualCheckOutAt =
    data.checkout?.checkedOutAt ||
    (data.status === "checkedOut" &&
    data.resolution?.finalStatus === "checkedOut"
      ? data.resolution.resolvedAt
      : undefined);
  const checkInWasOnDifferentDate = Boolean(
    data.checkedInAt && !isSameDay(new Date(data.checkedInAt), checkInDate),
  );
  const checkOutWasOnDifferentDate = Boolean(
    actualCheckOutAt && !isSameDay(new Date(actualCheckOutAt), checkOutDate),
  );

  const statusDeterminer = (status: string, usedFor: string) => {
    const checkInIsToday = isSameDay(today, checkInDate);

    switch (status) {
      case "booked":
        if (checkInIsToday) {
          return usedFor === "classname" ? "notCheckedIn" : "รอ Check-In";
        }

        return usedFor === "classname" ? "booked" : "จองแล้ว";
      case "checkedIn":
        return usedFor === "classname" ? "checkedIn" : "Check-In แล้ว";
      case "checkedOut":
        return usedFor === "classname" ? "checkedOut" : "Check-Out แล้ว";
      case "cancelled":
        return usedFor === "classname" ? "cancelled" : "ถูกยกเลิก";
      case "noShow":
        return usedFor === "classname" ? "noShow" : "No-Show";
      default:
        return usedFor === "classname" ? "unknown" : status;
    }
  };

  const roomReleaseStatusDeterminer = (
    status: "released" | "blocked",
    usedFor: string,
  ) => {
    switch (status) {
      case "released":
        if (usedFor === "icon") return "bx-door-open";
        return usedFor === "classname" ? "released" : "เปิดให้จอง";
      case "blocked":
        if (usedFor === "icon") return "bx-lock-keyhole";
        return usedFor === "classname" ? "blocked" : "ไม่เปิดให้จอง";
      default:
        return usedFor === "classname" ? "unknown" : "";
    }
  };

  const compactRoomsName = data.roomStays.map(formatRoomStayRooms).join(", ");
  const fullRoomsName = formatCompactRoomNames(
    data.roomStays.flatMap(getRoomStayRoomIds),
  );
  const identitySection = hasCheckedIn ? (
    <>
      <PassportView
        key={`${data.bookingId}-${data.revision}`}
        bookingId={data.bookingId}
        correctionDisabled={
          checkInCorrectionEligibility.loading ||
          !checkInCorrectionEligibility.allowed
        }
        correctionDisabledReason={
          checkInCorrectionEligibility.loading
            ? "กำลังตรวจสอบสิทธิ์..."
            : checkInCorrectionEligibility.message || undefined
        }
        onCorrectPassport={() => {
          void openCheckInCorrection("replace_passport");
        }}
      />
      <AdditionalGuestsPassport
        bookingId={data.bookingId}
        revision={data.revision}
        primaryNationality={data.passport?.nationality}
        onRevisionChange={(revision) => {
          const updatedBooking = { ...data, revision };
          setData(updatedBooking);
          onUpdated?.(updatedBooking);
        }}
      />
    </>
  ) : null;
  const storedOriginalSegment = (data.commercialSegments || []).find(
    (segment) => segment.kind === "original",
  );
  const extensionSegments = (data.commercialSegments || []).filter(
    (segment) => segment.kind === "extension",
  );
  const bookingChannelRows = [
    {
      key: storedOriginalSegment?._id || "original",
      platformId: storedOriginalSegment?.platformId || data.platformId,
      from: storedOriginalSegment?.from || data.checkIn,
      to:
        storedOriginalSegment?.to ||
        extensionSegments[0]?.from ||
        data.checkOut,
      channelBookingId:
        storedOriginalSegment?.channelBookingId || data.bookingId,
    },
    ...extensionSegments.map((segment) => ({
      key: segment._id || segment.transactionId,
      platformId: segment.platformId,
      from: segment.from,
      to: segment.to,
      channelBookingId: segment.channelBookingId,
    })),
  ];

  const formatTransactionAmount = (
    transaction: booking["transactions"][number],
  ) => {
    const amountText = transaction.amount.toLocaleString("th-TH");
    return transaction.direction === "out" ||
      transaction.type === "depositRefund" ||
      transaction.type === "cancellationRefund"
      ? `-${amountText} THB`
      : `${amountText} THB`;
  };
  const roomChargePayments = roomChargeSettlementTransactions(data);
  const transactionName = (transaction: booking["transactions"][number]) => {
    if (transaction.type === "misc" && transaction.note?.trim()) {
      return `Misc · ${transaction.note.trim()}`;
    }

    if (
      transaction.type === "deposit" &&
      transaction.sourceAction === "ADD_TRANSACTION"
    ) {
      return "รับมัดจำเพิ่ม";
    }

    if (
      transaction.type === "adjustment" &&
      transaction.reasonOfAdjustment === "rounding"
    ) {
      return "ปัดเศษยอดเงินสด";
    }

    const advancePayment = data.advancePayment;
    if (advancePayment && transaction._id === advancePayment.transactionId) {
      return advancePayment.calculationMode === "amount"
        ? "ค่าห้องล่วงหน้า"
        : `ค่าห้องล่วงหน้า ${advancePayment.percentage}%`;
    }

    if (
      transaction.type === "roomCharge" &&
      transaction.sourceAction === "EXTEND_BOOKING"
    ) {
      const extensionPlatformId =
        transaction.platformId ||
        (data.commercialSegments || []).find(
          (segment) => segment.transactionId === transaction._id,
        )?.platformId;
      const platformLabel = extensionPlatformId
        ? platformMap[extensionPlatformId]?.label
        : undefined;
      return `${platformLabel || "Unknown channel"} · ค่าเพิ่มคืน`;
    }

    if (
      transaction.type === "roomCharge" &&
      transaction.sourceAction !== "EXTEND_BOOKING" &&
      roomChargePayments.length > 0
    ) {
      return "ค่าห้องทั้งหมด";
    }

    if (isRoomChargeSettlementTransaction(data, transaction)) {
      return "ชำระค่าห้องส่วนที่เหลือ";
    }

    return transactionMap[transaction.type].name;
  };

  const isChildTransaction = (transaction: booking["transactions"][number]) =>
    transaction.type === "cardSurcharge" ||
    transaction.type === "depositRefund" ||
    transaction.type === "cancellationRefund" ||
    transaction.type === "roomChargeWriteOff" ||
    transaction._id === data.advancePayment?.transactionId ||
    (transaction.type === "adjustment" &&
      Boolean(transaction.relatedTransactionId));

  const outstandingRoomChargeAmount = roomChargeOutstandingAmount(data);
  const financialPosition = bookingFinancialPosition(data);
  const advancePaymentTransaction = advanceRoomPaymentTransaction(data);
  let attachNextSettlementCardSurchargeToRoomCharge = false;

  const groupedTransactions = data.transactions.reduce<
    {
      transaction: booking["transactions"][number];
      children: booking["transactions"];
    }[]
  >((groups, transaction) => {
    if (
      transaction._id === data.advancePayment?.transactionId ||
      transaction.type === "roomChargeWriteOff"
    ) {
      const roomChargeGroup = groups.find(
        (group) => group.transaction.type === "roomCharge",
      );

      if (roomChargeGroup) {
        roomChargeGroup.children.push(transaction);
      } else {
        groups.push({ transaction, children: [] });
      }
      return groups;
    }

    if (isRoomChargeSettlementTransaction(data, transaction)) {
      attachNextSettlementCardSurchargeToRoomCharge =
        transaction.paymentMethod === "Card";

      const roomChargeGroup = groups.find(
        (group) =>
          group.transaction.type === "roomCharge" &&
          group.transaction.sourceAction !== "EXTEND_BOOKING",
      );

      if (roomChargeGroup) {
        roomChargeGroup.children.push(transaction);
      } else {
        // Legacy fallback: retain the payment as a visible main row when its
        // original room charge is missing instead of silently dropping it.
        groups.push({ transaction, children: [] });
      }
      return groups;
    }

    if (transaction.type === "adjustment" && transaction.relatedTransactionId) {
      const linkedGroup = groups.find(
        (group) =>
          group.transaction._id === transaction.relatedTransactionId ||
          group.children.some(
            (child) => child._id === transaction.relatedTransactionId,
          ),
      );

      if (linkedGroup) {
        linkedGroup.children.push(transaction);
      } else {
        groups.push({ transaction, children: [] });
      }
      return groups;
    }

    if (
      transaction.type === "roomCharge" &&
      transaction.sourceAction === "EXTEND_BOOKING"
    ) {
      const originalRoomChargeGroup = groups.find(
        (group) =>
          group.transaction.type === "roomCharge" &&
          group.transaction.sourceAction !== "EXTEND_BOOKING",
      );

      if (originalRoomChargeGroup) {
        originalRoomChargeGroup.children.push(transaction);
      } else {
        groups.push({ transaction, children: [] });
      }
      return groups;
    }

    if (transaction.type === "cardSurcharge") {
      const lastGroup = groups[groups.length - 1];
      const roomChargeGroup = groups.find(
        (group) => group.transaction.type === "roomCharge",
      );
      const linkedGroup = transaction.relatedTransactionId
        ? groups.find(
            (group) =>
              group.transaction._id === transaction.relatedTransactionId ||
              group.children.some(
                (child) => child._id === transaction.relatedTransactionId,
              ),
          )
        : undefined;

      if (linkedGroup) {
        linkedGroup.children.push(transaction);
        attachNextSettlementCardSurchargeToRoomCharge = false;
        return groups;
      }

      if (
        roomChargeGroup &&
        attachNextSettlementCardSurchargeToRoomCharge &&
        transaction.relatedTransactionType === "settlementCharge"
      ) {
        roomChargeGroup.children.push(transaction);
        attachNextSettlementCardSurchargeToRoomCharge = false;
        return groups;
      }

      attachNextSettlementCardSurchargeToRoomCharge = false;

      if (lastGroup && !isChildTransaction(lastGroup.transaction)) {
        lastGroup.children.push(transaction);
      } else {
        groups.push({ transaction, children: [] });
      }
      return groups;
    }

    attachNextSettlementCardSurchargeToRoomCharge = false;

    if (
      transaction.type === "deposit" &&
      transaction.sourceAction === "ADD_TRANSACTION"
    ) {
      const originalDepositGroup = groups.find(
        (group) => group.transaction.type === "deposit",
      );

      if (originalDepositGroup) {
        originalDepositGroup.children.push(transaction);
      } else {
        groups.push({ transaction, children: [] });
      }
      return groups;
    }

    if (transaction.type === "depositRefund") {
      const depositGroup = [...groups]
        .reverse()
        .find((group) => group.transaction.type === "deposit");

      if (depositGroup) {
        depositGroup.children.push(transaction);
      } else {
        groups.push({ transaction, children: [] });
      }
      return groups;
    }

    if (transaction.type === "cancellationRefund") {
      const paidGroup = [...groups]
        .reverse()
        .find(
          (group) =>
            !isChildTransaction(group.transaction) &&
            group.transaction.paymentMethod === transaction.paymentMethod,
        );

      if (paidGroup) {
        paidGroup.children.push(transaction);
      } else {
        groups.push({ transaction, children: [] });
      }
      return groups;
    }

    groups.push({ transaction, children: [] });
    return groups;
  }, []);

  const renderPaymentMethod = (
    transaction: booking["transactions"][number],
    compact = false,
  ) => {
    if (transaction.type === "roomChargeWriteOff") {
      return (
        <div
          className={
            "viewBooking__paymentMethod" +
            (compact ? " viewBooking__paymentMethod--compact" : "")
          }
        >
          <p>ปิดยอด</p>
          <i className="bx bx-check" />
        </div>
      );
    }

    if (
      transaction.type === "roomCharge" &&
      transaction.sourceAction !== "EXTEND_BOOKING" &&
      roomChargePayments.length > 0
    ) {
      const hasOutstandingBalance = outstandingRoomChargeAmount > 0;

      return (
        <div
          className={
            "viewBooking__paymentMethod" +
            (compact ? " viewBooking__paymentMethod--compact" : "")
          }
        >
          <p className={hasOutstandingBalance ? "viewBooking__unpaid" : ""}>
            {hasOutstandingBalance ? "Unpaid" : "Paid"}
          </p>
          <i
            className={
              hasOutstandingBalance
                ? "bx bx-alert-triangle viewBooking__unpaid"
                : "bx bx-check-circle"
            }
          />
        </div>
      );
    }

    const paymentMethod = transaction.paymentMethod;

    return (
      <div
        className={
          "viewBooking__paymentMethod" +
          (compact ? " viewBooking__paymentMethod--compact" : "")
        }
      >
        <p className={paymentMethod === "Unpaid" ? "viewBooking__unpaid" : ""}>
          {paymentMethod}
        </p>
        {paymentMethod === "Unpaid" ? (
          <i className="bx bx-alert-triangle viewBooking__unpaid" />
        ) : (
          <i className={"bx " + paymentMethodIconMap[paymentMethod]} />
        )}
      </div>
    );
  };

  const renderReviewMeta = (transaction: booking["transactions"][number]) => {
    const isReviewed = transaction.reviewStatus === "reviewed";
    const needsReview = transactionRequiresReview(transaction);
    const linkedTransaction = transaction.relatedTransactionId
      ? data.transactions.find(
          (existingTransaction) =>
            existingTransaction._id === transaction.relatedTransactionId,
        )
      : null;

    const shouldShowNote =
      transaction.type !== "adjustment" && transaction.note;
    const infoItems = [
      linkedTransaction
        ? `ปรับจาก ${transactionMap[linkedTransaction.type].name} · ${formatTransactionAmount(
            linkedTransaction,
          )}`
        : "",
      shouldShowNote ? transaction.note : "",
    ].filter(Boolean);

    if (!isReviewed && !needsReview && !shouldShowNote && !linkedTransaction) {
      return null;
    }

    return (
      <div className="viewBooking__transactionMeta">
        {needsReview && (
          <span className="viewBooking__reviewBadge">รอตรวจสอบ</span>
        )}
        {isReviewed && (
          <span className="viewBooking__reviewBadge viewBooking__reviewBadge--approved">
            อนุมัติแล้ว
          </span>
        )}
        {infoItems.length > 0 && (
          <Tooltip
            className="viewBooking__transactionInfo"
            ariaLabel="ข้อมูลเพิ่มเติมของรายการ"
            content={
              <>
                {infoItems.map((item, index) => (
                  <span key={`${item}-${index}`}>{item}</span>
                ))}
              </>
            }
          >
            <i className="bx bx-info-circle" />
          </Tooltip>
        )}
      </div>
    );
  };

  const renderCorrectionActions = (
    transaction: booking["transactions"][number],
    compact = false,
  ) => {
    const transactionId =
      transaction.originalTransactionId || transaction._id || "";
    if (!transactionId) return null;
    const hasHistory =
      Boolean(transaction.corrected) ||
      (data.transactionCorrections || []).some(
        (correction) => correction.targetTransactionId === transactionId,
      );
    if (!hasHistory) return null;

    return (
      <div
        className={
          "viewBooking__correctionActions" +
          (compact ? " viewBooking__correctionActions--compact" : "")
        }
      >
        <button
          type="button"
          className="viewBooking__correctedBadge"
          onClick={() => setCorrectionHistoryTransactionId(transactionId)}
        >
          <i className="bx bx-history" />
          <p>มีการแก้ไข</p>
        </button>
      </div>
    );
  };

  const renderTransactionEndActions = (
    transaction: booking["transactions"][number],
    compact = false,
  ) => {
    const canEditTransaction =
      !data.voided && correctableTransactionTypes.has(transaction.type);

    return (
      <div
        className={
          "viewBooking__transactionEndActions" +
          (compact ? " viewBooking__transactionEndActions--compact" : "") +
          (canEditTransaction
            ? " viewBooking__transactionEndActions--editable"
            : "") +
          (transactionEditMode
            ? " viewBooking__transactionEndActions--editing"
            : "")
        }
      >
        {renderPaymentMethod(transaction, compact)}
        {transactionEditMode && (
          <div className="viewBooking__editRailCell">
            {canEditTransaction && (
              <button
                type="button"
                className="viewBooking__inlineEditButton"
                aria-label={`แก้ไข ${transactionName(transaction)}`}
                title={`แก้ไข ${transactionName(transaction)}`}
                onClick={() => setTransactionToCorrect(transaction)}
              >
                <i className="bx bx-edit" />
              </button>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderChildTransaction = (
    transaction: booking["transactions"][number],
    index: number,
    siblings: booking["transactions"] = [],
  ) => {
    const linkedTransaction = transaction.relatedTransactionId
      ? data.transactions.find(
          (existingTransaction) =>
            existingTransaction._id === transaction.relatedTransactionId,
        )
      : null;
    const needsReview = transactionRequiresReview(transaction);
    const isReviewed = transaction.reviewStatus === "reviewed";
    const infoItems = [
      transaction.createdAt
        ? `บันทึก: ${formatDisplayDateTime(transaction.createdAt, dateFormat)}`
        : "",
      transaction.createdBy
        ? `โดย: ${resolveStaffName(transaction.createdBy)}`
        : "",
      transaction.note ? `หมายเหตุ: ${transaction.note}` : "",
      transaction.reference ? `อ้างอิง: ${transaction.reference}` : "",
      linkedTransaction
        ? `เชื่อมกับ: ${transactionMap[linkedTransaction.type].name} · ${formatTransactionAmount(
            linkedTransaction,
          )}`
        : "",
      needsReview ? "สถานะ: รอตรวจสอบ" : "",
      isReviewed
        ? `สถานะ: อนุมัติแล้ว${
            transaction.reviewedBy
              ? ` โดย ${resolveStaffName(transaction.reviewedBy)}`
              : ""
          }${
            transaction.reviewedAt
              ? ` · ${formatDisplayDateTime(transaction.reviewedAt, dateFormat)}`
              : ""
          }`
        : "",
    ].filter(Boolean);

    return (
      <div
        className={
          "viewBooking__priceChild" +
          (index < siblings.length - 1
            ? " viewBooking__priceChild--continues"
            : "") +
          (transaction.type === "roomCharge" &&
          transaction.sourceAction === "EXTEND_BOOKING"
            ? " viewBooking__priceChild--extension"
            : "") +
          (transaction._id === highlightedTransactionId
            ? " viewBooking__priceChild--searchHighlight"
            : "")
        }
        data-search-transaction-id={transaction._id}
        aria-current={
          transaction._id === highlightedTransactionId ? "true" : undefined
        }
        key={
          transaction._id ||
          `${transaction.type}-${transaction.amount}-${index}`
        }
      >
        <div className="viewBooking__priceChildMain">
          <span className="viewBooking__priceChildMarker" />
          <div className="viewBooking__priceChildDetails">
            <div className="viewBooking__priceChildSummary">
              <p className="viewBooking__priceChildText">
                <span className="viewBooking__priceChildAmount">
                  {formatTransactionAmount(transaction)}
                </span>
                <span>{transactionName(transaction)}</span>
              </p>
              {infoItems.length > 0 && (
                <Tooltip
                  className="viewBooking__priceChildInfo"
                  ariaLabel="ข้อมูลเพิ่มเติมของรายการย่อย"
                  content={
                    <>
                      {infoItems.map((item) => (
                        <span key={item}>{item}</span>
                      ))}
                    </>
                  }
                >
                  <i className="bx bx-info-circle" />
                </Tooltip>
              )}
            </div>
            {renderCorrectionActions(transaction, true)}
          </div>
        </div>
        {renderTransactionEndActions(transaction, true)}
      </div>
    );
  };

  const updateBooking = (updatedBooking: booking) => {
    const formattedBooking = formatBookingDates(updatedBooking);

    setData(formattedBooking);
    setNoteDraft(formattedBooking.note || "");
    onUpdated?.(formattedBooking);
  };

  const saveNoteHandler = async () => {
    if (noteSaving || noteDraft === (data.note || "")) {
      setNoteIsEditing(false);
      return;
    }

    setNoteSaving(true);

    try {
      const response = await axios.patch(
        `${API_URL}/bookings/updateBookingNote/${data.bookingId}`,
        { note: noteDraft },
        { withCredentials: true },
      );

      if (response.data.booking) {
        updateBooking(response.data.booking);
      }

      setNoteIsEditing(false);
    } finally {
      setNoteSaving(false);
    }
  };

  const togglePinHandler = async () => {
    if (pinSaving) return;

    const nextPinned = !data.pinned;
    setPinSaving(true);

    try {
      const response = await axios.patch(
        `${API_URL}/bookings/pinBooking/${data.bookingId}`,
        { pinned: nextPinned },
        { withCredentials: true },
      );

      if (response.data.booking) {
        updateBooking(response.data.booking);
      }
    } finally {
      setPinSaving(false);
    }
  };

  return (
    <>
      <Modal
        open={Boolean(transactionToCorrect)}
        className="home__modalCenter"
        onClose={() =>
          requestUnsavedModalClose(
            correctTransactionIsDirty,
            () => setTransactionToCorrect(null),
            () =>
              setPendingUnsavedClose(() => () => setTransactionToCorrect(null)),
          )
        }
      >
        {transactionToCorrect ? (
          <CorrectTransaction
            booking={data}
            transaction={transactionToCorrect}
            onDirtyChange={setCorrectTransactionIsDirty}
            onClose={() => setTransactionToCorrect(null)}
            onUpdated={(updatedBooking) => {
              updateBooking(updatedBooking);
              setTransactionToCorrect(null);
              setTransactionEditMode(false);
            }}
          />
        ) : (
          <span />
        )}
      </Modal>
      <Modal
        open={Boolean(correctionHistoryTransactionId)}
        className="home__modalCenter"
        onClose={() => setCorrectionHistoryTransactionId(null)}
      >
        {correctionHistoryTransactionId ? (
          <TransactionCorrectionHistory
            booking={data}
            transactionId={correctionHistoryTransactionId}
            onClose={() => setCorrectionHistoryTransactionId(null)}
          />
        ) : (
          <span />
        )}
      </Modal>
      <Modal
        open={extendBookingIsOpen}
        className="home__modalCenter"
        onClose={() =>
          requestUnsavedModalClose(
            extendBookingIsDirty,
            () => setExtendBookingIsOpen(false),
            () =>
              setPendingUnsavedClose(() => () => setExtendBookingIsOpen(false)),
          )
        }
      >
        <ExtendBooking
          booking={data}
          onClose={() => setExtendBookingIsOpen(false)}
          onDirtyChange={setExtendBookingIsDirty}
          onUpdated={(updatedBooking) => {
            updateBooking(updatedBooking);
            setExtendBookingIsOpen(false);
          }}
        />
      </Modal>
      <Modal
        open={cancellationIsOpen}
        className="home__modalCenter"
        onClose={() =>
          requestUnsavedModalClose(
            cancellationIsDirty,
            () => setCancellationIsOpen(false),
            () =>
              setPendingUnsavedClose(() => () => setCancellationIsOpen(false)),
          )
        }
      >
        <Cancellation
          booking={data}
          onClose={() => setCancellationIsOpen(false)}
          onDirtyChange={setCancellationIsDirty}
          onUpdated={(updatedBooking) => {
            updateBooking(updatedBooking);
            setCancellationIsOpen(false);
          }}
        />
      </Modal>
      <Modal
        open={checkInIsOpen}
        className="home__modalCenter"
        onClose={() =>
          requestUnsavedModalClose(
            checkInIsDirty,
            () => {
              setCheckInIsOpen(false);
              setAdminHistoricalCheckIn(false);
            },
            () =>
              setPendingUnsavedClose(() => () => {
                setCheckInIsOpen(false);
                setAdminHistoricalCheckIn(false);
              }),
          )
        }
      >
        <CheckIn
          booking={data}
          isLateCheckIn={isLateCheckIn}
          nightsLate={nightsLate}
          adminHistoricalCheckIn={adminHistoricalCheckIn}
          onClose={() => {
            setCheckInIsOpen(false);
            setAdminHistoricalCheckIn(false);
          }}
          onDirtyChange={setCheckInIsDirty}
          handleCheckInSuccess={(updatedBooking) => {
            updateBooking(updatedBooking);
            setCheckInIsOpen(false);
            setAdminHistoricalCheckIn(false);
          }}
        />
      </Modal>
      <Modal
        open={correctCheckInIsOpen}
        className="home__modalCenter"
        onClose={() =>
          requestUnsavedModalClose(
            correctCheckInIsDirty,
            () => setCorrectCheckInIsOpen(false),
            () =>
              setPendingUnsavedClose(
                () => () => setCorrectCheckInIsOpen(false),
              ),
          )
        }
      >
        <CorrectCheckIn
          booking={data}
          mode={checkInCorrectionMode}
          onClose={() => setCorrectCheckInIsOpen(false)}
          onDirtyChange={setCorrectCheckInIsDirty}
          onUpdated={(updatedBooking) => {
            updateBooking(updatedBooking);
            setCorrectCheckInIsOpen(false);
          }}
        />
      </Modal>
      <Modal
        open={correctBookingStatusIsOpen}
        className="home__modalCenter"
        onClose={() =>
          requestUnsavedModalClose(
            correctBookingStatusIsDirty,
            () => setCorrectBookingStatusIsOpen(false),
            () =>
              setPendingUnsavedClose(
                () => () => setCorrectBookingStatusIsOpen(false),
              ),
          )
        }
      >
        {statusCorrectionType ? (
          <CorrectBookingStatus
            booking={data}
            correctionType={statusCorrectionType}
            onClose={() => setCorrectBookingStatusIsOpen(false)}
            onDirtyChange={setCorrectBookingStatusIsDirty}
            onUpdated={(updatedBooking) => {
              updateBooking(updatedBooking);
              setCorrectBookingStatusIsOpen(false);
            }}
          />
        ) : (
          <></>
        )}
      </Modal>
      <Modal
        open={checkOutIsOpen}
        className="home__modalCenter"
        onClose={() =>
          requestUnsavedModalClose(
            checkOutIsDirty,
            () => setCheckOutIsOpen(false),
            () => setPendingUnsavedClose(() => () => setCheckOutIsOpen(false)),
          )
        }
      >
        <CheckOut
          booking={data}
          isEarlyCheckOut={isEarlyCheckOut}
          onClose={() => setCheckOutIsOpen(false)}
          onDirtyChange={setCheckOutIsDirty}
          onRecordPayment={() => {
            setCheckOutIsOpen(false);
            setAddTransactionIsOpen(true);
          }}
          handleCheckOutSuccess={(updatedBooking) => {
            updateBooking(updatedBooking);
            setCheckOutIsOpen(false);
          }}
        />
      </Modal>
      <Modal
        open={resolveBookingIsOpen}
        className="home__modalCenter"
        onClose={() =>
          requestUnsavedModalClose(
            resolveBookingIsDirty,
            () => setResolveBookingIsOpen(false),
            () =>
              setPendingUnsavedClose(
                () => () => setResolveBookingIsOpen(false),
              ),
          )
        }
      >
        <ResolveBooking
          booking={data}
          variant={resolveVariant}
          onClose={() => setResolveBookingIsOpen(false)}
          onDirtyChange={setResolveBookingIsDirty}
          onUpdated={(updatedBooking) => {
            updateBooking(updatedBooking);
            setResolveBookingIsOpen(false);
          }}
        />
      </Modal>
      <Modal
        open={addTransactionIsOpen}
        onClose={() =>
          requestUnsavedModalClose(
            addTransactionIsDirty,
            () => setAddTransactionIsOpen(false),
            () =>
              setPendingUnsavedClose(
                () => () => setAddTransactionIsOpen(false),
              ),
          )
        }
        className="home__modalCenter"
      >
        <AddTransaction
          booking={data}
          onClose={() => setAddTransactionIsOpen(false)}
          onDirtyChange={setAddTransactionIsDirty}
          onUpdated={(updatedBooking) => {
            updateBooking(updatedBooking);
            setAddTransactionIsOpen(false);
          }}
        />
      </Modal>
      <Modal
        open={closedRoomAvailabilityIsOpen}
        className="home__modalCenter"
        onClose={() =>
          requestUnsavedModalClose(
            closedRoomAvailabilityIsDirty,
            () => setClosedRoomAvailabilityIsOpen(false),
            () =>
              setPendingUnsavedClose(
                () => () => setClosedRoomAvailabilityIsOpen(false),
              ),
          )
        }
      >
        <ClosedRoomAvailability
          booking={data}
          onClose={() => setClosedRoomAvailabilityIsOpen(false)}
          onDirtyChange={setClosedRoomAvailabilityIsDirty}
          onUpdated={(updatedBooking) => {
            updateBooking(updatedBooking);
            setClosedRoomAvailabilityIsOpen(false);
          }}
        />
      </Modal>
      <Modal
        open={manageRoomStaysIsOpen}
        onClose={() =>
          requestUnsavedModalClose(
            manageRoomStaysIsDirty,
            () => setManageRoomStaysIsOpen(false),
            () =>
              setPendingUnsavedClose(
                () => () => setManageRoomStaysIsOpen(false),
              ),
          )
        }
        className="home__modalCenter"
      >
        <ManageRoomStays
          initialRoomStays={data.roomStays}
          bookingId={data.bookingId}
          revision={data.revision}
          bookingStatus={data.status}
          canEditHistoricalRoomStays={user?.admin === true}
          checkIn={data.checkIn}
          checkOut={data.checkOut}
          onClose={() => setManageRoomStaysIsOpen(false)}
          onDirtyChange={setManageRoomStaysIsDirty}
          onUpdated={(updatedBooking) => {
            updateBooking(updatedBooking);
            setManageRoomStaysIsOpen(false);
          }}
        />
      </Modal>
      <Modal
        open={editBookingIsOpen}
        onClose={() =>
          requestUnsavedModalClose(
            editBookingIsDirty,
            () => setEditBookingIsOpen(false),
            () =>
              setPendingUnsavedClose(() => () => setEditBookingIsOpen(false)),
          )
        }
        className="home__modalCenter"
      >
        <AddBooking
          mode="edit"
          editModeBooking={data}
          onClose={() => setEditBookingIsOpen(false)}
          onDirtyChange={setEditBookingIsDirty}
          onUpdated={(updatedBooking) => {
            updateBooking(updatedBooking);
            setEditBookingIsOpen(false);
          }}
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
      <div
        className={`viewBooking__wrapper${
          booking ? "" : " viewBooking__wrapper--replacedSkeleton"
        }`}
      >
        <p className="viewBooking__searchAnnouncement" aria-live="polite">
          {searchAnnouncement}
        </p>
        <div className="viewBooking__top">
          {onClose && <ModalCloseButton onClick={onClose} />}
          <h1 className="viewBooking__name">
            {guestNameLines(data.name).map((line, index) => (
              <span key={`${line}-${index}`}>
                {line}
                {index < guestNameLines(data.name).length - 1 && <br />}
              </span>
            ))}
          </h1>
          <div className="viewBooking__roomAndIsCheckedIn">
            <h1>
              {compactRoomsName} <br />
            </h1>
            {data.status === "cancelled" &&
            data.cancellation?.roomReleaseStatus ? (
              <div className="viewBooking__statusGroup">
                <div className="viewBooking__statusBadge cancelled">
                  <div className="viewBooking__statusDot" />
                  <p className="viewBooking__statusText">
                    {statusDeterminer(data.status, "text")}
                  </p>
                </div>
                <div
                  className={
                    "viewBooking__roomReleaseBadge " +
                    roomReleaseStatusDeterminer(
                      data.cancellation.roomReleaseStatus,
                      "classname",
                    )
                  }
                >
                  <i
                    className={
                      "bx " +
                      roomReleaseStatusDeterminer(
                        data.cancellation.roomReleaseStatus,
                        "icon",
                      )
                    }
                  />
                  <p className="viewBooking__statusText">
                    {roomReleaseStatusDeterminer(
                      data.cancellation.roomReleaseStatus,
                      "text",
                    )}
                  </p>
                </div>
              </div>
            ) : (
              <div
                className={
                  "viewBooking__statusBadge " +
                  statusDeterminer(data.status, "classname")
                }
              >
                <div className="viewBooking__statusDot" />
                <p className="viewBooking__statusText">
                  {statusDeterminer(data.status, "text")}
                </p>
              </div>
            )}
          </div>
        </div>
        <div className="viewBooking__main">
          <div className="viewBooking__mainLeft">
            {(data.note || noteIsEditing) && (
              <div
                className={
                  "viewBooking__note" +
                  (noteIsEditing ? " viewBooking__note--editing" : "")
                }
                onClick={() => {
                  if (!noteIsEditing) setNoteIsEditing(true);
                }}
              >
                <div className="viewBooking__noteHeader">
                  <div
                    style={{
                      display: "flex",
                      gap: ".5rem",
                      alignItems: "center",
                    }}
                  >
                    <i className="bx bx-note " style={{ fontSize: "1.3rem" }} />
                    <p className="viewBooking__noteTitle">Note: </p>
                  </div>
                </div>
                {noteIsEditing ? (
                  <textarea
                    autoFocus
                    className="boxInput viewBooking__noteTextArea"
                    value={noteDraft}
                    placeholder="เพิ่ม Note สำหรับ booking นี้"
                    disabled={noteSaving}
                    onChange={(event) => setNoteDraft(event.target.value)}
                    onClick={(event) => event.stopPropagation()}
                    onBlur={() => {
                      saveNoteHandler().catch((err) =>
                        toast.error(
                          err.response?.data?.message ||
                            "เกิดข้อผิดพลาดในการบันทึก Note",
                        ),
                      );
                    }}
                  />
                ) : (
                  <p>{data.note}</p>
                )}
              </div>
            )}
            <div className="viewBooking__item viewBooking__item--channel">
              <span className="viewBooking__label">ช่องทางการจอง: </span>
              <div className="viewBooking__channelJourney">
                {bookingChannelRows.map((channel, index) => (
                  <div
                    className={
                      "viewBooking__channelSegment" +
                      (index < bookingChannelRows.length - 1
                        ? " viewBooking__channelSegment--connected"
                        : "")
                    }
                    key={channel.key}
                  >
                    <div className="viewBooking__channelLogoWrap">
                      <img
                        className="viewBooking__logo"
                        src={platformMap[channel.platformId]?.logo}
                        alt={platformMap[channel.platformId]?.label}
                      />
                    </div>
                    <div className="viewBooking__channelDetails">
                      <div className="viewBooking__channelTopline">
                        <p className="viewBooking__channelName">
                          {platformMap[channel.platformId]?.label || "ไม่ทราบ"}
                        </p>
                        <span
                          className="viewBooking__channelDates"
                          // style={{
                          //   backgroundColor:
                          //     platformMap[channel.platformId]?.color,
                          // }}
                        >
                          {formatDisplayDate(channel.from, dateFormat, {
                            includeYear: false,
                          })}
                          {" - "}
                          {formatDisplayDate(channel.to, dateFormat, {
                            includeYear: false,
                          })}
                        </span>
                      </div>
                      <button
                        className="viewBooking__channelBookingNo"
                        type="button"
                        onClick={() => {
                          if (!channel.channelBookingId) return;
                          navigator.clipboard.writeText(
                            channel.channelBookingId,
                          );
                          toast.success("คัดลอก Booking No สำเร็จ");
                        }}
                        disabled={!channel.channelBookingId}
                      >
                        <span>
                          No. {channel.channelBookingId || "ไม่ได้บันทึก"}
                        </span>
                        {channel.channelBookingId && (
                          <i className="bx bx-copy" aria-hidden="true" />
                        )}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="viewBooking__staySummary">
              <div className="viewBooking__item viewBooking__item--checkIn">
                <span className="viewBooking__label">Check-In</span>
                <p className="viewBooking__infoText viewBooking__infoText--withActual">
                  <span>{formatDisplayDate(data.checkIn, dateFormat)}</span>
                  <span className="viewBooking__nights">{data.nights} คืน</span>
                  {data.checkedInAt && checkInWasOnDifferentDate && (
                    <Tooltip
                      className="viewBooking__actualTime viewBooking__actualTime--checkIn viewBooking__actualTime--late"
                      ariaLabel="วันที่ Check-In จริงไม่ตรงกับวันที่จอง"
                      content="วันที่และเวลา Late Check-In"
                    >
                      <i className="bx bx-arrow-to-left" />{" "}
                      {formatDisplayTime(data.checkedInAt)}
                      {` · ${formatDisplayDate(data.checkedInAt, dateFormat, {
                        includeYear: false,
                      })}`}
                    </Tooltip>
                  )}
                </p>
              </div>
              <div className="viewBooking__item viewBooking__item--checkOut">
                <span className="viewBooking__label">Check-Out</span>
                <p className="viewBooking__infoText viewBooking__infoText--withActual">
                  <span>{formatDisplayDate(data.checkOut, dateFormat)}</span>
                  {actualCheckOutAt && checkOutWasOnDifferentDate && (
                    <Tooltip
                      className="viewBooking__actualTime viewBooking__actualTime--checkOut viewBooking__actualTime--late"
                      ariaLabel="วันที่ Check-Out จริงไม่ตรงกับวันที่จอง"
                      content="วันที่และเวลา Late Check-Out"
                    >
                      <i className="bx bx-arrow-from-left" />{" "}
                      {formatDisplayTime(actualCheckOutAt)}
                      {` · ${formatDisplayDate(actualCheckOutAt, dateFormat, {
                        includeYear: false,
                      })}`}
                    </Tooltip>
                  )}
                </p>
              </div>

              <div className="viewBooking__item viewBooking__item--room">
                <span className="viewBooking__label">ห้อง</span>
                <p className="viewBooking__infoText">{fullRoomsName}</p>
              </div>

              <div className="viewBooking__item viewBooking__item--staff">
                <span className="viewBooking__label">Staff ที่บันทึก</span>
                <p className="viewBooking__infoText">
                  {resolveStaffName(data.staffUsername)}
                </p>
              </div>
            </div>

            {!isMobileView && identitySection}
          </div>
          <div className="viewBooking__mainRight">
            {/* <p>ค่าใช้จ่าย</p> */}
            <div className="viewBooking__transactions">
              <div className="viewBooking__priceListWrap">
                {data.advancePayment && advancePaymentTransaction && (
                  <div
                    className={
                      "viewBooking__advanceStatus" +
                      (data.status === "cancelled"
                        ? " viewBooking__advanceStatus--cancelled"
                        : "")
                    }
                  >
                    <i
                      className={
                        data.status === "cancelled"
                          ? "bx bx-lock-keyhole"
                          : "bx bx-wallet"
                      }
                      aria-hidden="true"
                    />
                    <div>
                      <span>
                        {data.status === "cancelled"
                          ? "ยกเลิกแล้ว · เก็บเงินล่วงหน้า"
                          : data.advancePayment.calculationMode === "amount"
                            ? "ชำระค่าห้องล่วงหน้า"
                            : `ชำระค่าห้องล่วงหน้า ${data.advancePayment.percentage}%`}
                      </span>
                      <small>
                        {advancePaymentTransaction.amount.toLocaleString(
                          "th-TH",
                        )}{" "}
                        THB
                        {data.status !== "cancelled" && (
                          <>
                            {" · เหลือ "}
                            {outstandingRoomChargeAmount.toLocaleString(
                              "th-TH",
                            )}{" "}
                            THB
                          </>
                        )}
                      </small>
                    </div>
                  </div>
                )}
                {financialPosition.guestCredit > 0 && (
                  <div className="viewBooking__guestCredit">
                    <i className="bx bx-info-circle" />
                    <div>
                      <strong>
                        แขกมียอดเกิน/เครดิต{" "}
                        {financialPosition.guestCredit.toLocaleString("th-TH")}{" "}
                        THB
                      </strong>
                      <span>
                        ระบบยังไม่ได้คืนเงิน
                        กรุณาบันทึกการคืนเงินเมื่อมีเงินจริงออก
                      </span>
                    </div>
                  </div>
                )}
                <div
                  className={`viewBooking__priceList${
                    transactionEditMode
                      ? " viewBooking__priceList--editing"
                      : ""
                  }`}
                  ref={priceListRef}
                  onScroll={handleTransactionListScroll}
                >
                  {groupedTransactions.map(
                    ({ transaction, children }, index) => (
                      <div
                        className={`viewBooking__transactionGroup${
                          transaction._id === highlightedTransactionId
                            ? " viewBooking__transactionGroup--searchHighlight"
                            : ""
                        }`}
                        data-search-transaction-id={transaction._id}
                        aria-current={
                          transaction._id === highlightedTransactionId
                            ? "true"
                            : undefined
                        }
                        style={
                          index === groupedTransactions.length - 1
                            ? {}
                            : { borderBottom: "1px solid #eee" }
                        }
                        key={
                          transaction._id ||
                          `${transaction.type}-${transaction.amount}-${index}`
                        }
                      >
                        {isChildTransaction(transaction) ? (
                          renderChildTransaction(transaction, index)
                        ) : (
                          <div className="viewBooking__price">
                            <div className="viewBooking__priceMain">
                              <i
                                className={`bx ${transactionMap[transaction.type].icon} viewBooking__bedIcon`}
                                style={{
                                  backgroundColor:
                                    transactionMap[transaction.type].color,
                                }}
                              />
                              <div className="viewBooking__priceDetails">
                                <div className="viewBooking__priceSummary">
                                  <div className="viewBooking__priceSummaryText">
                                    <p className="viewBooking__infoText viewBooking__priceAmount">
                                      {formatTransactionAmount(transaction)}
                                    </p>
                                    <p className="viewBooking__transactionName">
                                      {transactionName(transaction)}
                                    </p>
                                    {renderCorrectionActions(transaction)}
                                  </div>
                                  {renderReviewMeta(transaction)}
                                </div>
                              </div>
                            </div>
                            {renderTransactionEndActions(transaction)}
                          </div>
                        )}
                        {children.map(renderChildTransaction)}
                      </div>
                    ),
                  )}
                </div>
                {showTransactionOverflowAlert && (
                  <div className="viewBooking__transactionsOverayAlert">
                    <button
                      className="viewBooking__transactionsOverflowButton"
                      type="button"
                      onClick={scrollToHiddenTransactions}
                    >
                      <span>ยังมีรายการเพิ่มเติม</span>
                      <i className="bx bx-chevron-down" />
                    </button>
                  </div>
                )}
              </div>
              <div
                className="viewBooking__addTransaction"
                onClick={() => setAddTransactionIsOpen(true)}
              >
                <i className="bx bx-plus" />
                <p>เพิ่มรายการใช้จ่าย</p>
              </div>
            </div>

            <div className="viewBooking__roomStays">
              {data.roomStays.map((roomStay, index) => (
                <div
                  className="viewBooking__roomStay"
                  key={index}
                  style={
                    index === data.roomStays.length - 1
                      ? {}
                      : { borderBottom: "1px solid #eee" }
                  }
                >
                  <h3>{formatRoomStayRooms(roomStay)}</h3>
                  <div className="viewBooking__roomStay--dates">
                    <p className="viewBooking__roomStay--from">
                      {formatDisplayDate(roomStay.from, dateFormat, {
                        includeYear: false,
                      })}
                    </p>
                    <p className="viewBooking__roomStay--to">
                      {formatDisplayDate(roomStay.to, dateFormat, {
                        includeYear: false,
                      })}
                    </p>
                  </div>
                </div>
              ))}
              {!data.voided &&
                (data.status === "booked" ||
                  data.status === "checkedIn" ||
                  (data.status === "checkedOut" && user?.admin)) && (
                  <div
                    className="viewBooking__addTransaction"
                    role="button"
                    tabIndex={0}
                    onClick={() => setManageRoomStaysIsOpen(true)}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      setManageRoomStaysIsOpen(true);
                    }}
                  >
                    <i
                      className={
                        data.status === "checkedOut"
                          ? "bx bx-history"
                          : "bx bx-edit-alt"
                      }
                    />
                    <p>
                      {data.status === "checkedOut"
                        ? "แก้ไขประวัติห้องพัก"
                        : "จัดการช่วงการเข้าพัก"}
                    </p>
                    {data.status === "checkedOut" && (
                      <span className="viewBooking__adminTag">Admin</span>
                    )}
                  </div>
                )}
            </div>
          </div>
        </div>
        {isMobileView && identitySection && (
          <section
            className="viewBooking__mobileIdentity"
            aria-label="ข้อมูล Passport"
          >
            {identitySection}
          </section>
        )}
        <div className="viewBooking__actions">
          <div className="viewBooking__secondaryActions">
            <div className="viewBooking__moreActions">
              <ActionButton
                text="เพิ่มเติม"
                icon="bx-dots-horizontal-rounded"
                onClick={() => setMoreActionsIsOpen((isOpen) => !isOpen)}
              />
              {moreActionsIsOpen && (
                <>
                  {isMobileView && (
                    <button
                      type="button"
                      className="viewBooking__moreActionsBackdrop"
                      aria-label="ปิดเมนูเพิ่มเติม"
                      onClick={() => setMoreActionsIsOpen(false)}
                    />
                  )}
                  <div className="viewBooking__moreActionsMenu">
                  <button
                    type="button"
                    onClick={() => {
                      setEditBookingIsOpen(true);
                      setMoreActionsIsOpen(false);
                    }}
                  >
                    <i className="bx bx-edit" />
                    แก้ไข
                  </button>
                  {!data.voided &&
                    (data.status === "booked" ||
                      data.status === "checkedIn") && (
                      <button
                        type="button"
                        className="viewBooking__mobileMoreAction"
                        onClick={() => {
                          setExtendBookingIsOpen(true);
                          setMoreActionsIsOpen(false);
                        }}
                      >
                        <i className="bx bx-calendar-plus" />
                        เพิ่มจำนวนคืน
                      </button>
                    )}
                  <button
                    type="button"
                    className="viewBooking__mobileMoreAction"
                    disabled={pinSaving}
                    onClick={() => {
                      setMoreActionsIsOpen(false);
                      toast.promise(togglePinHandler(), {
                        loading: data.pinned
                          ? "กำลังยกเลิกปัก Booking..."
                          : "กำลังปัก Booking...",
                        success: data.pinned
                          ? "ยกเลิกปัก Booking แล้ว"
                          : "ปัก Booking แล้ว",
                        error: (err) =>
                          err.response?.data?.message ||
                          "เกิดข้อผิดพลาดในการปัก Booking",
                      });
                    }}
                  >
                    <i
                      className={
                        data.pinned ? "bxf bx-pin-alt" : "bx bx-pin-alt"
                      }
                    />
                    {data.pinned ? "ยกเลิกปัก Booking" : "ปัก Booking"}
                  </button>
                  <button
                    type="button"
                    className={
                      transactionEditMode
                        ? "viewBooking__moreActionsMenuToggle--active"
                        : ""
                    }
                    onClick={() => {
                      setTransactionEditMode((active) => !active);
                      setMoreActionsIsOpen(false);
                    }}
                  >
                    <i className="bx bx-edit-alt" />
                    {transactionEditMode
                      ? "ซ่อนปุ่มแก้ไขรายการ"
                      : "แก้ไขรายการใช้จ่าย"}
                  </button>
                  {user?.admin &&
                    (data.status === "checkedOut" ||
                      data.status === "cancelled" ||
                      data.status === "noShow") && (
                      <button
                        type="button"
                        onClick={() => {
                          setClosedRoomAvailabilityIsOpen(true);
                          setMoreActionsIsOpen(false);
                        }}
                      >
                        <i className="bx bx-bed" />
                        แก้ไขการเปิดห้อง
                        <span className="viewBooking__adminTag">Admin</span>
                      </button>
                    )}
                  {data.status === "checkedIn" && (
                    <button
                      type="button"
                      disabled={
                        checkInCorrectionEligibility.loading ||
                        !checkInCorrectionEligibility.allowed
                      }
                      title={
                        checkInCorrectionEligibility.loading
                          ? "กำลังตรวจสอบสิทธิ์..."
                          : checkInCorrectionEligibility.message || undefined
                      }
                      onClick={() => {
                        void openCheckInCorrection("undo_check_in");
                      }}
                    >
                      <i
                        className={`bx bx-undo${
                          checkInCorrectionEligibility.allowed
                            ? " viewBooking__temporaryActionIcon"
                            : ""
                        }`}
                      />
                      <span>Undo Check-In</span>
                      {!checkInCorrectionEligibility.allowed ? (
                        <span className="viewBooking__adminTag">Admin</span>
                      ) : (
                        <i className="viewBooking__beforeCashCloseTag bx-clock-dashed-half" />
                      )}
                    </button>
                  )}
                  {statusCorrectionType && (
                    <button
                      type="button"
                      disabled={
                        statusCorrectionEligibility.loading ||
                        !statusCorrectionEligibility.allowed
                      }
                      title={
                        statusCorrectionEligibility.loading
                          ? "กำลังตรวจสอบสิทธิ์..."
                          : statusCorrectionEligibility.message || undefined
                      }
                      onClick={() => {
                        void openStatusCorrection();
                      }}
                    >
                      <i
                        className={`bx bx-undo${
                          statusCorrectionEligibility.allowed
                            ? " viewBooking__temporaryActionIcon"
                            : ""
                        }`}
                      />
                      <span>{statusCorrectionLabel}</span>
                      {!statusCorrectionEligibility.allowed ? (
                        <span className="viewBooking__adminTag">Admin</span>
                      ) : (
                        <i className="viewBooking__beforeCashCloseTag bx-clock-dashed-half" />
                      )}
                    </button>
                  )}
                  {user?.admin && data.status === "checkedIn" && (
                    <button
                      type="button"
                      onClick={() => {
                        setResolveVariant("specialCase");
                        setResolveBookingIsOpen(true);
                        setMoreActionsIsOpen(false);
                      }}
                    >
                      <i className="bx bx-receipt" />
                      Resolve สำรอง
                      <span className="viewBooking__adminTag">Admin</span>
                    </button>
                  )}
                  {user?.admin &&
                    (data.status === "checkedOut" ||
                      data.status === "cancelled" ||
                      data.status === "noShow") && (
                      <button
                        type="button"
                        onClick={() => {
                          setResolveVariant("postClose");
                          setResolveBookingIsOpen(true);
                          setMoreActionsIsOpen(false);
                        }}
                      >
                        <i className="bx bx-history" />
                        แก้ไขหลังปิด
                        <span className="viewBooking__adminTag">Admin</span>
                      </button>
                    )}
                  {user?.admin &&
                    data.status === "booked" &&
                    checkInIsBeforeToday && (
                      <button
                        type="button"
                        onClick={() => {
                          setAdminHistoricalCheckIn(true);
                          setCheckInIsOpen(true);
                          setMoreActionsIsOpen(false);
                        }}
                      >
                        <i className="bx bx-history" />
                        <span>Onboard Existing Stay</span>
                        <span className="viewBooking__adminTag">Admin</span>
                      </button>
                    )}
                  {data.status === "booked" && (
                    <button
                      type="button"
                      onClick={() => {
                        setCancellationIsOpen(true);
                        setMoreActionsIsOpen(false);
                      }}
                    >
                      <i className="bx bx-calendar-x" />
                      ยกเลิกการจอง
                    </button>
                  )}
                  {user?.admin && (
                    <button
                      type="button"
                      onClick={() => {
                        removeBookingHandler(data);
                        setMoreActionsIsOpen(false);
                      }}
                    >
                      <i
                        className="bx bx-trash"
                        style={{ color: "var(--red)" }}
                      />
                      ลบ
                    </button>
                  )}
                  </div>
                </>
              )}
            </div>

            {!data.voided &&
              (data.status === "booked" || data.status === "checkedIn") && (
                <ActionButton
                  text=""
                  mobileText="เพิ่มคืน"
                  tooltip="เพิ่มจำนวนคืน"
                  onClick={() => setExtendBookingIsOpen(true)}
                  icon="bx-calendar-plus"
                  className="viewBooking__mobileExtendAction"
                />
              )}

            <ActionButton
              text=""
              mobileText="โน้ต"
              tooltip="เพิ่มโน้ต"
              icon="bx-note"
              className="viewBooking__noteAction"
              onClick={() => {
                setNoteDraft(data.note || "");
                setNoteIsEditing(true);
              }}
            />

            <ActionButton
              text=""
              mobileText={data.pinned ? "ปักแล้ว" : "ปักหมุด"}
              tooltip="ปักหมุด"
              icon={data.pinned ? "bxf bx-pin-alt" : "bx-pin-alt"}
              className={data.pinned ? "viewBooking__pinAction" : ""}
              ariaLabel={data.pinned ? "ยกเลิกปัก Booking" : "ปัก Booking"}
              disabled={pinSaving}
              onClick={() =>
                toast.promise(togglePinHandler(), {
                  loading: data.pinned
                    ? "กำลังยกเลิกปัก Booking..."
                    : "กำลังปัก Booking...",
                  success: data.pinned
                    ? "ยกเลิกปัก Booking แล้ว"
                    : "ปัก Booking แล้ว",
                  error: (err) =>
                    err.response?.data?.message ||
                    "เกิดข้อผิดพลาดในการปัก Booking",
                })
              }
            />
          </div>
          <div className="viewBooking__actionsRow">
            {!data.voided &&
              (data.status === "booked" || data.status === "checkedIn") && (
                <ActionButton
                  text=""
                  tooltip="เพิ่มจำนวนคืน"
                  onClick={() => setExtendBookingIsOpen(true)}
                  icon="bx-calendar-plus"
                  className="viewBooking__desktopExtendAction"
                />
              )}
            {data.status === "booked" && !isNoShow && (
              <ActionButton
                text={isLateCheckIn ? "Late Check In" : "Check In"}
                onClick={() => {
                  setAdminHistoricalCheckIn(false);
                  setCheckInIsOpen(true);
                }}
                icon="bx-check-circle"
                className={
                  "viewBooking__primaryAction" +
                  (isLateCheckIn ? " viewBooking__lateCheckInAction" : "")
                }
                highlight={!isLateCheckIn}
              />
            )}
            {(isLateCheckIn || isNoShow) && (
              <ActionButton
                text="No-Show"
                className="viewBooking__noShowAction"
                onClick={() => {
                  setResolveVariant("noShow");
                  setResolveBookingIsOpen(true);
                }}
                icon="bx-x"
              />
            )}
            {data.status === "checkedIn" && (
              <ActionButton
                text={isEarlyCheckOut ? "Early Check Out" : "Check Out"}
                onClick={() => setCheckOutIsOpen(true)}
                icon="bx-door-open"
                className={
                  "viewBooking__primaryAction" +
                  (isEarlyCheckOut
                    ? " viewBooking__earlyCheckOutAction"
                    : "")
                }
                highlight={!isEarlyCheckOut}
              />
            )}
          </div>{" "}
        </div>
      </div>
    </>
  );
};

export default ViewBooking;
