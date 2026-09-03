import { useEffect, useState } from "react";
import axios from "axios";
import toast from "react-hot-toast";
import Select, { type SingleValue } from "react-select";
import ActionButton from "../../components/ActionButton";
import ModalCloseButton from "../../components/ModalCloseButton";
import { API_URL } from "../../config/api";
import { useAuth } from "../../context/AuthContext";
import {
  formatDisplayDate,
  formatDisplayDateTime,
} from "../../helpers/displayDate";
import { getApiErrorMessage } from "../../helpers/apiErrorMessage";
import { customStyles, type OptionType } from "../../helpers/selectStyling";
import { formatCompactRoomNames } from "../../helpers/roomStayHelpers";
import "./RoomBlockModal.css";

export type CalendarRoomBlock = {
  blockId: string;
  roomId: string;
  roomIds?: string[];
  from: string | Date;
  to: string | Date;
  reason: string;
  createdBy: string;
  createdAt: string | Date;
};

type NewRoomBlock = {
  roomIds: string[];
  from: string;
  to: string;
};

const roomBlockReasonOptions = [
  { value: "temporary_hold", label: "กันห้องไว้ชั่วคราว" },
  { value: "house_use", label: "ใช้ภายใน / เจ้าของเข้าพัก" },
  { value: "cleaning", label: "ทำความสะอาด" },
  { value: "maintenance", label: "ซ่อมบำรุง" },
  { value: "other", label: "อื่นๆ" },
] as const;

type RoomBlockReasonOption = (typeof roomBlockReasonOptions)[number]["value"];

