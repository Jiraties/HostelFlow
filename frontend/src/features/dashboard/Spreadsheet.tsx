import { AgGridProvider, AgGridReact } from "ag-grid-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AllCommunityModule } from "ag-grid-community";
import { themeQuartz } from "ag-grid-community";
import type {
  BodyScrollEndEvent,
  CellClassParams,
  ColDef,
  ColumnMovedEvent,
  GridReadyEvent,
  ICellRendererParams,
  IsFullWidthRowParams,
  GridApi,
  PostSortRowsParams,
  RowClickedEvent,
  RowHeightParams,
  ValueFormatterParams,
  ValueGetterParams,
} from "ag-grid-community";
import type { booking } from "../../types/bookingTypes";
import "./Spreadsheet.css";
import { platformMap } from "../../helpers/maps.ts";
import { roomChargeDisplayPaymentMethod } from "../../helpers/bookingHelpers.ts";
import { formatRoomStayRooms } from "../../helpers/roomStayHelpers.ts";
import { useAuth } from "../../context/AuthContext.tsx";
import { formatDisplayDate } from "../../helpers/displayDate.ts";
import { API_URL } from "../../config/api.ts";
import axios from "axios";

type SpreadsheetStatus = "arrivals" | "departures" | "master";

type SeparatorRow = {
  __separator: true;
  dateKey: string;
  dateLabel: string;
  isToday?: boolean;
};

type SpreadsheetRow = booking | SeparatorRow;
const spreadsheetModules = [AllCommunityModule];

const isSeparatorRow = (row: SpreadsheetRow | undefined): row is SeparatorRow =>
  !!row && "__separator" in row;

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

const bookingStatusMap = {
  booked: {
    label: "รอ Check-In",
    icon: "bx-user-x",
    className: "bookingStatusCell--booked",
  },
  checkedIn: {
    label: "Check-In แล้ว",
    icon: "bx-user-check",
    className: "bookingStatusCell--checkedIn",
  },
  checkedOut: {
    label: "Check-Out แล้ว",
    icon: "bx-arrow-out-right-square-half",
    className: "bookingStatusCell--checkedOut",
  },
  cancelled: {
    label: "ยกเลิก",
    icon: "bx-calendar-x",
    className: "bookingStatusCell--cancelled",
  },
  noShow: {
    label: "No-Show",
    icon: "bx-user-x",
    className: "bookingStatusCell--noShow",
  },
};

const statusCell = (params: ICellRendererParams<SpreadsheetRow, string>) => {
  const status = params.value as keyof typeof bookingStatusMap | undefined;
  const statusMeta = status ? bookingStatusMap[status] : undefined;

  if (!statusMeta) return null;

  return (
    <div
      className={`bookingStatusCell ${statusMeta.className}`}
      title={statusMeta.label}
    >
      <i className={`bx ${statusMeta.icon}`} aria-hidden="true" />
      <span>{statusMeta.label}</span>
    </div>
  );
};

const nameCell = (params: ICellRendererParams<SpreadsheetRow, string>) => {
  if (isSeparatorRow(params.data)) return null;

  return (
    <div className="spreadsheet__nameCell">
      {params.data?.pinned && (
        <i className="bxf bx-pin-alt spreadsheet__pinIcon" aria-hidden="true" />
      )}
      <span>{params.value}</span>
    </div>
  );
};

const remainingDepositAmount = (currentBooking: booking) =>
  Math.max(
    currentBooking.transactions.reduce((total, transaction) => {
      if (transaction.type === "deposit") return total + transaction.amount;
      if (
        transaction.type === "depositRefund" ||
        transaction.type === "depositKept"
      ) {
        return total - transaction.amount;
      }
      return total;
    }, 0),
    0,
  );

