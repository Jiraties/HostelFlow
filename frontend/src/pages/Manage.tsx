import "./Manage.css";

import axios from "axios";
import ActionButton from "../components/ActionButton";
import PageHeader from "../components/PageHeader";
import ViewActivities from "../features/activities/ViewActivities";

import { useEffect, useMemo, useState } from "react";
import { API_URL } from "../config/api";
import { Modal } from "@mui/material";
import type { actionType, activity } from "../types/activitiesTypes";
import CreateNewUser from "../components/CreateNewUser";
import ManageUser from "../components/ManageUser";
import { useAuth } from "../context/AuthContext";
import type { ManagedStaffUser } from "../components/ManageUser";
import { requestUnsavedModalClose } from "../helpers/modalGuards";
import UnsavedChangesModal from "../components/UnsavedChangesModal";

type StaffUser = ManagedStaffUser;

type ActivityStats = {
  totalActions: number;
  byStaff: Array<{ staffUsername: string; count: number }>;
  byAction: Array<{ action: actionType; count: number }>;
};

type FinanceSummary = {
  revenue: number;
  cashIn: number;
  cashOut: number;
  netTotal: number;
  refunds: number;
  depositLiability: number;
  cardSurcharges: number;
  unpaidBalance: number;
};

type DailyClose = {
  businessDate: string;
  staffUsername: string;
  openingCash: number;
  expectedCash: number;
  actualCash: number;
  variance: number;
  cashIn: number;
  cashOut: number;
  note?: string;
};

type ReviewTransaction = {
  bookingId?: string;
  guestName?: string;
  staffUsername?: string;
  type: string;
  paymentMethod: string;
  amount: number;
  direction?: "in" | "out" | "neutral";
  reviewFlags?: string[];
  note?: string;
};

