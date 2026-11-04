import { useState } from "react";
import Modal from "../../components/MotionModal";
import ActionButton from "../../components/ActionButton";
import ModalCloseButton from "../../components/ModalCloseButton";
import MonthInput from "../../components/MonthInput";
import ExportMultiSelect from "../../components/ExportMultiSelect";
import { paymentMethodOptions, platformOptions } from "../../helpers/options";
import {
  bookingExportIsEmpty, bookingExportQuery, defaultBookingExportFilters,
  exportCategoryOptions, exportStatusOptions, type BookingExportFilters,
} from "../../helpers/exportFilters";
import { currentReportingDate } from "./documentReports";
import { useDocumentExport } from "./useDocumentExport";
import "../bookings/AddBooking.css";

const ManagementExportPanel = () => {
  const [month, setMonth] = useState(() => currentReportingDate().slice(0, 7));
  const [filters, setFilters] = useState(defaultBookingExportFilters);
  const [infoOpen, setInfoOpen] = useState(false);
  const { busy, errors, download, clearError } = useDocumentExport();
  const exporting = Boolean(busy.bookings);
  const empty = bookingExportIsEmpty(filters);
  const update = (key: keyof BookingExportFilters, value: string[]) => {
    setFilters((previous) => ({ ...previous, [key]: value }));
    clearError("bookings");
  };
  const exportBooking = () => {
    if (empty || !month) return;
    void download({
      key: "bookings", endpoint: "getBookingsReport",
      params: bookingExportQuery(month, filters), filename: `bookings-${month}.xlsx`,
      successMessage: "ส่งออกรายงานการจองสำเร็จ", failureMessage: "ไม่สามารถส่งออกรายงานการจองได้ กรุณาลองใหม่",
    });
  };

  return (
    <section className="documents__export documents__export--booking" aria-labelledby="documents-management-title">
      <div className="documents__exportHeader">
        <i className="bx bx-file documents__exportIcon documents__exportIcon--booking" aria-hidden="true" />
        <div className="documents__exportTitle">
          <h3 id="documents-management-title">ข้อมูลการจอง</h3>
          <p className="documents__subtitle">Booking Data Export</p>
        </div>
        <button type="button" className="documents__infoTrigger" aria-label="เกี่ยวกับข้อมูลในรายงาน" title="เกี่ยวกับข้อมูลในรายงาน" aria-haspopup="dialog" onClick={() => setInfoOpen(true)}>
          <i className="bx bx-info-circle" aria-hidden="true" />
        </button>
      </div>
        <div className="documents__form">
          <div>
            <label className="documents__label" htmlFor="export-month">เดือน Check-In</label>
            <MonthInput id="export-month" value={month} onChange={(value) => { setMonth(value); clearError("bookings"); }} disabled={exporting} className="boxInput" />
          </div>
          <p className="documents__filterHelp" aria-live="polite">
            {filters.bookingStatuses.includes("cancelled") ? "รวม Booking ที่ยกเลิก" : "ไม่รวม Booking ที่ยกเลิก (ค่าเริ่มต้น)"}
          </p>
        <div className="documents__fieldGrid">
          <ExportMultiSelect id="export-channels" label="ช่องทางการจอง" countLabel="ช่องทาง" options={platformOptions} value={filters.bookingChannels} onChange={(value) => update("bookingChannels", value)} disabled={exporting} />
          <ExportMultiSelect id="export-statuses" label="สถานะการจอง" countLabel="สถานะ" options={exportStatusOptions} value={filters.bookingStatuses} onChange={(value) => update("bookingStatuses", value)} disabled={exporting} />
          <ExportMultiSelect id="export-payment-methods" label="ประเภทการชำระเงิน" countLabel="ประเภท" options={paymentMethodOptions} value={filters.paymentMethods} onChange={(value) => update("paymentMethods", value)} disabled={exporting} />
          <ExportMultiSelect id="export-categories" label="ประเภทข้อมูล" countLabel="ประเภท" options={exportCategoryOptions} value={filters.categories} onChange={(value) => update("categories", value)} disabled={exporting} />
        </div>
        {empty && <p className="formField__error" role="status">เลือกอย่างน้อย 1 รายการในแต่ละตัวกรอง</p>}
        </div>
        <div className="documents__actions">
          {errors.bookings && <p className="formField__error" role="alert">{errors.bookings}</p>}
          <ActionButton text={exporting ? "กำลังส่งออก…" : "ส่งออก Excel"} icon={exporting ? "bx-loader-alt bx-spin" : "bx-cloud"} className="documents__action" onClick={exportBooking} disabled={exporting || empty || !month} />
        </div>
      <Modal open={infoOpen} onClose={() => setInfoOpen(false)} className="home__modalCenter" aria-labelledby="documents-export-info-title">
        <div className="addBooking__wrapper documents__infoModal" role="dialog" aria-modal="true" aria-labelledby="documents-export-info-title">
          <ModalCloseButton onClick={() => setInfoOpen(false)} />
          <h2 id="documents-export-info-title">เกี่ยวกับข้อมูลในรายงาน</h2>
          <div className="documents__infoContent">
            <p>ตัวกรองทุกช่องทำงานร่วมกัน และต้องเลือกอย่างน้อย 1 รายการต่อช่อง</p>
            <p>ช่องทางและการชำระเงินกรองตามแต่ละแถว ส่วนบริการเสริมเฉพาะที่ผูกกับ Booking</p>
            <p>ยอดที่พักหลายประเภทแสดงเป็น Mixed โดยนับยอดเต็มเพียงครั้งเดียว ไม่แบ่งยอดตามประเภท</p>
          </div>
          <div className="documents__infoActions">
            <ActionButton text="ปิด" icon="bx-x" onClick={() => setInfoOpen(false)} />
          </div>
        </div>
      </Modal>
    </section>
  );
};

export default ManagementExportPanel;
