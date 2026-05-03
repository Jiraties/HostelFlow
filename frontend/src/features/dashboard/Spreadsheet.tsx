import { AgGridProvider, AgGridReact } from "ag-grid-react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { AllCommunityModule } from "ag-grid-community";
import { themeQuartz } from "ag-grid-community";
import type {
  CellClassParams,
  ColDef,
  GridReadyEvent,
  ICellRendererParams,
  IsFullWidthRowParams,
  GridApi,
  RowClickedEvent,
  RowHeightParams,
  ValueFormatterParams,
  ValueGetterParams,
} from "ag-grid-community";
import type { booking } from "../../types/bookingTypes";
import "./Spreadsheet.css";
import { platformMap } from "../../helpers/maps.ts";

type SpreadsheetStatus = "arrivals" | "departures" | "master";

type SeparatorRow = {
  __separator: true;
  dateKey: string;
  dateLabel: string;
  isToday?: boolean;
};

type SpreadsheetRow = booking | SeparatorRow;

const isSeparatorRow = (
  row: SpreadsheetRow | undefined,
): row is SeparatorRow => !!row && "__separator" in row;

const separatorDateKey = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
};

const inputDateToLocalDate = (value?: string) => {
  if (!value) return null;

  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;

  return new Date(year, month - 1, day);
};

const dateKeyIsInRange = (dateKey: string, from?: string, to?: string) => {
  const date = inputDateToLocalDate(dateKey);
  const fromDate = inputDateToLocalDate(from);
  const toDate = inputDateToLocalDate(to);

  if (!date) return false;
  if (fromDate && date < fromDate) return false;
  if (toDate && date > toDate) return false;

  return true;
};

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

