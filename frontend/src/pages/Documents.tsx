import "./Documents.css";

import toast from "react-hot-toast";
import Select from "react-select";
import ActionButton from "../components/ActionButton";
import PageHeader from "../components/PageHeader";

import axios from "axios";
import { useEffect, useState } from "react";
import { customStyles } from "../helpers/selectStyling";
import { API_URL } from "../config/api";
import { paymentMethodOptions, platformOptions } from "../helpers/options";

import type { SingleValue } from "react-select";
import type { OptionType } from "../helpers/selectStyling";

type DocumentFilters = {
  bookingMonth: string;
  tm30Month: string;
  hotelMonth: string;
  bookingChannel: string;
  bookingStatus: string;
  paymentMethod: string;
  reportType: string;
  roomGroup: string;
};

type ImmigrationReportStatus = {
  total: number;
  complete: number;
  missing: number;
  missingBookings: {
    bookingId: string;
    name: string;
    checkOut: string;
  }[];
};

const formatInputMonth = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");

  return `${year}-${month}`;
};

const formatThaiMonth = (value: string) => {
  const [year, month] = value.split("-").map(Number);
  if (!year || !month) return "";

  return new Intl.DateTimeFormat("th-TH", {
    calendar: "gregory",
    month: "long",
    year: "numeric",
  }).format(new Date(year, month - 1, 1));
};

const bookingStatusOptions = [
  { value: "all", label: "ทุกสถานะ" },
  { value: "booked", label: "ยังไม่ Check-In" },
  { value: "checkedIn", label: "Check-In แล้ว" },
  { value: "checkedOut", label: "Check-Out แล้ว" },
];

const reportTypeOptions = [
  { value: "dailySummary", label: "สรุปรายวัน" },
  { value: "guestList", label: "รายชื่อผู้เข้าพัก" },
  { value: "nationality", label: "สถิติสัญชาติ" },
];

const roomGroupOptions = [
  { value: "all", label: "ทั้งหมด" },
  { value: "Balcony", label: "Balcony / Window" },
  { value: "Pottery", label: "Pottery" },
  { value: "Siesta", label: "Siesta" },
  { value: "Marquisette", label: "Marquisette" },
  { value: "Homespan", label: "Homespan" },
  { value: "Veranda", label: "Veranda" },
  { value: "Wicker", label: "Wicker" },
];

const nationalityStats = [
  { code: "TH", flag: "🇹🇭", count: 12, percent: "54.5%" },
  { code: "US", flag: "🇺🇸", count: 4, percent: "18.2%" },
  { code: "JP", flag: "🇯🇵", count: 3, percent: "13.6%" },
  { code: "อื่นๆ", flag: "", count: 3, percent: "13.6%" },
];

