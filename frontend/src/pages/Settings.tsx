import ActionButton from "../components/ActionButton";
import "./Settings.css";
import axios from "axios";
import { useAuth } from "../context/AuthContext";
import { useNavigate } from "react-router";
import { API_URL } from "../config/api";
import RecentActivities from "../features/activities/RecentActivities";

const Settings = () => {
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
        <RecentActivities />
      </div>
    </main>
  );
};

export default Settings;
