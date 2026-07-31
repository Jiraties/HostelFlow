import axios from "axios";
import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";

import ActionButton from "../../components/ActionButton";
import ModalCloseButton from "../../components/ModalCloseButton";
import { API_URL } from "../../config/api";
import { formatDisplayDate } from "../../helpers/displayDate";
import {
  celebrateFinalDayClose,
  type CelebrationOrigin,
} from "../../helpers/celebrateFinalDayClose";
import type { DepositReturnReminder } from "../../types/cashShiftTypes";
import type { DateFormatPreference } from "../../types/userSettings";
import { DepositReminderGuestList } from "./DepositReminderGuestList";
import { OverdueDepositCategory } from "./OverdueDepositCategory";

import "../bookings/ResolveBooking.css";
import "./DepositReturnReminderModal.css";

type DepositReturnReminderModalProps = {
  businessDate: string;
  closingCashAmount: number;
  dateFormat: DateFormatPreference;
  onClose: () => void;
  onConfirm: (calculationToken: string) => Promise<void>;
};

type ReminderErrorResponse = {
  error?: string;
  message?: string;
  reminder?: DepositReturnReminder;
};

const formatMoney = (amount: number) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(amount);

const businessDateValue = (businessDate: string) =>
  new Date(`${businessDate}T12:00:00+07:00`);

export function DepositReturnReminderModal({
  businessDate,
  closingCashAmount,
  dateFormat,
  onClose,
  onConfirm,
}: DepositReturnReminderModalProps) {
  const [reminder, setReminder] = useState<DepositReturnReminder | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [finalCloseAcknowledged, setFinalCloseAcknowledged] = useState(false);

  const loadReminder = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError("");
      try {
        const response = await axios.get<{ reminder: DepositReturnReminder }>(
          `${API_URL}/finance/deposit-return-reminder`,
          {
            params: { businessDate },
            withCredentials: true,
            signal,
          },
        );
        setReminder(response.data.reminder);
      } catch (err) {
        if (axios.isCancel(err)) return;
        const message = axios.isAxiosError<ReminderErrorResponse>(err)
          ? err.response?.data.message || "ไม่สามารถโหลดรายการมัดจำได้"
          : "ไม่สามารถโหลดรายการมัดจำได้";
        setError(message);
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [businessDate],
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadReminder(controller.signal);
    return () => controller.abort();
  }, [loadReminder]);

  const submitFinalClose = async (celebrationOrigin: CelebrationOrigin) => {
    if (!reminder || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      await onConfirm(reminder.calculationToken);
      celebrateFinalDayClose(celebrationOrigin);

      onClose();
    } catch (err) {
      if (axios.isAxiosError<ReminderErrorResponse>(err)) {
        const refreshedReminder = err.response?.data.reminder;
        if (refreshedReminder) {
          setReminder(refreshedReminder);
        }
        const message =
          err.response?.data.message || "ไม่สามารถปิดยอดวันนี้ได้";
        setError(message);
        throw new Error(message);
      }
      throw err;
    } finally {
      setSubmitting(false);
    }
  };

  const hasOverdueDeposits = Boolean(reminder?.overdueBookingCount);
  const closeDisabled =
    loading || submitting || !reminder || !finalCloseAcknowledged;

  return (
    <section
      className="depositReminder"
      aria-labelledby="deposit-reminder-title"
    >
      <ModalCloseButton onClick={onClose} />

      <h1 id="deposit-reminder-title" className="addBooking__title">
        ภาพรวมวันพรุ่งนี้
      </h1>

      <section
        className="depositReminder__closingCash"
        aria-label="ยอดเงินสดที่กำลังปิดวันนี้"
      >
        <span className="depositReminder__closingCashIcon" aria-hidden="true">
          <i className="bx bx-wallet" />
        </span>
        <div>
          <span>ยอดเงินสดที่กำลังปิดวันนี้</span>
          <small>ยอดเงินสดที่นับได้และจะบันทึกในการปิดกะ</small>
        </div>
        <strong>THB {formatMoney(closingCashAmount)}</strong>
      </section>

      {loading ? (
        <div className="depositReminder__state">
          <i className="bx bx-loader-alt bx-spin" aria-hidden="true" />
          <span>กำลังตรวจสอบรายการมัดจำ...</span>
        </div>
      ) : reminder ? (
        <>
          <div className="depositReminder__summary">
            <div>
              <span>
                มัดจำที่ต้องเตรียมคืน ·{" "}
                {formatDisplayDate(
                  businessDateValue(reminder.targetBusinessDate),
                  dateFormat,
                )}
              </span>
              <strong>THB {formatMoney(reminder.requiredAmount)}</strong>
              <small>
                {reminder.bookingCount > 0
                  ? `สำหรับแขก ${reminder.bookingCount} booking`
                  : "ไม่มีเงินมัดจำที่ต้องเตรียมคืน"}
              </small>
            </div>
            <i
              className={`bx ${
                reminder.bookingCount > 0 ? "bx-wallet" : "bx-check-circle"
              }`}
              aria-hidden="true"
            />
          </div>

          {reminder.bookings.length > 0 ? (
            <DepositReminderGuestList
              bookings={reminder.bookings}
              dateFormat={dateFormat}
            />
          ) : (
            <div className="depositReminder__empty">
              <i className="bx bx-check" aria-hidden="true" />
              <span>ไม่ต้องกันเงินมัดจำสำหรับวันพรุ่งนี้</span>
            </div>
          )}

          {hasOverdueDeposits && (
            <OverdueDepositCategory
              bookings={reminder.overdueBookings}
              amount={reminder.overdueAmount}
              dateFormat={dateFormat}
            />
          )}
        </>
      ) : null}

      {error && (
        <div className="depositReminder__error" role="alert">
          <i className="bx bx-error-circle" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      <label className="resolveBooking__depositNotice depositReminder__finalAcknowledgement">
        <i className="bx bx-error-circle" aria-hidden="true" />
        <div>
          <strong>ยืนยันการปิดยอดสุดท้าย</strong>
          <p>
            หลังปิดยอดวันนี้ จะไม่สามารถรับหรือจ่ายเงินสดเพิ่มได้จนกว่าจะเปิดกะอีกครั้ง
          </p>
        </div>
        <input
          type="checkbox"
          aria-label="ยืนยันการปิดยอดสุดท้าย"
          checked={finalCloseAcknowledged}
          onChange={(event) =>
            setFinalCloseAcknowledged(event.target.checked)
          }
        />
      </label>

      <div className="depositReminder__actions">
        {error && !reminder ? (
          <ActionButton
            text="ลองโหลดใหม่"
            icon="bx-refresh"
            disabled={loading}
            onClick={() => void loadReminder()}
          />
        ) : null}
        <ActionButton
          text="ปิดยอดวันนี้"
          icon="bx-moon"
          highlight
          disabled={closeDisabled}
          onClick={(event) => {
            const buttonBounds = event.currentTarget.getBoundingClientRect();
            const celebrationOrigin = {
              x:
                (buttonBounds.left + buttonBounds.width / 2) /
                window.innerWidth,
              y:
                (buttonBounds.top + buttonBounds.height / 2) /
                window.innerHeight,
            };

            toast.promise(submitFinalClose(celebrationOrigin), {
              loading: "กำลังปิดยอดวันนี้",
              success: "ปิดยอดวันนี้เรียบร้อย",
              error: (err) =>
                err instanceof Error
                  ? err.message
                  : "เกิดข้อผิดพลาดในการปิดยอด",
            });
          }}
        />
      </div>
    </section>
  );
}
