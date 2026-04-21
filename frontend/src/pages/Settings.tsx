import ActionButton from "../components/ActionButton";
import "./Settings.css";
import axios from "axios";
import { useAuth } from "../context/AuthContext";
import { useLocation, useNavigate } from "react-router";
import { useEffect, useState } from "react";
import type { activity } from "../types/activitiesTypes";
import { API_URL } from "../config/api";

const Settings = () => {
  const [activities, setActivities] = useState<activity[]>([]);
  const location = useLocation();
  const { logout } = useAuth();
  const navigate = useNavigate();

  const fetchActivities = async () => {
    const fetchedActivities = await axios.get(
      `${API_URL}/activities/recentActivities`,
      { withCredentials: true },
    );

    setActivities(fetchedActivities.data.activities);
  };

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
    fetchActivities();
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
            const date = new Date(activity.timestamp);
            const actionMap = {
              NEW_BOOKING: { icon: "bx-plus", text: "เพิ่ม Booking" },
              REMOVE_BOOKING: { icon: "bx-trash", text: "ลบ Booking" },
              LOGOUT: {
                icon: "bx-arrow-out-right-square-half",
                text: "ออกจากระบบ",
              },
              LOGIN: {
                icon: "bx-arrow-in-right-square-half",
                text: "เข้าสู่ระบบ",
              },
            };

            if (
              activity.action === "NEW_BOOKING" ||
              activity.action === "REMOVE_BOOKING"
            )
              return (
                <div className="settings__activity">
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "1rem",
                    }}
                  >
                    <i
                      className={
                        "bx settings__activityIcon " +
                        actionMap[activity.action]["icon"]
                      }
                    ></i>
                    <div>
                      <h3>{actionMap[activity.action]["text"]}</h3>
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

            return (
              <div className="settings__activity">
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "1rem",
                  }}
                >
                  <i
                    className={
                      "bx settings__activityIcon " +
                      actionMap[activity.action]["icon"]
                    }
                  ></i>
                  <div>
                    <h3>{actionMap[activity.action]["text"]}</h3>
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