type ReconciliationData = {
  businessDate: string;
  threshold: number;
  summary: FinanceSummary;
  transactions: ReviewTransaction[];
  dailyCloses: DailyClose[];
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
  CHECK_OUT: { icon: "bx-door-open", text: "Check-Out" },
  CANCEL_BOOKING: { icon: "bx-calendar-x", text: "ยกเลิก Booking" },
  RESOLVE_STAY: { icon: "bx-receipt", text: "เคลียร์การเข้าพัก" },
  POST_CLOSE_ADJUSTMENT: {
    icon: "bx-history",
    text: "แก้ไขหลังปิด",
  },
  MANAGE_ROOM_STAYS: { icon: "bx-calendar-cog", text: "แก้ช่วงการเข้าพัก" },
  ADD_TRANSACTION: { icon: "bx-dollar", text: "เพิ่มรายการใช้จ่าย" },
  CREATE_USER: { icon: "bx-user-plus", text: "สร้างผู้ใช้" },
  RESET_USER_PASSWORD: { icon: "bx-key", text: "เปลี่ยนรหัสผ่าน" },
  UPDATE_USER: { icon: "bx-user-cog", text: "แก้ไขผู้ใช้" },
  DEACTIVATE_USER: { icon: "bx-user-x", text: "ปิดใช้งานผู้ใช้" },
  REACTIVATE_USER: { icon: "bx-user-check", text: "เปิดใช้งานผู้ใช้" },
  LOGIN: { icon: "bx-arrow-in-right-square-half", text: "เข้าสู่ระบบ" },
  LOGOUT: { icon: "bx-arrow-out-right-square-half", text: "ออกจากระบบ" },
  DAILY_CLOSE: { icon: "bx-cash", text: "ปิดยอดเงินสด" },
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

const todayInputValue = () => {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
};

const formatMoney = (value: number) =>
  value.toLocaleString("th-TH", {
    minimumFractionDigits: value % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });

const FinanceReconciliation = ({
  reconciliation,
  reviewEvents,
  financeDate,
  onDateChange,
}: {
  reconciliation: ReconciliationData | null;
  reviewEvents: ReviewTransaction[];
  financeDate: string;
  onDateChange: (value: string) => void;
}) => {
  const summary = reconciliation?.summary;

  return (
    <section className="manage__finance">
      <div className="manage__sectionHeader">
        <div>
          <i className="bx bx-currency-notes" />
          <div>
            <h2>Daily Cash Close</h2>
            <p>สรุปยอดเงินสดและรายการที่ควรตรวจประจำวัน</p>
          </div>
        </div>
        <div className="manage__financeHeaderActions">
          <span>{reconciliation?.dailyCloses.length || 0} การปิดยอด</span>
          <input
            className="boxInput manage__dateInput"
            type="date"
            value={financeDate}
            onChange={(event) => onDateChange(event.target.value)}
          />
        </div>
      </div>

      <div className="manage__financeGrid">
        <div className="manage__financePanel">
          <h3>ยอดวันนี้</h3>
          <div className="manage__financeStatsGrid">
            <div>
              <p>รับเงินสด</p>
              <strong>{formatMoney(summary?.cashIn || 0)} ฿</strong>
            </div>
            <div>
              <p>จ่ายเงินสด</p>
              <strong>{formatMoney(summary?.cashOut || 0)} ฿</strong>
            </div>
            <div>
              <p>คืนเงิน</p>
              <strong>{formatMoney(summary?.refunds || 0)} ฿</strong>
            </div>
            <div>
              <p>Unpaid</p>
              <strong>{formatMoney(summary?.unpaidBalance || 0)} ฿</strong>
            </div>
          </div>
        </div>

        <div className="manage__financePanel">
          <div className="manage__financePanelHeader">
            <h3>รายการที่ควรตรวจ</h3>
            <span>{reviewEvents.length}</span>
          </div>
          <div className="manage__reviewList">
            {reviewEvents.length === 0 ? (
              <p>ไม่มีรายการที่ต้องตรวจ</p>
            ) : (
              reviewEvents.slice(0, 6).map((transaction, index) => (
                <div
                  className="manage__reviewItem"
                  key={`${transaction.bookingId}-${transaction.type}-${index}`}
                >
                  <div>
                    <strong>
                      {transaction.guestName || transaction.bookingId}
                    </strong>
                    <p>
                      {transaction.type} · {transaction.paymentMethod} ·{" "}
                      {transaction.staffUsername || "-"}
                    </p>
                  </div>
                  <span>{formatMoney(transaction.amount)} ฿</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {reconciliation?.dailyCloses.length ? (
        <div className="manage__dailyCloseList">
          {reconciliation.dailyCloses.map((dailyClose) => (
            <span
              key={`${dailyClose.businessDate}-${dailyClose.staffUsername}`}
            >
              {dailyClose.staffUsername}: actual{" "}
              {formatMoney(dailyClose.actualCash)} ฿ / variance{" "}
              {formatMoney(dailyClose.variance)} ฿
            </span>
          ))}
        </div>
      ) : null}
    </section>
  );
};

const Manage = () => {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<StaffUser[]>([]);
  const [activities, setActivities] = useState<activity[]>([]);
  const [stats, setStats] = useState<ActivityStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [createNewUserIsOpen, setCreateNewUserIsOpen] = useState(false);
  const [createNewUserIsDirty, setCreateNewUserIsDirty] = useState(false);
  const [pendingUnsavedClose, setPendingUnsavedClose] = useState<
    (() => void) | null
  >(null);
  const [creatingUser, setCreatingUser] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [newUserForm, setNewUserForm] = useState<NewUserForm>(emptyNewUserForm);
  const [user, setUser] = useState<StaffUser | null>(null);
  const [managedUser, setManagedUser] = useState<StaffUser | null>(null);
  const [savingUserId, setSavingUserId] = useState<string | null>(null);
  const [resettingPasswordUserId, setResettingPasswordUserId] = useState<
    string | null
  >(null);
  const [financeDate, setFinanceDate] = useState(todayInputValue());
  const [reconciliation, setReconciliation] =
    useState<ReconciliationData | null>(null);
  const [reviewEvents, setReviewEvents] = useState<ReviewTransaction[]>([]);

  const fetchManageData = async () => {
    const [
      usersResponse,
      activitiesResponse,
      statsResponse,
      reconciliationResponse,
      reviewEventsResponse,
    ] = await Promise.all([
      axios.get(`${API_URL}/auth/users`, { withCredentials: true }),
      axios.get(`${API_URL}/activities/admin`, { withCredentials: true }),
      axios.get(`${API_URL}/activities/admin/stats`, {
        withCredentials: true,
      }),
      axios.get(`${API_URL}/finance/reconciliation`, {
        params: { date: financeDate },
        withCredentials: true,
      }),
      axios.get(`${API_URL}/finance/review-events`, {
        params: { date: financeDate },
        withCredentials: true,
      }),
    ]);

    setUsers(usersResponse.data.users);
    setActivities(activitiesResponse.data.activities);
    setStats(statsResponse.data);
    setReconciliation(reconciliationResponse.data);
    setReviewEvents(reviewEventsResponse.data.transactions);
    setLastUpdated(new Date());
  };

  useEffect(() => {
    let ignore = false;

    const load = async () => {
      setLoading(true);
      try {
        const [
          usersResponse,
          activitiesResponse,
          statsResponse,
          reconciliationResponse,
          reviewEventsResponse,
        ] = await Promise.all([
          axios.get(`${API_URL}/auth/users`, { withCredentials: true }),
          axios.get(`${API_URL}/activities/admin`, { withCredentials: true }),
          axios.get(`${API_URL}/activities/admin/stats`, {
            withCredentials: true,
          }),
          axios.get(`${API_URL}/finance/reconciliation`, {
            params: { date: financeDate },
            withCredentials: true,
          }),
          axios.get(`${API_URL}/finance/review-events`, {
            params: { date: financeDate },
            withCredentials: true,
          }),
        ]);

        if (ignore) return;
        setUsers(usersResponse.data.users);
        setActivities(activitiesResponse.data.activities);
        setStats(statsResponse.data);
        setReconciliation(reconciliationResponse.data);
        setReviewEvents(reviewEventsResponse.data.transactions);
        setLastUpdated(new Date());
      } finally {
        if (!ignore) setLoading(false);
      }
    };

    void load();

    return () => {
      ignore = true;
    };
  }, [financeDate]);

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

  const updateUserHandler = async (
    user: StaffUser,
    updates: { name: string; admin: boolean; active: boolean },
  ) => {
    setSavingUserId(user.userId);
    try {
      const response = await axios.patch(
        `${API_URL}/auth/users/${user.userId}`,
        updates,
        { withCredentials: true },
      );
      await fetchManageData();
      setManagedUser(response.data.user);
    } finally {
      setSavingUserId(null);
    }
  };

  const resetPasswordHandler = async (user: StaffUser, password: string) => {
    setResettingPasswordUserId(user.userId);
    try {
      await axios.patch(
        `${API_URL}/auth/users/${user.userId}/password`,
        { password },
        { withCredentials: true },
      );
      await fetchManageData();
    } finally {
      setResettingPasswordUserId(null);
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
    statCards,
    stats,
    updateNewUserForm,
    users,
  };

  void manageApi;

  return (
    <main className="manage">
      <Modal
        open={!!user}
        className="home__modalCenter"
        onClose={() => setUser(null)}
      >
        <>{user && <ViewActivities userId={user.userId} name={user.name} />}</>
      </Modal>
      <Modal
        open={!!managedUser}
        className="home__modalCenter"
        onClose={() => setManagedUser(null)}
      >
        <>
          {managedUser && (
            <ManageUser
              user={managedUser}
              currentUserId={currentUser?.userId}
              onClose={() => setManagedUser(null)}
              onSave={(updates) => updateUserHandler(managedUser, updates)}
              onResetPassword={(password) =>
                resetPasswordHandler(managedUser, password)
              }
              saving={savingUserId === managedUser.userId}
              resettingPassword={resettingPasswordUserId === managedUser.userId}
            />
          )}
        </>
      </Modal>
      <Modal
        open={createNewUserIsOpen}
        className="home__modalCenter"
        onClose={() =>
          requestUnsavedModalClose(
            createNewUserIsDirty,
            () => setCreateNewUserIsOpen(false),
            () =>
              setPendingUnsavedClose(() => () => setCreateNewUserIsOpen(false)),
          )
        }
      >
        <CreateNewUser
          form={newUserForm}
          onChange={updateNewUserForm}
          onClose={() => setCreateNewUserIsOpen(false)}
          onSubmit={createUserHandler}
          submitting={creatingUser}
          onDirtyChange={setCreateNewUserIsDirty}
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

      <PageHeader
        title="จัดการ Staff"
        onRefresh={fetchManageData}
        lastUpdated={lastUpdated}
      />

      <section className="main__actions">
        <ActionButton
          text="สร้างบัญชีผู้ใช้ใหม่"
          icon="bx-user-plus"
          onClick={() => {
            setCreateNewUserIsOpen(true);
          }}
        />
      </section>

      <FinanceReconciliation
        reconciliation={reconciliation}
        reviewEvents={reviewEvents}
        financeDate={financeDate}
        onDateChange={setFinanceDate}
      />

      <section>
        <div className="manage__users">
          {users.map((staffUser) => (
            <div
              className={
                "manage__user" +
                (!staffUser.active ? " manage__user--inactive" : "")
              }
              key={staffUser.userId}
            >
              <img src={API_URL + staffUser.profilePictureUrl} alt="" />
              <div className="manage__userInfo">
                <div>
                  <h3>
                    {staffUser.name}{" "}
                    {staffUser.admin && (
                      <span className="settings__adminTag">Admin</span>
                    )}
                    {!staffUser.active && (
                      <span className="manage__inactiveTag">Inactive</span>
                    )}
                  </h3>
                  <p>@{staffUser.username}</p>
                </div>
                <div className="manage__userActions">
                  <ActionButton
                    text=""
                    icon="bx-cog"
                    onClick={() => setManagedUser(staffUser)}
                  />
                  <ActionButton
                    text="ประวัติ"
                    icon="bx-history"
                    onClick={() => setUser(staffUser)}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
};

export default Manage;
