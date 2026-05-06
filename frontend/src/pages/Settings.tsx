import ActionButton from "../components/ActionButton";
import "./Settings.css";
import axios from "axios";
import { useAuth } from "../context/AuthContext";
import { useLocation, useNavigate } from "react-router";
import { useEffect, useState } from "react";
import type { activity, roomStay, transaction } from "../types/activitiesTypes";
import { API_URL } from "../config/api";

const actionMap = {
  NEW_BOOKING: { icon: "bx-plus", text: "เพิ่ม Booking" },
  REMOVE_BOOKING: { icon: "bx-trash", text: "ลบ Booking" },
  EDIT_BOOKING: { icon: "bx-edit", text: "แก้ไข Booking" },
  CHECK_IN: { icon: "bx-check-circle", text: "Check-In" },
  MANAGE_ROOM_STAYS: {
    icon: "bx-calendar-cog",
    text: "แก้ช่วงการเข้าพัก",
  },
  ADD_TRANSACTION: {
    icon: "bx-dollar",
    text: "เพิ่มรายการใช้จ่าย",
  },
  LOGOUT: {
    icon: "bx-arrow-out-right-square-half",
    text: "ออกจากระบบ",
  },
  LOGIN: {
    icon: "bx-arrow-in-right-square-half",
    text: "เข้าสู่ระบบ",
  },
} satisfies Record<activity["action"], { icon: string; text: string }>;

const transactionLabelMap = {
  roomCharge: "ค่าห้อง",
  deposit: "รับมัดจำ",
  adjustment: "ปรับราคา",
  depositRefund: "คืนมัดจำ",
  towel: "ผ้าเช็ดตัว",
  motorbike: "มอเตอร์ไซค์",
  slowBoat: "Slow Boat",
  joinTour: "Join Tour",
  extraBed: "เตียงเสริม",
  cardSurcharge: "ค่าธรรมเนียมบัตร",
} satisfies Record<transaction["type"], string>;

const formatCurrency = (amount: number) =>
  amount.toLocaleString("th-TH", {
    minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });

const formatDate = (date: string | Date) =>
  new Date(date).toLocaleDateString("th-TH", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    calendar: "gregory",
  });

const formatRoomStay = (stay: roomStay) =>
  `${stay.roomId}: ${formatDate(stay.from)} - ${formatDate(stay.to)}`;

const getAddedTransactions = (activity: activity) => {
  if (activity.action !== "ADD_TRANSACTION") return [];

  const summaryTransactions = activity.details.summary?.addedTransactions;
  if (summaryTransactions?.length) return summaryTransactions;

  const transactions = activity.details.changes?.transactions;
  if (!transactions) return [];

  return transactions.after.slice(transactions.before.length);
};

const getRoomStayChange = (activity: activity) => {
  if (activity.action !== "MANAGE_ROOM_STAYS") return null;

  const summary = activity.details.summary;
  if (summary?.beforeRoomStays?.length || summary?.afterRoomStays?.length) {
    return {
      before: summary.beforeRoomStays || [],
      after: summary.afterRoomStays || [],
    };
  }

  const roomStays = activity.details.changes?.roomStays;
  if (!roomStays) return null;

  return {
    before: roomStays.before,
    after: roomStays.after,
  };
};

