import { useEffect, useState } from "react";
import axios from "axios";
import { API_URL } from "../../config/api";
import type { booking } from "../../types/bookingTypes";
import CorrectTransaction from "../bookings/CorrectTransaction";
import ModalCloseButton from "../../components/ModalCloseButton";

type Sale = {
  saleId: string;
  customerName: string;
  revision: number;
  createdAt: string;
  transactions: booking["transactions"];
};
export default function StandaloneSaleCorrection({
  saleId,
  transactionId,
  onClose,
}: {
  saleId: string;
  transactionId?: string;
  onClose: () => void;
}) {
  const [sale, setSale] = useState<Sale | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    axios
      .get(
        `${API_URL}/finance/standalone-sales/${encodeURIComponent(saleId)}`,
        { withCredentials: true },
      )
      .then(({ data }) => {
        if (active) setSale(data.sale);
      })
      .catch(() => {
        if (active) setError("โหลดรายการไม่สำเร็จ กรุณาปิดแล้วลองอีกครั้ง");
      });
    return () => {
      active = false;
    };
  }, [saleId]);
  const transaction = sale?.transactions.find(
    (t) => (t.originalTransactionId || t._id) === transactionId,
  );
  if (!sale || !transaction)
    return (
      <div className="addBooking__wrapper">
        <ModalCloseButton onClick={onClose} />
        <p role="status">
          {error || (sale ? "รายการนี้ต้องใช้ขั้นตอนเฉพาะ" : "กำลังโหลดรายการ...")}
        </p>
      </div>
    );
  return (
    <CorrectTransaction
      booking={
        {
          bookingId: sale.saleId,
          name: sale.customerName,
          revision: sale.revision,
          status: "checkedOut",
          checkIn: sale.createdAt,
        } as unknown as booking
      }
      transaction={transaction}
      sourceType="standaloneSale"
      onClose={onClose}
    />
  );
}
