import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { API_URL } from "../../config/api";
import { notifyReviewQueueUpdated } from "../../helpers/reviewQueue";
import type { booking } from "../../types/bookingTypes";

export type RequestItem = {
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
export const correctionRequestLabels: Record<string, string> = {
  pending: "รออนุมัติ",
  approved: "อนุมัติแล้ว",
  rejected: "ไม่อนุมัติ",
  withdrawn: "ถอนคำขอแล้ว",
  stale: "ข้อมูลเปลี่ยน กรุณาส่งใหม่",
};
const noRequests: RequestItem[] = [];

export const useCorrectionRequests = (
  sourceId?: string | null,
  revision?: number,
) => {
  const [result, setResult] = useState<{
    sourceId: string | undefined;
    items: RequestItem[];
  }>();
  const [selection, setSelected] = useState<RequestItem | null>(null);
  const selected =
    sourceId === undefined || selection?.sourceId === sourceId
      ? selection
      : null;
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const reload = useCallback(() => notifyReviewQueueUpdated(), []);
  const load = useCallback(async (signal?: AbortSignal) => {
    if (sourceId === null) return;
    try {
      const { data } = await axios.get(
        `${API_URL}/finance/correction-requests`,
        {
          params: sourceId
            ? { sourceId, sourceType: "booking" }
            : { status: "pending" },
          signal,
          withCredentials: true,
        },
      );
      if (signal?.aborted) return;
      setResult({ sourceId, items: data.requests });
      setError("");
    } catch {
      if (signal?.aborted) return;
      setError("โหลดคำขอไม่สำเร็จ กรุณาลองอีกครั้ง");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [sourceId]);
  useEffect(() => {
    if (sourceId === null) return;
    let controller: AbortController | undefined;
    const refresh = () => {
      controller?.abort();
      controller = new AbortController();
      void load(controller.signal);
    };
    const timer = window.setTimeout(refresh, 0);
    window.addEventListener("hostelflow:review-queue-updated", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      controller?.abort();
      window.clearTimeout(timer);
      window.removeEventListener("hostelflow:review-queue-updated", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [load, sourceId, revision]);
  const decide = async (
    action: string,
    reason?: string,
    onBookingUpdated?: (updatedBooking: booking) => void,
  ) => {
    if (!selected) return;
    const { data } = await axios.post<{ booking?: booking }>(
      `${API_URL}/finance/correction-requests/${selected._id}/${action}`,
      { reason },
      {
        withCredentials: true,
        headers: { "Idempotency-Key": crypto.randomUUID() },
      },
    );
    setSelected(null);
    reload();
    if (data.booking) onBookingUpdated?.(data.booking);
  };
  return {
    items: result && result.sourceId === sourceId ? result.items : noRequests,
    selected,
    setSelected,
    error,
    loading,
    reload,
    decide,
  };
};
