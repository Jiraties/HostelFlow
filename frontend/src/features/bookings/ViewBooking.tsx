import { useState } from "react";
import ActionButton from "../../components/ActionButton";
import type { booking } from "../../types/bookingTypes";
import "./ViewBooking.css";
import { platformMap } from "../../helpers/maps.ts";

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
};

const ViewBooking = ({
  booking,
  removeBookingHandler,
  setCheckInIsOpen,
}: {
  booking: booking;
  removeBookingHandler: (booking: booking) => void;
  setCheckInIsOpen: (isOpen: boolean) => void;
}) => {
  const [note, setNote] = useState<string>(booking.note || "");

  const statusDeterminer = (status: string, usedFor: string) => {
    const checkInIsToday =
      new Date().toISOString().split("T")[0] ===
      new Date(booking.checkIn).toISOString().split("T")[0];

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
  };

  const roomsName = booking.roomStays
    .map((roomStay) => roomStay.roomId)
    .join(", ");

  const roomChargeTransaction = booking.transactions.find(
    (transaction) => transaction.type === "roomCharge",
  )!;

  return (
    <div className="viewBooking__wrapper">
      <div className="viewBooking__top">
        <h1 className="viewBooking__name">
          {booking.name.split(" ").map((word) => (
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
              statusDeterminer(booking.status, "classname")
            }
          >
            <div className="viewBooking__statusDot"></div>
            <p className="viewBooking__statusText">
              {statusDeterminer(booking.status, "text")}
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
                style={{ color: platformMap[booking.platformId]?.color }}
              >
                {platformMap[booking.platformId]?.label || "ไม่ทราบ"}
              </p>
              <img
                className="viewBooking__logo"
                src={platformMap[booking.platformId]?.logo}
                alt={platformMap[booking.platformId]?.label}
              />
            </div>
          </div>
          <div className="viewBooking__item">
            <span className="viewBooking__label">Check-In: </span>
            <p className="viewBooking__infoText">
              {new Intl.DateTimeFormat("th-TH", {
                calendar: "gregory",
                dateStyle: "medium",
              }).format(booking.checkIn)}{" "}
              <span className="viewBooking__nights">{booking.nights} คืน</span>
            </p>
          </div>
          <div className="viewBooking__item">
            <span className="viewBooking__label">Check-Out </span>
            <p className="viewBooking__infoText">
              {new Intl.DateTimeFormat("th-TH", {
                calendar: "gregory",
                dateStyle: "medium",
              }).format(booking.checkOut)}
            </p>
          </div>

          <div className="viewBooking__item">
            <span className="viewBooking__label">ห้อง: </span>
            <p className="viewBooking__infoText">{roomsName}</p>
          </div>

          <div className="viewBooking__item">
            <span className="viewBooking__label">Booking No: </span>
            <p className="viewBooking__infoText">{booking.bookingId}</p>
          </div>

          <div className="viewBooking__item">
            <span className="viewBooking__label">Staff ที่บันทึกรายการ: </span>
            <p className="viewBooking__infoText">{booking.staffUsername}</p>
          </div>
        </div>
        <div className="viewBooking__mainRight">
          {/* <p>ค่าใช้จ่าย</p> */}
          <div className="viewBooking__priceList">
            {booking.transactions.map((transaction, index) => (
              <div
                className="viewBooking__price"
                style={
                  index === booking.transactions.length - 1
                    ? {}
                    : { borderBottom: "1px solid #eee" }
                }
                key={transaction.amount}
              >
                <div
                  style={{ display: "flex", gap: "1rem", alignItems: "center" }}
                >
                  <i
                    className={`bx ${transactionMap[transaction.type].icon} viewBooking__bedIcon`}
                    style={{
                      backgroundColor: transactionMap[transaction.type].color,
                    }}
                  />
                  <div>
                    <p className="viewBooking__infoText">
                      {transaction.amount.toLocaleString("th-TH")} บาท
                    </p>
                    <p>{transactionMap[transaction.type].name}</p>
                  </div>
                </div>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <p
                    className={
                      transaction.paymentMethod === "Unpaid"
                        ? "viewBooking__unpaid"
                        : ""
                    }
                  >
                    {transaction.paymentMethod}
                    {}
                  </p>
                  {transaction.paymentMethod === "Unpaid" ? (
                    <i
                      className="bx bx-error viewBooking__unpaid"
                      style={{ fontSize: "1.4rem" }}
                    />
                  ) : (
                    <i
                      className={
                        "bx " + paymentMethodIconMap[transaction.paymentMethod]
                      }
                      style={{ fontSize: "1.4rem" }}
                    />
                  )}
                </div>
              </div>
            ))}
            <div className="viewBooking__addTransaction">
              <i className="bx bx-dollar" />
              <p>เพิ่มรายการใช้จ่าย</p>
            </div>
          </div>

          <div className="viewBooking__roomStays">
            {booking.roomStays.map((roomStay, index) => (
              <div
                className="viewBooking__roomStay"
                style={
                  index === booking.roomStays.length - 1
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
            <div className="viewBooking__addTransaction">
              <i className="bx bx-bed" />
              <p>จัดการห้องพัก</p>
            </div>
          </div>

          {booking.note && (
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
              <p>{booking.note}</p>
            </div>
          )}
        </div>
      </div>
      <div className="viewBooking__actions">
        <div className="viewBooking__actionsLeft">
          <ActionButton text="แก้ไขการจอง" onClick={() => {}} icon="bx-edit" />
          <ActionButton
            text="ลบการจอง"
            onClick={() => removeBookingHandler(booking)}
            icon="bx-trash"
          />
          <ActionButton
            text="ยกเลิกการจอง"
            onClick={() => {}}
            icon="bx-calendar-x"
          />
        </div>
        {booking.status === "booked" && (
          <ActionButton
            text="Check In"
            onClick={() => setCheckInIsOpen(true)}
            icon="bx-check-circle"
            highlight
          />
        )}
      </div>
    </div>
  );
};

export default ViewBooking;
