import { Modal } from "@mui/material";
import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import ActionButton from "./ActionButton";
import ModalCloseButton from "./ModalCloseButton";
import UnsavedChangesModal from "./UnsavedChangesModal";
import { API_URL } from "../config/api";
import { requestUnsavedModalClose } from "../helpers/modalGuards";
import "../features/bookings/AddBooking.css";
import "../features/bookings/Cancellation.css";
import "../features/bookings/ViewBooking.css";
import "./ManageUser.css";

export type ManagedStaffUser = {
  userId: string;
  username: string;
  name: string;
  admin: boolean;
  active: boolean;
  profilePictureUrl: string;
};

type UserUpdate = {
  name: string;
  admin: boolean;
  active: boolean;
};

type ManageUserProps = {
  user: ManagedStaffUser;
  currentUserId?: string;
  onClose: () => void;
  onSave: (updates: UserUpdate) => Promise<void>;
  onResetPassword: (password: string) => Promise<void>;
  saving: boolean;
  resettingPassword: boolean;
};

const userStatusText = (user: ManagedStaffUser) => {
  if (!user.active) return "Inactive";
  return "Active";
};

const EditUserModal = ({
  user,
  isSelf,
  onClose,
  onSave,
  saving,
  onDirtyChange,
}: {
  user: ManagedStaffUser;
  isSelf: boolean;
  onClose: () => void;
  onSave: (updates: UserUpdate) => Promise<void>;
  saving: boolean;
  onDirtyChange?: (isDirty: boolean) => void;
}) => {
  const [name, setName] = useState(user.name);
  const [admin, setAdmin] = useState(user.admin);
  const [active, setActive] = useState(user.active);

  useEffect(() => {
    setName(user.name);
    setAdmin(user.admin);
    setActive(user.active);
  }, [user]);

  useEffect(() => {
    onDirtyChange?.(
      name !== user.name || admin !== user.admin || active !== user.active,
    );

    return () => onDirtyChange?.(false);
  }, [active, admin, name, onDirtyChange, user.active, user.admin, user.name]);

  const saveHandler = async () => {
    if (!name.trim()) throw new Error("กรุณากรอกชื่อพนักงาน");

    await onSave({
      name: name.trim(),
      admin,
      active,
    });
    onClose();
  };

  return (
    <form className="addBooking__wrapper manageUserModal">
      <ModalCloseButton onClick={onClose} />
      <div className="manageUserModal__header">
        <h1 className="addBooking__title">แก้ไขผู้ใช้</h1>
        {isSelf && (
          <div className="manageUser__guardNote">
            <i className="bx bx-message-bubble-exclamation" />
            <p>
              คุณไม่สามารถปิดใช้งานบัญชีตัวเองหรือถอดสิทธิ์ Admin ของตัวเองได้
            </p>
          </div>
        )}
      </div>

      <div className="manageUserModal__form">
        <div>
          <p className="addBooking__label">ชื่อ-นามสกุล</p>
          <input
            type="text"
            className="boxInput"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div>
          <p className="addBooking__label">สิทธิ์ผู้ใช้</p>
          <div className="cancellation__segmentedControl manageUser__toggle">
            <button
              type="button"
              disabled={isSelf}
              className={
                "cancellation__segment" +
                (!admin ? " cancellation__segment--active" : "")
              }
              style={{ borderRight: "1px #eee solid" }}
              onClick={() => setAdmin(false)}
            >
              <i className="bx bx-user" />
              Staff
            </button>
            <button
              type="button"
              className={
                "cancellation__segment" +
                (admin ? " cancellation__segment--active" : "")
              }
              onClick={() => setAdmin(true)}
            >
              <i className="bx bx-shield-quarter" />
              Admin
            </button>
          </div>
        </div>

        <div>
          <p className="addBooking__label">สถานะบัญชี</p>
          <div className="cancellation__segmentedControl manageUser__toggle">
            <button
              type="button"
              disabled={isSelf}
              className={
                "cancellation__segment" +
                (active ? " cancellation__segment--active" : "")
              }
              style={{ borderRight: "1px #eee solid" }}
              onClick={() => setActive(true)}
            >
              <i className="bx bx-check-circle" />
              Active
            </button>
            <button
              type="button"
              disabled={isSelf}
              className={
                "cancellation__segment" +
                (!active ? " cancellation__segment--active" : "")
              }
              onClick={() => setActive(false)}
            >
              <i className="bx bx-block" />
              Inactive
            </button>
          </div>
        </div>
      </div>

      <div className="manageUserModal__actions">
        <ActionButton
          text="บันทึก"
          icon="bx-save"
          highlight
          disabled={saving}
          onClick={() =>
            toast.promise(saveHandler(), {
              loading: "กำลังบันทึกข้อมูลผู้ใช้",
              success: "บันทึกข้อมูลผู้ใช้เรียบร้อยแล้ว",
              error: (err) =>
                err.response?.data?.message ||
                err.message ||
                "ไม่สามารถบันทึกข้อมูลผู้ใช้ได้",
            })
          }
        />
      </div>
    </form>
  );
};

