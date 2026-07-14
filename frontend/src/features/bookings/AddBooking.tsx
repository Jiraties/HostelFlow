import { useEffect, useMemo, useState } from "react";
import ActionButton from "../../components/ActionButton";
import ModalCloseButton from "../../components/ModalCloseButton";
import CashShiftNudge from "../../components/CashShiftNudge";
import { BookingDateRangePicker } from "./BookingDateRangePicker";
import "./AddBooking.css";
import Select, { type MultiValue, type SingleValue } from "react-select";
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
import { getRoomStayRoomIds } from "../../helpers/roomStayHelpers";

interface BookingFormData {
  name: string;
  checkIn: string;
  checkOut: string;
  platformId: PlatformId | "";
  roomIds: string[];
  price: string; // always string (form input)
  paymentMethod: string;
  bookingId: string;
  staffUsername: string;
  note: string;
}

type BookingFormErrors = Partial<Record<keyof BookingFormData, string>>;
type RoomOptionWithReason = OptionType & { disabledReason?: string };
type AvailabilityStatus = "idle" | "loading" | "ready" | "error";

const nightsBetween = (checkIn: string, checkOut: string) => {
  if (!checkIn || !checkOut) return "";

  const from = new Date(`${checkIn}T00:00:00`);
  const to = new Date(`${checkOut}T00:00:00`);
  const nights = Math.round((to.getTime() - from.getTime()) / 86400000);

  return nights > 0 ? String(nights) : "";
};

