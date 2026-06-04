import ActionButton from "./ActionButton";
import ModalCloseButton from "./ModalCloseButton";
import "./ConfirmationModal.css";
import type { booking } from "../types/bookingTypes";
import axios from "axios";
import toast from "react-hot-toast";
import { API_URL } from "../config/api";

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
  const handleRemoveBooking = async () => {
    if (!booking) {
      throw new Error("No booking selected");
    }

    try {
      await axios.delete(
        `${API_URL}/bookings/removeBooking/` + booking?.bookingId,
        {
          withCredentials: true,
        },
      );
      // toast.success("ลบการจองของ " + booking.name + " สำเร็จ");
      closeAllModals?.();
    } catch (err: unknown) {
      const message =
        axios.isAxiosError<{ error?: string }>(err) && err.response?.data.error
          ? err.response.data.error
          : "เกิดข้อผิดพลาดในการลบการจอง";

      throw new Error(message);
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
        คุณแน่ใจหรือไม่ว่าจะ<strong>ลบการจองของ</strong> <br />
        {booking?.name}?
      </>
    ));
  const resolvedDescription =
    description ||
    (isDiscardChanges
      ? "ถ้าออกตอนนี้ ข้อมูลที่กรอกไว้จะหายไป"
      : "การลบจะไม่สามารถนำคืนได้");
  const resolvedConfirmText =
    confirmText || (isDiscardChanges ? "ออกโดยไม่บันทึก" : "ลบ");
  const resolvedConfirmIcon =
    confirmIcon || (isDiscardChanges ? "bx-log-out" : "bx-trash");
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
          onClick={() =>
            toast.promise(confirmHandler(), {
              loading: `กำลังลบการจองของ ${booking?.name || ""}`,
              success: isDiscardChanges
                ? "ออกจากฟอร์มแล้ว"
                : "ลบการจองของ " + (booking?.name || "") + " สำเร็จ",
              error: (err) => {
                if (err.response?.status === 409) {
                  return err.response.data.message;
                }
                return isDiscardChanges
                  ? "ไม่สามารถออกจากฟอร์มได้"
                  : "เกิดข้อผิดพลาดในการลบการจอง";
              },
            })
          }
        />
      </div>
    </div>
  );
};

export default ConfirmationModal;
