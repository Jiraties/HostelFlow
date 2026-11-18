import { useState } from "react";
import axios from "axios";
import toast from "react-hot-toast";
import { API_URL } from "../../config/api";
import { getApiErrorMessage } from "../../helpers/apiErrorMessage";
import ActionButton from "../../components/ActionButton";
export type UnassignedCorrection = {
  _id: string;
  sourceType: string;
  sourceId: string;
  note: string;
  before: { amount: number; paymentMethod: string };
  after: { amount: number; paymentMethod: string };
  reconciliation?: { note: string; reviewedBy: string };
};
export default function UnassignedCorrectionAudits({
  items,
}: {
  items: UnassignedCorrection[];
}) {
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [resolved, setResolved] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const resolve = async (item: UnassignedCorrection) => {
    const note = notes[item._id]?.trim();
    if (!note) {
      toast.error("กรุณาระบุผลตรวจสอบและอธิบายยอดต่าง");
      return;
    }
    setBusy(item._id);
    try {
      await axios.post(
        `${API_URL}/finance/corrections/${item.sourceType}/${encodeURIComponent(item.sourceId)}/${item._id}/reconcile`,
        { note },
        { withCredentials: true },
      );
      setResolved((current) => ({ ...current, [item._id]: note }));
    } catch (error) {
      toast.error(getApiErrorMessage(error, "บันทึกผลตรวจสอบไม่สำเร็จ"));
    } finally {
      setBusy(null);
    }
  };
  if (!items.length) return null;
  return (
    <section className="manage__financePanel manage__unassignedAudit">
      <h3>รายการแก้ไขหลังปิดวันที่ไม่มีการผูกกะเงินสด</h3>
      <p>ตรวจสอบรายการและอธิบายยอดต่าง การรับทราบไม่เพิ่มหรือลดเงินสด</p>
      {items.map((item) => (
        <article key={item._id} className="manage__unassignedAuditItem">
          <strong>{item.sourceId}</strong>
          <p>
            {item.before.amount} {item.before.paymentMethod} →{" "}
            {item.after.amount} {item.after.paymentMethod}
          </p>
          <p>{item.note}</p>
          {item.reconciliation || resolved[item._id] ? (
            <p>ตรวจสอบแล้ว: {item.reconciliation?.note || resolved[item._id]}</p>
          ) : (
            <>
              <label>
                <span className="addBooking__label">
                  ผลตรวจสอบและคำอธิบายยอดต่าง
                </span>
                <textarea
                  className="boxInput"
                  maxLength={500}
                  value={notes[item._id] || ""}
                  onChange={(event) =>
                    setNotes((current) => ({
                      ...current,
                      [item._id]: event.target.value,
                    }))
                  }
                />
              </label>
              <ActionButton
                text={busy === item._id ? "กำลังบันทึก" : "บันทึกผลตรวจสอบ"}
                icon="bx-check"
                disabled={busy !== null}
                className="manage__unassignedAuditAction"
                onClick={() => void resolve(item)}
              />
            </>
          )}
        </article>
      ))}
    </section>
  );
}