const checkOutAfterNights = (checkIn: string, nights: number) => {
  const date = new Date(`${checkIn}T00:00:00`);
  if (Number.isNaN(date.getTime()) || !Number.isInteger(nights) || nights < 1) {
    return "";
  }

  date.setDate(date.getDate() + nights);
  return formatLocalDate(date);
};

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
  const [occupiedRoomIds, setOccupiedRoomIds] = useState<string[]>([]);
  const [availabilityStatus, setAvailabilityStatus] =
    useState<AvailabilityStatus>("idle");
  const [formErrors, setFormErrors] = useState<BookingFormErrors>({});
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
        roomIds: getRoomStayRoomIds(editModeBooking.roomStays[0] || {}),
        price: roomCharge?.amount?.toString() || "",
        paymentMethod: roomCharge?.paymentMethod || "",
        bookingId: editModeBooking.bookingId,
        staffUsername: user?.username || "",
        note: editModeBooking.note || "",
      };
    }

    const defaultPlatform = user?.settings.defaultPlatformId || "";

    return {
      name: "",
      checkIn: clickInfo?.checkIn || "",
      checkOut: "",
      platformId: defaultPlatform,
      roomIds: clickInfo?.roomId ? [clickInfo.roomId] : [],
      price: "",
      paymentMethod:
        defaultPlatform === "TRAV"
          ? "OTA"
          : user?.settings.defaultPaymentMethod || "",
      bookingId: "",
      staffUsername: user?.username || "",
      note: "",
    };
  }, [
    clickInfo?.checkIn,
    clickInfo?.roomId,
    editModeBooking,
    user?.settings.defaultPaymentMethod,
    user?.settings.defaultPlatformId,
    user?.username,
  ]);
  const [formData, setFormData] = useState<BookingFormData>(initialFormData);
  const [nights, setNights] = useState(() =>
    nightsBetween(initialFormData.checkIn, initialFormData.checkOut),
  );
  const hasCashMovement =
    !isEditMode &&
    formData.paymentMethod === "Cash" &&
    Number.isFinite(Number(formData.price)) &&
    Number(formData.price) > 0;

  useEffect(() => {
    onDirtyChange?.(
      JSON.stringify(formData) !== JSON.stringify(initialFormData),
    );

    return () => onDirtyChange?.(false);
  }, [formData, initialFormData, onDirtyChange]);

  const roomAvailabilityReady =
    !isEditMode &&
    Boolean(formData.checkIn && formData.checkOut) &&
    new Date(formData.checkIn) < new Date(formData.checkOut);

  const roomOptions = useMemo<RoomOptionWithReason[]>(
    () =>
      roomIdOptions.map((option) => ({
        ...option,
        isDisabled: occupiedRoomIds.includes(option.value),
        disabledReason: occupiedRoomIds.includes(option.value)
          ? "ไม่ว่างในช่วงวันที่เลือก"
          : undefined,
      })),
    [occupiedRoomIds],
  );

  useEffect(() => {
    if (isEditMode || !formData.checkIn || !formData.checkOut) {
      setOccupiedRoomIds([]);
      setAvailabilityStatus("idle");
      return;
    }

    if (new Date(formData.checkIn) >= new Date(formData.checkOut)) {
      setOccupiedRoomIds([]);
      setAvailabilityStatus("idle");
      return;
    }

    const controller = new AbortController();
    setAvailabilityStatus("loading");

    axios
      .get(`${API_URL}/bookings/getRoomAvailability`, {
        params: {
          checkIn: formData.checkIn,
          checkOut: formData.checkOut,
        },
        signal: controller.signal,
        withCredentials: true,
      })
      .then((response) => {
        const nextOccupiedRoomIds = Array.isArray(
          response.data?.occupiedRoomIds,
        )
          ? response.data.occupiedRoomIds
          : [];

        setOccupiedRoomIds(nextOccupiedRoomIds);
        setAvailabilityStatus("ready");
        setFormErrors((prev) => ({ ...prev, roomIds: undefined }));
        setFormData((prev) => ({
          ...prev,
          roomIds: prev.roomIds.filter(
            (roomId) => !nextOccupiedRoomIds.includes(roomId),
          ),
        }));
      })
      .catch((err) => {
        if (axios.isCancel(err) || err.name === "CanceledError") return;
        setOccupiedRoomIds([]);
        setAvailabilityStatus("error");
        setFormErrors((prev) => ({
          ...prev,
          roomIds:
            "ตรวจสอบห้องว่างไม่สำเร็จ กรุณาลองเลือกวันที่อีกครั้งก่อนบันทึก",
        }));
      });

    return () => controller.abort();
  }, [formData.checkIn, formData.checkOut, isEditMode]);

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
      roomIds: [random(rooms)],
      price: String((Math.floor(Math.random() * 20) + 10) * 100),
      paymentMethod: payment,
      bookingId: String(Math.floor(1000000000 + Math.random() * 9000000000)),
      staffUsername: user?.username || "",
      note: "",
    });
    setNights(String(nights));
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

  const formDataChangeHandler = (
    field: keyof BookingFormData,
    value: BookingFormData[keyof BookingFormData],
  ) => {
    if (submitting) return;

    setFormData((prev) => {
      const updated = { ...prev, [field]: value };

      if (field === "platformId") {
        const platformId = value as PlatformId | "";
        if (platformId === "BOOK" || platformId === "TRAV") {
          updated.paymentMethod = "OTA";
        }
        if (platformId === "HOST") updated.paymentMethod = "Unpaid";
      }

      return updated;
    });
    setFormErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  const dateRangeChangeHandler = (checkIn: string, checkOut: string) => {
    if (submitting) return;

    setFormData((prev) => ({ ...prev, checkIn, checkOut }));
    setNights(nightsBetween(checkIn, checkOut));
    setFormErrors((prev) => ({
      ...prev,
      checkIn: undefined,
      checkOut: undefined,
    }));
  };

  const checkInInputChangeHandler = (checkIn: string) => {
    const nextNights = Number(nights);
    const checkOut =
      checkIn && Number.isInteger(nextNights) && nextNights > 0
        ? checkOutAfterNights(checkIn, nextNights)
        : formData.checkOut;

    dateRangeChangeHandler(checkIn, checkOut);
  };

  const checkOutInputChangeHandler = (checkOut: string) => {
    dateRangeChangeHandler(formData.checkIn, checkOut);
  };

  const nightsChangeHandler = (value: string) => {
    if (submitting) return;

    setNights(value);
    const nextNights = Number(value);
    if (!formData.checkIn || !Number.isInteger(nextNights) || nextNights < 1) {
      return;
    }

    formDataChangeHandler(
      "checkOut",
      checkOutAfterNights(formData.checkIn, nextNights),
    );
  };

  const validateForm = () => {
    const nextErrors: BookingFormErrors = {};

    if (!formData.name.trim()) {
      nextErrors.name = "กรุณากรอกชื่อผู้เข้าพัก";
    }
    if (!formData.checkIn) {
      nextErrors.checkIn = "กรุณาเลือกวันเช็คอิน";
    }
    if (!formData.checkOut) {
      nextErrors.checkOut = "กรุณาเลือกวันเช็คเอาท์";
    }
    if (
      formData.checkIn &&
      formData.checkOut &&
      new Date(formData.checkIn) >= new Date(formData.checkOut)
    ) {
      nextErrors.checkOut = "วันเช็คเอาท์ต้องอยู่หลังวันเช็คอิน";
    }
    if (!formData.platformId) {
      nextErrors.platformId = "กรุณาเลือกช่องทางการจอง";
    }

    if (!isEditMode) {
      if (roomAvailabilityReady && availabilityStatus !== "ready") {
        nextErrors.roomIds =
          availabilityStatus === "loading"
            ? "กำลังตรวจสอบห้องว่าง กรุณารอสักครู่"
            : "ตรวจสอบห้องว่างไม่สำเร็จ กรุณาลองเลือกวันที่อีกครั้งก่อนบันทึก";
      } else if (formData.roomIds.length === 0) {
        nextErrors.roomIds = roomAvailabilityReady
          ? "กรุณาเลือกห้อง/เตียง"
          : "เลือกวันเช็คอิน/เช็คเอาท์ก่อน แล้วเลือกห้อง/เตียง";
      }
      if (!formData.price) {
        nextErrors.price = "กรุณากรอกราคาห้องพัก";
      } else {
        const price = Number(formData.price);
        if (!Number.isFinite(price) || price <= 0) {
          nextErrors.price = "ราคาห้องพักต้องมากกว่า 0";
        }
      }
      if (!formData.paymentMethod) {
        nextErrors.paymentMethod = "กรุณาเลือกช่องทางการชำระเงิน";
      }
      if (!formData.bookingId.trim()) {
        nextErrors.bookingId = "กรุณากรอก Booking ID / Confirmation Number";
      }
    }

    return nextErrors;
  };

  const formatPaymentMethodLabel = ({ label, value }: OptionType) => (
    <div style={value === "Unpaid" ? { color: "red" } : {}}>{label}</div>
  );

  const formatRoomOptionLabel = (option: RoomOptionWithReason) => (
    <div className="addBooking__roomOption">
      <span>{option.label}</span>
      {option.disabledReason && <small>{option.disabledReason}</small>}
    </div>
  );

  const submitHandler = async () => {
    if (submitting) return;
    setSubmitting(true);

    try {
      const nextErrors = validateForm();
      setFormErrors(nextErrors);

      if (Object.keys(nextErrors).length > 0) {
        throw new Error("กรุณาตรวจสอบข้อมูลที่ไฮไลต์ไว้");
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

      const response = await axios
        .post(
          `${API_URL}/bookings/newBooking`,
          { booking: formData },
          { withCredentials: true },
        )
        .catch((err) => {
          if (axios.isAxiosError(err) && err.response?.status === 409) {
            setFormErrors((prev) => ({
              ...prev,
              roomIds:
                err.response?.data?.message ||
                "ห้อง/เตียงนี้ไม่ว่างในวันที่เลือก",
            }));
          }
          throw err;
        });

      if (appendToBookings) appendToBookings(response.data.booking);
      setFormData({
        name: "",
        checkIn: "",
        checkOut: "",
        platformId: "",
        roomIds: [],
        price: "",
        paymentMethod: "",
        bookingId: "",
        staffUsername: user?.username || "",
        note: "",
      });
      setNights("");
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
      {(reminderIsOpen || hasCashMovement) && (
        <div className="bookingNoticeStack">
          {reminderIsOpen && (
            <div className="editBooking__reminder">
              <div className="editBooking__textAndIcon">
                <i className="bx bx-message-dots" />
                <p>
                  เมื่อยืดวันที่ Check-In
                  ระบบจะเพิ่มวันช่วงพักห้องแรกโดยอัตโนมัติ
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
          {hasCashMovement && <CashShiftNudge />}
        </div>
      )}

      <div className="addBooking__grid">
        <div>
          <p className="addBooking__label">ชื่อ-สกุล</p>
          <input
            type="text"
            className={`boxInput ${formErrors.name ? "boxInput--error" : ""}`}
            value={formData.name}
            maxLength={30}
            onChange={(e) => formDataChangeHandler("name", e.target.value)}
            placeholder="เช่น Robert Brown"
          />
          {formErrors.name && (
            <p className="addBooking__fieldError">{formErrors.name}</p>
          )}
        </div>
        <div>
          <div className="addBooking__dateInputsWithNights">
            <div className="addBooking__dateGroup">
              <div className="addBooking__labels">
                <p className="addBooking__label">Check-In</p>
                <p className="addBooking__label">Check-Out</p>
              </div>
              <BookingDateRangePicker
                checkIn={formData.checkIn}
                checkOut={formData.checkOut}
                hasError={Boolean(formErrors.checkIn || formErrors.checkOut)}
                onChange={dateRangeChangeHandler}
                onCheckInChange={checkInInputChangeHandler}
                onCheckOutChange={checkOutInputChangeHandler}
              />
            </div>
            <div className="addBooking__nightsField">
              <p className="addBooking__label">คืน</p>
              <input
                type="number"
                inputMode="numeric"
                min="1"
                step="1"
                value={nights}
                onChange={(e) => nightsChangeHandler(e.target.value)}
                className="boxInput addBooking__nightsInput"
                aria-label="Number of nights"
              />
            </div>
          </div>
          {(formErrors.checkIn || formErrors.checkOut) && (
            <p className="addBooking__fieldError">
              {formErrors.checkIn || formErrors.checkOut}
            </p>
          )}
        </div>
        {!isEditMode && (
          <div>
            <p className="addBooking__label">ห้อง</p>
            {/* <input
              className="boxInput"
              type="text"
              value={formData.roomIds.join(", ")}
              placeholder="เช่น Pottery 1"
              onChange={(e) =>
                formDataChangeHandler(
                  "roomIds",
                  e.target.value
                    .split(",")
                    .map((roomId) => roomId.trim())
                    .filter(Boolean),
                )
              }
            /> */}
            <Select<RoomOptionWithReason, true>
              isMulti
              styles={customStyles<OptionType, true>()}
              classNamePrefix="rs"
              placeholder="เช่น Veranda 1"
              options={roomOptions}
              isDisabled={
                !roomAvailabilityReady ||
                availabilityStatus !== "ready" ||
                submitting
              }
              isLoading={availabilityStatus === "loading"}
              formatOptionLabel={formatRoomOptionLabel}
              value={roomOptions.filter((option) =>
                formData.roomIds.includes(option.value),
              )}
              onChange={(options: MultiValue<OptionType>) =>
                formDataChangeHandler(
                  "roomIds",
                  options.map((option) => option.value),
                )
              }
            />
            <p
              className={
                formErrors.roomIds
                  ? "addBooking__fieldError"
                  : "addBooking__fieldHelper"
              }
            >
              {formErrors.roomIds ||
                (roomAvailabilityReady
                  ? availabilityStatus === "loading"
                    ? "กำลังตรวจสอบห้อง/เตียงที่ว่าง..."
                    : occupiedRoomIds.length > 0
                      ? "ห้อง/เตียงที่ถูกจองแล้วจะแสดงเป็นตัวเลือกสีเทา"
                      : "เลือกได้เฉพาะห้อง/เตียงที่ว่างในช่วงวันที่นี้"
                  : "เลือกวันเช็คอินและเช็คเอาท์ก่อน ระบบจะแสดงห้อง/เตียงที่ว่าง")}
            </p>
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
          {formErrors.platformId && (
            <p className="addBooking__fieldError">{formErrors.platformId}</p>
          )}
        </div>

        {!isEditMode && (
          <>
            <div>
              <p className="addBooking__label">
                ราคารวมค่าห้องตลอดการเข้าพัก (฿)
              </p>
              <input
                className={`boxInput ${formErrors.price ? "boxInput--error" : ""}`}
                type="number"
                value={formData.price}
                placeholder="เช่น 1000"
                onChange={(e) => formDataChangeHandler("price", e.target.value)}
              />
              {formErrors.price && (
                <p className="addBooking__fieldError">{formErrors.price}</p>
              )}
              {!formErrors.price && (
                <p className="addBooking__fieldHelper">
                  กรอกยอดรวมทุกคืน ไม่ใช่ราคาต่อคืน
                </p>
              )}
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
              {formErrors.paymentMethod && (
                <p className="addBooking__fieldError">
                  {formErrors.paymentMethod}
                </p>
              )}
            </div>
            <div>
              <p className="addBooking__label">
                Booking ID / Confirmation Number
              </p>
              <input
                className={`boxInput ${
                  formErrors.bookingId ? "boxInput--error" : ""
                }`}
                type="text"
                value={formData.bookingId}
                placeholder="เช่น 4012345678"
                onChange={(e) =>
                  formDataChangeHandler("bookingId", e.target.value)
                }
              />
              {formErrors.bookingId && (
                <p className="addBooking__fieldError">{formErrors.bookingId}</p>
              )}
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
      {!isEditMode && import.meta.env.DEV && (
        <ActionButton
          text="DEBUG | Dummy Data"
          icon="bx-test-tube"
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
                err.message ||
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