const thbValueFormatter = (value?: number | null) =>
  value == null
    ? ""
    : new Intl.NumberFormat("th-TH", {
        style: "currency",
        currency: "THB",
        minimumFractionDigits: 0,
        currencyDisplay: "code",
      }).format(value);

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
  loadingMore,
  hasMore,
  onLoadMore,
  status,
  masterRange,
  focusMasterToday,
}: {
  bookings: booking[];
  setViewBookingBooking: (booking: booking) => void;
  loading: boolean;
  loadingMore?: boolean;
  hasMore?: boolean;
  onLoadMore?: () => void;
  status: SpreadsheetStatus;
  masterRange?: {
    from: string;
    to: string;
  };
  focusMasterToday?: boolean;
}) => {
  const { user, login, resolveStaffName } = useAuth();
  const isMaster = status === "master";
  const tableDensity = user?.settings.tableDensity || "comfortable";
  const dateFormat = user?.settings.dateFormat || "dd/MM/yyyy";
  const rowHeight =
    tableDensity === "compact"
      ? 36
      : tableDensity === "spacious"
        ? 54
        : undefined;
  const headerHeight =
    tableDensity === "compact"
      ? 40
      : tableDensity === "spacious"
        ? 52
        : undefined;
  const separatorRowHeight =
    tableDensity === "compact" ? 34 : tableDensity === "spacious" ? 50 : 42;
  const gridApiRef = useRef<GridApi<SpreadsheetRow> | null>(null);
  const gridContainerRef = useRef<HTMLDivElement>(null);
  const gridRepaintFrameRef = useRef<number | null>(null);
  const hasScrolledToTodayRef = useRef(false);
  const [isMobile, setIsMobile] = useState(false);
  const [animationsEnabledForStatus, setAnimationsEnabledForStatus] =
    useState<SpreadsheetStatus | null>(null);
  const todayKey = separatorDateKey(new Date());
  const latestLoadedCheckInKey = useMemo(
    () =>
      bookings.reduce((latestDateKey, currentBooking) => {
        const currentDateKey = separatorDateKey(currentBooking.checkIn);
        return currentDateKey > latestDateKey ? currentDateKey : latestDateKey;
      }, ""),
    [bookings],
  );
  const masterDataHasReachedToday =
    !hasMore || latestLoadedCheckInKey >= todayKey;

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 760px)");
    const syncIsMobile = () => setIsMobile(mediaQuery.matches);

    syncIsMobile();
    mediaQuery.addEventListener("change", syncIsMobile);

    return () => mediaQuery.removeEventListener("change", syncIsMobile);
  }, []);

  const dateValueFormater = useCallback(
    (params: ValueFormatterParams<SpreadsheetRow, Date>) =>
      params.value ? formatDisplayDate(params.value, dateFormat) : "",
    [dateFormat],
  );

  const separatorDateFormatter = useCallback(
    (date: Date) => formatDisplayDate(date, dateFormat),
    [dateFormat],
  );

  const rowData = useMemo<SpreadsheetRow[]>(() => {
    if (!isMaster) {
      return [...bookings].sort((a, b) => {
        if (Boolean(a.pinned) === Boolean(b.pinned)) return 0;
        return a.pinned ? -1 : 1;
      });
    }

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
        const aDateKey = isSeparatorRow(a)
          ? a.dateKey
          : separatorDateKey(a.checkIn);
        const bDateKey = isSeparatorRow(b)
          ? b.dateKey
          : separatorDateKey(b.checkIn);

        return aDateKey.localeCompare(bDateKey);
      });
    }

    return rows;
  }, [
    bookings,
    isMaster,
    masterRange?.from,
    masterRange?.to,
    separatorDateFormatter,
    todayKey,
  ]);

  const scrollToTodaySeparator = useCallback(() => {
    const api = gridApiRef.current;
    if (
      !api ||
      !isMaster ||
      !focusMasterToday ||
      loading ||
      loadingMore ||
      !masterDataHasReachedToday ||
      hasScrolledToTodayRef.current
    ) {
      return;
    }

    const todayRowIndex = rowData.findIndex(
      (row) => isSeparatorRow(row) && row.dateKey === todayKey,
    );

    if (todayRowIndex === -1) return;

    api.ensureIndexVisible(todayRowIndex, "top");
    hasScrolledToTodayRef.current = true;
  }, [
    focusMasterToday,
    isMaster,
    loading,
    loadingMore,
    masterDataHasReachedToday,
    rowData,
    todayKey,
  ]);

  useEffect(() => {
    if (isMaster && focusMasterToday) return;
    hasScrolledToTodayRef.current = false;
  }, [focusMasterToday, isMaster]);

  useEffect(() => {
    scrollToTodaySeparator();
  }, [scrollToTodaySeparator]);

  const repaintVisibleGrid = useCallback(() => {
    const api = gridApiRef.current;
    const container = gridContainerRef.current;
    if (!api || api.isDestroyed() || !container) return;

    const { width, height } = container.getBoundingClientRect();
    if (width < 1 || height < 1) return;

    if (gridRepaintFrameRef.current !== null) {
      window.cancelAnimationFrame(gridRepaintFrameRef.current);
    }
    gridRepaintFrameRef.current = window.requestAnimationFrame(() => {
      gridRepaintFrameRef.current = null;
      if (api.isDestroyed()) return;

      api.refreshClientSideRowModel("everything");
      api.refreshCells({ force: true });
      api.redrawRows();
      scrollToTodaySeparator();
    });
  }, [scrollToTodaySeparator]);

  useEffect(() => {
    const container = gridContainerRef.current;
    if (!container) return;

    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") repaintVisibleGrid();
    };
    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver((entries) => {
            const entry = entries[0];
            if (entry.contentRect.width > 0 && entry.contentRect.height > 0) {
              repaintVisibleGrid();
            }
          });

    resizeObserver?.observe(container);
    window.addEventListener("orientationchange", repaintVisibleGrid);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    repaintVisibleGrid();

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("orientationchange", repaintVisibleGrid);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      if (gridRepaintFrameRef.current !== null) {
        window.cancelAnimationFrame(gridRepaintFrameRef.current);
        gridRepaintFrameRef.current = null;
      }
    };
  }, [repaintVisibleGrid]);

  useEffect(() => {
    repaintVisibleGrid();
  }, [loading, repaintVisibleGrid, rowData, status]);

  useEffect(() => {
    if (
      !isMaster ||
      !focusMasterToday ||
      loading ||
      loadingMore ||
      masterDataHasReachedToday ||
      !hasMore ||
      !onLoadMore
    ) {
      return;
    }

    onLoadMore();
  }, [
    focusMasterToday,
    hasMore,
    isMaster,
    loading,
    loadingMore,
    masterDataHasReachedToday,
    onLoadMore,
  ]);

  const colDefs = useMemo<ColDef<SpreadsheetRow>[]>(() => {
    const columns: ColDef<SpreadsheetRow>[] = [
      {
        colId: "name",
        field: "name",
        headerName: "Name",
        flex: 1.3,
        minWidth: 180,
        filter: true,
        cellRenderer: nameCell,
      },
      {
        colId: "checkIn",
        field: "checkIn",
        width: 128,
        minWidth: 128,
        valueFormatter: dateValueFormater,
      },
      {
        colId: "checkOut",
        field: "checkOut",
        width: 128,
        minWidth: 128,
        valueFormatter: dateValueFormater,
      },
      {
        colId: "nights",
        field: "nights",
        headerName: "Nights",
        width: 76,
        minWidth: 76,
      },
      {
        colId: "rooms",
        valueGetter: (params: ValueGetterParams<SpreadsheetRow>) => {
          if (isSeparatorRow(params.data)) return "";
          return (
            params.data?.roomStays?.map(formatRoomStayRooms).join(", ") || ""
          );
        },
        headerName: "Rooms",
        filter: true,
        flex: 1,
        minWidth: 160,
        cellClass: "spreadsheet__roomCell",
      },
      {
        colId: "platformId",
        field: "platformId",
        headerName: "Channel",
        filter: true,
        width: 170,
        minWidth: 160,
        cellRenderer: platformCell,
      },
      {
        colId: "roomCharge",
        headerName: "Room Charge",
        width: 140,
        minWidth: 135,
        valueGetter: (params: ValueGetterParams<SpreadsheetRow>) => {
          if (isSeparatorRow(params.data)) return undefined;
          return params.data?.transactions?.find(
            (transaction) => transaction.type === "roomCharge",
          )?.amount;
        },
        valueFormatter: (
          params: ValueFormatterParams<SpreadsheetRow, number | undefined>,
        ) => thbValueFormatter(params.value),
      },
      {
        colId: "paymentMethod",
        valueGetter: (params: ValueGetterParams<SpreadsheetRow>) => {
          if (isSeparatorRow(params.data)) return "";
          return params.data ? roomChargeDisplayPaymentMethod(params.data) : "";
        },
        headerName: "Payment Method",
        filter: true,
        width: 145,
        minWidth: 140,
        cellClassRules: {
          red: (param: CellClassParams<SpreadsheetRow>) =>
            param.value === "Unpaid",
        },
      },
      ...(status === "departures"
        ? [
            {
              colId: "deposit",
              headerName: "Deposit",
              width: 125,
              minWidth: 120,
              valueGetter: (params: ValueGetterParams<SpreadsheetRow>) => {
                if (isSeparatorRow(params.data) || !params.data) {
                  return undefined;
                }
                return remainingDepositAmount(params.data);
              },
              valueFormatter: (
                params: ValueFormatterParams<
                  SpreadsheetRow,
                  number | undefined
                >,
              ) => thbValueFormatter(params.value),
            } satisfies ColDef<SpreadsheetRow>,
          ]
        : []),
      {
        colId: "bookingId",
        field: "bookingId",
        headerName: "Booking ID",
        filter: true,
        width: 150,
        minWidth: 140,
        sortable: false,
      },
      {
        colId: "checkInByStaffUsername",
        field: "checkInByStaffUsername",
        headerName: "Checked-In By",
        width: 130,
        minWidth: 120,
        valueFormatter: (params) =>
          params.value ? resolveStaffName(String(params.value)) : "-",
      },
      {
        colId: "note",
        field: "note",
        flex: 1.1,
        minWidth: 180,
        sortable: false,
      },
      {
        colId: "status",
        field: "status",
        headerName: isMobile ? "" : "สถานะ Check-In",
        pinned: "right",
        width: isMobile ? 56 : undefined,
        minWidth: isMobile ? 56 : undefined,
        maxWidth: isMobile ? 56 : 130,
        cellRenderer: isMobile ? statusCell : undefined,
        cellClassRules: {
          notCheckedIn: (param: CellClassParams<SpreadsheetRow>) => {
            return !isMobile && param.value === "booked";
          },
          checkedIn: (param: CellClassParams<SpreadsheetRow>) => {
            return !isMobile && param.value === "checkedIn";
          },
          checkedOut: (param: CellClassParams<SpreadsheetRow>) => {
            return !isMobile && param.value === "checkedOut";
          },
          cancelled: (param: CellClassParams<SpreadsheetRow>) => {
            return !isMobile && param.value === "cancelled";
          },
          noShow: (param: CellClassParams<SpreadsheetRow>) => {
            return !isMobile && param.value === "noShow";
          },
        },
        valueFormatter: (
          params: ValueFormatterParams<SpreadsheetRow, string | undefined>,
        ) => {
          if (!params.value) return "";

          const statusMeta =
            bookingStatusMap[params.value as keyof typeof bookingStatusMap];

          if (statusMeta) return statusMeta.label;
          return "";
        },
        sort: isMaster ? undefined : "asc",
      },
    ];

    return columns;
  }, [dateValueFormater, isMaster, isMobile, resolveStaffName, status]);

  const onRowDoubleClicked = (event: RowClickedEvent<SpreadsheetRow>) => {
    if (!event.data || isSeparatorRow(event.data)) return;
    setViewBookingBooking(event.data);
  };

  const onGridReady = (params: GridReadyEvent<SpreadsheetRow>) => {
    const api = params.api;
    gridApiRef.current = api;

    const savedColumnOrder = user?.settings.spreadsheetColumnOrders[status];
    if (savedColumnOrder?.length) {
      api.applyColumnState({
        state: savedColumnOrder.map((colId) => ({ colId })),
        applyOrder: true,
      });
    }

    if (loading) api.showLoadingOverlay();
    window.requestAnimationFrame(() => {
      setAnimationsEnabledForStatus(status);
      scrollToTodaySeparator();
      repaintVisibleGrid();
    });
  };

  const saveColumnOrder = useCallback(() => {
    const api = gridApiRef.current;
    if (!api || !user) return;

    const columnOrder = api
      .getAllDisplayedColumns()
      .map((column) => column.getColId());
    const spreadsheetColumnOrders = {
      ...user.settings.spreadsheetColumnOrders,
      [status]: columnOrder,
    };

    login({
      ...user,
      settings: { ...user.settings, spreadsheetColumnOrders },
    });

    axios
      .patch(
        `${API_URL}/auth/me/settings`,
        { spreadsheetColumnOrders },
        { withCredentials: true },
      )
      .catch((error: unknown) => {
        console.error("Failed to save spreadsheet column order", error);
      });
  }, [login, status, user]);

  const handleColumnMoved = useCallback((event: ColumnMovedEvent) => {
    if (!event.finished) return;
    saveColumnOrder();
  }, [saveColumnOrder]);

  const defaultColDef = useMemo<ColDef<SpreadsheetRow>>(
    () => ({
      resizable: true,
      suppressMovable: false,
    }),
    [],
  );

  const postSortRows = useCallback(
    (params: PostSortRowsParams<SpreadsheetRow>) => {
      if (isMaster) return;

      params.nodes.sort((a, b) => {
        const aIsPinned = !isSeparatorRow(a.data) && Boolean(a.data?.pinned);
        const bIsPinned = !isSeparatorRow(b.data) && Boolean(b.data?.pinned);

        if (aIsPinned === bIsPinned) return 0;
        return aIsPinned ? -1 : 1;
      });
    },
    [isMaster],
  );

  const handleBodyScrollEnd = useCallback(
    (event: BodyScrollEndEvent<SpreadsheetRow>) => {
      if (
        event.direction !== "vertical" ||
        !isMaster ||
        loading ||
        loadingMore ||
        !hasMore ||
        !onLoadMore
      ) {
        return;
      }

      const displayedRowCount = event.api.getDisplayedRowCount();
      const lastDisplayedRow =
        event.api.getDisplayedRowAtIndex(displayedRowCount - 1);
      if (!lastDisplayedRow) return;

      const viewport = event.api.getVerticalPixelRange();
      const contentBottom =
        (lastDisplayedRow.rowTop || 0) +
        (lastDisplayedRow.rowHeight || rowHeight || 42);
      const loadThreshold = Math.max(180, (rowHeight || 42) * 4);

      if (contentBottom - viewport.bottom <= loadThreshold) {
        onLoadMore();
      }
    },
    [
      hasMore,
      isMaster,
      loading,
      loadingMore,
      onLoadMore,
      rowHeight,
    ],
  );

  return (
    <AgGridProvider modules={spreadsheetModules}>
      <div
        ref={gridContainerRef}
        className={
          tableDensity === "spacious"
            ? "spreadsheet spreadsheet--spacious"
            : "spreadsheet"
        }
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
          defaultColDef={defaultColDef}
          maintainColumnOrder
          suppressColumnMoveAnimation={animationsEnabledForStatus !== status}
          suppressDragLeaveHidesColumns
          theme={myTheme}
          rowHeight={rowHeight}
          headerHeight={headerHeight}
          onGridReady={onGridReady}
          onColumnMoved={handleColumnMoved}
          postSortRows={postSortRows}
          onBodyScrollEnd={handleBodyScrollEnd}
          rowClassRules={{
            spreadsheet__pinnedRow: (params) =>
              !isSeparatorRow(params.data) && Boolean(params.data?.pinned),
          }}
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
            isSeparatorRow(params.data) ? separatorRowHeight : rowHeight
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
        {isMaster && loadingMore && (
          <div
            className="spreadsheet__infiniteLoading"
            role="status"
            aria-live="polite"
          >
            <span aria-hidden="true" />
            กำลังโหลดรายการเพิ่มเติม...
          </div>
        )}
      </div>
    </AgGridProvider>
  );
};

export default Spreadsheet;
