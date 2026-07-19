import ModalCloseButton from "../../components/ModalCloseButton";
import { useAuth } from "../../context/AuthContext";
import { formatDisplayDateTime } from "../../helpers/displayDate";
import type { booking, TransactionCorrection } from "../../types/bookingTypes";
import "./CorrectTransaction.css";
import "./TransactionCorrectionHistory.css";

const reasonLabels: Record<TransactionCorrection["reasonCode"], string> = {
  incorrect_amount: "กรอกจำนวนเงินผิด",
  incorrect_payment_method: "เลือกช่องทางชำระผิด",
  incorrect_category: "เลือกประเภทรายการผิด",
  incorrect_note: "ข้อมูลหรือหมายเหตุผิด",
  manager_discount: "ส่วนลดที่ผู้จัดการอนุมัติ",
  waived_fee: "ยกเว้นค่าบริการ",
  agreed_rate_correction: "แก้ราคาที่ตกลงกับแขก",
  cancelled_service: "ยกเลิกบริการ",
  guest_compensation: "ชดเชยให้แขก",
  other: "อื่น ๆ",
};

const currency = (amount: number) =>
  `${amount.toLocaleString("th-TH", { maximumFractionDigits: 2 })} THB`;

const TransactionCorrectionHistory = ({
  booking: currentBooking,
  transactionId,
  onClose,
}: {
  booking: booking;
  transactionId: string;
  onClose: () => void;
}) => {
  const { user, resolveStaffName } = useAuth();
  const dateFormat = user?.settings.dateFormat || "dd/MM/yyyy";
  const history = (currentBooking.transactionCorrections || [])
    .filter((correction) => correction.targetTransactionId === transactionId)
    .sort(
      (first, second) =>
        new Date(second.correctedAt).getTime() -
        new Date(first.correctedAt).getTime(),
    );
  const legacyAdjustments = (currentBooking.legacyTransactionAdjustments || [])
    .filter(
      (transaction) => transaction.relatedTransactionId === transactionId,
    )
    .sort(
      (first, second) =>
        new Date(second.createdAt || 0).getTime() -
        new Date(first.createdAt || 0).getTime(),
    );

  return (
    <div className="addBooking__wrapper correctionHistory__wrapper">
      <ModalCloseButton onClick={onClose} />
      <header className="correctTransaction__header">
        <h1 className="addBooking__title">ประวัติการแก้ไข</h1>
        <p>รายการเดิมและการแก้ไขทุกครั้งยังคงอยู่เพื่อตรวจสอบย้อนหลัง</p>
      </header>

      <div className="correctionHistory__list">
        {history.map((correction, index) => {
          const difference = Number(
            (correction.after.amount - correction.before.amount).toFixed(2),
          );
          return (
            <article
              className="correctionHistory__item"
              key={correction._id || `${correction.correctedAt}-${index}`}
            >
              <div className="correctionHistory__itemHeader">
                <div>
                  <strong>
                    {correction.correctionType === "recorded_mistake"
                      ? "แก้ไขข้อมูลที่บันทึกผิด"
                      : "ปรับยอดเรียกเก็บ"}
                  </strong>
                  <span>{reasonLabels[correction.reasonCode]}</span>
                </div>
                <span className="correctionHistory__badge">
                  ครั้งที่ {history.length - index}
                </span>
              </div>

              <div className="correctionHistory__comparison">
                <div>
                  <span>ก่อนแก้ไข</span>
                  <strong>{currency(correction.before.amount)}</strong>
                  <small>{correction.before.paymentMethod}</small>
                </div>
                <i className="bx bx-right-arrow-alt" />
                <div>
                  <span>หลังแก้ไข</span>
                  <strong>{currency(correction.after.amount)}</strong>
                  <small>{correction.after.paymentMethod}</small>
                </div>
              </div>

              <dl className="correctionHistory__meta">
                <div>
                  <dt>ส่วนต่าง</dt>
                  <dd>
                    {difference > 0 ? "+" : ""}
                    {currency(difference)}
                  </dd>
                </div>
                <div>
                  <dt>แก้โดย</dt>
                  <dd>
                    {correction.correctedByName?.trim() ||
                      resolveStaffName(correction.correctedBy)}
                  </dd>
                </div>
                <div>
                  <dt>วันและเวลา</dt>
                  <dd>
                    {formatDisplayDateTime(correction.correctedAt, dateFormat)}
                  </dd>
                </div>
                <div>
                  <dt>รอบบัญชีเดิม</dt>
                  <dd>{correction.originalBusinessDate}</dd>
                </div>
              </dl>
              <p className="correctionHistory__note">
                <strong>หมายเหตุ:</strong> {correction.note}
              </p>
            </article>
          );
        })}
        {legacyAdjustments.map((adjustment, index) => (
          <article
            className="correctionHistory__item"
            key={adjustment._id || `legacy-${index}`}
          >
            <div className="correctionHistory__itemHeader">
              <div>
                <strong>รายการปรับยอดเดิม</strong>
                <span>ข้อมูลจากระบบปรับราคาก่อนเปลี่ยน workflow</span>
              </div>
              <span className="correctionHistory__badge">Legacy</span>
            </div>
            <dl className="correctionHistory__meta">
              <div>
                <dt>ส่วนต่าง</dt>
                <dd>
                  {adjustment.direction === "out" ? "-" : "+"}
                  {currency(Math.abs(adjustment.amount))}
                </dd>
              </div>
              <div>
                <dt>ช่องทาง</dt>
                <dd>{adjustment.paymentMethod}</dd>
              </div>
              <div>
                <dt>บันทึกโดย</dt>
                <dd>{resolveStaffName(adjustment.createdBy || "system")}</dd>
              </div>
              <div>
                <dt>วันและเวลา</dt>
                <dd>
                  {adjustment.createdAt
                    ? formatDisplayDateTime(adjustment.createdAt, dateFormat)
                    : "ไม่พบเวลาเดิม"}
                </dd>
              </div>
            </dl>
            {adjustment.note && (
              <p className="correctionHistory__note">
                <strong>หมายเหตุ:</strong> {adjustment.note}
              </p>
            )}
          </article>
        ))}
        {history.length === 0 && legacyAdjustments.length === 0 && (
          <div className="correctionHistory__empty">
            <i className="bx bx-history" />
            <p>ยังไม่มีประวัติการแก้ไขรายการนี้</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default TransactionCorrectionHistory;
