import ActionButton from "./ActionButton";
import ModalCloseButton from "./ModalCloseButton";
import "./ConfirmationModal.css";
import type { booking } from "../types/bookingTypes";
import axios from "axios";
import toast from "react-hot-toast";
import { API_URL } from "../config/api";
import { useState } from "react";

const ConfirmationModal = ({
  booking,
  onClose,
  closeAllModals,
  variant = "deleteBooking",
  title,
  description,
  confirmText,
  confirmIcon,
  onConfirm,
}: {
  booking?: booking | null;
  onClose?: () => void;
  closeAllModals?: () => void;
  variant?: "deleteBooking" | "discardChanges";
  title?: React.ReactNode;
  description?: string;
  confirmText?: string;
  confirmIcon?: string;
  onConfirm?: () => void;
}) => {
  const [submitting, setSubmitting] = useState(false);
  const [voidReason, setVoidReason] = useState("");

  const handleRemoveBooking = async () => {
    if (submitting) return;
    if (!booking) {
      throw new Error("ไม่พบการจองที่ต้องการ void");
    }
    if (!voidReason.trim()) {
      throw new Error("กรุณาระบุเหตุผลที่ void การจอง");
    }

    setSubmitting(true);
    try {
      await axios.delete(
        `${API_URL}/bookings/removeBooking/` + booking?.bookingId,
        {
          withCredentials: true,
          data: {
            reason: voidReason.trim(),
            expectedRevision: booking.revision,
          },
        },
      );
      // toast.success("ลบการจองของ " + booking.name + " สำเร็จ");
      closeAllModals?.();
    } catch (err: unknown) {
      const message = axios.isAxiosError<{
        error?: string;
        message?: string;
      }>(err)
        ? err.response?.data.message ||
          err.response?.data.error ||
          "เกิดข้อผิดพลาดในการ void การจอง"
        : "เกิดข้อผิดพลาดในการ void การจอง";

      throw new Error(message);
    } finally {
      setSubmitting(false);
    }
  };

  const isDiscardChanges = variant === "discardChanges";
  const resolvedTitle =
    title ||
    (isDiscardChanges ? (
      <>
        คุณแน่ใจหรือไม่ว่าจะออก มีข้อมูลที่<strong>ยังไม่ได้บันทึก</strong>
      </>
    ) : (
      <>
        คุณแน่ใจหรือไม่ว่าจะ<strong>void การจองของ</strong> <br />
        {booking?.name}?
      </>
    ));
  const resolvedDescription =
    description ||
    (isDiscardChanges
      ? "ถ้าออกตอนนี้ ข้อมูลที่กรอกไว้จะหายไป"
      : "รายการและประวัติการเงินจะถูกเก็บไว้ แต่ห้องจะถูกปล่อยออกจากปฏิทิน");
  const resolvedConfirmText =
    confirmText || (isDiscardChanges ? "ออกโดยไม่บันทึก" : "Void การจอง");
  const resolvedConfirmIcon =
    confirmIcon || (isDiscardChanges ? "bx-arrow-out-right-square-half" : "bx-trash");
  const confirmHandler = isDiscardChanges
    ? async () => {
        onConfirm?.();
      }
    : handleRemoveBooking;

  return (
    <div className="confirmationModal">
      {onClose && <ModalCloseButton onClick={onClose} />}
      <div className="confirmationModal__text">
        <h1 className="confirmationModal__headerText">{resolvedTitle}</h1>
        <p>{resolvedDescription}</p>
      </div>
      {!isDiscardChanges && (
        <label className="confirmationModal__reasonLabel">
          เหตุผลที่ void
          <textarea
            className="confirmationModal__reason"
            value={voidReason}
            onChange={(event) => setVoidReason(event.target.value)}
            placeholder="ระบุเหตุผลเพื่อเก็บในประวัติการตรวจสอบ"
            disabled={submitting}
          />
        </label>
      )}
      <div className="confirmationModal__actions">
        <ActionButton
          text={resolvedConfirmText}
          icon={resolvedConfirmIcon}
          highlight={!isDiscardChanges}
          className={
            "confirmationModal__button" +
            (isDiscardChanges
              ? " confirmationModal__button--destructiveOutline"
              : "")
          }
          disabled={submitting}
          onClick={() =>
            toast.promise(confirmHandler(), {
              loading: isDiscardChanges
                ? "กำลังออกจากฟอร์ม..."
                : `กำลัง void การจองของ ${booking?.name || ""}`,
              success: isDiscardChanges
                ? "ออกจากฟอร์มแล้ว"
                : "void การจองของ " + (booking?.name || "") + " สำเร็จ",
              error: (err) => {
                if (err instanceof Error) return err.message;
                return isDiscardChanges
                  ? "ไม่สามารถออกจากฟอร์มได้"
                  : "เกิดข้อผิดพลาดในการ void การจอง";
              },
            })
          }
        />
      </div>
    </div>
  );
};

export default ConfirmationModal;
