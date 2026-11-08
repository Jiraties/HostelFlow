import ActionButton from "../../components/ActionButton";
import { Link } from "react-router";
import {
  passportReadinessKind,
  type PassportReadiness,
} from "./documentReports";
import { PreferredDateInput } from "../../components/PreferredDateInput";
import { useState } from "react";
import Modal from "../../components/MotionModal";
import ModalCloseButton from "../../components/ModalCloseButton";

type DailyReportCardProps = {
  id: string;
  title: string;
  subtitle: string;
  icon: string;
  accent: "tm30" | "hotel";
  readiness: PassportReadiness;
  exporting: boolean;
  exportError?: string | null;
  exportLabel: string;
  disabled: boolean;
  date: string;
  onDateChange: (date: string) => void;
  onExport: () => void;
  onRetry: () => void;
};

const DailyReportCard = ({
  id,
  title,
  subtitle,
  icon,
  accent,
  readiness,
  exporting,
  exportError,
  exportLabel,
  disabled,
  date,
  onDateChange,
  onExport,
  onRetry,
}: DailyReportCardProps) => {
  const [missingOpen, setMissingOpen] = useState(false);
  const kind = passportReadinessKind(readiness);
  const data = readiness.data;
  const stateIcon = {
    loading: "bx-loader-alt bx-spin",
    error: "bx-alert-circle",
    empty: "bx-calendar",
    incomplete: "bx-alert-triangle",
    ready: "bx-check",
  }[kind];
  const statusText = {
    loading: "กำลังตรวจสอบข้อมูล Passport…",
    error: readiness.error || "ยังตรวจสอบข้อมูล Passport ไม่ได้",
    empty: "ไม่มีรายการที่เข้าเงื่อนไขในวันที่เลือก",
    incomplete: `ยังไม่พร้อมส่งออก ${data?.missing || 0} รายการ`,
    ready: "Passport ครบ",
  }[kind];

  return (
    <article
      className={`documents__report documents__report--${accent}`}
      aria-labelledby={`${id}-title`}
    >
      <div className="documents__reportIdentity">
        <i
          className={`bx ${icon} documents__reportIcon documents__reportIcon--${accent}`}
          aria-hidden="true"
        />
        <div>
          <h3 id={`${id}-title`}>{title}</h3>
          <p className="documents__subtitle">{subtitle}</p>
        </div>
      </div>
      <div className="documents__reportDate">
        <PreferredDateInput
          id={`${id}-date`}
          aria-label={`วันที่เข้าพัก ${title}`}
          className="boxInput"
          value={date}
          onChange={onDateChange}
          allowClear={false}
          disabled={exporting}
        />
      </div>
      <div className="documents__readinessGroup">
        <div
          className={`documents__readiness documents__readiness--${kind}`}
          data-readiness={kind}
          role={kind === "error" ? "alert" : "status"}
          aria-live="polite"
          aria-busy={readiness.loading}
        >
          <i className={`bx ${stateIcon}`} aria-hidden="true" />
          <div>
            {kind === "incomplete" && data ? (
              <button
                type="button"
                className="documents__missingTrigger"
                aria-haspopup="dialog"
                onClick={() => setMissingOpen(true)}
              >
                <span>{statusText}</span>
                <i className="bx bx-chevron-right" aria-hidden="true" />
              </button>
            ) : (
              <p>
                {statusText}
                {data && kind === "ready" && (
                  <strong>
                    {" · "}ครบ {data.complete} / {data.total} รายการ
                  </strong>
                )}
              </p>
            )}
          </div>
          {kind === "error" && (
            <button
              type="button"
              className="documents__textButton"
              onClick={onRetry}
              disabled={disabled}
            >
              ลองใหม่
            </button>
          )}
        </div>
        <Modal
          open={missingOpen}
          onClose={() => setMissingOpen(false)}
          className="home__modalCenter"
          aria-labelledby={`${id}-missing-title`}
        >
          <div className="addBooking__wrapper documents__missingModal">
            <ModalCloseButton onClick={() => setMissingOpen(false)} />
            <h1 id={`${id}-missing-title`} className="addBooking__title">
              รายการที่ยังไม่พร้อม
            </h1>
            <p>
              ครบ {data?.complete || 0} / {data?.total || 0} รายการ
            </p>
            <ul className="documents__missingList">
              {data?.missingBookings.map((booking, index) => (
                <li key={`${booking.bookingId}-${booking.guestId || index}`}>
                  <Link
                    className="documents__missingItem"
                    to={`/master?bookingId=${encodeURIComponent(booking.bookingId)}`}
                    aria-label={`แก้ไขข้อมูล ${booking.name}${booking.guestLabel ? ` · ${booking.guestLabel}` : ""}`}
                  >
                    <span>
                      <strong>{booking.name}</strong>
                      <span>
                        {[
                          booking.guestLabel,
                          booking.reason || "ข้อมูล Passport ไม่ครบ",
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </span>
                    <i className="bx bx-chevron-right" aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>
            <ActionButton
              text="ปิด"
              icon="bx-x"
              onClick={() => setMissingOpen(false)}
            />
          </div>
        </Modal>
      </div>
      <div className="documents__actions">
        {exportError && (
          <p className="formField__error" role="alert">
            {exportError}
          </p>
        )}
        <ActionButton
          text={exporting ? "กำลังส่งออก…" : exportLabel}
          icon={exporting ? "bx-loader-alt bx-spin" : "bx-arrow-to-bottom"}
          className="documents__download"
          onClick={onExport}
          disabled={disabled || exporting}
        />
      </div>
    </article>
  );
};

export default DailyReportCard;