const platformCell = (params: ICellRendererParams<SpreadsheetRow, string>) => {
  const platform = platformMap[params.value as keyof typeof platformMap];

  if (!platform) return null;

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
  status,
  masterRange,
}: {
  bookings: booking[];
  setViewBookingBooking: (booking: booking) => void;
  loading: boolean;
  status: SpreadsheetStatus;
  masterRange?: {
    from: string;
    to: string;
  };
}) => {
  const modules = [AllCommunityModule];
  const isMaster = status === "master";
  const gridApiRef = useRef<GridApi<SpreadsheetRow> | null>(null);
  const hasScrolledToTodayRef = useRef(false);
  const todayKey = separatorDateKey(new Date());

  const dateValueFormater = (
    params: ValueFormatterParams<SpreadsheetRow, Date>,
  ) =>
    params.value
      ? new Intl.DateTimeFormat("th-TH", {
          calendar: "gregory",
          day: "numeric",
          month: "short",
          year: "2-digit",
        }).format(params.value)
      : "";

  const separatorDateFormatter = (date: Date) =>
    new Intl.DateTimeFormat("th-TH", {
      calendar: "gregory",
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(date);

  const rowData = useMemo<SpreadsheetRow[]>(() => {
    if (!isMaster) return bookings;

    const sortedBookings = [...bookings].sort((a, b) => {
      const checkInDiff = a.checkIn.getTime() - b.checkIn.getTime();
      if (checkInDiff !== 0) return checkInDiff;

      const checkOutDiff = a.checkOut.getTime() - b.checkOut.getTime();
      if (checkOutDiff !== 0) return checkOutDiff;

      return a.name.localeCompare(b.name);
    });

    const rows: SpreadsheetRow[] = [];
    let currentDateKey = "";
    let todaySeparatorExists = false;

    sortedBookings.forEach((booking) => {
      const dateKey = separatorDateKey(booking.checkIn);

      if (dateKey !== currentDateKey) {
        if (
          !todaySeparatorExists &&
          dateKey > todayKey &&
          dateKeyIsInRange(todayKey, masterRange?.from, masterRange?.to)
        ) {
          rows.push({
            __separator: true,
            dateKey: todayKey,
            dateLabel: `วันนี้ | ${separatorDateFormatter(new Date())}`,
            isToday: true,
          });
          todaySeparatorExists = true;
        }

        rows.push({
          __separator: true,
          dateKey,
          dateLabel:
            dateKey === todayKey
              ? `วันนี้ | ${separatorDateFormatter(booking.checkIn)}`
              : separatorDateFormatter(booking.checkIn),
          isToday: dateKey === todayKey,
        });
        if (dateKey === todayKey) todaySeparatorExists = true;
        currentDateKey = dateKey;
      }

      rows.push(booking);
    });

    if (
      !todaySeparatorExists &&
      dateKeyIsInRange(todayKey, masterRange?.from, masterRange?.to)
    ) {
      rows.push({
        __separator: true,
        dateKey: todayKey,
        dateLabel: `วันนี้ | ${separatorDateFormatter(new Date())}`,
        isToday: true,
      });
      rows.sort((a, b) => {
        const aDateKey = isSeparatorRow(a) ? a.dateKey : separatorDateKey(a.checkIn);
        const bDateKey = isSeparatorRow(b) ? b.dateKey : separatorDateKey(b.checkIn);

        return aDateKey.localeCompare(bDateKey);
      });
    }

    return rows;
  }, [bookings, isMaster, masterRange?.from, masterRange?.to, todayKey]);

  const scrollToTodaySeparator = useCallback(() => {
    const api = gridApiRef.current;
    if (!api || !isMaster || loading || hasScrolledToTodayRef.current) return;

    const todayRowIndex = rowData.findIndex(
      (row) => isSeparatorRow(row) && row.dateKey === todayKey,
    );

    if (todayRowIndex === -1) return;

    api.ensureIndexVisible(todayRowIndex, "top");
    hasScrolledToTodayRef.current = true;
  }, [isMaster, loading, rowData, todayKey]);

  useEffect(() => {
    if (isMaster) return;
    hasScrolledToTodayRef.current = false;
  }, [isMaster]);

  useEffect(() => {
    scrollToTodaySeparator();
  }, [scrollToTodaySeparator]);

  const colDefs = useMemo<ColDef<SpreadsheetRow>[]>(
    () => [
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
      valueGetter: (params: ValueGetterParams<SpreadsheetRow>) => {
        if (isSeparatorRow(params.data)) return "";
        return params.data?.roomStays?.map((roomStay) => roomStay.roomId).join(", ") || "";
      },
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
      valueGetter: (params: ValueGetterParams<SpreadsheetRow>) => {
        if (isSeparatorRow(params.data)) return undefined;
        return params.data?.transactions?.find(
          (transaction) => transaction.type === "roomCharge",
        )?.amount;
      },
      valueFormatter: (
        params: ValueFormatterParams<SpreadsheetRow, number | undefined>,
      ) =>
        params.value == null
          ? ""
          : new Intl.NumberFormat("th-TH", {
              style: "currency",
              currency: "THB",
              minimumFractionDigits: 0,
              currencyDisplay: "code",
            }).format(params.value),
    },
    {
      valueGetter: (params: ValueGetterParams<SpreadsheetRow>) => {
        if (isSeparatorRow(params.data)) return "";
        return params.data?.transactions?.find(
          (transaction) => transaction.type === "roomCharge",
        )?.paymentMethod;
      },
      headerName: "ช่องทางการจ่าย",
      filter: true,
      cellClassRules: {
        red: (param: CellClassParams<SpreadsheetRow>) =>
          param.value === "Unpaid",
      },
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
        notCheckedIn: (param: CellClassParams<SpreadsheetRow>) => {
          return param.value === "booked";
        },
        checkedIn: (param: CellClassParams<SpreadsheetRow>) => {
          return param.value === "checkedIn";
        },
        checkedOut: (param: CellClassParams<SpreadsheetRow>) => {
          return param.value === "checkedOut";
        },
      },
      valueFormatter: (
        params: ValueFormatterParams<SpreadsheetRow, string | undefined>,
      ) => {
        if (params.value === "booked") return "ยังไม่ Check-In";
        if (params.value === "checkedIn") return "Check-In แล้ว";
        if (params.value === "checkedOut") return "Check-Out แล้ว";
        return "";
      },
      sort: isMaster ? undefined : "asc",
    },
    ],
    [isMaster],
  );

  const onRowDoubleClicked = (event: RowClickedEvent<SpreadsheetRow>) => {
    if (!event.data || isSeparatorRow(event.data)) return;
    setViewBookingBooking(event.data);
  };

  const onGridReady = (params: GridReadyEvent<SpreadsheetRow>) => {
    const api = params.api;
    gridApiRef.current = api;

    if (loading) api.showLoadingOverlay();
    window.requestAnimationFrame(scrollToTodaySeparator);
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
          key={status}
          rowData={rowData}
          columnDefs={colDefs}
          theme={myTheme}
          onGridReady={onGridReady}
          autoSizeStrategy={{ type: "fitCellContents" }}
          getRowId={(params) =>
            isSeparatorRow(params.data)
              ? `separator-${params.data.dateKey}`
              : `booking-${status}-${params.data.bookingId}`
          }
          onRowClicked={onRowDoubleClicked}
          isFullWidthRow={(params: IsFullWidthRowParams<SpreadsheetRow>) =>
            isMaster && isSeparatorRow(params.rowNode.data)
          }
          fullWidthCellRenderer={(
            params: ICellRendererParams<SpreadsheetRow>,
          ) => (
            <div className="daySeparator">
              <span>
                {isSeparatorRow(params.data) ? params.data.dateLabel : ""}
              </span>
            </div>
          )}
          getRowHeight={(params: RowHeightParams<SpreadsheetRow>) =>
            isSeparatorRow(params.data) ? 42 : undefined
          }
          loadingOverlayComponent={CustomLoadingOverlay}
          onFirstDataRendered={scrollToTodaySeparator}
          onRowDataUpdated={scrollToTodaySeparator}
          getRowClass={(params) =>
            isSeparatorRow(params.data) && params.data.isToday
              ? "ag-row-todaySeparator"
              : undefined
          }
        />
      </div>
    </AgGridProvider>
  );
};

export default Spreadsheet;
