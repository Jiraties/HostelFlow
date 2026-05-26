import "./Documents.css";

import toast from "react-hot-toast";
import Select from "react-select";
import ActionButton from "../components/ActionButton";

import axios from "axios";
import { Link } from "react-router";
import { useState } from "react";
import { useAuth } from "../context/AuthContext";
import { customStyles } from "../helpers/selectStyling";
import { API_URL } from "../config/api";
import { paymentMethodOptions, platformOptions } from "../helpers/options";

import type { SingleValue } from "react-select";
import type { OptionType } from "../helpers/selectStyling";

type DocumentFilters = {
  from: string;
  to: string;
  bookingMonth: string;
  bookingChannel: string;
  bookingStatus: string;
  paymentMethod: string;
  tm30Type: "daily" | "guestList";
  checkInDate: string;
  nationality: string;
  reportType: string;
  roomGroup: string;
};

const formatInputDate = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
};

const formatInputMonth = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");

  return `${year}-${month}`;
};

const formatThaiDate = (value: string) => {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return "";

  return new Intl.DateTimeFormat("th-TH", {
    calendar: "gregory",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(year, month - 1, day));
};

const bookingStatusOptions = [
  { value: "all", label: "ทุกสถานะ" },
  { value: "booked", label: "ยังไม่ Check-In" },
  { value: "checkedIn", label: "Check-In แล้ว" },
  { value: "checkedOut", label: "Check-Out แล้ว" },
];

const nationalityOptions = [
  { value: "all", label: "ทั้งหมด" },
  { value: "TH", label: "ไทย" },
  { value: "US", label: "สหรัฐอเมริกา" },
  { value: "JP", label: "ญี่ปุ่น" },
  { value: "CN", label: "จีน" },
  { value: "EU", label: "ยุโรป" },
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
  const { user } = useAuth();
  const today = new Date();
  const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const lastDayOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  const [filters, setFilters] = useState<DocumentFilters>({
    from: formatInputDate(firstDayOfMonth),
    to: formatInputDate(lastDayOfMonth),
    bookingMonth: formatInputMonth(today),
    bookingChannel: "",
    bookingStatus: "all",
    paymentMethod: "all",
    tm30Type: "daily",
    checkInDate: formatInputDate(today),
    nationality: "all",
    reportType: "dailySummary",
    roomGroup: "all",
  });
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

  return (
    <main className="home">
      <header className="home__header">
        <div>
          <h1>เอกสาร | {fullFormattedDate}</h1>
          <div style={{ display: "flex", gap: "0.3rem" }}>
            <p>
              ข้อมูลอัปเดตล่าสุดเมื่อ {lastUpdated?.getHours()}:
              {lastUpdated?.getMinutes().toString().padStart(2, "0")}
            </p>
            <i
              className="bx bx-refresh home__refreshIcon"
              onClick={() => {
                toast.promise(() => Promise.resolve(), {
                  loading: "กำลังอัปเดตข้อมูล...",
                  success: "อัปเดตข้อมูลสำเร็จ",
                  error: "เกิดข้อผิดพลาดในการอัปเดตข้อมูล",
                });
              }}
            />
          </div>
        </div>

        <div className="home__headerProfile">
          <p>
            {user?.name} <strong>{"  " + (user?.admin ? " Admin" : "")}</strong>
          </p>
          <Link to={"/settings"}>
            <img
              className="home__profileImg"
              src="https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcR3m972e8FEvBi7ETC03avlJcZDg8nT9dWLSw&s"
              alt="profilePicture"
            />
          </Link>
        </div>
      </header>

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

          <div className="documents__segmentedControl">
            <button
              type="button"
              className={
                filters.tm30Type === "daily"
                  ? "documents__segment documents__segment--active"
                  : "documents__segment"
              }
              onClick={() => updateFilter("tm30Type", "daily")}
            >
              รายวัน (TM30)
            </button>
            <button
              type="button"
              className={
                filters.tm30Type === "guestList"
                  ? "documents__segment documents__segment--active"
                  : "documents__segment"
              }
              onClick={() => updateFilter("tm30Type", "guestList")}
            >
              รายชื่อเข้าพัก
            </button>
          </div>

          <div className="documents__form">
            <div>
              <p className="documents__label">วันที่เข้าพัก</p>
              <input
                type="date"
                value={filters.checkInDate}
                onChange={(e) => updateFilter("checkInDate", e.target.value)}
                className="boxInput"
              />
            </div>

            <div>
              <p className="documents__label">สัญชาติ</p>
              {renderSelect(nationalityOptions, filters.nationality, (value) =>
                updateFilter("nationality", value),
              )}
            </div>
          </div>

          <div className="documents__tm30Status">
            <div className="documents__statusRow documents__statusRow--success">
              <i className="bx bx-check" />
              <p>
                ข้อมูลหนังสือเดินทางครบถ้วน
                <strong>18 / 22 รายการ</strong>
              </p>
            </div>
            <div className="documents__statusRow documents__statusRow--warning">
              <i className="bx bx-error" />
              <p>ขาดข้อมูล Passport 4 รายการ</p>
              <button type="button">ดูรายละเอียด</button>
            </div>
          </div>

          <div className="documents__actions">
            <ActionButton
              text="ส่งออกไฟล์ ตม."
              icon="bx-download"
              highlight
              className="documents__action documents__action--blue"
              onClick={() => handleAction("ตม.30", "export")}
            />
            <ActionButton
              text="ดูตัวอย่าง"
              icon="bx-show"
              className="documents__action"
              onClick={() => handleAction("ตม.30", "preview")}
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
              <p className="documents__label">ช่วงวันที่</p>
              <div className="home__dateInputs documents__dateInputs">
                <input
                  type="date"
                  value={filters.from}
                  onChange={(e) => updateFilter("from", e.target.value)}
                  className="boxInput home__dateInput"
                />
                <input
                  type="date"
                  value={filters.to}
                  onChange={(e) => updateFilter("to", e.target.value)}
                  className="boxInput home__dateInput"
                />
              </div>
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
              <p>
                สรุปสถิติ ({formatThaiDate(filters.from)} -{" "}
                {formatThaiDate(filters.to)})
              </p>
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