const Documents = () => {
  const today = new Date();
  const currentMonth = formatInputMonth(today);
  const [filters, setFilters] = useState<DocumentFilters>({
    bookingMonth: currentMonth,
    tm30Month: currentMonth,
    hotelMonth: currentMonth,
    bookingChannel: "",
    bookingStatus: "all",
    paymentMethod: "all",
    reportType: "dailySummary",
    roomGroup: "all",
  });
  const [immigrationStatus, setImmigrationStatus] =
    useState<ImmigrationReportStatus | null>(null);
  const [immigrationStatusLoading, setImmigrationStatusLoading] =
    useState(false);
  const fullFormattedDate = new Intl.DateTimeFormat("th-TH", {
    day: "numeric",
    month: "long",
    year: "numeric",
    calendar: "gregory",
  }).format(new Date());
  const lastUpdated = new Date();

  const selectValue = (options: OptionType[], value: string) =>
    options.find((option) => option.value === value) || null;

  const updateFilter = (key: keyof DocumentFilters, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  const handleAction = (documentName: string, action: "export" | "preview") => {
    toast.success(
      `${action === "export" ? "เตรียมส่งออก" : "เปิดตัวอย่าง"} ${documentName} (frontend only)`,
    );
  };

  const renderSelect = (
    options: OptionType[],
    value: string,
    onChange: (value: string) => void,
    placeholder = "เลือก",
  ) => (
    <Select<OptionType>
      styles={customStyles<OptionType>()}
      classNamePrefix="rs"
      placeholder={placeholder}
      menuPortalTarget={document.body}
      options={options}
      value={selectValue(options, value)}
      onChange={(option: SingleValue<OptionType>) =>
        onChange(option?.value || "")
      }
    />
  );

  const getBookingReport = async () => {
    try {
      const response = await axios.get(
        `${API_URL}/documents/getBookingsReport`,
        {
          params: {
            month: filters.bookingMonth,
            bookingChannel: filters.bookingChannel,
            bookingStatus: filters.bookingStatus,
            paymentMethod: filters.paymentMethod,
          },
          responseType: "blob",
          withCredentials: true,
        },
      );

      const downloadUrl = URL.createObjectURL(response.data);
      const link = document.createElement("a");

      link.href = downloadUrl;
      link.download = `bookings-${filters.bookingMonth}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(downloadUrl);

      toast.success("ส่งออกรายงานการจองสำเร็จ");
    } catch (err) {
      console.error(err);
      toast.error("ไม่สามารถส่งออกรายงานการจองได้");
    }
  };

  const getImmigrationReport = async () => {
    if (immigrationStatus?.missing) {
      const shouldContinue = window.confirm(
        `ยังมีข้อมูล Passport ขาด ${immigrationStatus.missing} รายการ ต้องการส่งออกต่อหรือไม่?`,
      );

      if (!shouldContinue) return;
    }

    try {
      const response = await axios.get(
        `${API_URL}/documents/getImmigrationReport`,
        {
          params: {
            month: filters.tm30Month,
          },
          responseType: "blob",
          withCredentials: true,
        },
      );

      const downloadUrl = URL.createObjectURL(response.data);
      const link = document.createElement("a");

      link.href = downloadUrl;
      link.download = `tm30-${filters.tm30Month}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(downloadUrl);
      toast.success("ส่งออกไฟล์ ตม. สำเร็จ");
    } catch (err) {
      console.error(err);
      toast.error("ไม่สามารถส่งออกรายงานการจองได้");
    }
  };

  useEffect(() => {
    let ignore = false;

    const getImmigrationReportStatus = async () => {
      setImmigrationStatusLoading(true);

      try {
        const response = await axios.get<ImmigrationReportStatus>(
          `${API_URL}/documents/getImmigrationReportStatus`,
          {
            params: {
              month: filters.tm30Month,
            },
            withCredentials: true,
          },
        );

        if (!ignore) setImmigrationStatus(response.data);
      } catch (err) {
        console.error(err);
        if (!ignore) {
          setImmigrationStatus(null);
          toast.error("ไม่สามารถโหลดสถานะข้อมูล Passport ได้");
        }
      } finally {
        if (!ignore) setImmigrationStatusLoading(false);
      }
    };

    getImmigrationReportStatus();

    return () => {
      ignore = true;
    };
  }, [filters.tm30Month]);

  const showMissingImmigrationDetails = () => {
    if (!immigrationStatus?.missingBookings.length) return;

    toast(
      immigrationStatus.missingBookings
        .slice(0, 5)
        .map((booking) => `${booking.name} (${booking.bookingId})`)
        .join("\n") +
        (immigrationStatus.missingBookings.length > 5
          ? `\nและอีก ${immigrationStatus.missingBookings.length - 5} รายการ`
          : ""),
      { duration: 8000 },
    );
  };

  return (
    <main className="home">
      <PageHeader
        title={`เอกสาร | ${fullFormattedDate}`}
        lastUpdated={lastUpdated}
        onRefresh={() => Promise.resolve()}
      />

      <div className="documents__exports">
        <div className="documents__export">
          <div className="documents__exportHeader">
            <i
              className="bx bx-file"
              style={{
                color: "var(--primary-color)",
                backgroundColor: "#51d1dc15",
              }}
            />
            <div>
              <h3>ข้อมูลการจอง</h3>
              <p>Booking Data Export</p>
            </div>
          </div>

          <p className="documents__exportDescription">
            ส่งออกข้อมูลการจอง รายได้ ช่องทางการจอง และสถานะการเข้าพัก
          </p>

          <div className="documents__form">
            <div>
              <p className="documents__label">เดือน</p>
              <input
                type="month"
                value={filters.bookingMonth}
                onChange={(e) => updateFilter("bookingMonth", e.target.value)}
                className="boxInput"
              />
            </div>

            <div className="documents__fieldGrid">
              <div>
                <p className="documents__label">ช่องทางการจอง</p>
                {renderSelect(
                  [{ value: "", label: "ทุกช่องทาง" }, ...platformOptions],
                  filters.bookingChannel,
                  (value) => updateFilter("bookingChannel", value),
                  "ทุกช่องทาง",
                )}
              </div>
              <div>
                <p className="documents__label">สถานะการจอง</p>
                {renderSelect(
                  bookingStatusOptions,
                  filters.bookingStatus,
                  (value) => updateFilter("bookingStatus", value),
                )}
              </div>
            </div>

            <div>
              <p className="documents__label">ประเภทการชำระเงิน</p>
              {renderSelect(
                [{ value: "all", label: "ทุกประเภท" }, ...paymentMethodOptions],
                filters.paymentMethod,
                (value) => updateFilter("paymentMethod", value),
              )}
            </div>
          </div>

          <div className="documents__actions">
            <ActionButton
              text="ส่งออก Excel"
              icon="bx-cloud-download"
              highlight
              className="documents__action documents__action--primary"
              onClick={getBookingReport}
            />
            {/* <ActionButton
              text="ดูตัวอย่าง"
              icon="bx-show"
              className="documents__action"
              onClick={() => handleAction("ข้อมูลการจอง", "preview")}
            /> */}
          </div>
        </div>

        <div className="documents__export">
          <div className="documents__exportHeader">
            <i
              className="bx bx-file"
              style={{
                color: "#2F6FD6",
                backgroundColor: "#2F6FD615",
              }}
            />
            <div>
              <h3>ตม.30</h3>
              <p>Immigration Report</p>
            </div>
          </div>

          <p className="documents__exportDescription">
            สร้างไฟล์ข้อมูลผู้เข้าพักสำหรับส่งสำนักงานตรวจคนเข้าเมือง
          </p>

          <div className="documents__form">
            <div>
              <p className="documents__label">เดือนเข้าพัก</p>
              <input
                type="month"
                value={filters.tm30Month}
                onChange={(e) => updateFilter("tm30Month", e.target.value)}
                className="boxInput"
              />
            </div>
          </div>

          <div className="documents__tm30Status">
            <div className="documents__statusRow documents__statusRow--success">
              <i className="bx bx-check" />
              <p>
                {immigrationStatusLoading
                  ? "กำลังตรวจสอบข้อมูลหนังสือเดินทาง"
                  : "ข้อมูลหนังสือเดินทางครบถ้วน"}
                <strong>
                  {immigrationStatus
                    ? `${immigrationStatus.complete} / ${immigrationStatus.total} รายการ`
                    : "- / - รายการ"}
                </strong>
              </p>
            </div>
            {!!immigrationStatus?.missing && (
              <div className="documents__statusRow documents__statusRow--warning">
                <i className="bx bx-error" />
                <p>ขาดข้อมูล Passport {immigrationStatus.missing} รายการ</p>
                <button type="button" onClick={showMissingImmigrationDetails}>
                  ดูรายละเอียด
                </button>
              </div>
            )}
          </div>

          <div className="documents__actions">
            <ActionButton
              text="ส่งออกไฟล์ ตม."
              icon="bx-download"
              highlight
              className="documents__action documents__action--blue"
              onClick={getImmigrationReport}
            />
          </div>
        </div>
        <div className="documents__export">
          <div className="documents__exportHeader">
            <i
              className="bx bx-file"
              style={{
                color: "#F4A900",
                backgroundColor: "#F4A90015",
              }}
            />
            <div>
              <h3>รายงาน รร.</h3>
              <p>Hotel Accommodation Report</p>
            </div>
          </div>

          <p className="documents__exportDescription">
            สร้างรายงานผู้เข้าพักและสถิติสำหรับงานเอกสารโรงแรม
          </p>

          <div className="documents__form">
            <div>
              <p className="documents__label">เดือน</p>
              <input
                type="month"
                value={filters.hotelMonth}
                onChange={(e) => updateFilter("hotelMonth", e.target.value)}
                className="boxInput"
              />
            </div>

            <div>
              <p className="documents__label">รูปแบบรายงาน</p>
              {renderSelect(reportTypeOptions, filters.reportType, (value) =>
                updateFilter("reportType", value),
              )}
            </div>

            <div>
              <p className="documents__label">กลุ่มห้องพัก</p>
              {renderSelect(
                roomGroupOptions,
                filters.roomGroup,
                (value) => updateFilter("roomGroup", value),
                "ทั้งหมด",
              )}
            </div>
          </div>

          <div className="documents__hotelStats">
            <div className="documents__hotelStatsHeader">
              <p>สรุปสถิติ ({formatThaiMonth(filters.hotelMonth)})</p>
              <p>
                ผู้เข้าพักทั้งหมด <strong>22</strong>
              </p>
            </div>
            <div className="documents__nationalities">
              {nationalityStats.map((stat) => (
                <div className="documents__nationality" key={stat.code}>
                  <p>
                    <span>{stat.flag}</span>
                    {stat.code}
                  </p>
                  <strong>{stat.count}</strong>
                  <small>{stat.percent}</small>
                </div>
              ))}
            </div>
          </div>

          <div className="documents__actions">
            <ActionButton
              text="ส่งออก Excel"
              icon="bx-download"
              highlight
              className="documents__action documents__action--orange"
              onClick={() => handleAction("รายงาน รร.", "export")}
            />
            <ActionButton
              text="ดูตัวอย่าง"
              icon="bx-show"
              className="documents__action"
              onClick={() => handleAction("รายงาน รร.", "preview")}
            />
          </div>
        </div>
      </div>
    </main>
  );
};

export default Documents;
