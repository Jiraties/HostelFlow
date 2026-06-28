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
};

type PassportReportStatus = {
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

const bookingStatusOptions = [
  { value: "all", label: "ทุกสถานะ" },
  { value: "booked", label: "ยังไม่ Check-In" },
  { value: "checkedIn", label: "Check-In แล้ว" },
  { value: "checkedOut", label: "Check-Out แล้ว" },
  { value: "noShow", label: "No-Show" },
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
  });
  const [immigrationStatus, setImmigrationStatus] =
    useState<PassportReportStatus | null>(null);
  const [immigrationStatusLoading, setImmigrationStatusLoading] =
    useState(false);
  const [hotelStatus, setHotelStatus] = useState<PassportReportStatus | null>(
    null,
  );
  const [hotelStatusLoading, setHotelStatusLoading] = useState(false);
  const [bookingExporting, setBookingExporting] = useState(false);
  const [immigrationExporting, setImmigrationExporting] = useState(false);
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

  const handleHotelExport = () => {
    toast.error("รายงาน รร. ยังไม่ได้เชื่อมต่อระบบส่งออก");
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

  const renderPassportStatus = (
    status: PassportReportStatus | null,
    loading: boolean,
  ) => {
    const hasMissing = !!status?.missing;

    return (
      <div className="documents__passportStatus">
        <div
          className={`documents__statusRow ${
            hasMissing
              ? "documents__statusRow--warning"
              : "documents__statusRow--success"
          }`}
        >
          <i className={`bx ${hasMissing ? "bx-error" : "bx-check"}`} />
          <p>
            {loading
              ? "กำลังตรวจสอบข้อมูลหนังสือเดินทาง"
              : hasMissing
                ? `ขาดข้อมูล Passport ${status?.missing} รายการ`
                : "ข้อมูลหนังสือเดินทางครบถ้วน"}
            <strong>
              {status
                ? `${status.complete} / ${status.total} รายการ`
                : "- / - รายการ"}
            </strong>
          </p>
        </div>

        {hasMissing && (
          <div className="documents__missingList">
            {status.missingBookings.slice(0, 3).map((booking) => (
              <div className="documents__missingItem" key={booking.bookingId}>
                <div>
                  <strong>{booking.name}</strong>
                  <p>{booking.bookingId}</p>
                </div>
                <span>
                  {new Date(booking.checkOut).toLocaleDateString("th-TH", {
                    day: "2-digit",
                    month: "short",
                    year: "numeric",
                    calendar: "gregory",
                  })}
                </span>
              </div>
            ))}
            {status.missing > 3 && (
              <p className="documents__missingMore">
                และอีก {status.missing - 3} รายการ
              </p>
            )}
          </div>
        )}
      </div>
    );
  };

  const getBookingReport = async () => {
    setBookingExporting(true);

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
    } finally {
      setBookingExporting(false);
    }
  };

  const getImmigrationReport = async () => {
    if (immigrationStatus?.missing) {
      const shouldContinue = window.confirm(
        `ยังมีข้อมูล Passport ขาด ${immigrationStatus.missing} รายการ ต้องการส่งออกต่อหรือไม่?`,
      );

      if (!shouldContinue) return;
    }

    setImmigrationExporting(true);

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
    } finally {
      setImmigrationExporting(false);
    }
  };

  useEffect(() => {
    let ignore = false;

    const getImmigrationReportStatus = async () => {
      setImmigrationStatusLoading(true);

      try {
        const response = await axios.get<PassportReportStatus>(
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

  useEffect(() => {
    let ignore = false;

    const getHotelReportStatus = async () => {
      setHotelStatusLoading(true);

      try {
        const response = await axios.get<PassportReportStatus>(
          `${API_URL}/documents/getImmigrationReportStatus`,
          {
            params: {
              month: filters.hotelMonth,
            },
            withCredentials: true,
          },
        );

        if (!ignore) setHotelStatus(response.data);
      } catch (err) {
        console.error(err);
        if (!ignore) {
          setHotelStatus(null);
          toast.error("ไม่สามารถโหลดสถานะข้อมูล Passport สำหรับรายงาน รร. ได้");
        }
      } finally {
        if (!ignore) setHotelStatusLoading(false);
      }
    };

    getHotelReportStatus();

    return () => {
      ignore = true;
    };
  }, [filters.hotelMonth]);

  return (
    <main className="home">
      <PageHeader
        title={`เอกสาร | ${fullFormattedDate}`}
        lastUpdated={lastUpdated}
        onRefresh={() => Promise.resolve()}
      />

      <section className="documents__overview">
        <div>
          <i className="bx bx-file" />
          <p>รายงานพร้อมส่งออก</p>
          <strong>2</strong>
        </div>
        <div>
          <i className="bx bx-id-card" />
          <p>ตม. Passport ครบ</p>
          <strong>
            {immigrationStatus
              ? `${immigrationStatus.complete}/${immigrationStatus.total}`
              : "-/-"}
          </strong>
        </div>
        <div>
          <i className="bx bx-building-house" />
          <p>รร. Passport ครบ</p>
          <strong>
            {hotelStatus
              ? `${hotelStatus.complete}/${hotelStatus.total}`
              : "-/-"}
          </strong>
        </div>
      </section>

      <div className="documents__exports">
        <div className="documents__export documents__export--booking">
          <div className="documents__exportHeader">
            <i className="bx bx-file documents__exportIcon documents__exportIcon--booking" />
            <div>
              <h3>ข้อมูลการจอง</h3>
              <p>Booking Data Export</p>
            </div>
          </div>

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
              text={bookingExporting ? "กำลังส่งออก..." : "ส่งออก Excel"}
              icon={bookingExporting ? "bx-loader-alt" : "bx-cloud-download"}
              highlight
              className="documents__action documents__action--primary"
              onClick={getBookingReport}
              disabled={bookingExporting}
            />
          </div>
        </div>

        <div className="documents__export documents__export--tm30">
          <div className="documents__exportHeader">
            <i className="bx bx-id-card documents__exportIcon documents__exportIcon--tm30" />
            <div>
              <h3>ตม.30</h3>
              <p>Immigration Report</p>
            </div>
          </div>

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

          {renderPassportStatus(immigrationStatus, immigrationStatusLoading)}

          <div className="documents__actions">
            <ActionButton
              text={immigrationExporting ? "กำลังส่งออก..." : "ส่งออกไฟล์ ตม."}
              icon={immigrationExporting ? "bx-loader-alt" : "bx-download"}
              highlight
              className="documents__action documents__action--blue"
              onClick={getImmigrationReport}
              disabled={immigrationExporting}
            />
          </div>
        </div>
        <div className="documents__export documents__export--hotel">
          <div className="documents__exportHeader">
            <i className="bx bx-building-house documents__exportIcon documents__exportIcon--hotel" />
            <div>
              <h3>รายงาน รร.</h3>
              <p>Hotel Accommodation Report</p>
            </div>
          </div>

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
          </div>

          {renderPassportStatus(hotelStatus, hotelStatusLoading)}

          <div className="documents__actions">
            <ActionButton
              text="ยังไม่เชื่อมต่อระบบส่งออก"
              icon="bx-download"
              className="documents__action documents__action--orange"
              onClick={handleHotelExport}
            />
          </div>
        </div>
      </div>
    </main>
  );
};

export default Documents;
