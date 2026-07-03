import ActionButton from "../../components/ActionButton";
import ModalCloseButton from "../../components/ModalCloseButton";
import UnsavedChangesModal from "../../components/UnsavedChangesModal";
import axios from "axios";
import Skeleton from "react-loading-skeleton";
import ManageRoomStays from "./ManageRoomStays.tsx";
import AddTransaction from "./AddTransaction.tsx";
import AddBooking from "./AddBooking.tsx";
import PassportView from "./PassportView.tsx";
import CheckIn from "./CheckIn.tsx";
import CheckOut from "./CheckOut.tsx";
import ResolveBooking from "./ResolveBooking.tsx";

import { useState, useEffect, useRef } from "react";
import { API_URL } from "../../config/api.ts";
import { platformMap } from "../../helpers/maps.ts";
import {
  formatBookingDates,
  isRoomChargeSettlementTransaction,
  isSameDay,
  roomChargeDisplayPaymentMethod,
} from "../../helpers/bookingHelpers.ts";
import { requestUnsavedModalClose } from "../../helpers/modalGuards.ts";
import {
  formatRoomStayRooms,
  getRoomStayRoomIds,
} from "../../helpers/roomStayHelpers.ts";
import { Modal } from "@mui/material";
import { useAuth } from "../../context/AuthContext.tsx";

import type { booking, ResolutionOutcome } from "../../types/bookingTypes";

import "./ViewBooking.css";
import Cancellation from "./Cancellation.tsx";
import toast from "react-hot-toast";

const paymentMethodIconMap = {
  OTA: "bx-bank",
  Cash: "bx-currency-notes",
  Card: "bx-credit-card-alt",
  Transfer: "bx-arrow-right-left",
  Unpaid: "bx-error",
};

const transactionMap = {
  roomCharge: { icon: "bx-bed-alt", name: "ค่าห้อง", color: "#51d1dc" },
  deposit: { icon: "bx-wallet", name: "รับมัดจำ", color: "#facc15" },
  adjustment: { icon: "bx-edit-alt", name: "ปรับราคา", color: "#a78bfa" },
  depositRefund: { icon: "bx-undo", name: "คืนมัดจำ", color: "#f87171" },
  cancellationRefund: {
    icon: "bx-calendar-x",
    name: "คืนเงินยกเลิก",
    color: "#fb7185",
  },
  roomRefund: { icon: "bx-undo", name: "คืนค่าห้อง", color: "#fb7185" },
  settlementCharge: {
    icon: "bx-receipt",
    name: "เก็บเงินเพิ่ม",
    color: "#22c55e",
  },
  compensation: { icon: "bx-gift", name: "ชดเชยลูกค้า", color: "#38bdf8" },
  depositKept: { icon: "bx-lock-alt", name: "เก็บมัดจำ", color: "#facc15" },
  paymentCorrection: {
    icon: "bx-transfer",
    name: "แก้ไขการชำระเงิน",
    color: "#a78bfa",
  },
  towel: { icon: "bx-bath", name: "ผ้าเช็ดตัว", color: "#38bdf8" },
  motorbike: { icon: "bx-cycling", name: "มอเตอร์ไซค์", color: "#fb923c" },
  slowBoat: { icon: "bx-water", name: "Slow Boat", color: "#2dd4bf" },
  joinTour: { icon: "bx-map", name: "Join Tour", color: "#22c55e" },
  extraBed: { icon: "bx-bed", name: "เตียงเสริม", color: "#ec4899" },
  cardSurcharge: {
    icon: "bx-credit-card-alt",
    name: "ค่าธรรมเนียมบัตร 3%",
    color: "#94a3b8",
  },
};

