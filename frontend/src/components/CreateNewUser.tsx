import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import ActionButton from "./ActionButton";
import ModalCloseButton from "./ModalCloseButton";
import "./CreateNewUser.css";
import "../features/bookings/AddBooking.css";
import "../features/bookings/Cancellation.css";

type NewUserForm = {
  username: string;
  name: string;
  password: string;
  admin: boolean;
};

const CreateNewUser = ({
  form,
  onChange,
  onClose,
  onSubmit,
  submitting,
  onDirtyChange,
}: {
  form: NewUserForm;
  onChange: (field: keyof NewUserForm, value: string | boolean) => void;
  onClose: () => void;
  onSubmit: () => Promise<void>;
  submitting: boolean;
  onDirtyChange?: (isDirty: boolean) => void;
}) => {
  const [confirmPassword, setConfirmPassword] = useState("");

  useEffect(() => {
    onDirtyChange?.(
      Boolean(
        form.username ||
          form.name ||
          form.password ||
          form.admin ||
          confirmPassword,
      ),
    );

    return () => onDirtyChange?.(false);
  }, [confirmPassword, form, onDirtyChange]);

  const submitHandler = async () => {
    if (form.password !== confirmPassword) {
      throw new Error("รหัสผ่านไม่ตรงกัน");
    }

    await onSubmit();
    setConfirmPassword("");
    onClose();
  };

  return (
    <form className="addBooking__wrapper">
      <ModalCloseButton onClick={onClose} />
      <h1 className="addBooking__title">สร้างบัญชีผู้ใช้ใหม่</h1>

      <div className="addBooking__grid">
        <div>
          <p className="addBooking__label">Username</p>
          <input
            type="text"
            className="boxInput"
            placeholder="เช่น staff01"
            value={form.username}
            autoComplete="username"
            onChange={(e) => onChange("username", e.target.value)}
          />
        </div>
        <div>
          <p className="addBooking__label">ชื่อ-นามสกุล</p>
          <input
            type="text"
            className="boxInput"
            placeholder="เช่น Staff Name"
            value={form.name}
            autoComplete="name"
            onChange={(e) => onChange("name", e.target.value)}
          />
        </div>
        <div>
          <p className="addBooking__label">รหัสผ่าน</p>
          <input
            type="password"
            autoComplete="new-password"
            className="boxInput"
            placeholder="รหัสผ่านใหม่"
            value={form.password}
            onChange={(e) => onChange("password", e.target.value)}
          />
        </div>
        <div>
          <p className="addBooking__label">ยืนยันรหัสผ่าน</p>
          <input
            type="password"
            autoComplete="new-password"
            className="boxInput"
            placeholder="ยืนยันรหัสผ่านใหม่"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
          />
        </div>
        <div>
          <p className="addBooking__label">สิทธิ์ผู้ใช้</p>
          <div className="cancellation__segmentedControl createNewUser__roleToggle">
            <button
              type="button"
              className={
                "cancellation__segment" +
                (!form.admin ? " cancellation__segment--active" : "")
              }
              style={{ borderRight: "1px #eee solid" }}
              onClick={() => onChange("admin", false)}
            >
              <i className="bx bx-user" />
              Staff
            </button>
            <button
              type="button"
              className={
                "cancellation__segment" +
                (form.admin ? " cancellation__segment--active" : "")
              }
              onClick={() => onChange("admin", true)}
            >
              <i className="bx bx-shield-quarter" />
              Admin
            </button>
          </div>
        </div>
      </div>
      <ActionButton
        text="สร้างผู้ใช้"
        icon="bx-user-plus"
        highlight
        disabled={submitting}
        className="addBooking__submit"
        onClick={() =>
          toast.promise(submitHandler(), {
            loading: `กำลังสร้างผู้ใช้ ${form.username}`,
            success: `สร้างผู้ใช้ ${form.username} เรียบร้อยแล้ว`,
            error: (err) =>
              err.response?.data?.message ||
              err.message ||
              "เกิดข้อผิดพลาดในการสร้างผู้ใช้",
          })
        }
      />
    </form>
  );
};

export default CreateNewUser;
