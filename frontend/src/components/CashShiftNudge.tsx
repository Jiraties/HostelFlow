import { useEffect, useState } from "react";
import axios from "axios";
import { useNavigate } from "react-router";
import { useAuth } from "../context/AuthContext";
import { API_URL } from "../config/api";
import type { CashPositionData } from "../types/cashShiftTypes";
import "./CashShiftNudge.css";

const CashShiftNudge = () => {
  const { user, resolveStaffName } = useAuth();
  const navigate = useNavigate();
  const [cashPosition, setCashPosition] = useState<CashPositionData | null>(
    null,
  );

  useEffect(() => {
    const controller = new AbortController();

    axios
      .get<CashPositionData>(`${API_URL}/finance/cash-position`, {
        signal: controller.signal,
        withCredentials: true,
      })
      .then((response) => setCashPosition(response.data))
      .catch((error) => {
        if (axios.isCancel(error) || error.name === "CanceledError") return;
        setCashPosition(null);
      });

    return () => controller.abort();
  }, []);

  if (!cashPosition) return null;

  const activeShift = cashPosition.activeShift;
  if (activeShift?.staffUsername === user?.username) return null;

  const staffName =
    activeShift?.staff?.name || resolveStaffName(activeShift?.staffUsername);
  const message = activeShift
    ? `กะเงินสดของ ${staffName} เปิดอยู่ หากรับเงินแทนกัน ควรจัดการรับส่งเงินก่อน`
    : "ยังไม่ได้เปิดกะเงินสดวันนี้ รายการนี้จะไม่ถูกผูกกับกะเงินสด";

  return (
    <aside className="cashShiftNudge" role="status">
      <i className="bx bx-message-bubble-exclamation" aria-hidden="true" />
      <p>{message}</p>
      <button type="button" onClick={() => navigate("/#cash-close")}>
        จัดการกะเงินสด
      </button>
    </aside>
  );
};

export default CashShiftNudge;
