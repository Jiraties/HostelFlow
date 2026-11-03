import ActionButton from "../../components/ActionButton";
import { Link } from "react-router";
import { passportReadinessKind, type PassportReadiness } from "./documentReports";
import { PreferredDateInput } from "../../components/PreferredDateInput";

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
  id, title, subtitle, icon, accent, readiness,
  exporting, exportError, exportLabel, disabled, date, onDateChange, onExport, onRetry,
}: DailyReportCardProps) => {
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
    incomplete: `ขาดข้อมูล Passport ${data?.missing || 0} รายการ`,
    ready: "Passport ครบ",
  }[kind];

  return (
    <article className={`documents__export documents__export--${accent}`} aria-labelledby={`${id}-title`}>
      <div className="documents__exportHeader">
        <i className={`bx ${icon} documents__exportIcon documents__exportIcon--${accent}`} aria-hidden="true" />
        <div>
          <h3 id={`${id}-title`}>{title}</h3>
          <p className="documents__subtitle">{subtitle}</p>
        </div>
      </div>
      <div>
        <label className="documents__label" htmlFor={`${id}-date`}>วันที่เข้าพัก</label>
        <PreferredDateInput id={`${id}-date`} className="boxInput" value={date} onChange={onDateChange} allowClear={false} disabled={exporting} />
      </div>
      <div className={`documents__readiness documents__readiness--${kind}`} data-readiness={kind} role={kind === "error" ? "alert" : "status"} aria-live="polite" aria-busy={readiness.loading}>
        <i className={`bx ${stateIcon}`} aria-hidden="true" />
        <div>
          <p>{statusText}
          {data && kind !== "loading" && kind !== "error" && kind !== "ready" && (
            <strong>{kind === "empty" ? "0 รายการ" : `${data.complete} / ${data.total} รายการ`}</strong>
          )}
          </p>
        </div>
        {kind === "error" && <button type="button" className="documents__textButton" onClick={onRetry} disabled={disabled}>ลองใหม่</button>}
      </div>
      {kind === "incomplete" && data && (
        <details className="documents__missingDetails">
          <summary>ตรวจสอบข้อมูลที่ขาด {data.missing} รายการ</summary>
          <ul className="documents__missingList">
            {data.missingBookings.map((booking, index) => (
              <li key={`${booking.bookingId}-${booking.guestId || index}`}>
                <Link className="documents__missingItem" to={`/master?bookingId=${encodeURIComponent(booking.bookingId)}`} aria-label={`แก้ไขข้อมูล ${booking.name}${booking.guestLabel ? ` · ${booking.guestLabel}` : ""}`}>
                  <span>
                    <strong>{booking.name}</strong>
                    <span>{[booking.guestLabel, booking.reason || "ข้อมูล Passport ไม่ครบ"].filter(Boolean).join(" · ")}</span>
                  </span>
                  <i className="bx bx-chevron-right" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        </details>
      )}
      <div className="documents__actions">
        {exportError && <p className="formField__error" role="alert">{exportError}</p>}
        <ActionButton
          text={exporting ? "กำลังส่งออก…" : kind === "ready" && data ? `${exportLabel} · พร้อม ${data.complete}/${data.total}` : exportLabel}
          icon={exporting ? "bx-loader-alt bx-spin" : "bx-arrow-down"}
          className="documents__action"
          onClick={onExport}
          disabled={disabled || exporting}
        />
      </div>
    </article>
  );
};

export default DailyReportCard;
