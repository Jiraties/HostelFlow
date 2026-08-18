import { Modal } from "@mui/material";
import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import ActionButton from "./ActionButton";
import ModalCloseButton from "./ModalCloseButton";
import UnsavedChangesModal from "./UnsavedChangesModal";
import { profilePictureUrl } from "../helpers/profilePictureUrl";
import { requestUnsavedModalClose } from "../helpers/modalGuards";
import RecentActivities from "../features/activities/RecentActivities";
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
  onClose,
  onResetPassword,
  resettingPassword,
  onDirtyChange,
}: {
  onClose: () => void;
  onResetPassword: (password: string) => Promise<void>;
  resettingPassword: boolean;
  onDirtyChange?: (isDirty: boolean) => void;
}) => {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  useEffect(() => {
    onDirtyChange?.(Boolean(password || confirmPassword));

    return () => onDirtyChange?.(false);
  }, [confirmPassword, onDirtyChange, password]);

  const resetPasswordHandler = async () => {
    if (!password) throw new Error("กรุณากรอกรหัสผ่านใหม่");
    if (password.length < 12)
      throw new Error("รหัสผ่านต้องมีอย่างน้อย 12 ตัวอักษร");
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
            minLength={12}
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
            minLength={12}
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
        <header className="manageUser__hero">
          <img
            className="manageUser__avatar"
            src={profilePictureUrl(user.profilePictureUrl)}
            alt=""
          />
          <div className="manageUser__identity">
            <div className="manageUser__nameRow">
              <h1 className="manageUser__name">{user.name}</h1>
              {user.admin && (
                <span className="manageUser__chip manageUser__chip--admin">
                  Admin
                </span>
              )}
              {isSelf && <span className="manageUser__selfTag">คุณ</span>}
            </div>
            <div className="manageUser__usernameRow">
              <p className="manageUser__username">@{user.username}</p>
              {!user.active && (
                <span className="manageUser__chip manageUser__chip--inactive">
                  Inactive
                </span>
              )}
            </div>
          </div>
        </header>

        <div className="manageUser__workspace">
          <aside className="manageUser__accountColumn">
            <section className="manageUser__accountSection">
              <div className="manageUser__sectionTitle">
                <i className="bx bx-user-square" aria-hidden="true" />
                <h2>ข้อมูลบัญชี</h2>
              </div>
              <dl className="manageUser__facts">
                <div>
                  <dt>Username</dt>
                  <dd className="manageUser__factUsername">@{user.username}</dd>
                </div>
                <div>
                  <dt>สิทธิ์ผู้ใช้</dt>
                  <dd>
                    {user.admin ? (
                      <span className="manageUser__chip manageUser__chip--admin">
                        Admin
                      </span>
                    ) : (
                      "Staff"
                    )}
                  </dd>
                </div>
                <div>
                  <dt>สถานะบัญชี</dt>
                  <dd>
                    <span
                      className={`manageUser__chip ${
                        user.active
                          ? "manageUser__chip--active"
                          : "manageUser__chip--inactive"
                      }`}
                    >
                      {user.active ? "Active" : "Inactive"}
                    </span>
                  </dd>
                </div>
              </dl>
            </section>

            <section className="manageUser__accountSection manageUser__controlsSection">
              <div className="manageUser__actionPanel">
                <button type="button" onClick={() => setEditModalIsOpen(true)}>
                  <div className="manageUser__actionMain">
                    <i className="bx bx-cog" aria-hidden="true" />
                    <strong>แก้ไขข้อมูลผู้ใช้</strong>
                  </div>
                  <i className="bx bx-chevron-right" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => setPasswordModalIsOpen(true)}
                >
                  <div className="manageUser__actionMain">
                    <i className="bx bx-key" aria-hidden="true" />
                    <strong>รีเซ็ตรหัสผ่าน</strong>
                  </div>
                  <i className="bx bx-chevron-right" aria-hidden="true" />
                </button>
              </div>
            </section>
          </aside>

          <section className="manageUser__history">
            <RecentActivities userId={user.userId} />
          </section>
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
        <>
          {editModalIsOpen ? (
            <EditUserModal
              user={user}
              isSelf={isSelf}
              onClose={() => setEditModalIsOpen(false)}
              onSave={onSave}
              saving={saving}
              onDirtyChange={setEditModalIsDirty}
            />
          ) : null}
        </>
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
        <>
          {passwordModalIsOpen ? (
            <ResetPasswordModal
              onClose={() => setPasswordModalIsOpen(false)}
              onResetPassword={onResetPassword}
              resettingPassword={resettingPassword}
              onDirtyChange={setPasswordModalIsDirty}
            />
          ) : null}
        </>
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
