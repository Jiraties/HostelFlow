import { useEffect, useState } from "react";
import axios from "axios";
import toast from "react-hot-toast";
import ActionButton from "../../components/ActionButton";
import ModalCloseButton from "../../components/ModalCloseButton";
import { API_URL } from "../../config/api";
import type { StatusCorrectionType } from "../../helpers/statusCorrectionHelpers";
import type { booking } from "../../types/bookingTypes";
import "./CorrectCheckIn.css";
import "./ResolveBooking.css";
import "./CorrectBookingStatus.css";

type DepositDecision =
  | "not_applicable"
  | "not_actually_returned"
  | "already_returned";

type Preview = {
  eligible: boolean;
  booking: {
    bookingId: string;
    name: string;
    currentStatus: string;
    restoredStatus: string;
    originalActionActor: string;
    originalActionAt: string;
  };
  roomEffect: {
    assignments: Array<{ roomIds: string[]; from: string; to: string }>;
    message: string;
  };
  financialEffect: {
    depositReturnAmount: number;
    depositDecisionRequired: boolean;
    message: string;
  };
  ota: { requiresManualFollowUp: boolean; message: string };
  blockers: Array<{ code: string; message: string }>;
  warnings: Array<{ code: string; message: string }>;
};

type CorrectionError = {
  message?: string;
  preview?: Preview;
};

const labels: Record<StatusCorrectionType, { title: string; primary: string }> =
  {
    UNDO_CHECKOUT: {
      title: "Undo Checkout ที่บันทึกผิด",
      primary: "Undo checkout",
    },
    UNDO_CANCELLATION: {
      title: "Undo การยกเลิกที่บันทึกผิด",
      primary: "Undo cancellation",
    },
    UNDO_NO_SHOW: {
      title: "Undo No-Show ที่บันทึกผิด",
      primary: "Undo no-show",
    },
  };

const statusLabels: Record<string, string> = {
  booked: "Booked",
  checkedIn: "Checked in",
  checkedOut: "Checked out",
  cancelled: "Cancelled",
  noShow: "No-show",
};

