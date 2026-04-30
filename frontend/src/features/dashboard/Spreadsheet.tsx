import { AgGridProvider, AgGridReact } from "ag-grid-react";
import { useState, useCallback } from "react";
import { AllCommunityModule } from "ag-grid-community";
import { themeQuartz } from "ag-grid-community";
import type { booking } from "../../types/bookingTypes";
import "./Spreadsheet.css";
import { useLocation } from "react-router";
import { platformMap } from "../../helpers/maps.ts";

const myTheme = themeQuartz.withParams({
  fontFamily: "IBM Plex Sans Thai",
  accentColor: "var(--primary-color)",
  backgroundColor: "var(--background)",
  browserColorScheme: "light",
  chromeBackgroundColor: "var(--background)",
  foregroundColor: "var(--text)",
  spacing: "0.6rem",
  wrapperBorderRadius: "1rem",
  wrapperBorder: false,
});

const platformCell = (params: any) => {
  const platform = platformMap[params.value as keyof typeof platformMap];

  return (
    <div className="platformCell">
      <div
        className="platformCell__wrapper"
        style={{ backgroundColor: platform.color + "15" }}
      >
        <span
          className="platformCell__dot"
          style={{ backgroundColor: platform.color }}
        ></span>
        <p>{platform.label}</p>
      </div>
    </div>
  );
};

const CustomLoadingOverlay = () => {
  return (
    <div className="custom-loading">
      <div className="custom-loading__spinner"></div>
      <p>กำลังโหลดข้อมูล...</p>
    </div>
  );
};

const Spreadsheet = ({
  bookings,
  setViewBookingBooking,
  loading,
}: {
  bookings: booking[];
  setViewBookingBooking: (booking: booking) => void;
  loading: boolean;
}) => {
  const modules = [AllCommunityModule];
  const location = useLocation();

  const status = location.pathname.includes("arrivals")
    ? "arrivals"
    : "departures";

  const dateValueFormater = (params: any) =>
    new Intl.DateTimeFormat("th-TH", {
      calendar: "gregory",
      day: "numeric",
      month: "short",
      year: "2-digit",
    }).format(params.value);

  const [colDefs] = useState([
    { field: "name", headerName: "ชื่อ", filter: true },
    {
      field: "checkIn",
      valueFormatter: dateValueFormater,
    },
    {
      field: "checkOut",
      valueFormatter: dateValueFormater,
    },
    { field: "nights", headerName: "คืน" },
    {
      valueGetter: (params: any) =>
        params.data.roomStays?.map((r: any) => r.roomId).join(", "),
      headerName: "ห้อง",
      filter: true,
    },
    {
      field: "platformId",
      headerName: "ช่องทางการจอง",
      filter: true,
      cellRenderer: platformCell,
    },
    {
      headerName: "ค่าห้อง",
      maxWidth: 130,
      valueGetter: (params: any) =>
        params.data.transactions.find(
          (transaction) => transaction.type === "roomCharge",
        ).amount,
      valueFormatter: (params: any) =>
        new Intl.NumberFormat("th-TH", {
          style: "currency",
          currency: "THB",
          minimumFractionDigits: 0,
          currencyDisplay: "code",
        }).format(params.value),
    },
    {
      valueGetter: (params: any) =>
        params.data.transactions.find(
          (transaction) => transaction.type === "roomCharge",
        ).paymentMethod,
      headerName: "ช่องทางการจ่าย",
      filter: true,
      cellClassRules: { red: (param: any) => param.value === "Unpaid" },
    },
    { field: "bookingId", headerName: "Booking ID", sortable: false },
    {
      field: "checkedInByStaffUsername",
      headerName: "เช็คอินโดย",
    },
    { field: "note", sortable: false },
    {
      field: "status",
      headerName: "สถานะ Check-In",
      pinned: "right",
      maxWidth: 130,
      cellClassRules: {
        notCheckedIn: (param: any) => {
          return param.value === "booked";
        },
        checkedIn: (param: any) => {
          return param.value === "checkedIn";
        },
        checkedOut: (param: any) => {
          return param.value === "checkedOut";
        },
      },
      valueFormatter: (params: any) => {
        if (params.value === "booked") return "ยังไม่ Check-In";
        if (params.value === "checkedIn") return "Check-In แล้ว";
        if (params.value === "checkedOut") return "Check-Out แล้ว";
      },
      sort: "asc",
    },
  ]);

  const onRowDoubleClicked = (event: any) => {
    setViewBookingBooking(event.data);
  };

  const onGridReady = (params) => {
    const api = params.api;

    if (loading) api.showLoadingOverlay();
  };

  return (
    <AgGridProvider modules={modules}>
      <div
        style={{
          boxShadow: "rgba(149, 157, 165, 0.25) 0px 8px 24px",
          height: "100%",
          borderRadius: "1rem",
        }}
      >
        <AgGridReact
          rowData={bookings}
          columnDefs={colDefs}
          theme={myTheme}
          onGridReady={onGridReady}
          autoSizeStrategy={{ type: "fitCellContents" }}
          onRowClicked={onRowDoubleClicked}
          loadingOverlayComponent={CustomLoadingOverlay}
        />
      </div>
    </AgGridProvider>
  );
};

export default Spreadsheet;
