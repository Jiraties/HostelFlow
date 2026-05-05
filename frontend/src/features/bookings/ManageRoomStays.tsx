import Select, { type SingleValue } from "react-select";
import "./ManageRoomStays.css";
import type { OptionType } from "../../helpers/selectStyling";
import { customStyles } from "../../helpers/selectStyling";
import { roomIdOptions } from "../../helpers/options";
import { useState } from "react";
import ActionButton from "../../components/ActionButton";
import toast from "react-hot-toast";
import axios from "axios";
import { API_URL } from "../../config/api";
import {
  formatBookingDates,
  formatLocalDate,
} from "../../helpers/bookingHelpers";
import type { booking } from "../../types/bookingTypes";

interface roomStay {
  roomId: string;
  from: string;
  to: string;
}

const ManageRoomStays = ({
  initialRoomStays,
  bookingId,
  onUpdated,
}: {
  initialRoomStays: roomStay[];
  bookingId: string;
  onUpdated?: (booking: booking) => void;
}) => {
  const normalizeDate = (date: string) => {
    if (!date) return "";
    if (!date.includes("T")) return date;
    return formatLocalDate(new Date(date));
  };

  const [roomStays, setRoomStays] = useState<roomStay[]>(
    initialRoomStays.map((stay) => ({
      ...stay,
      from: stay.from ? normalizeDate(stay.from) : "",
      to: stay.to ? normalizeDate(stay.to) : "",
    })),
  );

  const addEmptyRoomStay = () => {
    if (roomStays.length + 1 > 5)
      return toast.error("สามารถเพิ่มห้องได้มากสุด 5 ห้องในการจองเดียว");
    setRoomStays((prevRoomStays) => {
      return [...prevRoomStays, { roomId: "", from: "", to: "" }];
    });
  };

  const removeRoomStay = () => {
    if (roomStays.length - 1 < 1) return toast.error("");
    setRoomStays((prevRoomStays) => {
      const updated = [...prevRoomStays];
      updated.pop();
      return updated;
    });
  };

  const patchRoomStays = async () => {
    const hasEmpty = roomStays.some(
      (stay) => !stay.roomId || !stay.from || !stay.to,
    );

    if (hasEmpty) throw new Error("กรุณากรอกข้อมูลให้ครบทุกช่อง");
    const hasInvalidDateRange = roomStays.some(
      (stay) => new Date(stay.from) >= new Date(stay.to),
    );

    if (hasInvalidDateRange) {
      throw new Error("วันที่เข้าพักต้องมาก่อนวันที่ออก");
    }

    const response = await axios.patch(
      `${API_URL}/bookings/manageRoomStays/${bookingId}`,
      { roomStays },
      { withCredentials: true },
    );

    if (response.status !== 200) throw new Error(response.data.message);
    if (response.data.booking)
      onUpdated?.(formatBookingDates(response.data.booking));
  };

  return (
    <div className="addBooking__wrapper">
      <div>
        <h1 className="addBooking__title">จัดการช่วงการเข้าพัก</h1>
      </div>

      <div className="manageRoomStays__list">
        {roomStays.map((roomStay, index) => (
          <div className="manageRoomStays__listItem" key={index}>
            <div>
              <p className="addBooking__label">ห้องพักช่วงพักที่ {index + 1}</p>
              <Select<OptionType>
                styles={customStyles<OptionType>()}
                classNamePrefix="rs"
                options={roomIdOptions}
                placeholder="เช่น Veranda 1"
                value={
                  roomIdOptions.find(
                    (option) => option.value === roomStay.roomId,
                  ) || null
                }
                //   formatOptionLabel={formatOptionLabel}
                onChange={(option: SingleValue<OptionType>) => {
                  if (!option) return;

                  setRoomStays((prevRoomStays) => {
                    const updated = [...prevRoomStays];
                    updated[index] = {
                      ...updated[index],
                      roomId: option.value,
                    };
                    return updated;
                  });
                }}
              />
            </div>

            <div>
              <div className="addBooking__labels">
                <p className="addBooking__label">จากวันที่</p>
                <p className="addBooking__label">ถึงวันที่</p>
              </div>
              <div className="addBooking__dateInputs">
                <input
                  type="date"
                  value={roomStay.from || ""}
                  onChange={(e) => {
                    setRoomStays((prevRoomStays) => {
                      const updated = [...prevRoomStays];
                      updated[index] = {
                        ...updated[index],
                        from: e.target.value,
                      };
                      return updated;
                    });
                  }}
                  style={{
                    borderRight: "0.1rem solid #e8e8e8",
                    borderRadius: "0.5rem 0 0 0.5rem",
                  }}
                  className="boxInput addBooking__dateInput"
                />
                <input
                  type="date"
                  value={roomStay.to || ""}
                  onChange={(e) => {
                    setRoomStays((prevRoomStays) => {
                      const updated = [...prevRoomStays];
                      updated[index] = {
                        ...updated[index],
                        to: e.target.value,
                      };
                      return updated;
                    });
                  }}
                  style={{ borderRadius: "0 0.5rem 0.5rem 0" }}
                  className="boxInput addBooking__dateInput"
                />
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="viewBooking__actions">
        <div className="viewBooking__actionsLeft">
          <ActionButton
            text="เพิ่มช่วงพัก"
            icon="bx-plus"
            onClick={() => addEmptyRoomStay()}
          />

          {roomStays.length > 1 && (
            <ActionButton
              text="ลดช่วงพัก"
              icon="bx-minus"
              onClick={() => removeRoomStay()}
            />
          )}
        </div>

        <ActionButton
          text="แก้ไข"
          icon="bx-edit"
          highlight
          onClick={() => {
            toast.promise(patchRoomStays(), {
              loading: "กำลังอัปเดตข้อมูล...",
              success: "อัปเดตข้อมูลสำเร็จ",
              error: (err) => {
                return (
                  err.response?.data?.message ||
                  err.message ||
                  "เกิดข้อผิดพลาดในการแก้ไขช่วงพัก"
                );
              },
            });
          }}
        />
      </div>
    </div>
  );
};

export default ManageRoomStays;
