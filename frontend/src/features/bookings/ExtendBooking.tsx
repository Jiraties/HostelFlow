import { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import Select, { type MultiValue, type SingleValue } from "react-select";
import toast from "react-hot-toast";
import ActionButton from "../../components/ActionButton";
import CashShiftNudge from "../../components/CashShiftNudge";
import { formatDisplayDate } from "../../helpers/displayDate";
import ModalCloseButton from "../../components/ModalCloseButton";
import { useAuth } from "../../context/AuthContext";
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
import { generateWalkInBookingId } from "../../helpers/walkInBookingId";
import type {
  booking,
  PaymentMethod,
  PlatformId,
} from "../../types/bookingTypes";

import "./AddTransaction.css";
import "./Cancellation.css";
import "./CheckIn.css";
import "./ExtendBooking.css";

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

const backwardAddNightsEnabled =
  import.meta.env.VITE_BACKWARD_ADD_NIGHTS_ENABLED !== "false";

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
  const { user } = useAuth();
  const dateFormat = user?.settings.dateFormat || "dd/MM/yyyy";
  const currentCheckIn = formatLocalDate(new Date(booking.checkIn));
  const currentCheckOut = formatLocalDate(new Date(booking.checkOut));
  const initialNewCheckIn = formatLocalDate(
    addDays(new Date(booking.checkIn), -1),
  );
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
  const earliestStay = useMemo(
    () =>
      [...booking.roomStays].sort(
        (left, right) =>
          new Date(left.from).getTime() - new Date(right.from).getTime(),
      )[0],
    [booking.roomStays],
  );
  const finalRoomIds = useMemo(
    () => getRoomStayRoomIds(finalStay || { roomIds: [] }),
    [finalStay],
  );
  const earliestRoomIds = useMemo(
    () => getRoomStayRoomIds(earliestStay || { roomIds: [] }),
    [earliestStay],
  );
  const [placement, setPlacement] = useState<"before" | "after">("after");
  const [newCheckIn, setNewCheckIn] = useState(initialNewCheckIn);
  const [newCheckOut, setNewCheckOut] = useState(initialNewCheckOut);
  const [addedNightsInput, setAddedNightsInput] = useState("1");
  const [roomIds, setRoomIds] = useState<string[]>(finalRoomIds);
  const [platformId, setPlatformId] = useState<PlatformId>("WALK");
  const [initialWalkInBookingId] = useState(() => generateWalkInBookingId());
  const [channelBookingId, setChannelBookingId] = useState(
    initialWalkInBookingId,
  );
  const generatedWalkInBookingIdRef = useRef(initialWalkInBookingId);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | "">("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [occupiedRoomIds, setOccupiedRoomIds] = useState<string[]>([]);
  const [checkingAvailability, setCheckingAvailability] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  const addedNightsDifference =
    placement === "before"
      ? Math.round(
          (new Date(`${currentCheckIn}T00:00:00`).getTime() -
            new Date(`${newCheckIn}T00:00:00`).getTime()) /
            86400000,
        )
      : Math.round(
          (new Date(`${newCheckOut}T00:00:00`).getTime() -
            new Date(`${currentCheckOut}T00:00:00`).getTime()) /
            86400000,
        );
  const addedNights = Number.isFinite(addedNightsDifference)
    ? Math.max(addedNightsDifference, 0)
    : 0;
  const numericAmount = Number(amount);
  const cardSurcharge =
    paymentMethod === "Card" && Number.isFinite(numericAmount)
      ? Number((numericAmount * 0.03).toFixed(2))
      : 0;
  const paidPaymentOptions = paymentMethodOptions.filter(
    (option) => option.value !== "Unpaid",
  );
  const selectedRooms = roomIds;
  const selectedRoomLabels = selectedRooms.map(
    (roomId) =>
      roomIdOptions.find((option) => option.value === roomId)?.label || roomId,
  );
  const platformLabel =
    platformOptions.find((option) => option.value === platformId)?.label ||
    platformId;
  const originalPlatformLabel =
    platformOptions.find((option) => option.value === booking.platformId)
      ?.label || booking.platformId;
  const paymentMethodLabel =
    paidPaymentOptions.find((option) => option.value === paymentMethod)
      ?.label || "ยังไม่ได้เลือก";
  const unavailableSelection = selectedRooms.some((roomId) =>
    occupiedRoomIds.includes(roomId),
  );
  const segmentFrom = placement === "before" ? newCheckIn : currentCheckOut;
  const segmentTo = placement === "before" ? currentCheckIn : newCheckOut;

  const addedNightsChangeHandler = (value: string) => {
    setAddedNightsInput(value);
    const nextAddedNights = Number(value);
    if (!Number.isInteger(nextAddedNights) || nextAddedNights < 1) {
      return;
    }

    if (placement === "before") {
      setNewCheckIn(
        formatLocalDate(
          addDays(new Date(`${currentCheckIn}T00:00:00`), -nextAddedNights),
        ),
      );
    } else {
      setNewCheckOut(
        formatLocalDate(
          addDays(new Date(`${currentCheckOut}T00:00:00`), nextAddedNights),
        ),
      );
    }
  };

  const clampAddedNights = () => {
    const nextAddedNights = Number(addedNightsInput);
    if (Number.isInteger(nextAddedNights) && nextAddedNights >= 1) {
      return;
    }

    setAddedNightsInput("1");
    if (placement === "before") setNewCheckIn(initialNewCheckIn);
    else setNewCheckOut(initialNewCheckOut);
  };

  const stepAddedNights = (change: number) => {
    const nextAddedNights = Math.max(1, addedNights + change);
    setAddedNightsInput(String(nextAddedNights));
    addedNightsChangeHandler(String(nextAddedNights));
  };

  const placementChangeHandler = (nextPlacement: "before" | "after") => {
    setPlacement(nextPlacement);
    setAddedNightsInput("1");
    setNewCheckIn(initialNewCheckIn);
    setNewCheckOut(initialNewCheckOut);
    setRoomIds(nextPlacement === "before" ? earliestRoomIds : finalRoomIds);
  };

  const platformChangeHandler = (nextPlatformId: PlatformId) => {
    let replacementBookingId: string | undefined;
    if (
      nextPlatformId === "WALK" &&
      (!channelBookingId.trim() ||
        channelBookingId === generatedWalkInBookingIdRef.current)
    ) {
      replacementBookingId = generateWalkInBookingId();
      generatedWalkInBookingIdRef.current = replacementBookingId;
    } else if (
      nextPlatformId !== "WALK" &&
      channelBookingId === generatedWalkInBookingIdRef.current
    ) {
      replacementBookingId = "";
      generatedWalkInBookingIdRef.current = "";
    }

    setPlatformId(nextPlatformId);
    if (replacementBookingId !== undefined) {
      setChannelBookingId(replacementBookingId);
    }
  };

  const channelBookingIdChangeHandler = (value: string) => {
    if (value !== generatedWalkInBookingIdRef.current) {
      generatedWalkInBookingIdRef.current = "";
    }
    setChannelBookingId(value);
  };

  useEffect(() => {
    onDirtyChange?.(
      placement !== "after" ||
        newCheckIn !== initialNewCheckIn ||
        newCheckOut !== initialNewCheckOut ||
        addedNightsInput !== "1" ||
        roomIds.join(",") !== finalRoomIds.join(",") ||
        platformId !== "WALK" ||
        channelBookingId !== initialWalkInBookingId ||
        paymentMethod !== "" ||
        amount !== "" ||
        note !== "",
    );
    return () => onDirtyChange?.(false);
  }, [
    amount,
    addedNightsInput,
    channelBookingId,
    finalRoomIds,
    initialNewCheckIn,
    initialNewCheckOut,
    initialWalkInBookingId,
    newCheckOut,
    newCheckIn,
    note,
    onDirtyChange,
    paymentMethod,
    platformId,
    placement,
    roomIds,
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
          checkIn: segmentFrom,
          checkOut: segmentTo,
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
  }, [addedNights, booking.bookingId, segmentFrom, segmentTo]);

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
          placement,
          nights: addedNights,
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
      toast.success(
        placement === "before"
          ? "เพิ่มคืนก่อนวันเข้าให้ Booking สำเร็จ"
          : "เพิ่มคืนให้ Booking สำเร็จ",
      );
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
        {backwardAddNightsEnabled && (
          <div className="extendBooking__field extendBooking__field--full">
          <p className="addBooking__label">ตำแหน่งคืนที่เพิ่ม</p>
          <div
            className="extendBooking__placement"
            role="group"
            aria-label="ตำแหน่งคืนที่เพิ่ม"
          >
            <button
              type="button"
              className={placement === "before" ? "active" : ""}
              disabled={submitting || booking.status !== "booked"}
              aria-pressed={placement === "before"}
              onClick={() => placementChangeHandler("before")}
            >
              ก่อนวันเข้า
            </button>
            <button
              type="button"
              className={placement === "after" ? "active" : ""}
              disabled={submitting}
              aria-pressed={placement === "after"}
              onClick={() => placementChangeHandler("after")}
            >
              หลังวันออก
            </button>
          </div>
          </div>
        )}
        <div className="extendBooking__roomFields">
          <div className="extendBooking__field">
            <p className="addBooking__label">ห้องสำหรับคืนที่เพิ่ม</p>
            <Select<OptionType, true>
              isMulti
              isDisabled={submitting || checkingAvailability}
              styles={customStyles<OptionType, true>()}
              className={unavailableSelection ? "formField--error" : undefined}
              classNamePrefix="rs"
              aria-invalid={unavailableSelection}
              options={availableRoomOptions}
              value={availableRoomOptions.filter((option) =>
                selectedRooms.includes(option.value),
              )}
              placeholder="เลือกห้องที่ว่าง"
              aria-label="เลือกห้องสำหรับคืนที่เพิ่ม"
              onChange={(options: MultiValue<OptionType>) =>
                setRoomIds(options.map((option) => option.value))
              }
            />
            {unavailableSelection && (
              <p className="formField__error">
                ห้องที่เลือกไม่ว่างในช่วงนี้
              </p>
            )}
          </div>
          <div className="extendBooking__field">
            <p className="addBooking__label">
              {placement === "before"
                ? "เพิ่มก่อนวันเข้าอีกกี่คืน?"
                : "เพิ่มอีกกี่คืน?"}
            </p>
            <div className="extendBooking__nightsStepper">
              <button
                type="button"
                aria-label="ลดจำนวนคืน"
                disabled={submitting || addedNights <= 1}
                onClick={() => stepAddedNights(-1)}
              >
                <i className="bx bx-minus" aria-hidden="true" />
              </button>
              <input
                type="number"
                inputMode="numeric"
                min="1"
                step="1"
                value={addedNightsInput}
                disabled={submitting}
                aria-label="จำนวนคืนที่เพิ่ม"
                onChange={(event) =>
                  addedNightsChangeHandler(event.target.value)
                }
                onBlur={clampAddedNights}
              />
              <button
                type="button"
                aria-label="เพิ่มจำนวนคืน"
                disabled={submitting}
                onClick={() => stepAddedNights(1)}
              >
                <i className="bx bx-plus" aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>

        <div className="extendBooking__field">
          <p className="addBooking__label">ช่องทางสำหรับคืนที่เพิ่ม</p>
          <Select<OptionType>
            isDisabled={submitting}
            styles={customStyles<OptionType>()}
            classNamePrefix="rs"
            options={platformOptions}
            value={platformOptions.find(
              (option) => option.value === platformId,
            )}
            formatOptionLabel={formatPlatformOptionLabel}
            aria-label="ช่องทางสำหรับคืนที่เพิ่ม"
            onChange={(option: SingleValue<OptionType>) =>
              option && platformChangeHandler(option.value as PlatformId)
            }
          />
        </div>

        <label className="extendBooking__field">
          <span>Booking No. สำหรับคืนที่เพิ่ม</span>
          <input
            className="boxInput"
            value={channelBookingId}
            maxLength={100}
            inputMode={platformId === "WALK" ? "numeric" : undefined}
            placeholder={
              platformId === "WALK" ? "เช่น 170720261819" : "เช่น 4012345678"
            }
            disabled={submitting}
            onChange={(event) =>
              channelBookingIdChangeHandler(event.target.value)
            }
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

        <div className="extendBooking__field">
          <p className="addBooking__label">ช่องทางชำระเงิน</p>
          <Select<OptionType>
            isDisabled={submitting}
            styles={customStyles<OptionType>()}
            classNamePrefix="rs"
            options={paidPaymentOptions}
            value={paidPaymentOptions.find(
              (option) => option.value === paymentMethod,
            )}
            placeholder="เลือกช่องทางชำระเงิน"
            aria-label="ช่องทางชำระเงิน"
            onChange={(option: SingleValue<OptionType>) =>
              setPaymentMethod((option?.value || "") as PaymentMethod | "")
            }
          />
          {paymentMethod === "Cash" && <CashShiftNudge />}
        </div>

        <label className="extendBooking__field extendBooking__field--full">
          <span>
            หมายเหตุ
            <span className="addTransaction__optionalLabel">(ไม่บังคับ)</span>
          </span>
          <input
            className="boxInput"
            value={note}
            placeholder="เช่น แขกเพิ่มคืนและขอย้ายห้อง"
            disabled={submitting}
            onChange={(event) => setNote(event.target.value)}
          />
        </label>
      </div>

      {placement === "before" && (
        <p className="extendBooking__anchorNotice">
          คืนที่เพิ่มจะใช้ช่องทางและ Booking No. ที่เลือก ส่วนการจองเดิมจะไม่เปลี่ยน
        </p>
      )}

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
                    {formatDisplayDate(segmentFrom, dateFormat, {
                      includeYear: false,
                    })}
                  </p>
                  <p className="viewBooking__roomStay--to">
                    {formatDisplayDate(segmentTo, dateFormat, {
                      includeYear: false,
                    })}
                  </p>
                </div>
                <span className="extendBooking__addedNights">
                  +{addedNights} คืน
                </span>
              </div>
            </div>
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
            <div className="addTransaction__cardPreviewRow">
              <p>ช่องทาง</p>
              <p>{platformLabel}</p>
            </div>
            {placement === "before" && (
              <div className="addTransaction__cardPreviewRow">
                <p>การจองเดิม (ไม่เปลี่ยน)</p>
                <p className="extendBooking__originalReservation">
                  <span>{originalPlatformLabel}</span>
                  <span>
                    {formatDisplayDate(currentCheckIn, dateFormat, {
                      includeYear: false,
                    })}
                    {" - "}
                    {formatDisplayDate(currentCheckOut, dateFormat, {
                      includeYear: false,
                    })}
                  </span>
                  <span>No. {booking.bookingId}</span>
                </p>
              </div>
            )}
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
          text={
            submitting
              ? "กำลังบันทึก..."
              : placement === "before"
                ? "ยืนยันเพิ่มคืนก่อนวันเข้า"
                : "ยืนยันเพิ่มคืน"
          }
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
