import ActionButton from "./ActionButton";
import "./ConfirmationModal.css";
import type { booking } from "../types/bookingTypes";
import axios from "axios";
import toast from "react-hot-toast";
import { API_URL } from "../config/api";

const ConfirmationModal = ({
  booking,
  closeAllModals,
}: {
  booking: booking | null;
  closeAllModals: () => void;
}) => {
  const handleRemoveBooking = async () => {
    if (!booking) {
      toast.error("No booking selected");
      return;
    }

    try {
      await axios.delete(
        `${API_URL}/bookings/removeBooking/` + booking?.bookingId,
        {
          withCredentials: true,
        },
      );
      toast.success("ลบการจองของ " + booking.name + " สำเร็จ");
      closeAllModals();
    } catch (err: any) {
      toast.error(err.response.data.error);
    }
  };

  return (
    <div className="confirmationModal">
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
          onClick={handleRemoveBooking}
        />
      </div>
    </div>
  );
};

export default ConfirmationModal;
