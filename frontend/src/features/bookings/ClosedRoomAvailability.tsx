import { useEffect, useState } from "react";
import axios from "axios";
import toast from "react-hot-toast";
import ActionButton from "../../components/ActionButton";
import ModalCloseButton from "../../components/ModalCloseButton";
import { API_URL } from "../../config/api";
import { formatBookingDates } from "../../helpers/bookingHelpers";
import type { booking } from "../../types/bookingTypes";
import "./Cancellation.css";
import "./ResolveBooking.css";

type RoomReleaseStatus = "released" | "blocked";

const currentRoomStatus = (booking: booking): RoomReleaseStatus =>
  booking.resolution?.roomReleaseStatus ||
  booking.checkout?.roomReleaseStatus ||
  booking.cancellation?.roomReleaseStatus ||
  "released";

const ClosedRoomAvailability = ({
  booking,
  onClose,
  onUpdated,
  onDirtyChange,
}: {
  booking: booking;
  onClose: () => void;
  onUpdated: (booking: booking) => void;
  onDirtyChange?: (dirty: boolean) => void;
}) => {
  const current = currentRoomStatus(booking);
  const [target, setTarget] = useState<RoomReleaseStatus>(
    current === "released" ? "blocked" : "released",
  );
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  useEffect(() => {
    onDirtyChange?.(Boolean(reason || target === current));
    return () => onDirtyChange?.(false);
  }, [current, onDirtyChange, reason, target]);

  const submit = async () => {
    if (!reason.trim()) throw new Error("กรุณาระบุเหตุผล");
    setSubmitting(true);
    try {
      const response = await axios.patch(
        `${API_URL}/bookings/${booking.bookingId}/closed-room-availability`,
        {
          expectedRevision: booking.revision,
          roomReleaseStatus: target,
          reason: reason.trim(),
        },
        {
          withCredentials: true,
          headers: { "Idempotency-Key": idempotencyKey },
        },
      );
      onUpdated(formatBookingDates(response.data.booking));
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="addBooking__wrapper resolveBooking__wrapper resolveBooking__wrapper--compact">
      <ModalCloseButton onClick={onClose} />
      <div className="resolveBooking__header">
        <h1 className="addBooking__title">แก้ไขการเปิดห้องหลังปิด Booking</h1>
        <p className="resolveBooking__intro">
          สถานะ Booking และข้อมูลการปิดเดิมจะไม่เปลี่ยน
        </p>
      </div>
      <section className="resolveBooking__section">
        <p className="addBooking__label">สถานะปัจจุบัน</p>
        <strong>{current === "released" ? "เปิดให้จอง" : "กันห้องไว้"}</strong>
      </section>
      <section className="resolveBooking__section">
        <p className="addBooking__label">เปลี่ยนเป็น</p>
        <div className="cancellation__segmentedControl">
          <button
            type="button"
            className={`cancellation__segment${target === "released" ? " cancellation__segment--active" : ""}`}
            onClick={() => setTarget("released")}
          >
            เปิดให้จอง
          </button>
          <button
            type="button"
            className={`cancellation__segment${target === "blocked" ? " cancellation__segment--active" : ""}`}
            onClick={() => setTarget("blocked")}
          >
            กันห้องไว้
          </button>
        </div>
      </section>
      <section className="resolveBooking__section">
        <p className="addBooking__label">เหตุผล (จำเป็น)</p>
        <textarea
          className="boxInput"
          maxLength={500}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </section>
      <div className="resolveBooking__actions">
        <ActionButton text="ยกเลิก" icon="bx-x" onClick={onClose} />
        <ActionButton
          text="บันทึก"
          icon="bx-save"
          highlight
          disabled={submitting || target === current}
          onClick={() =>
            toast.promise(submit(), {
              loading: "กำลังบันทึก...",
              success: "แก้ไขการเปิดห้องสำเร็จ",
              error: (error) =>
                error.response?.data?.message ||
                error.message ||
                "ไม่สามารถแก้ไขการเปิดห้องได้",
            })
          }
        />
      </div>
    </div>
  );
};

export default ClosedRoomAvailability;
