import { Link } from "react-router";
import { Fragment } from "react";
import ActionButton from "../../components/ActionButton";
import PaymentMethodChip from "../../components/PaymentMethodChip";
import { useAuth } from "../../context/AuthContext";
import { formatDisplayDateTime } from "../../helpers/displayDate";
import { transactionMap } from "../../helpers/transactionDisplay";
import type { booking } from "../../types/bookingTypes";
import CorrectTransaction from "../bookings/CorrectTransaction";
import Modal from "../../components/MotionModal";
import {
  useCorrectionRequests,
  type RequestItem,
} from "./useCorrectionRequests";

export const CorrectionRequestDialog = ({
  selected,
  admin,
  onClose,
  onDecide,
}: {
  selected: RequestItem | null;
  admin: boolean;
  onClose: () => void;
  onDecide: (action: string, reason?: string) => Promise<void>;
}) => (
  <Modal
    open={!!selected}
    className="home__modalCenter"
    aria-label="ตรวจสอบคำขอแก้ไข"
    onClose={onClose}
  >
    <>
      {selected && (
        <CorrectTransaction
          key={selected._id}
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
            historical: selected.proposal.historical,
            roundingChange: selected.roundingChange,
            requestedBy: selected.requestedBy,
            requestedAt: selected.requestedAt,
            decisionReason: selected.decisionReason,
            admin,
            onDecide,
          }}
          onClose={onClose}
        />
      )}
    </>
  </Modal>
);

const CorrectionRequests = () => {
  const { user, resolveStaffName } = useAuth();
  const { items, selected, setSelected, error, loading, reload, decide } =
    useCorrectionRequests();

  return (
    <section className="manage__reviewQueueSection" aria-labelledby="manage-correction-requests-title">
      <div className="manage__financePanelHeader">
        <div>
          <h3 id="manage-correction-requests-title">คำขอแก้ไขที่รออนุมัติ</h3>
          <p className="manage__correctionMeta">รวมทุกวันที่</p>
        </div>
        {items.length > 0 && (
          <span className="manage__correctionCount" aria-label={`${items.length} คำขอ`}>
            {items.length}
          </span>
        )}
      </div>
      {error && (
        <p role="alert">
          {error} <button type="button" onClick={reload}>ลองอีกครั้ง</button>
        </p>
      )}
      {loading && <p role="status">กำลังโหลดคำขอ...</p>}
      {!loading && !items.length && !error && (
        <div className="manage__emptyState manage__correctionEmpty">
          <i className="bx bx-check-shield" aria-hidden="true" />
          <p>ไม่มีคำขอรออนุมัติ</p>
        </div>
      )}
      <div className="manage__reviewList">
        {items.map((item) => {
          const { before, after, historical } = item.proposal;
          const amountChanged = before.amount !== after.amount;
          const methodChanged = before.paymentMethod !== after.paymentMethod;
          const categoryChanged = before.type !== after.type;
          return (
            <article key={item._id} className="manage__correctionRow">
              <div className="manage__correctionIdentity">
                <h4>{item.sourceLabel}</h4>
                <div className="manage__correctionContext">
                  <span>{transactionMap[before.type]?.name ?? before.type}</span>
                  {!methodChanged && <PaymentMethodChip method={before.paymentMethod} />}
                  {historical && <span className="manage__correctionHistorical">หลังปิดกะ</span>}
                </div>
                <p className="manage__correctionMeta">
                  {resolveStaffName(item.requestedBy)} ·{" "}
                  {formatDisplayDateTime(item.requestedAt, user?.settings.dateFormat)}
                </p>
                {item.sourceType === "booking" && (
                  <Link
                    className="manage__correctionBookingLink"
                    to={`/master?bookingId=${encodeURIComponent(item.sourceId)}`}
                  >
                    Booking {item.sourceId}
                    <i className="bx bx-link-external" aria-hidden="true" />
                  </Link>
                )}
              </div>
              {amountChanged || methodChanged || categoryChanged ? (
                <div className="correctionReview__change">
                  {[before, after].map((transaction, index) => (
                    <Fragment key={index === 0 ? "before" : "after"}>
                      {index === 1 && (
                        <span className="correctionReview__arrow" aria-hidden="true">→</span>
                      )}
                      <div>
                        <span>{index === 0 ? "เดิม" : "ที่ขอแก้ไข"}</span>
                        {amountChanged && (
                          <strong>{transaction.amount.toLocaleString("th-TH")} THB</strong>
                        )}
                        {categoryChanged && (
                          <strong>{transactionMap[transaction.type]?.name ?? transaction.type}</strong>
                        )}
                        {methodChanged && (
                          <div><PaymentMethodChip method={transaction.paymentMethod} /></div>
                        )}
                      </div>
                    </Fragment>
                  ))}
                </div>
              ) : (
                <p className="manage__correctionMeta">แก้ไขรายละเอียดรายการ</p>
              )}
              <ActionButton
                className="manage__correctionAction"
                text="ดูคำขอ"
                icon="bx-chevron-right"
                onClick={() => setSelected(item)}
              />
            </article>
          );
        })}
      </div>
      <CorrectionRequestDialog
        selected={selected}
        admin={Boolean(user?.admin)}
        onClose={() => setSelected(null)}
        onDecide={decide}
      />
    </section>
  );
};

export default CorrectionRequests;
