import "./Settings.css";
import axios from "axios";
import { useAuth } from "../context/AuthContext";
import { useNavigate } from "react-router";
import { API_URL } from "../config/api";
import { profilePictureUrl } from "../helpers/profilePictureUrl";
import RecentActivities from "../features/activities/RecentActivities";
import PageHeader from "../components/PageHeader";
import usePageTitle from "../hooks/useTitle";
import SettingsItem from "../features/settings/SettingsItem";
import toast from "react-hot-toast";
import { paymentMethodOptions, platformOptions } from "../helpers/options";
import type { UserSettings } from "../types/userSettings";

const settingsSelectOptions = {
  calendarColorMode: [
    { value: "status", label: "สีตาม Status" },
    { value: "source", label: "สีตาม Platform" },
  ],
  calendarDensity: [
    { value: "compact", label: "กระชับ" },
    { value: "comfortable", label: "ปกติ" },
    { value: "spacious", label: "กว้าง" },
  ],
  tableDensity: [
    { value: "compact", label: "กระชับ" },
    { value: "comfortable", label: "ปกติ" },
    { value: "spacious", label: "กว้าง" },
  ],
  dateFormat: [
    { value: "dd/MM/yyyy", label: "DD/MM/YYYY" },
    { value: "d MMM yyyy", label: "D MMM YYYY" },
  ],
};

const settingsFields: {
  key: keyof UserSettings;
  label: string;
  options: { value: string; label: string }[];
}[] = [
  {
    key: "calendarColorMode",
    label: "สีในปฏิทิน",
    options: settingsSelectOptions.calendarColorMode,
  },
  {
    key: "calendarDensity",
    label: "ความหนาแน่นปฏิทิน",
    options: settingsSelectOptions.calendarDensity,
  },
  {
    key: "tableDensity",
    label: "ความหนาแน่นตาราง",
    options: settingsSelectOptions.tableDensity,
  },
  {
    key: "defaultPlatformId",
    label: "ช่องทางการจองเริ่มต้น",
    options: [
      { value: "", label: "ไม่ตั้งค่าเริ่มต้น" },
      ...platformOptions.map((option) => ({
        value: option.value,
        label: option.label,
      })),
    ],
  },
  {
    key: "defaultPaymentMethod",
    label: "ช่องทางการชำระเงินเริ่มต้น",
    options: [
      { value: "", label: "ไม่ตั้งค่าเริ่มต้น" },
      ...paymentMethodOptions.map((option) => ({
        value: option.value,
        label: option.label,
      })),
    ],
  },
  {
    key: "dateFormat",
    label: "รูปแบบวันที่",
    options: settingsSelectOptions.dateFormat,
  },
];

const Settings = () => {
  usePageTitle("HostelFlow · ตั้งค่า");
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

  const updateSetting = async <K extends keyof UserSettings>(
    key: K,
    value: UserSettings[K],
  ) => {
    if (!user) return;

    const previousUser = user;
    const optimisticUser = {
      ...user,
      settings: {
        ...user.settings,
        [key]: value,
      },
    };

    login(optimisticUser);

    try {
      const response = await axios.patch(
        `${API_URL}/auth/me/settings`,
        { [key]: value },
        { withCredentials: true },
      );

      login({
        ...response.data.user,
        settings: {
          ...(response.data.user?.settings || {}),
          [key]: value,
        },
      });
      toast.success("บันทึกการตั้งค่าแล้ว");
    } catch (err) {
      login(previousUser);
      const errorMessage = axios.isAxiosError(err)
        ? err.response?.status === 404
          ? "ไม่พบ API สำหรับบันทึกการตั้งค่า กรุณารีสตาร์ท backend"
          : err.response?.data?.message || "บันทึกการตั้งค่าไม่สำเร็จ"
        : "บันทึกการตั้งค่าไม่สำเร็จ";

      toast.error(errorMessage);
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
                src={profilePictureUrl(user?.profilePictureUrl)}
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

          <SettingsItem
            label="ออกจากระบบ"
            buttonLabel="ออกจากระบบ"
            action={logoutHandler}
            icon="bx-arrow-out-right-square-half"
            buttonClassName="settings__logout"
          />

          <hr className="settings__separator" />

          {/* <div className="settings__fields"> */}
          {settingsFields.map((field) => (
            <label className="settings__field" key={field.key}>
              <span className="settings__fieldCopy">
                <span className="settings__fieldLabel">{field.label}</span>
              </span>
              <span className="settings__selectWrap">
                <select
                  className="settings__select"
                  value={String(user?.settings[field.key] ?? "")}
                  onChange={(event) =>
                    updateSetting(
                      field.key,
                      event.target.value as UserSettings[typeof field.key],
                    )
                  }
                >
                  {field.options.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <i className="bx bx-chevron-down" aria-hidden="true" />
              </span>
            </label>
          ))}
          {/* </div> */}
        </div>
        <RecentActivities />
      </div>
    </main>
  );
};

export default Settings;
