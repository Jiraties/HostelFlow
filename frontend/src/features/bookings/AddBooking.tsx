import { useState } from "react";
import ActionButton from "../../components/ActionButton";
import "./AddBooking.css";
import Select from "react-select";
import { useAuth } from "../../context/AuthContext";
import toast from "react-hot-toast";
import axios from "axios";
import type { booking, roomId } from "../../types/bookingTypes";
import type { StylesConfig } from "react-select";

type OptionType = {
  value: string;
  label: string;
  color?: string;
};

export const customStyles: StylesConfig<OptionType | string, false> = {
  control: (provided) => ({
    ...provided,

    fontFamily: '"IBM Plex Sans Thai", sans-serif',
    padding: "0.6rem",
    borderRadius: "0.5rem",
    border: "none",
    boxShadow: "rgba(149, 157, 165, 0.25) 0px 8px 24px",
    width: "100%",
    color: "var(--text)",
    backgroundColor: "#fff",
  }),

  input: (provided) => ({
    ...provided,
    padding: 0,
    margin: 0,
    boxShadow: "none",
  }),

  singleValue: (provided) => ({
    ...provided,

    color: "var(--text)",
  }),

  menu: (provided) => ({
    ...provided,
    borderRadius: "0.5rem",
    overflow: "hidden",
    fontFamily: '"IBM Plex Sans Thai", sans-serif',
  }),

  option: (provided, state: any) => ({
    ...provided,
    fontFamily: '"IBM Plex Sans Thai", sans-serif',
    backgroundColor: state.isFocused ? "#f3f3f3" : "#fff",
    color: "var(--text)",
    cursor: "pointer",
  }),

  dropdownIndicator: (provided) => ({
    ...provided,
    color: "#fff",
  }),

  indicatorSeparator: () => ({
    display: "none",
  }),
};

