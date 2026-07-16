import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import Select, { type MultiValue, type SingleValue } from "react-select";
import toast from "react-hot-toast";
import ActionButton from "../../components/ActionButton";
import CashShiftNudge from "../../components/CashShiftNudge";
import { formatDisplayDate } from "../../helpers/displayDate";
import ModalCloseButton from "../../components/ModalCloseButton";
import { API_URL } from "../../config/api";
import {
  formatBookingDates,
  formatLocalDate,
} from "../../helpers/bookingHelpers";
import {
  platformOptions,
  paymentMethodOptions,
  roomIdOptions,
} from "../../helpers/options";
import { getRoomStayRoomIds } from "../../helpers/roomStayHelpers";
import { customStyles, type OptionType } from "../../helpers/selectStyling";
import type {
  booking,
  PaymentMethod,
  PlatformId,
} from "../../types/bookingTypes";

import "./AddTransaction.css";
import "./Cancellation.css";
import "./CheckIn.css";
import "./ExtendBooking.css";

type AssignmentMode = "same" | "move";

type ExtendBookingProps = {
  booking: booking;
  onClose?: () => void;
  onDirtyChange?: (isDirty: boolean) => void;
  onUpdated?: (booking: booking) => void;
};

const addDays = (value: Date, days: number) => {
  const next = new Date(value);
  next.setDate(next.getDate() + days);
  return next;
};

const currency = (amount: number) =>
  `THB ${new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
  }).format(amount || 0)}`;

const formatPlatformOptionLabel = ({ label, color }: OptionType) => (
  <div className="extendBooking__platformOption">
    <span style={{ backgroundColor: color || "transparent" }} />
    {label}
  </div>
);