const CorrectBookingStatus = ({
  booking: currentBooking,
  correctionType,
  onClose,
  onUpdated,
  onDirtyChange,
}: {
  booking: booking;
  correctionType: StatusCorrectionType;
  onClose: () => void;
  onUpdated: (booking: booking) => void;
  onDirtyChange?: (dirty: boolean) => void;
}) => {
  const depositAmount =
    correctionType === "UNDO_CHECKOUT"
      ? Number(currentBooking.checkout?.depositRefundAmount || 0)
      : 0;
  const [reason, setReason] = useState("");
  const [depositDecision, setDepositDecision] =
    useState<DepositDecision>("not_applicable");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewing, setPreviewing] = useState(true);
  const [previewError, setPreviewError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const copy = labels[correctionType];

  useEffect(() => {
    onDirtyChange?.(Boolean(reason || depositDecision !== "not_applicable"));
    return () => onDirtyChange?.(false);
  }, [depositDecision, onDirtyChange, reason]);

  useEffect(() => {
    const controller = new AbortController();

    axios
      .post<Preview>(
        `${API_URL}/bookings/${currentBooking.bookingId}/status-corrections/preview`,
        {
          expectedRevision: currentBooking.revision,
          correctionType,
          reason: "",
          depositDecision,
        },
        {
          withCredentials: true,
          signal: controller.signal,
          headers: { "Idempotency-Key": idempotencyKey },
        },
      )
      .then((response) => {
        setPreview(response.data);
        setPreviewError("");
      })
      .catch((error: unknown) => {
        if (axios.isCancel(error)) return;
        setPreview(null);
        setPreviewError(
          axios.isAxiosError<CorrectionError>(error)
            ? error.response?.data.message ||
                "ไม่สามารถตรวจสอบผลการแก้ไขได้"
            : "ไม่สามารถตรวจสอบผลการแก้ไขได้",
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setPreviewing(false);
      });

    return () => controller.abort();
  }, [
    correctionType,
    currentBooking.bookingId,
    currentBooking.revision,
    depositDecision,
    idempotencyKey,
  ]);

  const payload = {
    expectedRevision: currentBooking.revision,
    correctionType,
    reason: reason.trim(),
    depositDecision,
  };
  const requestConfig = {
    withCredentials: true,
    headers: { "Idempotency-Key": idempotencyKey },
  };

  const getError = (error: unknown) => {
    if (!axios.isAxiosError<CorrectionError>(error)) {
      return "ไม่สามารถแก้ไขสถานะได้";
    }
    return (
      error.response?.data.preview?.blockers?.[0]?.message ||
      error.response?.data.message ||
      "ไม่สามารถแก้ไขสถานะได้"
    );
  };

  const submit = async () => {
    if (!reason.trim()) {
      throw new Error("กรุณาระบุเหตุผลที่แก้ไข");
    }
    if (depositAmount > 0 && depositDecision === "not_applicable") {
      throw new Error("กรุณาระบุว่าได้คืนมัดจำให้แขกจริงแล้วหรือไม่");
    }
    if (!preview?.eligible) {
      throw new Error(
        preview?.blockers[0]?.message ||
          previewError ||
          "ยังไม่สามารถแก้ไขสถานะนี้ได้",
      );
    }
    setSubmitting(true);
    try {
      const response = await axios.post<{
        booking: booking;
        warnings?: Array<{ message: string }>;
      }>(
        `${API_URL}/bookings/${currentBooking.bookingId}/status-corrections`,
        payload,
        requestConfig,
      );
      onUpdated(response.data.booking);
      response.data.warnings?.forEach((warning) =>
        toast(warning.message, { icon: "⚠️" }),
      );
      onClose();
    } catch (error) {
      throw new Error(getError(error));
    } finally {
      setSubmitting(false);
    }
  };

  const visibleBlockers =
    preview?.blockers.filter(
      (blocker) => blocker.code !== "DEPOSIT_DECISION_REQUIRED",
    ) || [];
  const hasBlockingPreviewIssue =
    Boolean(previewError) || visibleBlockers.length > 0;

  return (
    <div className="correctCheckIn correctBookingStatus">
      <ModalCloseButton onClick={onClose} />
      <header>
        <h1 className="addBooking__title">{copy.title}</h1>
      </header>

      {depositAmount > 0 && (
        <fieldset className="correctBookingStatus__deposit">
          <legend>เงินมัดจำ ฿{depositAmount} ถูกคืนให้แขกจริงหรือไม่</legend>
          <label>
            <input
              type="radio"
              name="deposit-decision"
              checked={depositDecision === "not_actually_returned"}
              onChange={() => {
                setDepositDecision("not_actually_returned");
                setPreview(null);
                setPreviewing(true);
              }}
            />
            <span>
              <span>ยังไม่ได้คืนมัดจำจริง</span>
              <small>
                ชดเชยเฉพาะรายการคืนเงินที่บันทึกผิด โดยเก็บประวัติเดิมไว้
              </small>
            </span>
          </label>
          <label>
            <input
              type="radio"
              name="deposit-decision"
              checked={depositDecision === "already_returned"}
              onChange={() => {
                setDepositDecision("already_returned");
                setPreview(null);
                setPreviewing(true);
              }}
            />
            <span>
              <span>คืนมัดจำให้แขกแล้ว</span>
              <small>
                คงรายการคืนเงินไว้ หากต้องรับมัดจำใหม่ให้ใช้ขั้นตอนรับมัดจำปกติ
              </small>
            </span>
          </label>
        </fieldset>
      )}

      <div className="correctBookingStatus__reason">
        <label htmlFor="status-correction-reason">
          เหตุผลที่แก้ไข <span aria-hidden="true">*</span>
        </label>
        <textarea
          id="status-correction-reason"
          className="boxInput"
          value={reason}
          maxLength={500}
          onChange={(event) => {
            setReason(event.target.value);
          }}
          placeholder="เช่น เลือก Booking ผิดรายการ"
        />
      </div>

      <section
        className="resolveBooking__summary correctBookingStatus__summary"
        aria-live="polite"
      >
        <p className="addBooking__label">หลังบันทึก</p>
        <ul>
          <li>
            <i className="bx bx-user" aria-hidden="true" />
            {currentBooking.bookingId} · {currentBooking.name}
          </li>
          <li>
            <i className="bx bx-check-circle" aria-hidden="true" />
            สถานะเปลี่ยนจาก {statusLabels[currentBooking.status]} เป็น{" "}
            <strong>
              {
                statusLabels[
                  correctionType === "UNDO_CHECKOUT"
                    ? "checkedIn"
                    : "booked"
                ]
              }
            </strong>
          </li>
          <li>
            <i className="bx bx-bed" aria-hidden="true" />
            {previewing
              ? "กำลังตรวจสอบห้อง / เตียง..."
              : preview?.roomEffect.message || "ไม่พบผลต่อห้อง / เตียง"}
          </li>
          <li>
            <i className="bx bx-wallet" aria-hidden="true" />
            {previewing
              ? "กำลังตรวจสอบเงิน / มัดจำ..."
              : preview?.financialEffect.message || "ไม่มีผลทางการเงิน"}
          </li>
        </ul>
        {previewError ? (
          <div className="correctBookingStatus__blockers">
            <p>{previewError}</p>
          </div>
        ) : null}
        {visibleBlockers.length ? (
          <div className="correctBookingStatus__blockers">
            {visibleBlockers.map((blocker) => (
              <p key={blocker.code}>{blocker.message}</p>
            ))}
          </div>
        ) : null}
        {preview?.warnings.map((warning) => (
          <p className="correctBookingStatus__warning" key={warning.code}>
            <i className="bx bx-error-circle" /> {warning.message}
          </p>
        ))}
      </section>

      <div className="correctBookingStatus__actions">
        <ActionButton
          text={copy.primary}
          icon="bx-undo"
          highlight
          disabled={
            previewing ||
            submitting ||
            !preview ||
            hasBlockingPreviewIssue
          }
          onClick={() =>
            toast.promise(submit(), {
              loading: "กำลังบันทึก...",
              success: "แก้ไขสถานะสำเร็จ",
              error: (error) => error.message,
            })
          }
        />
      </div>
    </div>
  );
};

export default CorrectBookingStatus;