const AddBooking = ({
  appendToBookings,
}: {
  appendToBookings: (booking: booking) => void;
}) => {
  const { user } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    checkIn: "",
    checkOut: "",
    platformId: "",
    roomId: "",
    price: "",
    paymentMethod: "",
    bookingId: "",
    staffUsername: user?.username || "", // Might not be used, backend already does this, but just in case we want to display it in the future without fetching the booking again
    note: "",
  });

  const platformOptions = [
    { value: "BOOK", label: "Booking.com", color: "#003580" },
    { value: "HOST", label: "Hostelworld", color: "#F15A24" },
    { value: "AGOD", label: "Agoda", color: "#19AC5B" },
    { value: "TRAV", label: "Traveloka", color: "#00ADEF" },
    { value: "WALK", label: "Walk-In", color: "#f12424" },
  ];

  const paymentMethodOptions = [
    { value: "OTA", label: "OTA" },
    { value: "Cash", label: "Cash" },
    { value: "Unpaid", label: "Unpaid" },
    { value: "Card", label: "Card" },
    { value: "Transfer", label: "Transfer" },
  ];

  const roomIdOptions: OptionType[] = [
    { value: "Balcony", label: "Balcony" },
    { value: "Window", label: "Window" },
    { value: "Pottery 1", label: "Pottery 1" },
    { value: "Pottery 2", label: "Pottery 2" },

    { value: "Siesta 1", label: "Siesta 1" },
    { value: "Siesta 2", label: "Siesta 2" },
    { value: "Siesta 3", label: "Siesta 3" },
    { value: "Siesta 4", label: "Siesta 4" },
    { value: "Siesta 5", label: "Siesta 5" },
    { value: "Siesta 6", label: "Siesta 6" },
    { value: "Siesta 7", label: "Siesta 7" },
    { value: "Siesta 8", label: "Siesta 8" },
    { value: "Siesta 9", label: "Siesta 9" },
    { value: "Siesta 10", label: "Siesta 10" },
    { value: "Siesta 11", label: "Siesta 11" },
    { value: "Siesta 12", label: "Siesta 12" },
    { value: "Siesta 13", label: "Siesta 13" },
    { value: "Siesta 14", label: "Siesta 14" },

    { value: "Marquisette 1", label: "Marquisette 1" },
    { value: "Marquisette 2", label: "Marquisette 2" },
    { value: "Marquisette 3", label: "Marquisette 3" },
    { value: "Marquisette 4", label: "Marquisette 4" },
    { value: "Marquisette 5", label: "Marquisette 5" },
    { value: "Marquisette 6", label: "Marquisette 6" },
    { value: "Marquisette 7", label: "Marquisette 7" },
    { value: "Marquisette 8", label: "Marquisette 8" },

    { value: "Homespan 1", label: "Homespan 1" },
    { value: "Homespan 2", label: "Homespan 2" },
    { value: "Homespan 3", label: "Homespan 3" },
    { value: "Homespan 4", label: "Homespan 4" },
    { value: "Homespan 5", label: "Homespan 5" },
    { value: "Homespan 6", label: "Homespan 6" },
    { value: "Homespan 7", label: "Homespan 7" },
    { value: "Homespan 8", label: "Homespan 8" },

    { value: "Veranda 1", label: "Veranda 1" },
    { value: "Veranda 2", label: "Veranda 2" },
    { value: "Veranda 3", label: "Veranda 3" },
    { value: "Veranda 4", label: "Veranda 4" },
    { value: "Veranda 5", label: "Veranda 5" },
    { value: "Veranda 6", label: "Veranda 6" },

    { value: "Wicker 1", label: "Wicker 1" },
    { value: "Wicker 2", label: "Wicker 2" },
    { value: "Wicker 3", label: "Wicker 3" },
    { value: "Wicker 4", label: "Wicker 4" },
    { value: "Wicker 5", label: "Wicker 5" },
    { value: "Wicker 6", label: "Wicker 6" },
  ];

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

    const platforms = platformOptions.map((p) => p.value);
    const payments = paymentMethodOptions.map((p) => p.value);

    const random = <T,>(arr: T[]): T =>
      arr[Math.floor(Math.random() * arr.length)];

    const today = new Date();
    const formatDate = (date: Date) => date.toISOString().split("T")[0];

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
      checkIn: formatDate(checkInDate), // ✅ always today
      checkOut: formatDate(checkOutDate),
      platformId: platform,
      roomId: random(rooms),
      price: String((Math.floor(Math.random() * 20) + 10) * 100),
      paymentMethod: payment,
      bookingId: String(Math.floor(1000000000 + Math.random() * 9000000000)),
      staffUsername: user?.username || "",
      note: "",
    });
  };

  const formatOptionLabel = ({
    label,
    color,
  }: {
    label: string;
    color: string;
  }) => (
    <div style={{ display: "flex", alignItems: "center" }}>
      <span
        style={{
          width: "10px",
          height: "10px",
          borderRadius: "50%",
          backgroundColor: color,
          display: "inline-block",
          marginRight: "8px",
        }}
      />
      {label}
    </div>
  );

  const formDataChangeHandler = (field: string, value: string) => {
    if (submitting) return;

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

    if (
      !formData.name ||
      !formData.checkIn ||
      !formData.checkOut ||
      !formData.platformId ||
      !formData.roomId ||
      !formData.price ||
      !formData.paymentMethod ||
      !formData.bookingId
    ) {
      toast.error("กรุณากรอกข้อมูลให้ครบทุกช่อง");
      setSubmitting(false);
      return;
    }

    if (new Date(formData.checkIn) >= new Date(formData.checkOut)) {
      toast.error("วันที่เช็คอินต้องไม่อยู่หลังวันที่เช็คเอาท์");
      setSubmitting(false);
      return;
    }

    try {
      const response = await axios.post(
        "http://localhost:3000/bookings/newBooking",
        { booking: formData },
        { withCredentials: true },
      );

      toast.success(`การจองของ ${formData.name} ถูกเพิ่มเรียบร้อยแล้ว`, {
        duration: 10000,
      });

      appendToBookings(response.data.booking);
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
    } catch (err: any) {
      if (err.response?.status === 409) {
        toast.error(err.response.data.message, {
          duration: 5000,
        });
      } else {
        toast.error(
          err.response?.data?.message || "เกิดข้อผิดพลาดในการเพิ่มการจอง",
        );
      }
    }

    setSubmitting(false);
  };

  return (
    <form className="addBooking__wrapper">
      <h1 className="addBooking__title">เพิ่มการจองใหม่</h1>
      {/* <p className="addBooking__description">
        Note: ถ้าผู้ใช้เลือกช่องทางการจอง Booking หรือ Hostel,
        ระบบจะกำหนดช่องทางการชำระเงินโดยอัตโนมัติ
      </p> */}
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
            <p className="addBooking__label">Check In</p>
            <p className="addBooking__label">Check Out</p>
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
        <div>
          <p className="addBooking__label">ห้อง</p>
          {/* <input
            className="boxInput"
            type="text"
            value={formData.roomId}
            placeholder="เช่น Pottery 1"
            onChange={(e) => formDataChangeHandler("roomId", e.target.value)}
          /> */}
          <Select
            classNamePrefix="rs"
            styles={customStyles}
            placeholder="เช่น Veranda 1"
            options={roomIdOptions}
            value={roomIdOptions.find(
              (option) => option.value === formData.roomId,
            )}
            onChange={(option: any) =>
              formDataChangeHandler("roomId", option?.value || "")
            }
          />
        </div>
        <div>
          <p className="addBooking__label">ช่องทางการจอง</p>
          <Select
            classNamePrefix="rs"
            styles={customStyles}
            options={platformOptions}
            placeholder="เลือกช่องทางการจอง"
            value={
              platformOptions.find(
                (option) => option.value === formData.platformId,
              ) || null
            }
            formatOptionLabel={formatOptionLabel}
            onChange={(option: any) =>
              formDataChangeHandler("platformId", option?.value || "BOOK")
            }
          />
        </div>

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
          <Select
            classNamePrefix="rs"
            styles={customStyles}
            options={paymentMethodOptions}
            placeholder="เลือกช่องทางการชำระเงิน"
            formatOptionLabel={formatPaymentMethodLabel}
            value={
              paymentMethodOptions.find(
                (option) => option.value === formData.paymentMethod,
              ) || null
            }
            onChange={(option: any) =>
              formDataChangeHandler("paymentMethod", option?.value || "")
            }
          />
        </div>
        <div>
          <p className="addBooking__label">Booking ID / Confirmation Number</p>
          <input
            className="boxInput"
            type="text"
            value={formData.bookingId}
            placeholder="เช่น 4012345678"
            onChange={(e) => formDataChangeHandler("bookingId", e.target.value)}
          />
        </div>
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
      <ActionButton
        text="DEBUG | Dummy Data"
        icon="bx-test"
        onClick={fillDummyData}
        className="addBooking__submit"
      />
      <ActionButton
        text="เพิ่มการจอง"
        icon="bx-plus"
        highlight
        onClick={submitHandler}
        className="addBooking__submit"
      />
    </form>
  );
};

export default AddBooking;
