import { useState } from "react";
import Modal from "../../components/MotionModal";
import ActionButton from "../../components/ActionButton";
import Tooltip from "../../components/Tooltip";
import MonthInput from "../../components/MonthInput";
import ExportFilterGroup from "./ExportFilterGroup";
import { paymentMethodOptions, platformOptions } from "../../helpers/options";
import {
  bookingExportIsEmpty,
  bookingExportQuery,
  defaultBookingExportFilters,
  exportCategoryOptions,
  exportStatusOptions,
  type BookingExportFilters,
} from "../../helpers/exportFilters";
import { currentReportingDate } from "./documentReports";
import { useDocumentExport } from "./useDocumentExport";

const ManagementExportPanel = () => {
  const [month, setMonth] = useState(() => currentReportingDate().slice(0, 7));
  const [filters, setFilters] = useState(defaultBookingExportFilters);
  const [open, setOpen] = useState(false);
  const [customizing, setCustomizing] = useState(false);
  const [activeGroup, setActiveGroup] = useState<
    keyof BookingExportFilters | null
  >(null);
  const { busy, errors, download, clearError } = useDocumentExport();
  const exporting = Boolean(busy.bookings);
  const empty = bookingExportIsEmpty(filters);
  const groups = [
    {
      key: "bookingChannels",
      id: "export-channels",
      label: "ช่องทางการจอง",
      allLabel: "ทุกช่องทาง",
      options: platformOptions,
    },
    {
      key: "bookingStatuses",
      id: "export-statuses",
      label: "สถานะการจอง",
      allLabel: "ทุกสถานะ",
      options: exportStatusOptions,
    },
    {
      key: "paymentMethods",
      id: "export-payment-methods",
      label: "ประเภทการชำระเงิน",
      allLabel: "ทุกการชำระเงิน",
      options: paymentMethodOptions,
    },
    {
      key: "categories",
      id: "export-categories",
      label: "ประเภทข้อมูล",
      allLabel: "ทุกประเภท",
      options: exportCategoryOptions,
    },
  ] as const;
  const summary = groups
    .map((group) => {
      const count = filters[group.key].length;
      if (count === 0) return `${group.label}: ยังไม่ได้เลือก`;
      if (count === group.options.length) return group.allLabel;
      if (group.key === "bookingStatuses") return `${count} สถานะ`;
      return `${group.label} ${count}/${group.options.length}`;
    })
    .join(" · ");
  const close = () => {
    if (!exporting) setOpen(false);
  };
  const update = (key: keyof BookingExportFilters, value: string[]) => {
    setFilters((previous) => ({ ...previous, [key]: value }));
    clearError("bookings");
  };
  const exportBooking = () => {
    if (empty || !month) return;
    void download({
      key: "bookings",
      endpoint: "getBookingsReport",
      params: bookingExportQuery(month, filters),
      filename: `bookings-${month}.xlsx`,
      successMessage: "เริ่มดาวน์โหลดรายงานการจองแล้ว",
      failureMessage: "ไม่สามารถส่งออกรายงานการจองได้ กรุณาลองใหม่",
    });
  };

  return (
    <>
      <section
        className="documents__bookingEntry"
        aria-labelledby="documents-management-title"
      >
        <i className="bx bx-file documents__entryIcon" aria-hidden="true" />
        <div className="documents__entryCopy">
          <p className="documents__eyebrow">Booking Data Export</p>
          <h2 id="documents-management-title">ข้อมูลการจอง</h2>
          <p>
            ข้อมูลการเข้าพัก การชำระเงิน และบริการเสริม
            เลือกส่งออกตามเดือนและตัวกรอง
          </p>
        </div>
        <ActionButton
          text="ส่งออก Excel"
          icon="bx-arrow-to-bottom"
          highlight
          onClick={() => {
            setCustomizing(false);
            setActiveGroup(null);
            setOpen(true);
          }}
        />
      </section>
      <Modal
        open={open}
        onClose={close}
        className="home__modalCenter documentExportModal"
        aria-labelledby="documents-export-title"
      >
        <div className="documentExport">
          <header className="documentExport__header">
            <h1 id="documents-export-title" className="checkIn__title">
              ส่งออกข้อมูลการจอง
            </h1>
          </header>
          <div className="documentExport__body" aria-busy={exporting}>
            <div className="documentExport__period">
              <label htmlFor="export-month">เดือน Check-In</label>
              <MonthInput
                id="export-month"
                value={month}
                onChange={(value) => {
                  setMonth(value);
                  clearError("bookings");
                }}
                disabled={exporting}
                className="boxInput"
              />
            </div>
            <div className="documentExport__filterCard">
              <button
                type="button"
                className="documentExport__filterToggle"
                aria-expanded={customizing}
                aria-controls="export-filters"
                disabled={exporting}
                onClick={() => {
                  setCustomizing(!customizing);
                  setActiveGroup(null);
                }}
              >
                <span>
                  <span className="documentExport__filterLabel">ตัวกรอง</span>
                  <span
                    className="documentExport__filterSummary"
                    aria-live="polite"
                  >
                    {summary}
                  </span>
                </span>
                <i
                  className={`bx bx-chevron-${customizing ? "up" : "down"} documentExport__filterAction`}
                  aria-hidden="true"
                />
              </button>
              {customizing && (
                <section
                  id="export-filters"
                  className="documentFilters"
                  aria-label="ปรับตัวกรอง"
                >
                  {groups.map((group) => (
                    <ExportFilterGroup
                      key={group.key}
                      id={group.id}
                      label={group.label}
                      allLabel={group.allLabel}
                      options={group.options}
                      value={filters[group.key]}
                      onChange={(value) => update(group.key, value)}
                      disabled={exporting}
                      expanded={activeGroup === group.key}
                      onToggle={() =>
                        setActiveGroup(
                          activeGroup === group.key ? null : group.key,
                        )
                      }
                    />
                  ))}
                  <button
                    type="button"
                    className="documents__textButton documentFilters__reset"
                    disabled={exporting}
                    onClick={() => {
                      setFilters(defaultBookingExportFilters());
                      clearError("bookings");
                    }}
                  >
                    คืนค่าเริ่มต้น
                  </button>
                </section>
              )}
            </div>
            <p className="documentExport__scope" aria-live="polite">
              {filters.bookingStatuses.includes("cancelled")
                ? "รวม Booking ที่ยกเลิก"
                : "ไม่รวม Booking ที่ยกเลิก (ค่าเริ่มต้น)"}
            </p>
            <Tooltip
              className="documentExport__info"
              ariaLabel="เกี่ยวกับข้อมูลในรายงาน"
              content={
                <>
                  <span>ตัวกรองทุกช่องทำงานร่วมกัน และต้องเลือกอย่างน้อย 1 รายการต่อช่อง</span>
                  <span>ช่องทางและการชำระเงินกรองตามแต่ละแถว ส่วนบริการเสริมเฉพาะที่ผูกกับ Booking</span>
                  <span>ยอดที่พักหลายประเภทแสดงเป็น Mixed โดยนับยอดเต็มเพียงครั้งเดียว ไม่แบ่งยอดตามประเภท</span>
                </>
              }
            >
              <i className="bx bx-info-circle" aria-hidden="true" />
              <span>เกี่ยวกับข้อมูลในรายงาน</span>
            </Tooltip>
          </div>
          <footer className="documentExport__footer">
            <div className="documentExport__feedback" aria-live="polite">
              {empty && (
                <p className="formField__error">
                  เลือกอย่างน้อย 1 รายการในแต่ละตัวกรอง
                </p>
              )}
              {errors.bookings && (
                <p className="formField__error" role="alert">
                  {errors.bookings}
                </p>
              )}
            </div>
            <div className="documentExport__buttons">
              <ActionButton
                text="ยกเลิก"
                icon="bx-x"
                onClick={close}
                disabled={exporting}
              />
              <ActionButton
                text={exporting ? "กำลังส่งออก…" : "ส่งออก Excel"}
                icon={
                  exporting ? "bx-loader-alt bx-spin" : "bx-arrow-to-bottom"
                }
                highlight
                onClick={exportBooking}
                disabled={exporting || empty || !month}
              />
            </div>
          </footer>
        </div>
      </Modal>
    </>
  );
};

export default ManagementExportPanel;
