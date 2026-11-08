import { useState } from "react";
import PageHeader from "../components/PageHeader";
import { useAuth } from "../context/AuthContext";
import { formatHeaderDate } from "../helpers/displayDate";
import usePageTitle from "../hooks/useTitle";
import DailyReportCard from "../features/documents/DailyReportCard";
import ManagementExportPanel from "../features/documents/ManagementExportPanel";
import { currentReportingDate } from "../features/documents/documentReports";
import { usePassportReportStatus } from "../features/documents/usePassportReportStatus";
import { useDocumentExport } from "../features/documents/useDocumentExport";
import { useAppConfirmation } from "../components/useAppConfirmation";
import "./Documents.css";

const Documents = () => {
  usePageTitle("HostelFlow · เอกสาร");
  const { user } = useAuth();
  const [immigrationDate, setImmigrationDate] = useState(currentReportingDate);
  const [hotelDate, setHotelDate] = useState(currentReportingDate);
  const immigration = usePassportReportStatus(
    "getImmigrationReportStatus",
    immigrationDate,
  );
  const hotel = usePassportReportStatus(
    "getHotelAccommodationReportStatus",
    hotelDate,
  );
  const { busy, errors, download, clearError } = useDocumentExport();
  const confirmation = useAppConfirmation();
  const dateFormat = user?.settings.dateFormat || "dd/MM/yyyy";
  const lastUpdated =
    immigration.updatedAt && hotel.updatedAt
      ? new Date(
          Math.min(immigration.updatedAt.getTime(), hotel.updatedAt.getTime()),
        )
      : null;
  const exportImmigration = () => {
    if (!immigrationDate) return;
    void download({
      key: "tm30",
      endpoint: "getImmigrationReport",
      params: { date: immigrationDate },
      filename: `tm30-${immigrationDate}.xlsx`,
      successMessage: "ส่งออกไฟล์ ตม. สำเร็จ",
      failureMessage: "ไม่สามารถส่งออกรายงาน ตม.30 ได้ กรุณาลองใหม่",
      confirm: async () =>
        !immigration.data?.missing ||
        (await confirmation.ask({
          title: "ข้อมูลยังไม่พร้อมส่งออก",
          description: `ยังมี ${immigration.data.missing} รายการที่ยังไม่ Check-In หรือข้อมูล Passport ไม่ครบ`,
          confirmText: "ส่งออกต่อ",
          confirmIcon: "bx-arrow-to-bottom",
        })) !== null,
    });
  };
  const exportHotel = () => {
    if (!hotelDate) return;
    void download({
      key: "hotel",
      endpoint: "getHotelAccommodationReport",
      params: { date: hotelDate },
      filename: `hotel-accommodation-${hotelDate}.xlsx`,
      successMessage: hotel.data?.missing
        ? `ส่งออกรายงานแล้ว โดยมีข้อมูลไม่ครบ ${hotel.data.missing} รายการ`
        : "ส่งออกรายงาน รร. สำเร็จ",
      failureMessage: "ไม่สามารถส่งออกรายงาน รร. ได้ กรุณาลองใหม่",
    });
  };

  return (
    <main className="home documents">
      <PageHeader
        title={`เอกสาร | ${formatHeaderDate(new Date(), dateFormat)}`}
        lastUpdated={lastUpdated}
        onRefresh={() => Promise.all([immigration.refresh(), hotel.refresh()])}
      />

      {user?.admin && <ManagementExportPanel />}
      <section
        className="documents__daily"
        aria-labelledby="documents-daily-title"
      >
        <header className="documents__sectionHeader">
          <div>
            <h2 id="documents-daily-title">รายงานประจำวัน</h2>
            <p>เลือกวันที่เข้าพักสำหรับแต่ละรายงาน</p>
          </div>
          <span className="documents__format">
            <i className="bx bx-spreadsheet" aria-hidden="true" /> Excel .xlsx
          </span>
        </header>
        <div className="documents__reports">
          <DailyReportCard
            id="documents-tm30"
            title="ตม.30"
            subtitle="Immigration Report"
            icon="bx-user-id-card"
            accent="tm30"
            readiness={immigration}
            exporting={Boolean(busy.tm30)}
            exportError={errors.tm30}
            exportLabel="ส่งออก Excel"
            date={immigrationDate}
            onDateChange={(value) => {
              setImmigrationDate(value);
              clearError("tm30");
            }}
            disabled={!immigrationDate}
            onExport={exportImmigration}
            onRetry={() => {
              void immigration.refresh().catch(() => {});
            }}
          />
          <DailyReportCard
            id="documents-hotel"
            title="รายงาน รร."
            subtitle="Hotel Accommodation Report"
            icon="bx-building-house"
            accent="hotel"
            readiness={hotel}
            exporting={Boolean(busy.hotel)}
            exportError={errors.hotel}
            exportLabel="ส่งออก Excel"
            date={hotelDate}
            onDateChange={(value) => {
              setHotelDate(value);
              clearError("hotel");
            }}
            disabled={!hotelDate}
            onExport={exportHotel}
            onRetry={() => {
              void hotel.refresh().catch(() => {});
            }}
          />
        </div>
      </section>
      {confirmation.dialog}
    </main>
  );
};

export default Documents;