const RoomBlockModal = ({
  selection,
  block,
  onClose,
  onChanged,
}: {
  selection?: NewRoomBlock | null;
  block?: CalendarRoomBlock | null;
  onClose: () => void;
  onChanged: () => void;
}) => {
  const { user } = useAuth();
  const dateFormat = user?.settings.dateFormat || "dd/MM/yyyy";
  const [reasonOption, setReasonOption] = useState<RoomBlockReasonOption>();
  const [customReason, setCustomReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const isCreate = Boolean(selection);
  const roomIds = selection?.roomIds?.length
    ? selection.roomIds
    : block?.roomIds?.length
      ? block.roomIds
      : block?.roomId
        ? [block.roomId]
        : [];
  const roomNames = formatCompactRoomNames(roomIds);
  const from = selection?.from || block?.from || "";
  const to = selection?.to || block?.to || "";
  const reason =
    reasonOption === "other"
      ? customReason.trim()
      : roomBlockReasonOptions.find((option) => option.value === reasonOption)
          ?.label || "";

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !submitting) onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onClose, submitting]);

  const create = async () => {
    if (!selection || submitting) return;
    if (!reason) throw new Error("กรุณาระบุเหตุผลที่บล็อกห้อง");

    setSubmitting(true);
    try {
      await axios.post(
        `${API_URL}/bookings/room-blocks`,
        { ...selection, reason },
        { withCredentials: true },
      );
      onChanged();
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  const release = async () => {
    if (!block || submitting) return;
    setSubmitting(true);
    try {
      await axios.patch(
        `${API_URL}/bookings/room-blocks/${block.blockId}/release`,
        {},
        { withCredentials: true },
      );
      onChanged();
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  const rangeText =
    from && to
      ? `${formatDisplayDate(from, dateFormat)} – ${formatDisplayDate(to, dateFormat)}`
      : "";
  const nights =
    from && to
      ? Math.max(
          1,
          Math.round(
            (new Date(to).getTime() - new Date(from).getTime()) / 86400000,
          ),
        )
      : 0;

  return (
    <div className="roomBlockModal addBooking__wrapper">
      <ModalCloseButton onClick={onClose} />
      <div className="roomBlockModal__header">
        <h1 className="addBooking__title">
          {isCreate ? "บล็อกห้อง" : "รายละเอียดการบล็อกห้อง"}
        </h1>
      </div>

      <section
        className="roomBlockModal__bookingCard"
        aria-label={`บล็อก ${roomNames} ช่วง ${rangeText}`}
      >
        <div className="roomBlockModal__roomRow">
          <div className="roomBlockModal__roomIdentity">
            <span className="roomBlockModal__roomIcon" aria-hidden="true">
              <i className="bx bx-bed" />
            </span>
            <span>
              <small>
                {roomIds.length > 1
                  ? `${roomIds.length} ห้อง / เตียง`
                  : "ห้อง / เตียง"}
              </small>
              <strong title={roomIds.join(", ")}>{roomNames}</strong>
            </span>
          </div>
          <span className="roomBlockModal__status">
            <i className="bx bx-block" aria-hidden="true" />
            {isCreate ? "ช่วงที่จะบล็อก" : "บล็อกอยู่"}
          </span>
        </div>

        <div className="roomBlockModal__dateJourney">
          <div className="roomBlockModal__datePoint">
            <span>เริ่มบล็อก</span>
            <strong>{formatDisplayDate(from, dateFormat)}</strong>
          </div>
          <div className="roomBlockModal__dateRail" aria-hidden="true">
            <span>{nights} คืน</span>
            <i className="bx bx-right-arrow-alt" />
          </div>
          <div className="roomBlockModal__datePoint roomBlockModal__datePoint--end">
            <span>เปิดให้จอง</span>
            <strong>{formatDisplayDate(to, dateFormat)}</strong>
          </div>
        </div>

        {!isCreate && block && (
          <div className="roomBlockModal__existingDetails">
            <div className="roomBlockModal__reasonNote">
              <i className="bx bx-message-square-detail" aria-hidden="true" />
              <span>
                <small>เหตุผล</small>
                <strong>{block.reason}</strong>
              </span>
            </div>
            <p className="roomBlockModal__auditLine">
              <i className="bx bx-time-five" aria-hidden="true" />
              บล็อกโดย <strong>{block.createdBy}</strong> ·{" "}
              {formatDisplayDateTime(block.createdAt, dateFormat)}
            </p>
          </div>
        )}
      </section>

      {isCreate && (
        <label className="roomBlockModal__reason">
          <span>เหตุผล (จำเป็น)</span>
          <Select<OptionType>
            autoFocus
            styles={customStyles<OptionType>()}
            classNamePrefix="rs"
            options={roomBlockReasonOptions}
            isDisabled={submitting}
            value={
              roomBlockReasonOptions.find(
                (option) => option.value === reasonOption,
              ) || null
            }
            onChange={(option: SingleValue<OptionType>) =>
              setReasonOption(
                (option?.value || "maintenance") as RoomBlockReasonOption,
              )
            }
          />
          {reasonOption === "other" && (
            <>
              <textarea
                className="boxInput"
                maxLength={500}
                value={customReason}
                disabled={submitting}
                style={{ marginTop: "1rem" }}
                placeholder="ระบุเหตุผล"
                onChange={(event) => setCustomReason(event.target.value)}
              />
              <small>{customReason.length}/500</small>
            </>
          )}
        </label>
      )}

      <div className="roomBlockModal__actions">
        {/* <ActionButton
          text="ยกเลิก"
          icon="bx-x"
          disabled={submitting}
          onClick={onClose}
        /> */}
        <ActionButton
          text={isCreate ? "บล็อกห้อง" : "เปิดให้จอง"}
          icon={isCreate ? "bx-block" : "bx-link-break"}
          disabled={submitting || (isCreate && !reason)}
          onClick={() =>
            toast.promise(isCreate ? create() : release(), {
              loading: isCreate ? "กำลังบล็อกห้อง..." : "กำลังเปิดห้อง...",
              success: isCreate ? "บล็อกห้องสำเร็จ" : "เปิดห้องให้จองแล้ว",
              error: (error) =>
                getApiErrorMessage(
                  error,
                  isCreate ? "ไม่สามารถบล็อกห้องได้" : "ไม่สามารถเปิดห้องได้",
                ),
            })
          }
        />
      </div>
    </div>
  );
};

export default RoomBlockModal;
