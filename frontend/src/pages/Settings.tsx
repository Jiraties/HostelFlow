import ActionButton from "../components/ActionButton";
import "./Settings.css";
import axios from "axios";
import { useAuth } from "../context/AuthContext";
import { useNavigate } from "react-router";
import { API_URL } from "../config/api";
import RecentActivities from "../features/activities/RecentActivities";
import PageHeader from "../components/PageHeader";

const Settings = () => {
  const { logout, user, login } = useAuth();
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

  const setProfilePicture = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const image = event.target.files?.[0];

    if (!image) return;

    const formData = new FormData();
    formData.append("profilePicture", image);

    await axios.patch(`${API_URL}/auth/me/profile-picture`, formData, {
      withCredentials: true,
      headers: { "Content-Type": "multipart/form-data" },
    });

    try {
      const response = await axios.get(`${API_URL}/auth/me`, {
        withCredentials: true,
      });

      const user = response.data.user;

      if (response.data.user) {
        console.log(user);
        login(user);
      }
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <main className="settings">
      <PageHeader title="ตั้งค่า และ ประวัติ" />
      <div className="settings__grid">
        <div className="settings__list">
          <div className="settings__profile">
            <label className="settings__profilePicture--wrapper">
              <input
                type="file"
                accept="image/*"
                className="settings__profilePicture--upload"
                onChange={setProfilePicture}
              />
              <img
                className="settings__profilePicture"
                src={API_URL + user?.profilePictureUrl}
                alt=""
              />
              <span className="settings__profilePictureOverlay">
                <i className="bx bx-camera" />
              </span>
            </label>
            <div>
              <h3>
                {user?.name}{" "}
                {user?.admin && (
                  <span className="settings__adminTag">Admin</span>
                )}
              </h3>
              <p>@{user?.username}</p>
            </div>
          </div>

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
