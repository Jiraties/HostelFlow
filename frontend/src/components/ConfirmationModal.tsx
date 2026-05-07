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
}: {
  booking: booking | null;
  onClose?: () => void;
  closeAllModals: () => void;
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
      closeAllModals();
    } catch (err: unknown) {
      const message =
        axios.isAxiosError<{ error?: string }>(err) && err.response?.data.error
          ? err.response.data.error
          : "เกิดข้อผิดพลาดในการลบการจอง";

      throw new Error(message);
    }
  };

  return (
    <div className="confirmationModal">
      {onClose && <ModalCloseButton onClick={onClose} />}
      <div className="confirmationModal__text">
        <h1 className="confirmationModal__headerText">
          คุณแน่ใจหรือไม่ว่าจะ<strong>ลบการจองของ</strong> <br />
          {booking?.name}?
        </h1>
        <p>การลบจะไม่สามารถนำคืนได้</p>
      </div>
      <div className="confirmationModal__actions">
        <ActionButton
          text="ลบ"
          icon="bx-trash"
          highlight
          className="confirmationModal__button"
          onClick={() =>
            toast.promise(handleRemoveBooking(), {
              loading: `กำลังลบการจองของ ${booking?.name || ""}`,
              success: "ลบการจองของ " + (booking?.name || "") + " สำเร็จ",
              error: (err) => {
                if (err.response?.status === 409) {
                  return err.response.data.message;
                }
                return "เกิดข้อผิดพลาดในการลบการจอง";
              },
            })
          }
        />
      </div>
    </div>
  );
};

export default ConfirmationModal;