const ViewBooking = ({
  booking,
  bookingId,
  onClose,
  onUpdated,
  removeBookingHandler,
}: {
  booking: booking | null;
  bookingId?: string;
  onClose?: () => void;
  onUpdated?: (booking: booking) => void;
  removeBookingHandler: (booking: booking) => void;
}) => {
  const [data, setData] = useState<booking | null>(booking || null);
  const [manageRoomStaysIsOpen, setManageRoomStaysIsOpen] = useState(false);
  const [editBookingIsOpen, setEditBookingIsOpen] = useState(false);
  const [addTransactionIsOpen, setAddTransactionIsOpen] = useState(false);
  const [cancellationIsOpen, setCancellationIsOpen] = useState(false);
  const [checkInIsOpen, setCheckInIsOpen] = useState(false);
  const [checkOutIsOpen, setCheckOutIsOpen] = useState(false);
  const [resolveBookingIsOpen, setResolveBookingIsOpen] = useState(false);
  const [initialResolveOutcome, setInitialResolveOutcome] = useState<
    ResolutionOutcome | undefined
  >(undefined);
  const [manageRoomStaysIsDirty, setManageRoomStaysIsDirty] = useState(false);
  const [editBookingIsDirty, setEditBookingIsDirty] = useState(false);
  const [addTransactionIsDirty, setAddTransactionIsDirty] = useState(false);
  const [cancellationIsDirty, setCancellationIsDirty] = useState(false);
  const [checkInIsDirty, setCheckInIsDirty] = useState(false);
  const [checkOutIsDirty, setCheckOutIsDirty] = useState(false);
  const [resolveBookingIsDirty, setResolveBookingIsDirty] = useState(false);
  const [noteIsEditing, setNoteIsEditing] = useState(false);
  const [noteDraft, setNoteDraft] = useState(booking?.note || "");
  const [noteSaving, setNoteSaving] = useState(false);
  const [starSaving, setStarSaving] = useState(false);
  const [pendingUnsavedClose, setPendingUnsavedClose] = useState<
    (() => void) | null
  >(null);
  const [loading, setLoading] = useState(!booking);
  const [moreActionsIsOpen, setMoreActionsIsOpen] = useState(false);
  const [showTransactionOverflowAlert, setShowTransactionOverflowAlert] =
    useState(false);
  const [
    transactionOverflowAlertDismissed,
    setTransactionOverflowAlertDismissed,
  ] = useState(false);
  const priceListRef = useRef<HTMLDivElement | null>(null);
  const { user } = useAuth();

  const updateTransactionOverflowAlert = () => {
    const priceList = priceListRef.current;
    if (!priceList) return;

    const hasHiddenTransactions =
      priceList.scrollHeight > priceList.clientHeight + 1;
    const isAtTop = priceList.scrollTop < 4;

    setShowTransactionOverflowAlert(
      hasHiddenTransactions && isAtTop && !transactionOverflowAlertDismissed,
    );
  };

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

    setData(booking);
    setNoteDraft(booking.note || "");
    setNoteIsEditing(false);
    setLoading(false);
    setMoreActionsIsOpen(false);
  }, [booking]);

  useEffect(() => {
    if (data) return;

    const fetchBooking = async () => {
      try {
        setLoading(true);

        const res = await axios.get(
          `${API_URL}/bookings/getBookingById/` + bookingId,
          { withCredentials: true },
        );

        const formattedBooking = formatBookingDates(res.data);
        setData(formattedBooking);
        setNoteDraft(formattedBooking.note || "");
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    fetchBooking();
  }, [bookingId, data]);

  useEffect(() => {
    const animationFrame = requestAnimationFrame(
      updateTransactionOverflowAlert,
    );

    return () => cancelAnimationFrame(animationFrame);
  }, [data?.transactions.length, transactionOverflowAlertDismissed]);

  if (loading || !data) {
    return (
      <div className="viewBooking__wrapper">
        {onClose && <ModalCloseButton onClick={onClose} />}
        <div className="viewBooking__top">
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
        if (usedFor === "icon") return "bx-lock-alt";
        return usedFor === "classname" ? "blocked" : "ไม่เปิดให้จอง";
      default:
        return usedFor === "classname" ? "unknown" : "";
    }
  };

  const compactRoomsName = data.roomStays.map(formatRoomStayRooms).join(", ");
  const fullRoomsName = data.roomStays.flatMap(getRoomStayRoomIds).join(", ");

  const formatTransactionAmount = (
    transaction: booking["transactions"][number],
  ) => {
    const amountText = transaction.amount.toLocaleString("th-TH");
    return transaction.direction === "out" ||
      transaction.type === "depositRefund" ||
      transaction.type === "cancellationRefund"
      ? `-${amountText} บาท`
      : `${amountText} บาท`;
  };

  const isChildTransaction = (transaction: booking["transactions"][number]) =>
    transaction.type === "cardSurcharge" ||
    transaction.type === "depositRefund" ||
    transaction.type === "cancellationRefund" ||
    (transaction.type === "adjustment" &&
      Boolean(transaction.relatedTransactionId));

  const effectiveRoomChargePaymentMethod = roomChargeDisplayPaymentMethod(data);
  let attachNextSettlementCardSurchargeToRoomCharge = false;

  const groupedTransactions = data.transactions.reduce<
    {
      transaction: booking["transactions"][number];
      children: booking["transactions"];
    }[]
  >((groups, transaction) => {
    if (isRoomChargeSettlementTransaction(data, transaction)) {
      attachNextSettlementCardSurchargeToRoomCharge =
        transaction.paymentMethod === "Card";
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

    if (transaction.type === "cardSurcharge") {
      const lastGroup = groups[groups.length - 1];
      const roomChargeGroup = groups.find(
        (group) => group.transaction.type === "roomCharge",
      );

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
    const paymentMethod =
      transaction.type === "roomCharge"
        ? effectiveRoomChargePaymentMethod
        : transaction.paymentMethod;

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
          <i className="bx bx-error viewBooking__unpaid" />
        ) : (
          <i className={"bx " + paymentMethodIconMap[paymentMethod]} />
        )}
      </div>
    );
  };

  const renderReviewMeta = (transaction: booking["transactions"][number]) => {
    const isReviewed = transaction.reviewStatus === "reviewed";
    const needsReview =
      !isReviewed &&
      (transaction.reviewStatus === "needs_review" ||
        Boolean(transaction.reviewFlags?.length));
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
          <span className="viewBooking__transactionInfo" tabIndex={0}>
            <i className="bx bx-info-circle" />
            <span className="viewBooking__transactionTooltip">
              {infoItems.map((item, index) => (
                <span key={`${item}-${index}`}>{item}</span>
              ))}
            </span>
          </span>
        )}
      </div>
    );
  };

  const renderChildTransaction = (
    transaction: booking["transactions"][number],
    index: number,
  ) => (
    <div
      className="viewBooking__priceChild"
      key={`${transaction.type}-${transaction.amount}-${index}`}
    >
      <div className="viewBooking__priceChildMain">
        <span className="viewBooking__priceChildMarker" />
        <div>
          <p className="viewBooking__priceChildText">
            <span className="viewBooking__priceChildAmount">
              {formatTransactionAmount(transaction)}
            </span>
            <span>{transactionMap[transaction.type].name}</span>
          </p>
          {renderReviewMeta(transaction)}
        </div>
      </div>
      {renderPaymentMethod(transaction, true)}
    </div>
  );

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

  const toggleStarHandler = async () => {
    if (starSaving) return;

    const nextStarred = !data.starred;
    setStarSaving(true);

    try {
      const response = await axios.patch(
        `${API_URL}/bookings/starBooking/${data.bookingId}`,
        { starred: nextStarred },
        { withCredentials: true },
      );

      if (response.data.booking) {
        updateBooking(response.data.booking);
      }
    } finally {
      setStarSaving(false);
    }
  };

  return (
    <>
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
            () => setCheckInIsOpen(false),
            () => setPendingUnsavedClose(() => () => setCheckInIsOpen(false)),
          )
        }
      >
        <CheckIn
          booking={data}
          isLateCheckIn={isLateCheckIn}
          nightsLate={nightsLate}
          onClose={() => setCheckInIsOpen(false)}
          onDirtyChange={setCheckInIsDirty}
          handleCheckInSuccess={(updatedBooking) => {
            updateBooking(updatedBooking);
            setCheckInIsOpen(false);
          }}
        />
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
          initialOutcome={initialResolveOutcome}
          initialFinalStatus={
            initialResolveOutcome === "no_show" ? "noShow" : undefined
          }
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
          bookingId={data.bookingId}
          guestName={data.name}
          transactions={data.transactions}
          onClose={() => setAddTransactionIsOpen(false)}
          onDirtyChange={setAddTransactionIsDirty}
          onUpdated={(updatedBooking) => {
            updateBooking(updatedBooking);
            setAddTransactionIsOpen(false);
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
      <div className="viewBooking__wrapper">
        {onClose && <ModalCloseButton onClick={onClose} />}
        <div className="viewBooking__top">
          <h1 className="viewBooking__name">
            {data.name.split(" ").map((word) => (
              <span key={word}>
                {word} <br key={word} />
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
            <div className="viewBooking__item">
              <span className="viewBooking__label">ช่องทางการจอง: </span>
              <div className="viewBooking__platform">
                <p
                  className="viewBooking__infoText"
                  style={{ color: platformMap[data.platformId]?.color }}
                >
                  {platformMap[data.platformId]?.label || "ไม่ทราบ"}
                </p>
                <img
                  className="viewBooking__logo"
                  src={platformMap[data.platformId]?.logo}
                  alt={platformMap[data.platformId]?.label}
                />
              </div>
            </div>
            <div className="viewBooking__item">
              <span className="viewBooking__label">Check-In: </span>
              <p className="viewBooking__infoText">
                {new Intl.DateTimeFormat("th-TH", {
                  calendar: "gregory",
                  dateStyle: "medium",
                }).format(data.checkIn)}{" "}
                <span className="viewBooking__nights">{data.nights} คืน</span>
              </p>
            </div>
            <div className="viewBooking__item">
              <span className="viewBooking__label">Check-Out </span>
              <p className="viewBooking__infoText">
                {new Intl.DateTimeFormat("th-TH", {
                  calendar: "gregory",
                  dateStyle: "medium",
                }).format(data.checkOut)}
              </p>
            </div>

            <div className="viewBooking__item">
              <span className="viewBooking__label">Booking No: </span>
              <div
                className="viewBookng__bookingNo"
                onClick={() => {
                  navigator.clipboard.writeText(data.bookingId);
                  toast.success("คัดลอก Booking No สำเร็จ");
                }}
              >
                <p className="viewBooking__infoText">{data.bookingId}</p>
                <i className="bx bx-copy viewBooking__copyIcon" />
              </div>
            </div>
            <div className="viewBooking__item">
              <span className="viewBooking__label">ห้อง: </span>
              <p className="viewBooking__infoText">{fullRoomsName}</p>
            </div>

            <div className="viewBooking__item">
              <span className="viewBooking__label">
                Staff ที่บันทึกรายการ:{" "}
              </span>
              <p className="viewBooking__infoText">{data.staffUsername}</p>
            </div>

            <PassportView bookingId={data.bookingId} />
          </div>
          <div className="viewBooking__mainRight">
            {/* <p>ค่าใช้จ่าย</p> */}
            <div className="viewBooking__transactions">
              <div className="viewBooking__priceListWrap">
                <div
                  className="viewBooking__priceList"
                  ref={priceListRef}
                  onScroll={handleTransactionListScroll}
                >
                  {groupedTransactions.map(
                    ({ transaction, children }, index) => (
                      <div
                        className="viewBooking__transactionGroup"
                        style={
                          index === groupedTransactions.length - 1
                            ? {}
                            : { borderBottom: "1px solid #eee" }
                        }
                        key={`${transaction.type}-${transaction.amount}-${index}`}
                      >
                        {isChildTransaction(transaction) ? (
                          renderChildTransaction(transaction, index)
                        ) : (
                          <div className="viewBooking__price">
                            <div
                              style={{
                                display: "flex",
                                gap: "1rem",
                                alignItems: "center",
                                minWidth: 0,
                              }}
                            >
                              <i
                                className={`bx ${transactionMap[transaction.type].icon} viewBooking__bedIcon`}
                                style={{
                                  backgroundColor:
                                    transactionMap[transaction.type].color,
                                }}
                              />
                              <div style={{ minWidth: 0 }}>
                                <p className="viewBooking__infoText viewBooking__priceAmount">
                                  {formatTransactionAmount(transaction)}
                                </p>
                                <p>{transactionMap[transaction.type].name}</p>
                                {renderReviewMeta(transaction)}
                              </div>
                            </div>
                            {renderPaymentMethod(transaction)}
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
                <i className="bx bx-dollar" />
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
                      {new Date(roomStay.from).toLocaleDateString("th-TH", {
                        day: "2-digit",
                        month: "short",
                      })}
                    </p>
                    <p className="viewBooking__roomStay--to">
                      {new Date(roomStay.to).toLocaleDateString("th-TH", {
                        day: "2-digit",
                        month: "short",
                      })}
                    </p>
                  </div>
                </div>
              ))}
              <div
                className="viewBooking__addTransaction"
                onClick={() => setManageRoomStaysIsOpen(true)}
              >
                <i className="bx bx-bed" />
                <p>จัดการช่วงการเข้าพัก</p>
              </div>
            </div>
          </div>
        </div>
        <div className="viewBooking__actions">
          <div className="viewBooking__secondaryActions">
            <div className="viewBooking__moreActions">
              <ActionButton
                text="เพิ่มเติม"
                icon="bx-dots-horizontal-rounded"
                onClick={() => setMoreActionsIsOpen((isOpen) => !isOpen)}
              />
              {moreActionsIsOpen && (
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
                  <button
                    type="button"
                    onClick={() => {
                      removeBookingHandler(data);
                      setMoreActionsIsOpen(false);
                    }}
                  >
                    <i className="bx bx-trash" />
                    ลบ
                  </button>
                  {data.status === "booked" && (
                    <button
                      type="button"
                      onClick={() => {
                        setCancellationIsOpen(true);
                        setMoreActionsIsOpen(false);
                      }}
                    >
                      <i className="bx bx-calendar-x" />
                      ยกเลิก
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={
                      (data.status === "checkedOut" ||
                        data.status === "cancelled" ||
                        data.status === "noShow") &&
                      !user?.admin
                    }
                    onClick={() => {
                      setInitialResolveOutcome(undefined);
                      setResolveBookingIsOpen(true);
                      setMoreActionsIsOpen(false);
                    }}
                  >
                    <i
                      className={
                        "bx " +
                        (data.status === "checkedOut" ||
                        data.status === "cancelled" ||
                        data.status === "noShow"
                          ? "bx-history"
                          : "bx-receipt")
                      }
                    />
                    {data.status === "checkedOut" ||
                    data.status === "cancelled" ||
                    data.status === "noShow"
                      ? "แก้ไขหลังปิด"
                      : "Resolve"}
                  </button>
                </div>
              )}
            </div>

            <ActionButton
              text=""
              icon="bx-note"
              onClick={() => {
                setNoteDraft(data.note || "");
                setNoteIsEditing(true);
              }}
            />

            <ActionButton
              text=""
              icon={data.starred ? "bxs-star" : "bx-star"}
              className={data.starred ? "viewBooking__starAction" : ""}
              disabled={starSaving}
              onClick={() =>
                toast.promise(toggleStarHandler(), {
                  loading: data.starred
                    ? "กำลังยกเลิกปักดาว..."
                    : "กำลังปักดาว...",
                  success: data.starred
                    ? "ยกเลิกปักดาวแล้ว"
                    : "ปักดาว Booking แล้ว",
                  error: (err) =>
                    err.response?.data?.message ||
                    "เกิดข้อผิดพลาดในการปักดาว Booking",
                })
              }
            />
          </div>
          <div className="viewBooking__actionsRow">
            {data.status === "booked" && !isNoShow && (
              <ActionButton
                text={isLateCheckIn ? "Late Check In" : "Check In"}
                onClick={() => setCheckInIsOpen(true)}
                icon="bx-check-circle"
                className={
                  isLateCheckIn ? "viewBooking__lateCheckInAction" : ""
                }
                highlight={!isLateCheckIn}
              />
            )}
            {(isLateCheckIn || isNoShow) && (
              <ActionButton
                text="No-Show"
                className="viewBooking__noShowAction"
                onClick={() => {
                  setInitialResolveOutcome("no_show");
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
                  isEarlyCheckOut ? "viewBooking__earlyCheckOutAction" : ""
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