const Settings = () => {
  const [activities, setActivities] = useState<activity[]>([]);
  const location = useLocation();
  const { logout } = useAuth();
  const navigate = useNavigate();

  const logoutHandler = async () => {
    await axios.post(
      `${API_URL}/auth/logout`,
      {},
      {
        withCredentials: true,
      },
    );

    logout();

    navigate("/");
  };

  useEffect(() => {
    let ignore = false;

    const fetchActivities = async () => {
      const fetchedActivities = await axios.get(
        `${API_URL}/activities/recentActivities`,
        { withCredentials: true },
      );

      if (!ignore) setActivities(fetchedActivities.data.activities);
    };

    void fetchActivities();

    return () => {
      ignore = true;
    };
  }, [location]);

  console.log(activities);

  return (
    <main className="settings">
      <h1>ตั้งค่า และ ประวัติ</h1>
      <div className="settings__grid">
        <div className="settings__list">
          <div className="settings__item">
            <p>ออกจากระบบ</p>
            <ActionButton
              text="ออกจากระบบ"
              icon="bx-arrow-out-right-square-half"
              onClick={logoutHandler}
              className="settings__logout"
            />
          </div>
        </div>
        <div className="settings__activities">
          {activities.map((activity) => {
            console.log(activity);
            const date = new Date(activity.timestamp);
            const action = actionMap[activity.action];
            const addedTransactions = getAddedTransactions(activity);
            const roomStayChange = getRoomStayChange(activity);

            if (
              activity.action === "NEW_BOOKING" ||
              activity.action === "REMOVE_BOOKING"
            )
              return (
                <div
                  className="settings__activity"
                  key={activity.timestamp.toString()}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "1rem",
                    }}
                  >
                    <i
                      className={`bx settings__activityIcon ${action.icon}`}
                    ></i>
                    <div>
                      <h3>{action.text}</h3>
                      <p>
                        {date.toLocaleTimeString("th-TH", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                        {" - "}
                        {date.toLocaleDateString("th-TH", {
                          day: "2-digit",
                          month: "long",
                          year: "numeric",
                          calendar: "gregory",
                        })}
                      </p>
                    </div>
                  </div>

                  <div className="settings__activityDetails">
                    <p>
                      <strong>ชื่อผู้เข้าพัก:</strong>{" "}
                      {activity.details.snapshot?.name}
                    </p>
                    <p>
                      <strong>Check In:</strong>{" "}
                      {new Date(
                        activity.details.snapshot?.checkIn || "",
                      ).toLocaleDateString("th-TH", { calendar: "gregory" })}
                    </p>
                    <p>
                      <strong>Check Out:</strong>{" "}
                      {new Date(
                        activity.details.snapshot?.checkOut || "",
                      ).toLocaleDateString("th-TH", { calendar: "gregory" })}
                    </p>
                    <p>
                      <strong>ห้อง:</strong> {activity.details.snapshot?.roomId}
                    </p>
                    <p>
                      <strong>ช่องทางการจอง:</strong>{" "}
                      {activity.details.snapshot?.platformId}
                    </p>
                    <p>
                      <strong>ราคา:</strong> {activity.details.snapshot?.price}
                    </p>
                    <p>
                      <strong>ช่องทางการจ่าย:</strong>{" "}
                      {activity.details.snapshot?.paymentMethod}
                    </p>
                    <p>
                      <strong>Booking ID:</strong>{" "}
                      {activity.details.snapshot?.bookingId}
                    </p>
                  </div>
                </div>
              );

            if (activity.action === "ADD_TRANSACTION") {
              return (
                <div
                  className="settings__activity"
                  key={activity.timestamp.toString()}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "1rem",
                    }}
                  >
                    <i className={`bx settings__activityIcon ${action.icon}`}></i>
                    <div>
                      <h3>{action.text}</h3>
                      <p>
                        {date.toLocaleTimeString("th-TH", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                        {" - "}
                        {date.toLocaleDateString("th-TH", {
                          day: "2-digit",
                          month: "long",
                          year: "numeric",
                          calendar: "gregory",
                        })}
                      </p>
                    </div>
                  </div>

                  <div className="settings__activityDetails">
                    <p>
                      <strong>Booking ID:</strong> {activity.bookingId}
                    </p>
                    {addedTransactions.map((transaction, index) => (
                      <p
                        key={`${transaction.type}-${transaction.amount}-${index}`}
                      >
                        <strong>
                          {transactionLabelMap[transaction.type]}:
                        </strong>{" "}
                        {formatCurrency(transaction.amount)} บาท (
                        {transaction.paymentMethod})
                      </p>
                    ))}
                  </div>
                </div>
              );
            }

            if (activity.action === "MANAGE_ROOM_STAYS") {
              return (
                <div
                  className="settings__activity"
                  key={activity.timestamp.toString()}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "1rem",
                    }}
                  >
                    <i className={`bx settings__activityIcon ${action.icon}`}></i>
                    <div>
                      <h3>{action.text}</h3>
                      <p>
                        {date.toLocaleTimeString("th-TH", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                        {" - "}
                        {date.toLocaleDateString("th-TH", {
                          day: "2-digit",
                          month: "long",
                          year: "numeric",
                          calendar: "gregory",
                        })}
                      </p>
                    </div>
                  </div>

                  <div className="settings__activityDetails">
                    <p>
                      <strong>Booking ID:</strong> {activity.bookingId}
                    </p>
                    <p>
                      <strong>ก่อนแก้:</strong>{" "}
                      {roomStayChange?.before.map(formatRoomStay).join(", ") ||
                        "-"}
                    </p>
                    <p>
                      <strong>หลังแก้:</strong>{" "}
                      {roomStayChange?.after.map(formatRoomStay).join(", ") ||
                        "-"}
                    </p>
                  </div>
                </div>
              );
            }

            return (
              <div
                className="settings__activity"
                key={activity.timestamp.toString()}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "1rem",
                  }}
                >
                  <i className={`bx settings__activityIcon ${action.icon}`}></i>
                  <div>
                    <h3>{action.text}</h3>
                    <p>
                      {date.toLocaleTimeString("th-TH", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                      {" - "}
                      {date.toLocaleDateString("th-TH", {
                        day: "2-digit",
                        month: "long",
                        year: "numeric",
                        calendar: "gregory",
                      })}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </main>
  );
};

export default Settings;
