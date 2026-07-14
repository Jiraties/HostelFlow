import ActionButton from "../../components/ActionButton";

import type { DepositRequirement } from "../../types/cashShiftTypes";

import "./DepositPreparationModal.css";

const formatMoney = (value: number) =>
  value.toLocaleString("th-TH", {
    minimumFractionDigits: value % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });

type DepositPreparationModalProps = {
  requirement?: DepositRequirement;
  currentDepositCash: number;
  operatingExpectedCash: number;
  depositActualCash: string;
  operatingActualCash: string;
  note: string;
  noteRequired: boolean;
  saving: boolean;
  canSubmit: boolean;
  onDepositActualCashChange: (value: string) => void;
  onOperatingActualCashChange: (value: string) => void;
  onNoteChange: (value: string) => void;
  onClose: () => void;
  onConfirm: () => void;
};

const DepositPreparationModal = ({
  requirement,
  currentDepositCash,
  operatingExpectedCash,
  depositActualCash,
  operatingActualCash,
  note,
  noteRequired,
  saving,
  canSubmit,
  onDepositActualCashChange,
  onOperatingActualCashChange,
  onNoteChange,
  onClose,
  onConfirm,
}: DepositPreparationModalProps) => {
  const requiredCash = requirement?.total || 0;
  const adjustment = requiredCash - currentDepositCash;

  const transferInstruction =
    adjustment > 0
      ? {
          icon: "bx-arrow-down-stroke",
          eyebrow: "เติมเงินเข้ากองมัดจำ",
          detail: `นำเงินจากกองมัดจำแขกอยู่ต่อ ${formatMoney(adjustment)} ฿`,
        }
      : adjustment < 0
        ? {
            icon: "bx-arrow-up-stroke",
            eyebrow: "นำเงินส่วนเกินออก",
            detail: `คืนเงินเข้ากองมัดจำแขกอยู่ต่อ ${formatMoney(Math.abs(adjustment))} ฿`,
          }
        : {
            icon: "bx-check",
            eyebrow: "ยอดเงินพร้อมแล้ว",
            detail: "ไม่ต้องย้ายเงินระหว่างกองมัดจำกับกองมัดจำแขกอยู่ต่อ",
          };

  return (
    <section
      className="depositPreparationModal"
      aria-labelledby="deposit-preparation-title"
    >
      {/* <button
        type="button"
        className="depositPreparationModal__close"
        aria-label="ปิดหน้าต่างเตรียมมัดจำ"
        disabled={saving}
        onClick={onClose}
      >
        <i className="bx bx-x" />
      </button> */}

      <header className="depositPreparationModal__header">
        <div>
          <h2 id="deposit-preparation-title" className="checkIn__title">
            เตรียมมัดจำสำหรับวันพรุ่งนี้
          </h2>
          <p>ปิดยอดสุดท้ายของวันและจัดเงินมัดจำสำหรับแขกที่จะเช็คเอาท์</p>
        </div>
        <span>{requirement?.businessDate || "-"}</span>
      </header>

      <div className="depositPreparationModal__overview">
        <div className="depositPreparationModal__total">
          <p>ยอดที่ต้องมีในกองมัดจำพรุ่งนี้</p>
          <strong>{formatMoney(requiredCash)} ฿</strong>
          <span>
            {requirement?.refundBookingCount || 0} การจองที่ต้องคืนมัดจำ
          </span>
        </div>

        <div className="depositPreparationModal__transfer">
          <i className={`bx ${transferInstruction.icon}`} />
          <div>
            <span>{transferInstruction.eyebrow}</span>
            <strong>{transferInstruction.detail}</strong>
          </div>
        </div>
      </div>

      <section
        className="depositPreparationModal__bookings"
        aria-labelledby="deposit-preparation-bookings-title"
      >
        <header>
          <div>
            <h3 id="deposit-preparation-bookings-title">รายการคืนมัดจำ</h3>
            <p>ตรวจสอบแขกก่อนจัดเงินใส่กอง</p>
          </div>
          <span>{requirement?.checkoutCount || 0} เช็คเอาท์</span>
        </header>

        {requirement?.bookings.length ? (
          <ul>
            {requirement.bookings.map((booking) => (
              <li key={booking.bookingId}>
                <div>
                  <strong>{booking.guestName}</strong>
                  <small>{booking.bookingId}</small>
                </div>
                <span>{formatMoney(booking.amount)} ฿</span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="depositPreparationModal__empty">
            <i className="bx bx-check-circle" />
            <div>
              <strong>ไม่ต้องเตรียมเงินคืนมัดจำ</strong>
              <span>ไม่มีรายการคืนมัดจำสำหรับวันพรุ่งนี้</span>
            </div>
          </div>
        )}
      </section>

      <div className="depositPreparationModal__counts">
        <label>
          <span>เงินมัดจำหลังเตรียม</span>
          <input
            className="boxInput"
            type="number"
            min="0"
            disabled={!canSubmit || saving}
            value={depositActualCash}
            placeholder={`${formatMoney(requiredCash)} คาดไว้`}
            onChange={(event) => onDepositActualCashChange(event.target.value)}
          />
        </label>
        <label>
          <span>รายได้เงินสดที่นับได้</span>
          <input
            className="boxInput"
            type="number"
            min="0"
            disabled={!canSubmit || saving}
            value={operatingActualCash}
            placeholder={`${formatMoney(operatingExpectedCash)} คาดไว้`}
            onChange={(event) =>
              onOperatingActualCashChange(event.target.value)
            }
          />
        </label>
      </div>

      {noteRequired && (
        <label className="depositPreparationModal__note">
          <span>หมายเหตุยอดต่าง</span>
          <input
            className="boxInput"
            type="text"
            disabled={saving}
            value={note}
            placeholder="เช่น พบเงินขาด / เงินเกิน"
            onChange={(event) => onNoteChange(event.target.value)}
          />
        </label>
      )}

      <footer className="depositPreparationModal__footer">
        <button type="button" disabled={saving} onClick={onClose}>
          ยกเลิก
        </button>
        <ActionButton
          text="ยืนยันปิดวันและเตรียมมัดจำ"
          icon="bx-check"
          highlight
          disabled={saving || !canSubmit}
          onClick={onConfirm}
        />
      </footer>
    </section>
  );
};

export default DepositPreparationModal;
