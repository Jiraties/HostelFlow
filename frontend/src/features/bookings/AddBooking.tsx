import { useEffect, useMemo, useState } from "react";
import ActionButton from "../../components/ActionButton";
import ModalCloseButton from "../../components/ModalCloseButton";
import "./AddBooking.css";
import Select, { type SingleValue } from "react-select";
import { useAuth } from "../../context/AuthContext";
import toast from "react-hot-toast";
import axios from "axios";
import { API_URL } from "../../config/api";
import { customStyles } from "../../helpers/selectStyling";
import type { booking, PlatformId } from "../../types/bookingTypes";
import type { OptionType } from "../../helpers/selectStyling";
import {
  formatBookingDates,
  formatLocalDate,
} from "../../helpers/bookingHelpers";
import {
  platformOptions,
  roomIdOptions,
  paymentMethodOptions,
} from "../../helpers/options";

interface BookingFormData {
  name: string;
  checkIn: string;
  checkOut: string;
  platformId: PlatformId | "";
  roomId: string;
  price: string; // always string (form input)
  paymentMethod: string;
  bookingId: string;
  staffUsername: string;
  note: string;
}

const AddBooking = ({
  mode = "add",
  editModeBooking,
  appendToBookings,
  onUpdated,
  onClose,
  clickInfo,
  onDirtyChange,
}: {
  mode?: "add" | "edit";
  editModeBooking?: booking;
  appendToBookings?: (booking: booking) => void;
  onUpdated?: (booking: booking) => void;
  onClose?: () => void;
  onDirtyChange?: (isDirty: boolean) => void;
  clickInfo?: {
    checkIn: string | null;
    roomId: string | null;
  };
}) => {
  const { user } = useAuth();
  const isEditMode = mode === "edit" && !!editModeBooking;
  const [submitting, setSubmitting] = useState(false);
  const [reminderIsOpen, setReminderIsOpen] = useState(
    mode === "edit" && editModeBooking && editModeBooking?.roomStays.length > 1,
  );
  const initialFormData = useMemo<BookingFormData>(() => {
    if (editModeBooking) {
      const roomCharge = editModeBooking.transactions.find(
        (t) => t.type === "roomCharge",
      );

      return {
        name: editModeBooking.name,
        checkIn: formatLocalDate(new Date(editModeBooking.checkIn)),
        checkOut: formatLocalDate(new Date(editModeBooking.checkOut)),
        platformId: editModeBooking.platformId,
        roomId: editModeBooking.roomStays[0]?.roomId || "",
        price: roomCharge?.amount?.toString() || "",
        paymentMethod: roomCharge?.paymentMethod || "",
        bookingId: editModeBooking.bookingId,
        staffUsername: user?.username || "",
        note: editModeBooking.note || "",
      };
    }

    return {
      name: "",
      checkIn: clickInfo?.checkIn || "",
      checkOut: "",
      platformId: "",
      roomId: clickInfo?.roomId || "",
      price: "",
      paymentMethod: "",
      bookingId: "",
      staffUsername: user?.username || "",
      note: "",
    };
  }, [clickInfo?.checkIn, clickInfo?.roomId, editModeBooking, user?.username]);
  const [formData, setFormData] = useState<BookingFormData>(initialFormData);

  useEffect(() => {
    onDirtyChange?.(JSON.stringify(formData) !== JSON.stringify(initialFormData));

    return () => onDirtyChange?.(false);
  }, [formData, initialFormData, onDirtyChange]);

  const fillDummyData = () => {
    if (submitting) return;

    const names = [
      "John Smith",
      "Emma Johnson",
      "Michael Brown",
      "Olivia Davis",
      "William Garcia",
      "Sophia Martinez",
    ];

    const rooms = [
      "Balcony",
      "Window",
      "Pottery 1",
      "Pottery 2",
      "Siesta 1",
      "Siesta 2",
      "Siesta 3",
      "Siesta 4",
      "Siesta 5",
      "Siesta 6",
      "Siesta 7",
      "Siesta 8",
      "Siesta 9",
      "Siesta 10",
      "Siesta 11",
      "Siesta 12",
      "Siesta 13",
      "Siesta 14",
      "Marquisette 1",
      "Marquisette 2",
      "Marquisette 3",
      "Marquisette 4",
      "Marquisette 5",
      "Marquisette 6",
      "Marquisette 7",
      "Marquisette 8",
      "Homespan 1",
      "Homespan 2",
      "Homespan 3",
      "Homespan 4",
      "Homespan 5",
      "Homespan 6",
      "Homespan 7",
      "Homespan 8",
      "Veranda 1",
      "Veranda 2",
      "Veranda 3",
      "Veranda 4",
      "Veranda 5",
      "Veranda 6",
      "Wicker 1",
      "Wicker 2",
      "Wicker 3",
      "Wicker 4",
      "Wicker 5",
      "Wicker 6",
    ];

    const platforms = platformOptions.map((p) => p.value as PlatformId);
    const payments = paymentMethodOptions.map((p) => p.value);

    const random = <T,>(arr: T[]): T =>
      arr[Math.floor(Math.random() * arr.length)];

    const today = new Date();

    const nights = Math.floor(Math.random() * 4) + 1; // 1–4 nights

    const checkInDate = new Date(today);
    const checkOutDate = new Date(today);
    checkOutDate.setDate(today.getDate() + nights);

    const platform = random(platforms);

    let payment = random(payments);
    if (platform === "BOOK") payment = "OTA";
    if (platform === "HOST") payment = "Unpaid";

    setFormData({
      name: random(names),
      checkIn: formatLocalDate(checkInDate), // ✅ always today
      checkOut: formatLocalDate(checkOutDate),
      platformId: platform,
      roomId: random(rooms),
      price: String((Math.floor(Math.random() * 20) + 10) * 100),
      paymentMethod: payment,
      bookingId: String(Math.floor(1000000000 + Math.random() * 9000000000)),
      staffUsername: user?.username || "",
      note: "",
    });
  };

  const formatOptionLabel = ({ label, color }: OptionType) => (
    <div style={{ display: "flex", alignItems: "center" }}>
      <span
        style={{
          width: "10px",
          height: "10px",
          borderRadius: "50%",
          backgroundColor: color || "transparent",
          display: "inline-block",
          marginRight: "8px",
        }}
      />
      {label}
    </div>
  );

  const formDataChangeHandler = (field: string, value: string) => {
    if (submitting) throw new Error("Already Submitting");

    setFormData((prev) => {
      const updated = { ...prev, [field]: value };

      if (field === "platformId") {
        if (value === "BOOK") updated.paymentMethod = "OTA";
        if (value === "HOST") updated.paymentMethod = "Unpaid";
      }

      return updated;
    });
  };

  const formatPaymentMethodLabel = ({ label }: { label: string }) => (
    <div style={label === "Unpaid" ? { color: "red" } : {}}>{label}</div>
  );

  const submitHandler = async () => {
    if (submitting) return;
    setSubmitting(true);

    try {
      const missingEditFields =
        !formData.name ||
        !formData.checkIn ||
        !formData.checkOut ||
        !formData.platformId;
      const missingAddFields =
        missingEditFields ||
        !formData.roomId ||
        !formData.price ||
        !formData.paymentMethod ||
        !formData.bookingId;

      if (isEditMode ? missingEditFields : missingAddFields) {
        throw new Error("กรุณากรอกข้อมูลให้ครบทุกช่อง");
      }

      if (new Date(formData.checkIn) >= new Date(formData.checkOut)) {
        throw new Error("วันที่เช็คอินต้องไม่อยู่หลังวันที่เช็คเอาท์");
      }

      if (!isEditMode) {
        const price = Number(formData.price);

        if (!Number.isFinite(price) || price <= 0) {
          throw new Error("ราคาห้องต้องมากกว่า 0");
        }
      }

      if (isEditMode && editModeBooking) {
        const response = await axios.patch(
          `${API_URL}/bookings/editBooking/${editModeBooking.bookingId}`,
          {
            booking: {
              name: formData.name,
              checkIn: formData.checkIn,
              checkOut: formData.checkOut,
              platformId: formData.platformId,
              note: formData.note,
            },
          },
          { withCredentials: true },
        );

        if (response.data.booking) {
          onUpdated?.(formatBookingDates(response.data.booking));
        }
        onClose?.();
        return;
      }

      const response = await axios.post(
        `${API_URL}/bookings/newBooking`,
        { booking: formData },
        { withCredentials: true },
      );

      if (appendToBookings) appendToBookings(response.data.booking);
      setFormData({
        name: "",
        checkIn: "",
        checkOut: "",
        platformId: "",
        roomId: "",
        price: "",
        paymentMethod: "",
        bookingId: "",
        staffUsername: user?.username || "",
        note: "",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="addBooking__wrapper">
      {onClose && <ModalCloseButton onClick={onClose} />}
      <h1 className="addBooking__title">
        {mode === "add" ? "เพิ่มการจองใหม่" : "แก้ไขการจอง"}
      </h1>
      {reminderIsOpen && (
        <div className="editBooking__reminder">
          <div className="editBooking__textAndIcon">
            <i className="bx bx-message-dots" />
            <p>
              เมื่อยืดวันที่ Check-In ระบบจะเพิ่มวันช่วงพักห้องแรกโดยอัตโนมัติ
              <br />
              เมื่อยืดวันที่ Check-Out
              ระบบจะเพิ่มวันช่วงพักห้องท้ายสุดโดยอัตโนมัติเช่นกัน
            </p>
          </div>
          <i
            className="bx bx-x editBooking__closeReminder"
            onClick={() => setReminderIsOpen(false)}
          />
        </div>
      )}

      <div className="addBooking__grid">
        <div>
          <p className="addBooking__label">ชื่อ-สกุล</p>
          <input
            type="text"
            className="boxInput"
            value={formData.name}
            maxLength={30}
            onChange={(e) => formDataChangeHandler("name", e.target.value)}
            placeholder="เช่น Robert Brown"
          />
        </div>
        <div>
          <div className="addBooking__labels">
            <p className="addBooking__label">Check-In</p>
            <p className="addBooking__label">Check-Out</p>
          </div>
          <div className="addBooking__dateInputs">
            <input
              type="date"
              value={formData.checkIn}
              onChange={(e) => formDataChangeHandler("checkIn", e.target.value)}
              style={{
                borderRight: "0.1rem solid #e8e8e8",
                borderRadius: "0.5rem 0 0 0.5rem",
              }}
              className="boxInput addBooking__dateInput"
            />
            <input
              type="date"
              value={formData.checkOut}
              onChange={(e) =>
                formDataChangeHandler("checkOut", e.target.value)
              }
              style={{ borderRadius: "0 0.5rem 0.5rem 0" }}
              className="boxInput addBooking__dateInput"
            />
          </div>
        </div>
        {!isEditMode && (
          <div>
            <p className="addBooking__label">ห้อง</p>
            {/* <input
              className="boxInput"
              type="text"
              value={formData.roomId}
              placeholder="เช่น Pottery 1"
              onChange={(e) => formDataChangeHandler("roomId", e.target.value)}
            /> */}
            <Select<OptionType>
              styles={customStyles<OptionType>()}
              classNamePrefix="rs"
              placeholder="เช่น Veranda 1"
              options={roomIdOptions}
              value={roomIdOptions.find(
                (option) => option.value === formData.roomId,
              )}
              onChange={(option: SingleValue<OptionType>) =>
                formDataChangeHandler("roomId", option?.value || "")
              }
            />
          </div>
        )}
        <div>
          <p className="addBooking__label">ช่องทางการจอง</p>
          <Select<OptionType>
            styles={customStyles<OptionType>()}
            classNamePrefix="rs"
            options={platformOptions}
            placeholder="เลือกช่องทางการจอง"
            value={
              platformOptions.find(
                (option) => option.value === formData.platformId,
              ) || null
            }
            formatOptionLabel={formatOptionLabel}
            onChange={(option: SingleValue<OptionType>) =>
              formDataChangeHandler("platformId", option?.value || "BOOK")
            }
          />
        </div>

        {!isEditMode && (
          <>
            <div>
              <p className="addBooking__label">ราคา (฿)</p>
              <input
                className="boxInput"
                type="number"
                value={formData.price}
                placeholder="เช่น 1000"
                onChange={(e) => formDataChangeHandler("price", e.target.value)}
              />
            </div>
            <div>
              <p className="addBooking__label">จ่ายผ่าน</p>
              <Select<OptionType>
                styles={customStyles<OptionType>()}
                classNamePrefix="rs"
                options={paymentMethodOptions}
                placeholder="เลือกช่องทางการชำระเงิน"
                formatOptionLabel={formatPaymentMethodLabel}
                value={
                  paymentMethodOptions.find(
                    (option) => option.value === formData.paymentMethod,
                  ) || null
                }
                onChange={(option: SingleValue<OptionType>) =>
                  formDataChangeHandler("paymentMethod", option?.value || "")
                }
              />
            </div>
            <div>
              <p className="addBooking__label">
                Booking ID / Confirmation Number
              </p>
              <input
                className="boxInput"
                type="text"
                value={formData.bookingId}
                placeholder="เช่น 4012345678"
                onChange={(e) =>
                  formDataChangeHandler("bookingId", e.target.value)
                }
              />
            </div>
          </>
        )}
        <div>
          <p className="addBooking__label">Note</p>
          <input
            className="boxInput"
            type="text"
            value={formData.note}
            placeholder="เช่น แขกเดิมพักต่อ 1 คืน"
            onChange={(e) => formDataChangeHandler("note", e.target.value)}
          />
        </div>
      </div>
      {!isEditMode && (
        <ActionButton
          text="DEBUG | Dummy Data"
          icon="bx-test"
          onClick={fillDummyData}
          className="addBooking__submit"
        />
      )}
      <ActionButton
        text={isEditMode ? "บันทึกการแก้ไข" : "เพิ่มการจอง"}
        icon={isEditMode ? "bx-edit" : "bx-plus"}
        highlight
        disabled={submitting}
        onClick={() =>
          toast.promise(submitHandler(), {
            loading: isEditMode
              ? `กำลังแก้ไขการจองของ ${formData.name}`
              : `กำลังบันทึกการจองของ ${formData.name}`,
            success: isEditMode
              ? `การจองของ ${formData.name} ถูกแก้ไขเรียบร้อยแล้ว`
              : `การจองของ ${formData.name} ถูกเพิ่มเรียบร้อยแล้ว`,
            error: (err) => {
              if (err.response?.status === 409) {
                return err.response.data.message;
              }
              return (
                err.response?.data?.message ||
                (isEditMode
                  ? "เกิดข้อผิดพลาดในการแก้ไขการจอง"
                  : "เกิดข้อผิดพลาดในการเพิ่มการจอง")
              );
            },
          })
        }
        className="addBooking__submit"
      />
    </form>
  );
};

export default AddBooking;