const ResetPasswordModal = ({
  user,
  onClose,
  onResetPassword,
  resettingPassword,
  onDirtyChange,
}: {
  user: ManagedStaffUser;
  onClose: () => void;
  onResetPassword: (password: string) => Promise<void>;
  resettingPassword: boolean;
  onDirtyChange?: (isDirty: boolean) => void;
}) => {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  useEffect(() => {
    setPassword("");
    setConfirmPassword("");
  }, [user]);

  useEffect(() => {
    onDirtyChange?.(Boolean(password || confirmPassword));

    return () => onDirtyChange?.(false);
  }, [confirmPassword, onDirtyChange, password]);

  const resetPasswordHandler = async () => {
    if (!password) throw new Error("กรุณากรอกรหัสผ่านใหม่");
    if (password !== confirmPassword) throw new Error("รหัสผ่านไม่ตรงกัน");

    await onResetPassword(password);
    onClose();
  };

  return (
    <form className="addBooking__wrapper manageUserModal">
      <ModalCloseButton onClick={onClose} />
      <h1 className="addBooking__title">รีเซ็ตรหัสผ่าน</h1>

      <div className="manageUserModal__form">
        {/* <div className="manageUserModal__target">
          <p>{user.name}</p>
          <span>@{user.username}</span>
        </div> */}
        <div>
          <p className="addBooking__label">รหัสผ่านใหม่</p>
          <input
            type="password"
            autoComplete="new-password"
            className="boxInput"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <div>
          <p className="addBooking__label">ยืนยันรหัสผ่าน</p>
          <input
            type="password"
            autoComplete="new-password"
            className="boxInput"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
          />
        </div>
      </div>

      <div className="manageUserModal__actions">
        <ActionButton
          text="รีเซ็ตรหัสผ่าน"
          icon="bx-key"
          highlight
          disabled={resettingPassword}
          onClick={() =>
            toast.promise(resetPasswordHandler(), {
              loading: "กำลังรีเซ็ตรหัสผ่าน",
              success: "รีเซ็ตรหัสผ่านเรียบร้อยแล้ว",
              error: (err) =>
                err.response?.data?.message ||
                err.message ||
                "ไม่สามารถรีเซ็ตรหัสผ่านได้",
            })
          }
        />
      </div>
    </form>
  );
};

