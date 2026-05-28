import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { API_URL } from "../config/api";
import type { actionType, activity } from "../types/activitiesTypes";
import "./Manage.css";
import { useAuth } from "../context/AuthContext";
import { Link } from "react-router";

type StaffUser = {
  userId: string;
  username: string;
  name: string;
  admin: boolean;
};

type ActivityStats = {
  totalActions: number;
  byStaff: Array<{ staffUsername: string; count: number }>;
  byAction: Array<{ action: actionType; count: number }>;
};

type NewUserForm = {
  username: string;
  name: string;
  password: string;
  admin: boolean;
};

const actionMap = {
  NEW_BOOKING: { icon: "bx-plus", text: "เพิ่ม Booking" },
  REMOVE_BOOKING: { icon: "bx-trash", text: "ลบ Booking" },
  EDIT_BOOKING: { icon: "bx-edit", text: "แก้ไข Booking" },
  CHECK_IN: { icon: "bx-check-circle", text: "Check-In" },
  MANAGE_ROOM_STAYS: { icon: "bx-calendar-cog", text: "แก้ช่วงการเข้าพัก" },
  ADD_TRANSACTION: { icon: "bx-dollar", text: "เพิ่มรายการใช้จ่าย" },
  CREATE_USER: { icon: "bx-user-plus", text: "สร้างผู้ใช้" },
  RESET_USER_PASSWORD: { icon: "bx-key", text: "เปลี่ยนรหัสผ่าน" },
  LOGIN: { icon: "bx-arrow-in-right-square-half", text: "เข้าสู่ระบบ" },
  LOGOUT: { icon: "bx-arrow-out-right-square-half", text: "ออกจากระบบ" },
} satisfies Record<actionType, { icon: string; text: string }>;

const emptyNewUserForm: NewUserForm = {
  username: "",
  name: "",
  password: "",
  admin: false,
};

const formatDateTime = (date: string | Date) =>
  new Date(date).toLocaleString("th-TH", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    calendar: "gregory",
  });

const Manage = () => {
  const [users, setUsers] = useState<StaffUser[]>([]);
  const [activities, setActivities] = useState<activity[]>([]);
  const [stats, setStats] = useState<ActivityStats | null>(null);
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [creatingUser, setCreatingUser] = useState(false);
  const [resettingUserId, setResettingUserId] = useState<string | null>(null);
  const [newUserForm, setNewUserForm] = useState<NewUserForm>(emptyNewUserForm);
  const [resetPasswords, setResetPasswords] = useState<Record<string, string>>(
    {},
  );

  const fetchManageData = async () => {
    const [usersResponse, activitiesResponse, statsResponse] =
      await Promise.all([
        axios.get(`${API_URL}/auth/users`, { withCredentials: true }),
        axios.get(`${API_URL}/activities/admin`, { withCredentials: true }),
        axios.get(`${API_URL}/activities/admin/stats`, {
          withCredentials: true,
        }),
      ]);

    setUsers(usersResponse.data.users);
    setActivities(activitiesResponse.data.activities);
    setStats(statsResponse.data);
  };

  useEffect(() => {
    let ignore = false;

    const load = async () => {
      setLoading(true);
      try {
        const [usersResponse, activitiesResponse, statsResponse] =
          await Promise.all([
            axios.get(`${API_URL}/auth/users`, { withCredentials: true }),
            axios.get(`${API_URL}/activities/admin`, { withCredentials: true }),
            axios.get(`${API_URL}/activities/admin/stats`, {
              withCredentials: true,
            }),
          ]);

        if (ignore) return;
        setUsers(usersResponse.data.users);
        setActivities(activitiesResponse.data.activities);
        setStats(statsResponse.data);
      } finally {
        if (!ignore) setLoading(false);
      }
    };

    void load();

    return () => {
      ignore = true;
    };
  }, []);

  const mostActiveStaff = stats?.byStaff[0];
  const mostCommonAction = stats?.byAction[0];

  const statCards = useMemo(
    () => [
      { label: "จำนวน Action เดือนนี้", value: stats?.totalActions || 0 },
      { label: "จำนวน Staff", value: users.length },
      {
        label: "Staff ที่ใช้งานมากสุด",
        value: mostActiveStaff?.staffUsername || "-",
      },
      {
        label: "Action ที่พบบ่อยสุด",
        value: mostCommonAction ? actionMap[mostCommonAction.action].text : "-",
      },
    ],
    [mostActiveStaff, mostCommonAction, stats?.totalActions, users.length],
  );

  const updateNewUserForm = (
    field: keyof NewUserForm,
    value: string | boolean,
  ) => {
    setNewUserForm((prev) => ({ ...prev, [field]: value }));
  };

  const createUserHandler = async () => {
    if (!newUserForm.username || !newUserForm.name || !newUserForm.password) {
      throw new Error("กรุณากรอกข้อมูลผู้ใช้ให้ครบ");
    }

    setCreatingUser(true);
    try {
      await axios.post(`${API_URL}/auth/admin/createUser`, newUserForm, {
        withCredentials: true,
      });
      setNewUserForm(emptyNewUserForm);
      await fetchManageData();
    } finally {
      setCreatingUser(false);
    }
  };

  const resetPasswordHandler = async (user: StaffUser) => {
    const password = resetPasswords[user.userId];

    if (!password) {
      throw new Error("กรุณากรอกรหัสผ่านใหม่");
    }

    setResettingUserId(user.userId);
    try {
      await axios.patch(
        `${API_URL}/auth/users/${user.userId}/password`,
        { password },
        { withCredentials: true },
      );
      setResetPasswords((prev) => ({ ...prev, [user.userId]: "" }));
      await fetchManageData();
    } finally {
      setResettingUserId(null);
    }
  };

  const manageApi = {
    actionMap,
    activities,
    createUserHandler,
    creatingUser,
    fetchManageData,
    formatDateTime,
    loading,
    newUserForm,
    resetPasswordHandler,
    resetPasswords,
    resettingUserId,
    setResetPasswords,
    statCards,
    stats,
    updateNewUserForm,
    users,
  };

  void manageApi;

  return (
    <main className="manage">
      <header className="home__header">
        <div>
          <h1>จัดการ Staff</h1>
          <div className="main__lastUpdated">
            {/* <p>
              ข้อมูลอัปเดตล่าสุดเมื่อ{" "}
              {lastUpdated
                ? `${lastUpdated.getHours()}:${lastUpdated
                    .getMinutes()
                    .toString()
                    .padStart(2, "0")}`
                : "--:--"}
            </p> */}
            <i
              className="bx bx-refresh home__refreshIcon"
              //   onClick={() => {
              //     toast.promise(() => {}, {
              //       loading: "กำลังอัปเดตข้อมูล...",
              //       success: "อัปเดตข้อมูลสำเร็จ",
              //       error: "เกิดข้อผิดพลาดในการอัปเดตข้อมูล",
              //     });
              //   }}
            />
          </div>
        </div>

        <div className="home__headerProfile">
          <p>
            {user?.name} <strong>{"  " + (user?.admin ? " Admin" : "")}</strong>
          </p>
          <Link to={"/settings"}>
            <img
              className="home__profileImg"
              src="https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcR3m972e8FEvBi7ETC03avlJcZDg8nT9dWLSw&s"
              alt="profilePicture"
            />
          </Link>
        </div>
      </header>
    </main>
  );
};

export default Manage;
