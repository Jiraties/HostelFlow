import { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import { API_URL } from "../config/api";
import { getApiErrorMessage } from "../helpers/apiErrorMessage";
import type { AnalyticsResponse } from "../types/analytics";

export const useAnalytics = (month: string, enabled: boolean) => {
  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState("");
  const activeRequest = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    setLoading(true);
    setError("");
    try {
      const response = await axios.get<AnalyticsResponse>(`${API_URL}/bookings/analytics`, {
        params: { month }, withCredentials: true, signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setData(response.data);
    } catch (cause) {
      if (controller.signal.aborted) return;
      setError(getApiErrorMessage(cause, "ไม่สามารถโหลดข้อมูล Analytics ได้"));
      throw cause;
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [enabled, month]);

  useEffect(() => {
    void refresh().catch(() => {});
    return () => activeRequest.current?.abort();
  }, [refresh]);

  return { data: enabled && data?.month === month ? data : null, loading: enabled && loading, error, refresh };
};
