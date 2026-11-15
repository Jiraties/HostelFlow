import { Link } from "react-router";
import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { API_URL } from "../../config/api";
import { notifyReviewQueueUpdated } from "../../helpers/reviewQueue";
import type { booking } from "../../types/bookingTypes";
import CorrectTransaction from "../bookings/CorrectTransaction";
import Modal from "../../components/MotionModal";

type RequestItem = {
  _id: string;
  sourceType: "booking" | "standaloneSale";
  sourceId: string;
  transactionId: string;
  sourceLabel: string;
  expectedRevision: number;
  requestedBy: string;
  requestedAt: string;
  status: string;
  decisionReason?: string;
  proposal: {
    before: booking["transactions"][number];
    after: booking["transactions"][number];
    note: string;
    correctionType: "recorded_mistake" | "charge_change";
    reasonCode: string;
    historical?: boolean;
  };
};
const labels: Record<string, string> = {
  pending: "รออนุมัติ",
  approved: "อนุมัติแล้ว",
  rejected: "ไม่อนุมัติ",
  withdrawn: "ถอนคำขอแล้ว",
  stale: "ข้อมูลเปลี่ยน กรุณาส่งใหม่",
};
export default function CorrectionRequests({
  sourceId,
  admin = false,
}: {
  sourceId?: string;
  admin?: boolean;
}) {
  const [items, setItems] = useState<RequestItem[]>([]);
  const [selected, setSelected] = useState<RequestItem | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    try {
      const { data } = await axios.get(
        `${API_URL}/finance/correction-requests`,
        {
          params: { sourceId, status: sourceId ? undefined : "pending" },
          withCredentials: true,
        },
      );
      setItems(data.requests);
      setError("");
    } catch {
      setError("โหลดคำขอไม่สำเร็จ กรุณาลองอีกครั้ง");
    } finally {
      setLoading(false);
    }
  }, [sourceId]);
  useEffect(() => {
    const refresh = () => {
      void load();
    };
    const timer = window.setTimeout(refresh, 0);
    window.addEventListener("hostelflow:review-queue-updated", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("hostelflow:review-queue-updated", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [load]);
  const decide = async (action: string, reason?: string) => {
    if (!selected) return;
    await axios.post(
      `${API_URL}/finance/correction-requests/${selected._id}/${action}`,
      { reason },
      {
        withCredentials: true,
        headers: { "Idempotency-Key": crypto.randomUUID() },
      },
    );
    setSelected(null);
    await load();
    notifyReviewQueueUpdated();
  };
  return (
    <section className="manage__financePanel" aria-label="คำขอแก้ไขรายการ">
      <div className="manage__financePanelHeader">
        <h3>{sourceId ? "คำขอแก้ไขรายการ" : "คำขอรออนุมัติ · ทุกวันที่"}</h3>
        <span>{items.length}</span>
      </div>
      {error && (
        <p role="alert">
          {error} <button onClick={() => void load()}>ลองอีกครั้ง</button>
        </p>
      )}
      {loading && <p role="status">กำลังโหลดคำขอ...</p>}
      {!loading && !items.length && !error && <p>ไม่มีคำขอ</p>}
      {items.map((item) => (
        <div key={item._id} className="manage__reviewItem">
          <div className="manage__reviewMain">
            <strong>
              {item.sourceLabel} · {item.sourceId}
            </strong>
            <p>
              {item.proposal.before.type} · {item.proposal.before.amount} →{" "}
              {item.proposal.after.amount} ฿ · {labels[item.status]}
            </p>
            <p>
              {item.requestedBy} ·{" "}
              {new Date(item.requestedAt).toLocaleString("th-TH", {
                timeZone: "Asia/Bangkok",
              })}
            </p>
            {item.sourceType === "booking" && (
              <Link
                to={`/master?bookingId=${encodeURIComponent(item.sourceId)}`}
              >
                เปิด Booking
              </Link>
            )}
            <p>{item.proposal.note}</p>
            {item.decisionReason && <p>{item.decisionReason}</p>}
          </div>
          <button
            type="button"
            className="manage__approveAction"
            onClick={() => setSelected(item)}
          >
            ดูคำขอ
          </button>
        </div>
      ))}
      <Modal
        open={!!selected}
        className="home__modalCenter"
        onClose={() => setSelected(null)}
      >
        <>
          {selected && (
            <CorrectTransaction
              booking={
                {
                  bookingId: selected.sourceId,
                  name: selected.sourceLabel,
                  revision: selected.expectedRevision,
                  status: "checkedOut",
                  checkIn: selected.requestedAt,
                } as unknown as booking
              }
              transaction={{
                ...selected.proposal.before,
                _id: selected.transactionId,
              }}
              sourceType={selected.sourceType}
              review={{
                after: selected.proposal.after,
                note: selected.proposal.note,
                status: selected.status,
                admin,
                onDecide: decide,
              }}
              onClose={() => setSelected(null)}
            />
          )}
        </>
      </Modal>
    </section>
  );
}
