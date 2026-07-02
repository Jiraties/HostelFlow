import Select, { type MultiValue } from "react-select";
import "./ManageRoomStays.css";
import type { OptionType } from "../../helpers/selectStyling";
import { customStyles } from "../../helpers/selectStyling";
import { roomIdOptions } from "../../helpers/options";
import { useEffect, useMemo, useState } from "react";
import ActionButton from "../../components/ActionButton";
import ModalCloseButton from "../../components/ModalCloseButton";
import toast from "react-hot-toast";
import axios from "axios";
import { API_URL } from "../../config/api";
import {
  formatBookingDates,
  formatLocalDate,
} from "../../helpers/bookingHelpers";
import type { booking } from "../../types/bookingTypes";
import { getRoomStayRoomIds } from "../../helpers/roomStayHelpers";

interface roomStay {
  roomIds: string[];
  roomId?: string;
  from: string;
  to: string;
}

const ManageRoomStays = ({
  initialRoomStays,
  bookingId,
  checkIn,
  checkOut,
  onClose,
  onUpdated,
  onDirtyChange,
}: {
  initialRoomStays: roomStay[];
  bookingId: string;
  checkIn: string | Date;
  checkOut: string | Date;
  onClose?: () => void;
  onUpdated?: (booking: booking) => void;
  onDirtyChange?: (isDirty: boolean) => void;
}) => {
  const normalizeDate = (date: string) => {
    if (!date) return "";
    if (!date.includes("T")) return date;
    return formatLocalDate(new Date(date));
  };

  const bookingCheckIn = normalizeDate(String(checkIn));
  const bookingCheckOut = normalizeDate(String(checkOut));
  const applyBookingBoundaries = (stays: roomStay[]) =>
    stays.map((stay, index) => ({
      ...stay,
      from: index === 0 ? bookingCheckIn : stay.from,
      to: index === stays.length - 1 ? bookingCheckOut : stay.to,
    }));

  const initialManagedRoomStays = useMemo(
    () => {
      const normalizedCheckIn = normalizeDate(String(checkIn));
      const normalizedCheckOut = normalizeDate(String(checkOut));

      return initialRoomStays.map((stay, index) => ({
        ...stay,
        roomIds: getRoomStayRoomIds(stay),
        from:
          index === 0
            ? normalizedCheckIn
            : stay.from
              ? normalizeDate(stay.from)
              : "",
        to:
          index === initialRoomStays.length - 1
            ? normalizedCheckOut
            : stay.to
              ? normalizeDate(stay.to)
              : "",
      }));
    },
    [initialRoomStays, checkIn, checkOut],
  );

  const [roomStays, setRoomStays] = useState<roomStay[]>(
    initialManagedRoomStays,
  );
  const [occupiedRoomIdsByStay, setOccupiedRoomIdsByStay] = useState<
    Record<number, string[]>
  >({});

  const roomStayAvailabilityKey = useMemo(
    () =>
      applyBookingBoundaries(roomStays)
        .map((stay) => `${stay.from || ""}:${stay.to || ""}`)
        .join("|"),
    [roomStays, bookingCheckIn, bookingCheckOut],
  );

  useEffect(() => {
    onDirtyChange?.(
      JSON.stringify(roomStays) !== JSON.stringify(initialManagedRoomStays),
    );

    return () => onDirtyChange?.(false);
  }, [initialManagedRoomStays, onDirtyChange, roomStays]);

  useEffect(() => {
    const boundedRoomStays = applyBookingBoundaries(roomStays);
    const availabilityRequests = boundedRoomStays.map((stay, index) => ({
      index,
      from: stay.from,
      to: stay.to,
      valid:
        Boolean(stay.from && stay.to) &&
        new Date(stay.from) < new Date(stay.to),
    }));

    if (!availabilityRequests.some((request) => request.valid)) {
      setOccupiedRoomIdsByStay({});
      return;
    }

    const controller = new AbortController();

    Promise.all(
      availabilityRequests.map(async (request) => {
        if (!request.valid) return { index: request.index, occupiedRoomIds: [] };

        const response = await axios.get(
          `${API_URL}/bookings/getRoomAvailability`,
          {
            params: {
              checkIn: request.from,
              checkOut: request.to,
              excludeBookingId: bookingId,
            },
            signal: controller.signal,
            withCredentials: true,
          },
        );

        return {
          index: request.index,
          occupiedRoomIds: Array.isArray(response.data?.occupiedRoomIds)
            ? response.data.occupiedRoomIds
            : [],
        };
      }),
    )
      .then((availabilityResults) => {
        const nextOccupiedRoomIdsByStay = availabilityResults.reduce<
          Record<number, string[]>
        >((result, availability) => {
          result[availability.index] = availability.occupiedRoomIds;
          return result;
        }, {});

        setOccupiedRoomIdsByStay(nextOccupiedRoomIdsByStay);
        setRoomStays((prevRoomStays) =>
          prevRoomStays.map((stay, index) => ({
            ...stay,
            roomIds: getRoomStayRoomIds(stay).filter(
              (roomId) =>
                !nextOccupiedRoomIdsByStay[index]?.includes(roomId),
            ),
          })),
        );
      })
      .catch((err) => {
        if (axios.isCancel(err) || err.name === "CanceledError") return;
        setOccupiedRoomIdsByStay({});
      });

    return () => controller.abort();
  }, [bookingId, roomStayAvailabilityKey]);

  const roomOptionsByStay = useMemo(
    () =>
      roomStays.map((_, index) =>
        roomIdOptions.map((option) => ({
          ...option,
          isDisabled: occupiedRoomIdsByStay[index]?.includes(option.value),
        })),
      ),
    [occupiedRoomIdsByStay, roomStays],
  );

  const addEmptyRoomStay = () => {
    if (roomStays.length + 1 > 5)
      return toast.error("สามารถเพิ่มห้องได้มากสุด 5 ห้องในการจองเดียว");
    setRoomStays((prevRoomStays) => {
      return [...prevRoomStays, { roomIds: [], from: "", to: "" }];
    });
  };

  const isFirstStay = (index: number) => index === 0;
  const isLastStay = (index: number) => index === roomStays.length - 1;

  const removeRoomStay = () => {
    if (roomStays.length - 1 < 1) return toast.error("");
    setRoomStays((prevRoomStays) => {
      const updated = [...prevRoomStays];
      updated.pop();
      return applyBookingBoundaries(updated);
    });
  };

  const patchRoomStays = async () => {
    const roomStaysWithBoundaries = applyBookingBoundaries(roomStays);
    const hasEmpty = roomStaysWithBoundaries.some(
      (stay) => !getRoomStayRoomIds(stay).length || !stay.from || !stay.to,
    );

    if (hasEmpty) throw new Error("กรุณากรอกข้อมูลให้ครบทุกช่อง");
    const hasInvalidDateRange = roomStaysWithBoundaries.some(
      (stay) => new Date(stay.from) >= new Date(stay.to),
    );

    if (hasInvalidDateRange) {
      throw new Error("วันที่เข้าพักต้องมาก่อนวันที่ออก");
    }

    const response = await axios.patch(
      `${API_URL}/bookings/manageRoomStays/${bookingId}`,
      { roomStays: roomStaysWithBoundaries },
      { withCredentials: true },
    );

    if (response.status !== 200) throw new Error(response.data.message);
    if (response.data.booking)
      onUpdated?.(formatBookingDates(response.data.booking));
  };

  return (
    <div className="addBooking__wrapper">
      {onClose && <ModalCloseButton onClick={onClose} />}
      <div>
        <h1 className="addBooking__title">จัดการช่วงการเข้าพัก</h1>
      </div>

      <div className="manageRoomStays__list">
        {roomStays.map((roomStay, index) => (
          <div className="manageRoomStays__listItem" key={index}>
            <div>
              <p className="addBooking__label">ห้องพักช่วงพักที่ {index + 1}</p>
              <Select<OptionType, true>
                isMulti
                styles={customStyles<OptionType, true>()}
                classNamePrefix="rs"
                options={roomOptionsByStay[index] || roomIdOptions}
                placeholder="เช่น Veranda 1"
                value={(roomOptionsByStay[index] || roomIdOptions).filter((option) =>
                  getRoomStayRoomIds(roomStay).includes(option.value),
                )}
                //   formatOptionLabel={formatOptionLabel}
                onChange={(options: MultiValue<OptionType>) => {
                  setRoomStays((prevRoomStays) => {
                    const updated = [...prevRoomStays];
                    updated[index] = {
                      ...updated[index],
                      roomIds: options.map((option) => option.value),
                    };
                    return updated;
                  });
                }}
              />
            </div>

            <div>
              <div className="addBooking__labels">
                <p className="addBooking__label">
                  จากวันที่{" "}
                  {isFirstStay(index) && (
                    <span className="manageRoomStays__lockedHint">
                      <i className="bx bx-lock-alt" />
                      วัน Check-In
                    </span>
                  )}
                </p>
                <p className="addBooking__label">
                  ถึงวันที่{" "}
                  {isLastStay(index) && (
                    <span className="manageRoomStays__lockedHint">
                      <i className="bx bx-lock-alt" />
                      วัน Check-Out
                    </span>
                  )}
                </p>
              </div>
              <div className="addBooking__dateInputs">
                <input
                  type="date"
                  value={isFirstStay(index) ? bookingCheckIn : roomStay.from || ""}
                  disabled={isFirstStay(index)}
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
                  className="boxInput addBooking__dateInput manageRoomStays__boundaryDate"
                />
                <input
                  type="date"
                  value={isLastStay(index) ? bookingCheckOut : roomStay.to || ""}
                  disabled={isLastStay(index)}
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
                  className="boxInput addBooking__dateInput manageRoomStays__boundaryDate"
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
