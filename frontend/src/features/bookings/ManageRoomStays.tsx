import Select, { type MultiValue } from "react-select";
import "./ManageRoomStays.css";
import type { OptionType } from "../../helpers/selectStyling";
import { customStyles } from "../../helpers/selectStyling";
import { roomIdOptions } from "../../helpers/options";
import { useCallback, useEffect, useMemo, useState } from "react";
import ActionButton from "../../components/ActionButton";
import ModalCloseButton from "../../components/ModalCloseButton";
import { PreferredDateInput } from "../../components/PreferredDateInput";
import Tooltip from "../../components/Tooltip";
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

const bangkokDateKey = () => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value;

  return `${value("year")}-${value("month")}-${value("day")}`;
};

const ManageRoomStays = ({
  initialRoomStays,
  bookingId,
  revision,
  bookingStatus,
  canEditHistoricalRoomStays,
  checkIn,
  checkOut,
  onClose,
  onUpdated,
  onDirtyChange,
}: {
  initialRoomStays: roomStay[];
  bookingId: string;
  revision: number;
  bookingStatus: booking["status"];
  canEditHistoricalRoomStays: boolean;
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
  const businessDate = bangkokDateKey();
  const closedHistoryIsReadOnly =
    bookingStatus === "checkedOut" && !canEditHistoricalRoomStays;
  const requiresHistoricalCorrectionReason =
    canEditHistoricalRoomStays &&
    (bookingStatus === "checkedOut" || bookingCheckIn < businessDate);
  const restrictHistoricalStays =
    !canEditHistoricalRoomStays && bookingCheckIn < businessDate;
  const isHistoricalStay = useCallback(
    (stay: roomStay) =>
      restrictHistoricalStays &&
      Boolean(stay.to) &&
      stay.to <= businessDate,
    [businessDate, restrictHistoricalStays],
  );
  const applyBookingBoundaries = useCallback(
    (stays: roomStay[]) =>
      stays.map((stay, index) => ({
        ...stay,
        from: index === 0 ? bookingCheckIn : stay.from,
        to: index === stays.length - 1 ? bookingCheckOut : stay.to,
      })),
    [bookingCheckIn, bookingCheckOut],
  );

  const initialManagedRoomStays = useMemo(() => {
    const normalizedCheckIn = normalizeDate(String(checkIn));
    const normalizedCheckOut = normalizeDate(String(checkOut));

    const normalizedStays = initialRoomStays.map((stay, index) => ({
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

    if (!restrictHistoricalStays) return normalizedStays;

    return normalizedStays.flatMap((stay) => {
      if (stay.from < businessDate && businessDate < stay.to) {
        return [
          { ...stay, to: businessDate },
          { ...stay, from: businessDate },
        ];
      }
      return [stay];
    });
  }, [
    initialRoomStays,
    checkIn,
    checkOut,
    restrictHistoricalStays,
    businessDate,
  ]);

  const [roomStays, setRoomStays] = useState<roomStay[]>(
    initialManagedRoomStays,
  );
  const [occupiedRoomIdsByStay, setOccupiedRoomIdsByStay] = useState<
    Record<number, string[]>
  >({});
  const [submitting, setSubmitting] = useState(false);
  const [historicalCorrectionReason, setHistoricalCorrectionReason] =
    useState("");

  const roomStayAvailabilityKey = useMemo(
    () =>
      applyBookingBoundaries(roomStays)
        .map(
          (stay) =>
            `${stay.from || ""}:${stay.to || ""}:${
              isHistoricalStay(stay) ? "locked" : "editable"
            }`,
        )
        .join("|"),
    [roomStays, applyBookingBoundaries, isHistoricalStay],
  );

  useEffect(() => {
    onDirtyChange?.(
      JSON.stringify(roomStays) !== JSON.stringify(initialManagedRoomStays) ||
        Boolean(historicalCorrectionReason.trim()),
    );

    return () => onDirtyChange?.(false);
  }, [
    historicalCorrectionReason,
    initialManagedRoomStays,
    onDirtyChange,
    roomStays,
  ]);

  useEffect(() => {
    const boundedRoomStays = applyBookingBoundaries(roomStays);
    const availabilityRequests = boundedRoomStays.map((stay, index) => ({
      index,
      from: stay.from,
      to: stay.to,
      valid:
        !closedHistoryIsReadOnly &&
        !isHistoricalStay(stay) &&
        Boolean(stay.from && stay.to) &&
        new Date(stay.from) < new Date(stay.to),
    }));

    if (!availabilityRequests.some((request) => request.valid)) {
      return;
    }

    const controller = new AbortController();

    Promise.all(
      availabilityRequests.map(async (request) => {
        if (!request.valid)
          return { index: request.index, occupiedRoomIds: [] };

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
        setRoomStays((prevRoomStays) => {
          let changed = false;
          const nextRoomStays = prevRoomStays.map((stay, index) => {
            const currentRoomIds = getRoomStayRoomIds(stay);
            const nextRoomIds = isHistoricalStay(stay)
              ? currentRoomIds
              : currentRoomIds.filter(
                  (roomId) =>
                    !nextOccupiedRoomIdsByStay[index]?.includes(roomId),
                );
            if (
              nextRoomIds.length !== currentRoomIds.length ||
              nextRoomIds.some(
                (roomId, roomIndex) => roomId !== currentRoomIds[roomIndex],
              )
            ) {
              changed = true;
            }
            return changed ? { ...stay, roomIds: nextRoomIds } : stay;
          });

          return changed ? nextRoomStays : prevRoomStays;
        });
      })
      .catch((err) => {
        if (axios.isCancel(err) || err.name === "CanceledError") return;
        setOccupiedRoomIdsByStay({});
      });

    return () => controller.abort();
  }, [
    bookingId,
    roomStayAvailabilityKey,
    roomStays,
    applyBookingBoundaries,
    isHistoricalStay,
    closedHistoryIsReadOnly,
  ]);

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
    if (submitting) return;
    if (roomStays.length + 1 > 5)
      return toast.error("สามารถเพิ่มห้องได้มากสุด 5 ห้องในการจองเดียว");
    setRoomStays((prevRoomStays) => {
      return [...prevRoomStays, { roomIds: [], from: "", to: "" }];
    });
  };

  const isFirstStay = (index: number) => index === 0;
  const isLastStay = (index: number) => index === roomStays.length - 1;
  const editableStayCount = roomStays.filter(
    (stay) => !isHistoricalStay(stay),
  ).length;
  const canEditCurrentOrFuture =
    !restrictHistoricalStays || bookingCheckOut > businessDate;
  const canRemoveRoomStay =
    roomStays.length > 1 &&
    (!restrictHistoricalStays || editableStayCount > 1);

  const removeRoomStay = () => {
    if (submitting) return;
    if (roomStays.length - 1 < 1)
      return toast.error("ต้องมีช่วงพักอย่างน้อย 1 ช่วง");
    setRoomStays((prevRoomStays) => {
      const updated = [...prevRoomStays];
      updated.pop();
      return applyBookingBoundaries(updated);
    });
  };

  const patchRoomStays = async () => {
    if (submitting) return;
    if (closedHistoryIsReadOnly) {
      throw new Error("การแก้ประวัติห้องหลัง Check-Out ทำได้เฉพาะ Admin");
    }
    if (
      requiresHistoricalCorrectionReason &&
      !historicalCorrectionReason.trim()
    ) {
      throw new Error("กรุณาระบุเหตุผลที่แก้ไขประวัติห้องพัก");
    }
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

    setSubmitting(true);
    try {
      const response = await axios.patch(
        `${API_URL}/bookings/manageRoomStays/${bookingId}`,
        {
          roomStays: roomStaysWithBoundaries,
          expectedRevision: revision,
          historicalCorrectionReason: historicalCorrectionReason.trim(),
        },
        { withCredentials: true },
      );

      if (response.status !== 200) throw new Error(response.data.message);
      if (response.data.booking)
        onUpdated?.(formatBookingDates(response.data.booking));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="addBooking__wrapper">
      {onClose && <ModalCloseButton onClick={onClose} />}
      <div>
        <h1 className="addBooking__title">
          {bookingStatus === "checkedOut"
            ? "แก้ไขประวัติห้องพัก"
            : "จัดการช่วงการเข้าพัก"}
        </h1>
        {closedHistoryIsReadOnly && (
          <p className="manageRoomStays__checkedInHint">
            การแก้ประวัติห้องหลัง Check-Out ทำได้เฉพาะ Admin
          </p>
        )}
        {restrictHistoricalStays && (
          <p className="manageRoomStays__checkedInHint">
            คืนที่ผ่านมาแสดงด้วยเครื่องหมายล็อก
            และสามารถย้ายห้องได้ตั้งแต่วันนี้เป็นต้นไป
          </p>
        )}
        {canEditHistoricalRoomStays && bookingCheckIn < businessDate && (
          <p className="manageRoomStays__adminHistoryHint">
            แอดมินแก้ห้องย้อนหลังได้ และระบบจะบันทึกการเปลี่ยนแปลงไว้
          </p>
        )}
      </div>

      <div className="manageRoomStays__list">
        {roomStays.map((roomStay, index) => (
          <div
            className={`manageRoomStays__listItem${
              isHistoricalStay(roomStay)
                ? " manageRoomStays__listItem--locked"
                : ""
            }`}
            key={`${roomStay.from}-${roomStay.to}-${index}`}
          >
            <div>
              <p className="addBooking__label">
                ห้องพักช่วงพักที่ {index + 1}
                {isHistoricalStay(roomStay) && (
                  <Tooltip
                    className="manageRoomStays__lockedHint"
                    ariaLabel="ดูเหตุผลที่คืนที่ผ่านมาถูกล็อก"
                    content={
                      <>
                        <strong>ทำไมคืนที่ผ่านมาถึงถูกล็อก?</strong>
                        <span>
                          เพื่อรักษาประวัติห้องที่แขกเข้าพักจริง
                          พนักงานจึงย้ายห้องได้ตั้งแต่วันนี้เป็นต้นไป
                        </span>
                        <span>
                          หากต้องแก้ย้อนหลัง ให้แอดมินดำเนินการ
                          โดยระบบจะบันทึกการเปลี่ยนแปลงไว้
                        </span>
                      </>
                    }
                  >
                    <i className="bx bx-lock-keyhole" />
                    คืนที่ผ่านมา
                  </Tooltip>
                )}
              </p>
              <Select<OptionType, true>
                isMulti
                styles={customStyles<OptionType, true>()}
                classNamePrefix="rs"
                options={roomOptionsByStay[index] || roomIdOptions}
                placeholder="เช่น Veranda 1"
                isDisabled={
                  submitting ||
                  closedHistoryIsReadOnly ||
                  isHistoricalStay(roomStay)
                }
                value={(roomOptionsByStay[index] || roomIdOptions).filter(
                  (option) =>
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
                      <i className="bx bx-lock-keyhole" />
                      วัน Check-In
                    </span>
                  )}
                </p>
                <p className="addBooking__label">
                  ถึงวันที่{" "}
                  {isLastStay(index) && (
                    <span className="manageRoomStays__lockedHint">
                      <i className="bx bx-lock-keyhole" />
                      วัน Check-Out
                    </span>
                  )}
                </p>
              </div>
              <div className="addBooking__dateInputs">
                <PreferredDateInput
                  value={
                    isFirstStay(index) ? bookingCheckIn : roomStay.from || ""
                  }
                  disabled={
                    closedHistoryIsReadOnly ||
                    isFirstStay(index) ||
                    isHistoricalStay(roomStay) ||
                    (restrictHistoricalStays &&
                      roomStay.from <= businessDate)
                  }
                  min={restrictHistoricalStays ? businessDate : undefined}
                  onChange={(e) => {
                    const newFrom = e.target.value;

                    setRoomStays((prevRoomStays) => {
                      const updated = [...prevRoomStays];

                      updated[index] = {
                        ...updated[index],
                        from: newFrom,
                      };

                      if (index - 1 >= 0) {
                        updated[index - 1] = {
                          ...updated[index - 1],
                          to: newFrom,
                        };
                      }

                      return updated;
                    });
                  }}
                  style={{
                    borderRight: "0.1rem solid #e8e8e8",
                    borderRadius: "0.5rem 0 0 0.5rem",
                  }}
                  className="boxInput addBooking__dateInput manageRoomStays__boundaryDate"
                />
                <PreferredDateInput
                  value={
                    isLastStay(index) ? bookingCheckOut : roomStay.to || ""
                  }
                  disabled={
                    closedHistoryIsReadOnly ||
                    isLastStay(index) ||
                    isHistoricalStay(roomStay)
                  }
                  min={restrictHistoricalStays ? businessDate : undefined}
                  onChange={(e) => {
                    const newTo = e.target.value;

                    setRoomStays((prevRoomStays) => {
                      const updated = [...prevRoomStays];

                      updated[index] = {
                        ...updated[index],
                        to: newTo,
                      };

                      if (index + 1 < updated.length) {
                        updated[index + 1] = {
                          ...updated[index + 1],
                          from: newTo,
                        };
                      }

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
      {requiresHistoricalCorrectionReason && (
        <label className="manageRoomStays__historyReason">
          <span className="addBooking__label">เหตุผลที่แก้ประวัติห้องพัก</span>
          <textarea
            className="boxInput"
            value={historicalCorrectionReason}
            maxLength={500}
            disabled={submitting}
            placeholder="เช่น แขกย้ายจาก V1 ไป V2 ตั้งแต่คืนที่สอง"
            onChange={(event) =>
              setHistoricalCorrectionReason(event.target.value)
            }
          />
          <small>ระบบจะบันทึกเหตุผลพร้อมข้อมูลก่อนและหลังแก้ไข</small>
        </label>
      )}
      <div className="viewBooking__actions">
        <div className="viewBooking__actionsLeft">
          <ActionButton
            text="เพิ่มช่วงพัก"
            icon="bx-plus"
            disabled={
              submitting ||
              closedHistoryIsReadOnly ||
              !canEditCurrentOrFuture
            }
            onClick={() => addEmptyRoomStay()}
          />

          {canRemoveRoomStay && (
            <ActionButton
              text="ลดช่วงพัก"
              icon="bx-minus"
              disabled={submitting || closedHistoryIsReadOnly}
              onClick={() => removeRoomStay()}
            />
          )}
        </div>

        <ActionButton
          text="แก้ไข"
          icon="bx-edit"
          highlight
          disabled={
            submitting ||
            closedHistoryIsReadOnly ||
            !canEditCurrentOrFuture ||
            (requiresHistoricalCorrectionReason &&
              !historicalCorrectionReason.trim())
          }
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
