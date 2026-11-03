import { useRef, useState } from "react";
import axios from "axios";
import toast from "react-hot-toast";
import { API_URL } from "../../config/api";
import { getApiErrorMessage } from "../../helpers/apiErrorMessage";
import { withDocumentExportLock } from "./documentReports";

type ExportRequest = {
  key: string;
  endpoint: string;
  params: Record<string, string>;
  filename: string;
  successMessage: string;
  failureMessage: string;
  confirm?: () => boolean;
};

const exportErrorMessage = async (error: unknown, fallback: string) => {
  if (axios.isAxiosError(error) && error.response?.data instanceof Blob) {
    try {
      const data = JSON.parse(await error.response.data.text());
      return getApiErrorMessage({ response: { data } }, fallback);
    } catch { return fallback; }
  }
  return getApiErrorMessage(error, fallback);
};

export const useDocumentExport = () => {
  const locks = useRef(new Set<string>());
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string | null>>({});

  const download = (request: ExportRequest) => withDocumentExportLock(locks.current, request.key, async () => {
    if (request.confirm && !request.confirm()) return;
    setBusy((previous) => ({ ...previous, [request.key]: true }));
    setErrors((previous) => ({ ...previous, [request.key]: null }));
    try {
      const response = await axios.get<Blob>(`${API_URL}/documents/${request.endpoint}`, {
        params: request.params, responseType: "blob", withCredentials: true,
      });
      const url = URL.createObjectURL(response.data);
      const link = document.createElement("a");
      try {
        link.href = url;
        link.download = request.filename;
        document.body.appendChild(link);
        link.click();
      } finally {
        link.remove();
        URL.revokeObjectURL(url);
      }
      toast.success(request.successMessage);
    } catch (error) {
      const message = await exportErrorMessage(error, request.failureMessage);
      setErrors((previous) => ({ ...previous, [request.key]: message }));
      toast.error(message);
    } finally {
      setBusy((previous) => ({ ...previous, [request.key]: false }));
    }
  });

  const clearError = (key: string) => setErrors((previous) => ({ ...previous, [key]: null }));
  return { busy, errors, download, clearError };
};