const ExtendBooking = ({
  booking,
  onClose,
  onDirtyChange,
  onUpdated,
}: ExtendBookingProps) => {
  const currentCheckOut = formatLocalDate(new Date(booking.checkOut));
  const currentCheckIn = formatLocalDate(new Date(booking.checkIn));
  const initialNewCheckOut = formatLocalDate(
    addDays(new Date(booking.checkOut), 1),
  );
  const finalStay = useMemo(
    () =>
      [...booking.roomStays]
        .sort(
          (left, right) =>
            new Date(right.from).getTime() - new Date(left.from).getTime(),
        )
        .find(
          (stay) => formatLocalDate(new Date(stay.to)) === currentCheckOut,
        ) || booking.roomStays[booking.roomStays.length - 1],
    [booking.roomStays, currentCheckOut],
  );
  const currentRoomIds = useMemo(
    () => getRoomStayRoomIds(finalStay || { roomIds: [] }),
    [finalStay],
  );
  const [newCheckOut, setNewCheckOut] = useState(initialNewCheckOut);
  const minimumTotalNights = booking.nights + 1;
  const [totalNights, setTotalNights] = useState(String(minimumTotalNights));
  const [assignmentMode, setAssignmentMode] = useState<AssignmentMode>("same");
  const [roomIds, setRoomIds] = useState<string[]>(currentRoomIds);
  const [platformId, setPlatformId] = useState<PlatformId>("WALK");
  const [channelBookingId, setChannelBookingId] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | "">("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [occupiedRoomIds, setOccupiedRoomIds] = useState<string[]>([]);
  const [checkingAvailability, setCheckingAvailability] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  const addedNights = Math.max(
    Math.round(
      (new Date(`${newCheckOut}T00:00:00`).getTime() -
        new Date(`${currentCheckOut}T00:00:00`).getTime()) /
        86400000,
    ),
    0,
  );
  const numericAmount = Number(amount);
  const cardSurcharge =
    paymentMethod === "Card" && Number.isFinite(numericAmount)
      ? Number((numericAmount * 0.03).toFixed(2))
      : 0;
  const paidPaymentOptions = paymentMethodOptions.filter(
    (option) => option.value !== "Unpaid",
  );
  const selectedRooms = assignmentMode === "same" ? currentRoomIds : roomIds;
  const selectedRoomLabels = selectedRooms.map(
    (roomId) =>
      roomIdOptions.find((option) => option.value === roomId)?.label || roomId,
  );
  const platformLabel =
    platformOptions.find((option) => option.value === platformId)?.label ||
    platformId;
  const paymentMethodLabel =
    paidPaymentOptions.find((option) => option.value === paymentMethod)
      ?.label || "ยังไม่ได้เลือก";
  const unavailableSelection = selectedRooms.some((roomId) =>
    occupiedRoomIds.includes(roomId),
  );

  const newCheckOutChangeHandler = (value: string) => {
    setNewCheckOut(value);
    const nextAddedNights = Math.round(
      (new Date(`${value}T00:00:00`).getTime() -
        new Date(`${currentCheckOut}T00:00:00`).getTime()) /
        86400000,
    );

    if (Number.isInteger(nextAddedNights) && nextAddedNights >= 1) {
      setTotalNights(String(booking.nights + nextAddedNights));
    }
  };

  const totalNightsChangeHandler = (value: string) => {
    setTotalNights(value);
    const nextTotalNights = Number(value);
    if (
      !Number.isInteger(nextTotalNights) ||
      nextTotalNights < minimumTotalNights
    ) {
      return;
    }

    setNewCheckOut(
      formatLocalDate(addDays(new Date(booking.checkIn), nextTotalNights)),
    );
  };

  const clampTotalNights = () => {
    const nextTotalNights = Number(totalNights);
    if (
      Number.isInteger(nextTotalNights) &&
      nextTotalNights >= minimumTotalNights
    ) {
      return;
    }

    setTotalNights(String(minimumTotalNights));
    setNewCheckOut(
      formatLocalDate(addDays(new Date(booking.checkIn), minimumTotalNights)),
    );
  };

  useEffect(() => {
    onDirtyChange?.(
      newCheckOut !== initialNewCheckOut ||
        assignmentMode !== "same" ||
        platformId !== "WALK" ||
        channelBookingId !== "" ||
        paymentMethod !== "" ||
        amount !== "" ||
        note !== "",
    );
    return () => onDirtyChange?.(false);
  }, [
    amount,
    assignmentMode,
    channelBookingId,
    initialNewCheckOut,
    newCheckOut,
    note,
    onDirtyChange,
    paymentMethod,
    platformId,
  ]);

  useEffect(() => {
    if (addedNights < 1) {
      setOccupiedRoomIds([]);
      return;
    }

    const controller = new AbortController();
    setCheckingAvailability(true);
    axios
      .get(`${API_URL}/bookings/getRoomAvailability`, {
        params: {
          checkIn: currentCheckOut,
          checkOut: newCheckOut,
          excludeBookingId: booking.bookingId,
        },
        signal: controller.signal,
        withCredentials: true,
      })
      .then((response) => {
        setOccupiedRoomIds(
          Array.isArray(response.data?.occupiedRoomIds)
            ? response.data.occupiedRoomIds
            : [],
        );
      })
      .catch((error) => {
        if (axios.isCancel(error) || error.name === "CanceledError") return;
        setOccupiedRoomIds([]);
        toast.error("ไม่สามารถตรวจสอบห้องว่างได้ กรุณาลองใหม่");
      })
      .finally(() => {
        if (!controller.signal.aborted) setCheckingAvailability(false);
      });

    return () => controller.abort();
  }, [addedNights, booking.bookingId, currentCheckOut, newCheckOut]);

  const availableRoomOptions = useMemo(
    () =>
      roomIdOptions.map((option) => ({
        ...option,
        isDisabled: occupiedRoomIds.includes(option.value),
      })),
    [occupiedRoomIds],
  );
  const submitExtension = async () => {
    if (submitting) return;
    if (addedNights < 1) throw new Error("กรุณาเพิ่มอย่างน้อย 1 คืน");
    if (selectedRooms.length === 0) throw new Error("กรุณาเลือกห้องพัก");
    if (unavailableSelection) {
      throw new Error("ห้องที่เลือกไม่ว่างสำหรับคืนที่เพิ่ม กรุณาเลือกใหม่");
    }
    if (!channelBookingId.trim()) {
      throw new Error("กรุณาระบุ Booking No. สำหรับคืนที่เพิ่ม");
    }
    if (!paymentMethod) throw new Error("กรุณาเลือกช่องทางชำระเงิน");
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      throw new Error("ค่าห้องของคืนที่เพิ่มต้องมากกว่า 0");
    }

    setSubmitting(true);
    try {
      const response = await axios.post(
        `${API_URL}/bookings/${booking.bookingId}/extensions`,
        {
          expectedRevision: booking.revision,
          startDate: currentCheckOut,
          newCheckOut,
          roomIds: selectedRooms,
          platformId,
          channelBookingId: channelBookingId.trim(),
          amount: numericAmount,
          paymentMethod,
          note,
        },
        {
          headers: { "Idempotency-Key": idempotencyKey },
          withCredentials: true,
        },
      );

      if (response.data.booking) {
        onUpdated?.(formatBookingDates(response.data.booking));
      }
      toast.success("เพิ่มคืนให้ Booking สำเร็จ");
    } catch (error) {
      if (axios.isAxiosError<{ message?: string }>(error)) {
        if (error.response?.status === 409) {
          throw new Error(
            "ข้อมูล booking หรือห้องว่างเปลี่ยนระหว่างแก้ไข กรุณารีเฟรช booking แล้วลองใหม่",
          );
        }
        throw new Error(
          error.response?.data?.message || "ไม่สามารถเพิ่มคืนให้ booking ได้",
        );
      }
      throw error;
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="extendBooking__wrapper">
      {onClose && <ModalCloseButton onClick={onClose} />}
      <header className="extendBooking__header">
        <h1>เพิ่มจำนวนคืนให้ {booking.name}</h1>
      </header>

      <div className="extendBooking__contentGrid">
        <div className="extendBooking__leftColumn">
          <div className="addBooking__dateInputsWithNights extendBooking__dateInputsWithNights">
            <div className="addBooking__dateGroup">
              <div className="addBooking__labels">
                <p className="addBooking__label">Check-In</p>
                <p className="addBooking__label">Check-Out ใหม่</p>
              </div>
              <div className="addBooking__dateInputs">
                <input
                  className="boxInput addBooking__dateInput extendBooking__previousCheckOut"
                  type="date"
                  value={currentCheckIn}
                  disabled
                />
                <input
                  className="boxInput addBooking__dateInput"
                  type="date"
                  min={initialNewCheckOut}
                  value={newCheckOut}
                  disabled={submitting}
                  onChange={(event) =>
                    newCheckOutChangeHandler(event.target.value)
                  }
                />
              </div>
            </div>
            <div className="addBooking__nightsField">
              <p className="addBooking__label">คืน</p>
              <input
                className="boxInput addBooking__nightsInput"
                type="number"
                inputMode="numeric"
                min={minimumTotalNights}
                step="1"
                value={totalNights}
                disabled={submitting}
                aria-label="จำนวนคืนทั้งหมดหลังเพิ่มคืน"
                onChange={(event) =>
                  totalNightsChangeHandler(event.target.value)
                }
                onBlur={clampTotalNights}
              />
            </div>
          </div>
          <div>
            <p className="addBooking__label">ห้องสำหรับคืนที่เพิ่ม</p>
            <div className="cancellation__segmentedControl">
              <button
                type="button"
                className={
                  "cancellation__segment" +
                  (assignmentMode === "same"
                    ? " cancellation__segment--extendActive"
                    : "")
                }
                disabled={submitting}
                onClick={() => {
                  setAssignmentMode("same");
                  setRoomIds(currentRoomIds);
                }}
              >
                <i className="bx bx-bed" />
                ห้องเดิม
              </button>
              <button
                type="button"
                className={
                  "cancellation__segment" +
                  (assignmentMode === "move"
                    ? " cancellation__segment--extendActive"
                    : "")
                }
                disabled={submitting}
                onClick={() => setAssignmentMode("move")}
              >
                <i className="bx bx-arrow-right-left" />
                เลือกห้องใหม่
              </button>
            </div>
          </div>
          {assignmentMode === "move" && (
            <div>
              <p className="addBooking__label">ห้องสำหรับคืนที่เพิ่ม</p>
              <Select<OptionType, true>
                isMulti
                isDisabled={submitting || checkingAvailability}
                styles={customStyles<OptionType, true>()}
                classNamePrefix="rs"
                options={availableRoomOptions}
                value={availableRoomOptions.filter((option) =>
                  selectedRooms.includes(option.value),
                )}
                placeholder="เลือกห้องที่ว่าง"
                onChange={(options: MultiValue<OptionType>) =>
                  setRoomIds(options.map((option) => option.value))
                }
              />
              {unavailableSelection && (
                <p className="extendBooking__error">
                  ห้องที่เลือกไม่ว่างในช่วงนี้
                </p>
              )}
            </div>
          )}

          <label className="extendBooking__field">
            <span>หมายเหตุ (ถ้ามี)</span>
            <input
              className="boxInput"
              value={note}
              placeholder="เช่น แขกเพิ่มคืนและขอย้ายห้อง"
              disabled={submitting}
              onChange={(event) => setNote(event.target.value)}
            />
          </label>
        </div>

        <div className="extendBooking__rightColumn">
          <label className="extendBooking__field">
            <span>ช่องทางสำหรับคืนที่เพิ่ม</span>
            <Select<OptionType>
              isDisabled={submitting}
              styles={customStyles<OptionType>()}
              classNamePrefix="rs"
              options={platformOptions}
              value={platformOptions.find(
                (option) => option.value === platformId,
              )}
              formatOptionLabel={formatPlatformOptionLabel}
              onChange={(option: SingleValue<OptionType>) =>
                option && setPlatformId(option.value as PlatformId)
              }
            />
          </label>

          <label className="extendBooking__field">
            <span>Booking No. สำหรับคืนที่เพิ่ม</span>
            <input
              className="boxInput"
              value={channelBookingId}
              maxLength={100}
              placeholder="เช่น HW-12345678 / WALK-0716"
              disabled={submitting}
              onChange={(event) => setChannelBookingId(event.target.value)}
            />
          </label>

          <label className="extendBooking__field">
            <span>ค่าห้องของคืนที่เพิ่ม</span>
            <input
              placeholder="เช่น 1000"
              className="boxInput"
              type="number"
              min="0.01"
              step="0.01"
              value={amount}
              disabled={submitting}
              onChange={(event) => setAmount(event.target.value)}
            />
          </label>

          <label className="extendBooking__field">
            <span>ช่องทางชำระเงิน</span>
            <Select<OptionType>
              isDisabled={submitting}
              styles={customStyles<OptionType>()}
              classNamePrefix="rs"
              options={paidPaymentOptions}
              value={paidPaymentOptions.find(
                (option) => option.value === paymentMethod,
              )}
              placeholder="เลือกช่องทางชำระเงิน"
              onChange={(option: SingleValue<OptionType>) =>
                setPaymentMethod((option?.value || "") as PaymentMethod | "")
              }
            />
          </label>

          {paymentMethod === "Cash" && <CashShiftNudge />}
        </div>
      </div>

      <div className="extendBooking__summarySection">
        <p className="addBooking__label">สรุปก่อนยืนยัน</p>
        <section
          className="addTransaction__cardPreview"
          aria-label="สรุปการเพิ่มคืน"
        >
          <div className="addTransaction__cardPreviewList">
            <div className="addTransaction__cardPreviewRow">
              <p>คืนที่เพิ่ม</p>
              <div className="extendBooking__summaryVisual">
                <div className="viewBooking__roomStay--dates">
                  <p className="viewBooking__roomStay--from">
                    {formatDisplayDate(currentCheckOut, "dd/MM/yyyy", {
                      includeYear: false,
                    })}
                  </p>
                  <p className="viewBooking__roomStay--to">
                    {formatDisplayDate(newCheckOut, "dd/MM/yyyy", {
                      includeYear: false,
                    })}
                  </p>
                </div>
                <span className="extendBooking__addedNights">
                  +{addedNights} คืน
                </span>
              </div>
            </div>
            {assignmentMode === "move" && (
              <div className="addTransaction__cardPreviewRow">
                <p>ห้องสำหรับคืนที่เพิ่ม</p>
                <p className="extendBooking__summaryRooms">
                  {selectedRoomLabels.length > 0 ? (
                    selectedRoomLabels.map((roomLabel, index) => (
                      <span
                        className="extendBooking__summaryRoomChip"
                        key={selectedRooms[index]}
                      >
                        {roomLabel}
                      </span>
                    ))
                  ) : (
                    <span>-</span>
                  )}
                </p>
              </div>
            )}
            <div className="addTransaction__cardPreviewRow">
              <p>ช่องทาง</p>
              <p>{platformLabel}</p>
            </div>
            <div className="addTransaction__cardPreviewRow">
              <p>
                ค่าห้อง
                {paymentMethod && (
                  <span
                    className={`checkIn__paymentTag ${paymentMethod.toLowerCase()}`}
                  >
                    {paymentMethodLabel}
                  </span>
                )}
              </p>
              <p>{currency(numericAmount)}</p>
            </div>
            {cardSurcharge > 0 && (
              <div className="addTransaction__cardPreviewRow">
                <p>
                  ค่าธรรมเนียมบัตร 3%{" "}
                  <span className="addTransaction__paymentTag card">Card</span>
                </p>
                <p>{currency(cardSurcharge)}</p>
              </div>
            )}
          </div>
          <div className="addTransaction__cardPreviewTotal">
            <div className="addTransaction__cardPreviewBreakdown">
              <div className="addTransaction__cardPreviewTotalRow">
                <p>ยอดที่ต้องเก็บจากลูกค้า</p>
                <p className="addTransaction__cardPreviewTotalText">
                  {currency((numericAmount || 0) + cardSurcharge)}
                </p>
              </div>
            </div>
          </div>
        </section>
      </div>

      <div className="extendBooking__actions">
        <ActionButton
          text={submitting ? "กำลังบันทึก..." : "ยืนยัน Add Nights"}
          icon="bx-calendar-plus"
          highlight
          disabled={submitting || checkingAvailability}
          onClick={() =>
            submitExtension().catch((error) =>
              toast.error(
                error instanceof Error ? error.message : "เกิดข้อผิดพลาด",
              ),
            )
          }
        />
      </div>
    </div>
  );
};

export default ExtendBooking;