const ManageUser = ({
  user,
  currentUserId,
  onClose,
  onSave,
  onResetPassword,
  saving,
  resettingPassword,
}: ManageUserProps) => {
  const [editModalIsOpen, setEditModalIsOpen] = useState(false);
  const [passwordModalIsOpen, setPasswordModalIsOpen] = useState(false);
  const [editModalIsDirty, setEditModalIsDirty] = useState(false);
  const [passwordModalIsDirty, setPasswordModalIsDirty] = useState(false);
  const [pendingUnsavedClose, setPendingUnsavedClose] = useState<
    (() => void) | null
  >(null);
  const isSelf = currentUserId === user.userId;

  return (
    <>
      <div className="manageUser__wrapper">
        <ModalCloseButton onClick={onClose} />
        <div className="manageUser__top">
          <div>
            <div className="manageUser__nameRow">
              <h1 className="manageUser__name">
                {user.name}{" "}
                {user.admin && (
                  <span className="settings__adminTag">Admin</span>
                )}
              </h1>
              {isSelf && (
                <span className="settings__adminTag manageUser__selfTag">
                  You
                </span>
              )}
            </div>
            <div className="manageUser__usernameRow">
              <p className="manageUser__username">@{user.username}</p>
              <div className="manageUser__activeStatus">
                <span
                  className={
                    "manageUser__activeDot" +
                    (user.active ? " manageUser__activeDot--active" : "")
                  }
                />
                <p>{userStatusText(user)}</p>
              </div>
            </div>
          </div>
          <div className="manageUser__statusArea">
            <img
              className="manageUser__avatar"
              src={API_URL + user.profilePictureUrl}
              alt=""
            />
          </div>
        </div>

        <div className="manageUser__main">
          <div className="manageUser__mainLeft">
            <div className="viewBooking__item">
              <span className="viewBooking__label">Username: </span>
              <p className="viewBooking__infoText">{user.username}</p>
            </div>
            <div className="viewBooking__item">
              <span className="viewBooking__label">ชื่อ Staff: </span>
              <p className="viewBooking__infoText">{user.name}</p>
            </div>
            <div className="viewBooking__item">
              <span className="viewBooking__label">สิทธิ์: </span>
              <p className="viewBooking__infoText">
                {user.admin ? "Admin" : "Staff"}
              </p>
            </div>
            <div className="viewBooking__item">
              <span className="viewBooking__label">สถานะบัญชี: </span>
              <p className="viewBooking__infoText">
                {user.active ? "Active" : "Inactive"}
              </p>
            </div>
          </div>

          <div className="manageUser__mainRight">
            <div className="manageUser__actionPanel">
              <button type="button" onClick={() => setEditModalIsOpen(true)}>
                <div className="manageUser__actionMain">
                  <i className="bx bx-user-cog viewBooking__bedIcon" />
                  <div>
                    <p className="viewBooking__infoText">แก้ไขข้อมูลผู้ใช้</p>
                    <p>{userStatusText(user)}</p>
                  </div>
                </div>
                <i className="bx bx-chevron-right" />
              </button>
              <button
                type="button"
                onClick={() => setPasswordModalIsOpen(true)}
              >
                <div className="manageUser__actionMain">
                  <i className="bx bx-key viewBooking__bedIcon" />
                  <div>
                    <p className="viewBooking__infoText">รีเซ็ตรหัสผ่าน</p>
                    <p>กำหนดรหัสผ่านใหม่ให้บัญชีนี้</p>
                  </div>
                </div>
                <i className="bx bx-chevron-right" />
              </button>
            </div>
          </div>
        </div>
      </div>

      <Modal
        open={editModalIsOpen}
        className="home__modalCenter"
        onClose={() =>
          requestUnsavedModalClose(
            editModalIsDirty,
            () => setEditModalIsOpen(false),
            () => setPendingUnsavedClose(() => () => setEditModalIsOpen(false)),
          )
        }
      >
        <EditUserModal
          user={user}
          isSelf={isSelf}
          onClose={() => setEditModalIsOpen(false)}
          onSave={onSave}
          saving={saving}
          onDirtyChange={setEditModalIsDirty}
        />
      </Modal>

      <Modal
        open={passwordModalIsOpen}
        className="home__modalCenter"
        onClose={() =>
          requestUnsavedModalClose(
            passwordModalIsDirty,
            () => setPasswordModalIsOpen(false),
            () =>
              setPendingUnsavedClose(() => () => setPasswordModalIsOpen(false)),
          )
        }
      >
        <ResetPasswordModal
          user={user}
          onClose={() => setPasswordModalIsOpen(false)}
          onResetPassword={onResetPassword}
          resettingPassword={resettingPassword}
          onDirtyChange={setPasswordModalIsDirty}
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
    </>
  );
};

export default ManageUser;
