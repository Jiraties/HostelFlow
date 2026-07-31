import { useState } from "react";

import ActionButton from "../../components/ActionButton";
import ModalCloseButton from "../../components/ModalCloseButton";
import type { FinalCloseRecovery } from "../../types/cashShiftTypes";

import "../bookings/AddBooking.css";
import "../bookings/ResolveBooking.css";
import "./ReopenFinalCashShiftModal.css";

type Props = {
  recovery: FinalCloseRecovery;
  onClose: () => void;
  onConfirm: (input: {
    reason: string;
    expectedLedgerRevision: number;
    idempotencyKey: string;
  }) => Promise<void>;
};

const formatMoney = (amount: number) =>
  new Intl.NumberFormat("th-TH", { maximumFractionDigits: 2 }).format(amount);

const formatBangkokDateTime = (value: string | Date) =>
  new Intl.DateTimeFormat("th-TH", {
    timeZone: "Asia/Bangkok",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));

export function ReopenFinalCashShiftModal({
  recovery,
  onClose,
  onConfirm,
}: Props) {
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  const submit = async () => {
    const trimmedReason = reason.trim();
    if (!trimmedReason || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      await onConfirm({
        reason: trimmedReason,
        expectedLedgerRevision: recovery.ledgerRevision,
        idempotencyKey,
      });
      onClose();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "ไม่สามารถเปิดกะอีกครั้งได้";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section
      className="addBooking__wrapper resolveBooking__wrapper reopenCashShift"
      aria-labelledby="reopen-shift-title"
    >
      <ModalCloseButton onClick={onClose} />
      <div className="resolveBooking__header">
        <h1 id="reopen-shift-title" className="addBooking__title">
          เปิดกะอีกครั้ง
        </h1>
        <p className="resolveBooking__intro">
          ใช้เมื่อมีรายการเงินสดเข้าหลังปิดยอดสุดท้าย กะเดิมจะกลับมาเปิดและต้องปิดยอดใหม่ตามปกติ
        </p>
      </div>

      <section className="resolveBooking__section reopenCashShift__people">
        <p>
          <span>เจ้าของกะ</span>
          <strong>
            {recovery.shiftOwner?.name || recovery.shiftOwner?.username}
          </strong>
        </p>
        <p>
          <span>ผู้ปิดยอดเดิม</span>
          <strong>
            {recovery.originalCloser?.name ||
              recovery.originalCloser?.username}
          </strong>
        </p>
        <p>
          <span>เวลาปิดเดิม</span>
          <strong>
            {formatBangkokDateTime(recovery.originalClose.endedAt)}
          </strong>
        </p>
      </section>

      <section
        className="resolveBooking__summary reopenCashShift__amounts"
        aria-label="ยอดปิดเดิม"
      >
        <div><span>คาดไว้</span><strong>{formatMoney(recovery.originalClose.operatingExpectedCash)} ฿</strong></div>
        <div><span>นับได้</span><strong>{formatMoney(recovery.originalClose.operatingActualCash)} ฿</strong></div>
        <div><span>ยอดต่าง</span><strong>{formatMoney(recovery.originalClose.operatingVariance)} ฿</strong></div>
      </section>

      <section className="resolveBooking__depositNotice reopenCashShift__auditNote">
        <i className="bx bx-history" aria-hidden="true" />
        <div>
          <strong>ประวัติเดิมจะไม่ถูกลบ</strong>
          <p>
            การปิดยอดเดิมจะยังอยู่ในประวัติการตรวจสอบ พร้อมผู้ปิด เวลา และยอดเงินเดิม
          </p>
        </div>
      </section>

      <label className="resolveBooking__section reopenCashShift__reason">
        <span className="addBooking__label">เหตุผลที่เปิดกะอีกครั้ง</span>
        <textarea
          className="boxInput resolveBooking__note"
          value={reason}
          maxLength={500}
          autoFocus
          placeholder="เช่น แขกมาชำระเงินสดหลังปิดยอด"
          onChange={(event) => setReason(event.target.value)}
        />
      </label>

      {error && <p className="reopenCashShift__error" role="alert">{error}</p>}

      <div className="resolveBooking__actions reopenCashShift__actions">
        <ActionButton text="ยกเลิก" icon="bx-x" disabled={submitting} onClick={onClose} />
        <ActionButton
          text="เปิดกะอีกครั้ง"
          icon="bx-undo"
          highlight
          disabled={submitting || !reason.trim()}
          onClick={() => void submit()}
        />
      </div>
    </section>
  );
}
