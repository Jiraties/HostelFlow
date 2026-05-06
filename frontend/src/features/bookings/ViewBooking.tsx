import { useState, useEffect } from "react";
import ActionButton from "../../components/ActionButton";
import type { booking } from "../../types/bookingTypes";
import "./ViewBooking.css";
import axios from "axios";
import { API_URL } from "../../config/api.ts";
import { platformMap } from "../../helpers/maps.ts";
import { formatBookingDates, isSameDay } from "../../helpers/bookingHelpers.ts";
import Skeleton from "react-loading-skeleton";
import { Modal } from "@mui/material";
import ManageRoomStays from "./ManageRoomStays.tsx";
import AddTransaction from "./AddTransaction.tsx";
import AddBooking from "./AddBooking.tsx";

const paymentMethodIconMap = {
  OTA: "bx-bank",
  Cash: "bx-currency-notes",
  Card: "bx-credit-card-alt",
  Transfer: "bx-arrow-right-left",
};

const transactionMap = {
  roomCharge: { icon: "bx-bed-alt", name: "ค่าห้อง", color: "#51d1dc" },
  deposit: { icon: "bx-wallet", name: "รับมัดจำ", color: "#facc15" },
  adjustment: { icon: "bx-edit-alt", name: "ปรับราคา", color: "#a78bfa" },
  depositRefund: { icon: "bx-undo", name: "คืนมัดจำ", color: "#f87171" },
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
  removeBookingHandler,
  setCheckInIsOpen,
}: {
  booking: booking;
  bookingId?: string;
  removeBookingHandler: (booking: booking) => void;
  setCheckInIsOpen: (isOpen: boolean) => void;
}) => {
  const [data, setData] = useState<booking | null>(booking || null);
  const [manageRoomStaysIsOpen, setManageRoomStaysIsOpen] = useState(false);
  const [editBookingIsOpen, setEditBookingIsOpen] = useState(false);
  const [addTransactionIsOpen, setAddTransactionIsOpen] = useState(false);
  const [loading, setLoading] = useState(!booking);

  useEffect(() => {
    if (!booking) return;

    setData(booking);
    setLoading(false);
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

        setData(formatBookingDates(res.data));
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    fetchBooking();
  }, [bookingId, data]);

  if (loading || !data) {
    return (
      <div className="viewBooking__wrapper">
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

  const statusDeterminer = (status: string, usedFor: string) => {
    const checkInIsToday = isSameDay(new Date(), new Date(data.checkIn));

    if (status === "booked" && !checkInIsToday) {
      return usedFor === "classname" ? "booked" : "จองแล้ว";
    }
    if (status === "booked" && checkInIsToday) {
      return usedFor === "classname" ? "notCheckedIn" : "ยังไม่ Check-In";
    }
    if (status === "checkedIn") {
      return usedFor === "classname" ? "checkedIn" : "Check-In แล้ว";
    }
    if (status === "checkedOut") {
      return usedFor === "classname" ? "checkedOut" : "Check-Out แล้ว";
    }

    return usedFor === "classname" ? "unknown" : status;
  };

  const roomsName = data.roomStays
    .map((roomStay) => roomStay.roomId)
    .join(", ");

  const formatTransactionAmount = (
    transaction: booking["transactions"][number],
  ) => {
    const amountText = transaction.amount.toLocaleString("th-TH");
    return transaction.type === "depositRefund"
      ? `-${amountText} บาท`
      : `${amountText} บาท`;
  };

  const isChildTransaction = (transaction: booking["transactions"][number]) =>
    transaction.type === "cardSurcharge" ||
    transaction.type === "depositRefund";

  const groupedTransactions = data.transactions.reduce<
    {
      transaction: booking["transactions"][number];
      children: booking["transactions"];
    }[]
  >((groups, transaction) => {
    if (transaction.type === "cardSurcharge") {
      const lastGroup = groups[groups.length - 1];

      if (lastGroup && !isChildTransaction(lastGroup.transaction)) {
        lastGroup.children.push(transaction);
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

    groups.push({ transaction, children: [] });
    return groups;
  }, []);

  const renderPaymentMethod = (
    transaction: booking["transactions"][number],
  ) => (
    <div style={{ display: "flex", gap: "0.5rem" }}>
      <p
        className={
          transaction.paymentMethod === "Unpaid" ? "viewBooking__unpaid" : ""
        }
      >
        {transaction.paymentMethod}
      </p>
      {transaction.paymentMethod === "Unpaid" ? (
        <i
          className="bx bx-error viewBooking__unpaid"
          style={{ fontSize: "1.4rem" }}
        />
      ) : (
        <i
          className={"bx " + paymentMethodIconMap[transaction.paymentMethod]}
          style={{ fontSize: "1.4rem" }}
        />
      )}
    </div>
  );

  const renderChildTransaction = (
    transaction: booking["transactions"][number],
    index: number,
  ) => (
    <div
      className="viewBooking__priceChild"
      key={`${transaction.type}-${transaction.amount}-${index}`}
    >
      <div className="viewBooking__priceChildMain">
        <span className="viewBooking__priceChildMarker">↳</span>
        <div>
          <p className="viewBooking__priceChildAmount">
            {formatTransactionAmount(transaction)}
          </p>
          <p>{transactionMap[transaction.type].name}</p>
        </div>
      </div>
      {renderPaymentMethod(transaction)}
    </div>
  );

  return (
    <>
      <Modal
        open={addTransactionIsOpen}
        onClose={() => setAddTransactionIsOpen(false)}
        className="home__modalCenter"
      >
        <AddTransaction
          bookingId={data.bookingId}
          guestName={data.name}
          onClose={() => setAddTransactionIsOpen(false)}
          onUpdated={(updatedBooking) => {
            setData(updatedBooking);
            setAddTransactionIsOpen(false);
          }}
        />
      </Modal>
      <Modal
        open={manageRoomStaysIsOpen}
        onClose={() => setManageRoomStaysIsOpen(false)}
        className="home__modalCenter"
      >
        <ManageRoomStays
          initialRoomStays={data.roomStays}
          bookingId={data.bookingId}
          checkIn={data.checkIn}
          checkOut={data.checkOut}
          onUpdated={(updatedBooking) => {
            setData(updatedBooking);
            setManageRoomStaysIsOpen(false);
          }}
        />
      </Modal>
      <Modal
        open={editBookingIsOpen}
        onClose={() => setEditBookingIsOpen(false)}
        className="home__modalCenter"
      >
        <AddBooking
          mode="edit"
          editModeBooking={data}
          onClose={() => setEditBookingIsOpen(false)}
          onUpdated={(updatedBooking) => {
            setData(updatedBooking);
            setEditBookingIsOpen(false);
          }}
        />
      </Modal>
      <div className="viewBooking__wrapper">
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
              {roomsName} <br />
            </h1>
            <div
              className={
                "viewBooking__statusBadge " +
                statusDeterminer(data.status, "classname")
              }
            >
              <div className="viewBooking__statusDot"></div>
              <p className="viewBooking__statusText">
                {statusDeterminer(data.status, "text")}
              </p>
            </div>
          </div>
        </div>
        <div className="viewBooking__main">
          <div className="viewBooking__mainLeft">
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
              <span className="viewBooking__label">ห้อง: </span>
              <p className="viewBooking__infoText">{roomsName}</p>
            </div>

            <div className="viewBooking__item">
              <span className="viewBooking__label">Booking No: </span>
              <p className="viewBooking__infoText">{data.bookingId}</p>
            </div>

            <div className="viewBooking__item">
              <span className="viewBooking__label">
                Staff ที่บันทึกรายการ:{" "}
              </span>
              <p className="viewBooking__infoText">{data.staffUsername}</p>
            </div>
          </div>
          <div className="viewBooking__mainRight">
            {/* <p>ค่าใช้จ่าย</p> */}
            <div className="viewBooking__transactions">
              <div className="viewBooking__priceList">
                {groupedTransactions.map(({ transaction, children }, index) => (
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
                          }}
                        >
                          <i
                            className={`bx ${transactionMap[transaction.type].icon} viewBooking__bedIcon`}
                            style={{
                              backgroundColor:
                                transactionMap[transaction.type].color,
                            }}
                          />
                          <div>
                            <p className="viewBooking__infoText">
                              {formatTransactionAmount(transaction)}
                            </p>
                            <p>{transactionMap[transaction.type].name}</p>
                          </div>
                        </div>
                        {renderPaymentMethod(transaction)}
                      </div>
                    )}
                    {children.map(renderChildTransaction)}
                  </div>
                ))}
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
                  <h3>{roomStay.roomId}</h3>
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

            {data.note && (
              <div className="viewBooking__note">
                <p
                  style={{
                    color: "#ffbf00",
                    display: "flex",
                    alignItems: "center",
                    gap: ".5rem",
                    marginBottom: ".5rem",
                  }}
                >
                  <i className="bx bx-note" style={{ fontSize: "1.3rem" }} />
                  Note:{" "}
                </p>
                <p>{data.note}</p>
              </div>
            )}
          </div>
        </div>
        <div className="viewBooking__actions">
          <div className="viewBooking__actionsLeft">
            <ActionButton
              text="แก้ไข"
              icon="bx-edit"
              onClick={() => setEditBookingIsOpen(true)}
            />
            <ActionButton
              text="ลบ"
              onClick={() => removeBookingHandler(data)}
              icon="bx-trash"
            />
            <ActionButton
              text="ยกเลิก"
              onClick={() => {}}
              icon="bx-calendar-x"
            />
          </div>
          {data.status === "booked" && (
            <ActionButton
              text="Check In"
              onClick={() => setCheckInIsOpen(true)}
              icon="bx-check-circle"
              highlight
            />
          )}
        </div>
      </div>
    </>
  );
};

export default ViewBooking;
