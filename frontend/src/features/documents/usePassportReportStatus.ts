import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { API_URL } from "../../config/api";
import { getApiErrorMessage } from "../../helpers/apiErrorMessage";
import { isPassportReportStatus, type PassportReadiness, type PassportReportStatus } from "./documentReports";

type Result = {
  key: string;
  data: PassportReportStatus | null;
  error: string | null;
  updatedAt: Date | null;
};

export const usePassportReportStatus = (endpoint: string, date: string) => {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const pendingRef = useRef<{ key: string; promise: Promise<void>; resolve: () => void; reject: (error: Error) => void } | null>(null);
  const key = `${date}:${attempt}`;

  useEffect(() => {
    if (!date) return;
    let active = true;
    const controller = new AbortController();
    axios.get<unknown>(`${API_URL}/documents/${endpoint}`, {
      params: { date }, withCredentials: true, signal: controller.signal,
    }).then(({ data }) => {
      if (!active) return;
      if (!isPassportReportStatus(data)) throw new Error("ข้อมูลสถานะรายงานไม่สมบูรณ์ กรุณาลองใหม่");
      setResult({ key, data, error: null, updatedAt: new Date() });
      if (pendingRef.current?.key === key) {
        pendingRef.current.resolve();
        pendingRef.current = null;
      }
    }).catch((error: unknown) => {
      if (!active || axios.isCancel(error)) return;
      const message = getApiErrorMessage(error, "ไม่สามารถตรวจสอบข้อมูล Passport ได้ กรุณาลองใหม่");
      setResult({ key, data: null, error: message, updatedAt: null });
      if (pendingRef.current?.key === key) {
        pendingRef.current.reject(new Error(message));
        pendingRef.current = null;
      }
    });
    return () => {
      active = false;
      controller.abort();
      if (pendingRef.current?.key === key) {
        pendingRef.current.resolve();
        pendingRef.current = null;
      }
    };
  }, [date, endpoint, key]);

  useEffect(() => () => {
    pendingRef.current?.resolve();
    pendingRef.current = null;
  }, []);

  const refresh = () => {
    if (!date) return Promise.resolve();
    // Repeated refreshes wait for the same result.
    if (pendingRef.current) return pendingRef.current.promise;
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
    pendingRef.current = { key: `${date}:${attempt + 1}`, promise, resolve, reject };
    setAttempt((previous) => previous + 1);
    return promise;
  };
  const current = result?.key === key;
  const readiness: PassportReadiness = {
    data: current ? result.data : null,
    loading: Boolean(date) && !current,
    error: !date ? "กรุณาเลือกวันที่รายงาน" : current ? result.error : null,
    updatedAt: current ? result.updatedAt : null,
  };
  return { ...readiness, refresh };
};
