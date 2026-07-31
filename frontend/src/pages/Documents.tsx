import "./Documents.css";

import toast from "react-hot-toast";
import Select from "react-select";
import ActionButton from "../components/ActionButton";
import PageHeader from "../components/PageHeader";
import { PreferredDateInput } from "../components/PreferredDateInput";

import axios from "axios";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { customStyles } from "../helpers/selectStyling";
import { API_URL } from "../config/api";
import { paymentMethodOptions, platformOptions } from "../helpers/options";
import usePageTitle from "../hooks/useTitle";
import { useAuth } from "../context/AuthContext";
import { formatDisplayDate, formatHeaderDate } from "../helpers/displayDate";

import type { SingleValue } from "react-select";
import type { OptionType } from "../helpers/selectStyling";

type DocumentFilters = {
  bookingMonth: string;
  tm30Date: string;
  hotelDate: string;
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
    guestId?: string | null;
    guestLabel?: string;
    reason?: string;
  }[];
};

const formatInputMonth = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");

  return `${year}-${month}`;
};

const formatInputDate = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
};

const bookingStatusOptions = [
  { value: "all", label: "ทุกสถานะ" },
  { value: "booked", label: "ยังไม่ Check-In" },
  { value: "checkedIn", label: "Check-In แล้ว" },
  { value: "checkedOut", label: "Check-Out แล้ว" },
  { value: "noShow", label: "No-Show" },
];

const Documents = () => {
  usePageTitle("HostelFlow · เอกสาร");
  const { user } = useAuth();
  const navigate = useNavigate();
  const dateFormat = user?.settings.dateFormat || "dd/MM/yyyy";
  const today = new Date();
  const currentMonth = formatInputMonth(today);
  const currentDate = formatInputDate(today);
  const [filters, setFilters] = useState<DocumentFilters>({
    bookingMonth: currentMonth,
    tm30Date: currentDate,
    hotelDate: currentDate,
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
  const [hotelExporting, setHotelExporting] = useState(false);
  const fullFormattedDate = formatHeaderDate(new Date(), dateFormat);
  const lastUpdated = new Date();

  const selectValue = (options: OptionType[], value: string) =>
    options.find((option) => option.value === value) || null;

  const updateFilter = (key: keyof DocumentFilters, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
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
          <i
            className={`bx ${hasMissing ? "bx-alert-triangle" : "bx-check"}`}
          />
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
              <button
                className="documents__missingItem"
                key={`${booking.bookingId}-${booking.guestId || booking.guestLabel || "primary"}`}
                type="button"
                onClick={() =>
                  navigate(
                    `/master?bookingId=${encodeURIComponent(booking.bookingId)}`,
                  )
                }
              >
                <div className="documents__missingPrimary">
                  <strong>{booking.name}</strong>
                  <p>
                    {booking.bookingId}
                    {booking.guestLabel ? ` · ${booking.guestLabel}` : ""}
                    {booking.reason ? ` - ${booking.reason}` : ""}
                  </p>
                </div>
                <div className="documents__missingMeta">
                  <strong>{booking.reason || "Passport ไม่ครบ"}</strong>
                  <span>{formatDisplayDate(booking.checkOut, dateFormat)}</span>
                </div>
              </button>
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
            date: filters.tm30Date,
          },
          responseType: "blob",
          withCredentials: true,
        },
      );

      const downloadUrl = URL.createObjectURL(response.data);
      const link = document.createElement("a");

      link.href = downloadUrl;
      link.download = `tm30-${filters.tm30Date}.xlsx`;
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

  const getHotelAccommodationReport = async () => {
    setHotelExporting(true);

    try {
      const response = await axios.get(
        `${API_URL}/documents/getHotelAccommodationReport`,
        {
          params: {
            date: filters.hotelDate,
          },
          responseType: "blob",
          withCredentials: true,
        },
      );

      const downloadUrl = URL.createObjectURL(response.data);
      const link = document.createElement("a");

      link.href = downloadUrl;
      link.download = `hotel-accommodation-${filters.hotelDate}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(downloadUrl);
      toast.success(
        hotelStatus?.missing
          ? `ส่งออกรายงานแล้ว โดยมีข้อมูลไม่ครบ ${hotelStatus.missing} รายการ`
          : "ส่งออกรายงาน รร. สำเร็จ",
      );
    } catch (err) {
      console.error(err);
      toast.error("ไม่สามารถส่งออกรายงาน รร. ได้");
    } finally {
      setHotelExporting(false);
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
              date: filters.tm30Date,
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
  }, [filters.tm30Date]);

  useEffect(() => {
    let ignore = false;

    const getHotelReportStatus = async () => {
      setHotelStatusLoading(true);

      try {
        const response = await axios.get<PassportReportStatus>(
          `${API_URL}/documents/getHotelAccommodationReportStatus`,
          {
            params: {
              date: filters.hotelDate,
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
  }, [filters.hotelDate]);

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
          <i className="bx bx-user-id-card" />
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
              icon={bookingExporting ? "bx-loader-lines" : "bx-cloud"}
              highlight
              className="documents__action documents__action--primary"
              onClick={getBookingReport}
              disabled={bookingExporting}
            />
          </div>
        </div>

        <div className="documents__export documents__export--tm30">
          <div className="documents__exportHeader">
            <i className="bx bx-user-id-card documents__exportIcon documents__exportIcon--tm30" />
            <div>
              <h3>ตม.30</h3>
              <p>Immigration Report</p>
            </div>
          </div>

          <div className="documents__form">
            <div>
              <p className="documents__label">วันที่เข้าพัก</p>
              <PreferredDateInput
                value={filters.tm30Date}
                onChange={(e) => updateFilter("tm30Date", e.target.value)}
                className="boxInput"
              />
            </div>
          </div>

          {renderPassportStatus(immigrationStatus, immigrationStatusLoading)}

          <div className="documents__actions">
            <ActionButton
              text={immigrationExporting ? "กำลังส่งออก..." : "ส่งออกไฟล์ ตม."}
              icon={immigrationExporting ? "bx-loader-lines" : "bx-arrow-down"}
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
              <p className="documents__label">วันที่เข้าพัก</p>
              <PreferredDateInput
                value={filters.hotelDate}
                onChange={(e) => updateFilter("hotelDate", e.target.value)}
                className="boxInput"
              />
            </div>
          </div>

          {renderPassportStatus(hotelStatus, hotelStatusLoading)}

          <div className="documents__actions">
            <ActionButton
              text={hotelExporting ? "กำลังส่งออก..." : "ส่งออกรายงาน รร."}
              icon={hotelExporting ? "bx-loader-lines" : "bx-arrow-down"}
              highlight
              className="documents__action documents__action--orange"
              onClick={getHotelAccommodationReport}
              disabled={hotelExporting}
            />
          </div>
        </div>
      </div>
    </main>
  );
};

export default Documents;
