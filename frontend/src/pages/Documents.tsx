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
import { passportReadinessKind } from "../features/documents/documentReports";
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
  const dateFormat = user?.settings.dateFormat || "dd/MM/yyyy";
  const lastUpdated =
    immigration.updatedAt && hotel.updatedAt
      ? new Date(
          Math.min(immigration.updatedAt.getTime(), hotel.updatedAt.getTime()),
        )
      : null;
  const reportStates = [
    passportReadinessKind(immigration),
    passportReadinessKind(hotel),
  ];
  const readyReports = reportStates.some(
    (state) => state === "loading" || state === "error",
  )
    ? "–"
    : reportStates.filter((state) => state === "ready").length;

  const exportImmigration = () => {
    if (!immigrationDate) return;
    void download({
      key: "tm30",
      endpoint: "getImmigrationReport",
      params: { date: immigrationDate },
      filename: `tm30-${immigrationDate}.xlsx`,
      successMessage: "ส่งออกไฟล์ ตม. สำเร็จ",
      failureMessage: "ไม่สามารถส่งออกรายงาน ตม.30 ได้ กรุณาลองใหม่",
      confirm: () =>
        !immigration.data?.missing ||
        window.confirm(
          `ยังมีข้อมูล Passport ขาด ${immigration.data.missing} รายการ ต้องการส่งออกต่อหรือไม่?`,
        ),
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
      <section className="documents__overview" aria-label="ภาพรวมรายงาน">
        <div>
          <i className="bx bx-file" aria-hidden="true" />
          <p>รายงานพร้อมส่งออก</p>
          <strong>{readyReports}</strong>
        </div>
        <div>
          <i className="bx bx-user-id-card" aria-hidden="true" />
          <p>ตม. Passport ครบ</p>
          <strong>
            {immigration.data
              ? `${immigration.data.complete}/${immigration.data.total}`
              : "-/-"}
          </strong>
        </div>
        <div>
          <i className="bx bx-building-house" aria-hidden="true" />
          <p>รร. Passport ครบ</p>
          <strong>
            {hotel.data ? `${hotel.data.complete}/${hotel.data.total}` : "-/-"}
          </strong>
        </div>
      </section>
      <section
        className={`documents__exports${user?.admin ? " documents__exports--admin" : ""}`}
        aria-label="เอกสารสำหรับส่งออก"
      >
        {user?.admin && <ManagementExportPanel />}
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
      </section>
    </main>
  );
};

export default Documents;
