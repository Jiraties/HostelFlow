import { Dialog, DialogContent, useAutocomplete } from "@mui/material";
import { useForkRef } from "@mui/material/utils";
import axios from "axios";
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigate } from "react-router";
import { API_URL } from "../../config/api";
import { useAuth } from "../../context/AuthContext";
import type { PaletteMode } from "../../context/commandPalette";
import { navigationItems } from "../../components/navigationItems";
import {
  readRecentBookings,
  rememberBooking,
} from "../../helpers/recentBookings";
import { resolveSearchDestination } from "../../helpers/searchDestinations";
import { getTransactionDisplay } from "../../helpers/transactionDisplay";
import {
  dateFormatPlaceholder,
  formatDateInputValue,
  formatDisplayDate,
  formatNumericDateDraft,
  parseDateInputValue,
} from "../../helpers/displayDate";
import type { DateFormatPreference } from "../../types/userSettings";
import type {
  BookingSearchResult,
  SearchBootstrapResponse,
  SearchGroupName,
  SearchResponse,
  SearchResult,
} from "../../types/searchTypes";
import "./GlobalSearchPalette.css";

type PaletteCommand = {
  id: string;
  label: string;
  description: string;
  icon: string;
  keywords: string;
  aliases?: string[];
  adminOnly?: boolean;
  commonOnBlank?: boolean;
  action:
    | "navigate"
    | "addBooking"
    | "addTransaction"
    | "checkInDate"
    | "checkOutDate"
    | "standaloneSale";
  path?: string;
};

type PaletteOption =
  | {
      id: string;
      type: "data";
      section: string;
      result: SearchResult;
      priority: number;
    }
  | {
      id: string;
      type: "command";
      section: "คำสั่ง";
      command: PaletteCommand;
      priority: 1;
    };

const modeTags: Partial<
  Record<PaletteMode, { label: string; ariaLabel: string; icon: string }>
> = {
  commands: {
    label: "คำสั่ง",
    ariaLabel: "กำลังค้นหาเฉพาะคำสั่ง กด Tab เพื่อกลับไปค้นหาทั้งหมด",
    icon: "bx-command",
  },
  bookingPick: {
    label: "เพิ่ม Transaction",
    ariaLabel:
      "กำลังเพิ่มรายการใน Booking กด Backspace หรือ Delete เพื่อล้างโหมด",
    icon: "bx-receipt",
  },
  checkInDate: {
    label: "Check-in",
    ariaLabel: "กำลังค้นหาตามวันเช็กอิน กด Backspace หรือ Delete เพื่อล้างโหมด",
    icon: "bx-calendar-check",
  },
  checkOutDate: {
    label: "Check-out",
    ariaLabel:
      "กำลังค้นหาตามวันเช็กเอาต์ กด Backspace หรือ Delete เพื่อล้างโหมด",
    icon: "bx-calendar-x",
  },
};

const commandDefinitions: PaletteCommand[] = [
  {
    id: "add-booking",
    label: "เพิ่มการจองใหม่",
    description: "/addBooking",
    icon: "bx-plus",
    keywords: "เพิ่ม การจอง new booking",
    aliases: ["/addBooking"],
    action: "addBooking",
    commonOnBlank: true,
  },
  {
    id: "add-transaction",
    label: "เพิ่มรายการใน Booking",
    description: "/addTransaction",
    icon: "bx-receipt",
    keywords: "เพิ่ม transaction รายการ booking ชำระ",
    aliases: ["/addTransaction"],
    action: "addTransaction",
    commonOnBlank: true,
  },
  {
    id: "check-in-date",
    label: "ค้นหาตามวัน Check-in",
    description: "/check-in",
    icon: "bx-calendar-check",
    keywords: "check-in checkin arrival วันที่เช็กอิน วันเข้าพัก",
    aliases: ["/check-in"],
    action: "checkInDate",
  },
  {
    id: "check-out-date",
    label: "ค้นหาตามวัน Check-out",
    description: "/check-out",
    icon: "bx-calendar-x",
    keywords: "check-out checkout departure วันที่เช็กเอาต์ วันออก",
    aliases: ["/check-out"],
    action: "checkOutDate",
  },
  {
    id: "standalone-sale",
    label: "เพิ่มรายการใช้จ่ายแขกนอก",
    description: "เปิดขั้นตอนเดิมโดยไม่สร้าง Booking",
    icon: "bx-store",
    keywords: "sale แขกนอก รายการขาย",
    action: "standaloneSale",
    commonOnBlank: true,
  },
  ...navigationItems.map<PaletteCommand>((item) => ({
    id: `navigate-${item.link}`,
    label: `ไปที่${item.label}`,
    description: item.link,
    icon: item.icon,
    keywords: `${item.label} ${item.link}`,
    adminOnly: item.adminOnly,
    action: "navigate",
    path: item.link,
    commonOnBlank: ["/", "/master", "/calendar"].includes(item.link),
  })),
];

const normalizeText = (value: string) =>
  value.normalize("NFKC").toLocaleLowerCase().trim().replace(/\s+/g, " ");

const formatDateModeDraft = (
  value: string,
  dateFormat: DateFormatPreference,
  previousValue = "",
) => {
  if (dateFormat !== "dd/MM/yyyy") return value.slice(0, 11);
  return formatNumericDateDraft(value, previousValue);
};

const dataPriority = (result: SearchResult) =>
  result.matchKind === "fuzzy" ? 3 : result.matchKind === "prefix" ? 2 : 0;

const dataSection = (result: SearchResult) => {
  const group =
    result.kind === "booking"
      ? "Bookings"
      : result.kind === "transaction"
        ? "Transactions"
        : "Rooms";
  if (dataPriority(result) === 0) return `${group} · ตรงกัน`;
  if (dataPriority(result) === 3) return `${group} · ใกล้เคียง`;
  return group;
};

const optionLabel = (option: PaletteOption) => {
  if (option.type === "command") return option.command.label;
  if (option.result.kind === "booking") return option.result.guestName;
  if (option.result.kind === "transaction") return option.result.typeLabel;
  return option.result.label;
};

const commandColorClass = (command: PaletteCommand) => {
  if (command.action === "addBooking") return "booking";
  if (command.action === "addTransaction") return "transaction";
  if (command.action === "standaloneSale") return "sale";
  if (command.action === "checkInDate" || command.action === "checkOutDate") {
    return "date";
  }
  return "navigation";
};

const modeTagColorClass = (mode: PaletteMode) => {
  if (mode === "bookingPick") return " globalSearch__modeTag--transaction";
  if (mode === "checkInDate" || mode === "checkOutDate") {
    return " globalSearch__modeTag--date";
  }
  return "";
};

const resultIcon = (result: SearchResult) =>
  result.kind === "booking"
    ? "bx-bed"
    : result.kind === "transaction"
      ? getTransactionDisplay(result.type).icon
      : "bx-door-open";

const resultIconColor = (result: SearchResult) =>
  result.kind === "transaction"
    ? getTransactionDisplay(result.type).color
    : undefined;

const formatAmount = (amount: number) =>
  new Intl.NumberFormat("th-TH", {
    style: "currency",
    currency: "THB",
    maximumFractionDigits: 2,
  }).format(amount);

const resultMeta = (result: SearchResult, dateFormat: DateFormatPreference) => {
  if (result.kind === "booking") {
    return `${result.bookingId} · ${result.roomIds.join(", ") || "ยังไม่ระบุห้อง"} · ${formatDisplayDate(result.checkIn, dateFormat)}`;
  }
  if (result.kind === "transaction") {
    return `${result.guestName} · ${formatAmount(result.amount)} · ${formatDisplayDate(result.businessDate, dateFormat)}`;
  }
  return `ห้อง ${result.roomId} · ${formatDisplayDate(result.date, dateFormat)}`;
};

type GlobalSearchPaletteProps = {
  open: boolean;
  mode: PaletteMode;
  onClose: () => void;
  onOpenAddBooking: () => void;
  onOpenStandaloneSale: () => void;
  onPickBookingForTransaction: () => void;
  onPickCheckInDate: () => void;
  onPickCheckOutDate: () => void;
  onClearMode: () => void;
  onToggleCommandMode: () => void;
};

const GlobalSearchPaletteContent = ({
  open,
  mode,
  onClose,
  onOpenAddBooking,
  onOpenStandaloneSale,
  onPickBookingForTransaction,
  onPickCheckInDate,
  onPickCheckOutDate,
  onClearMode,
  onToggleCommandMode,
}: GlobalSearchPaletteProps) => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const dateFormat = user?.settings.dateFormat || "dd/MM/yyyy";
  const [query, setQuery] = useState("");
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [bootstrap, setBootstrap] = useState<SearchBootstrapResponse | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [showLoading, setShowLoading] = useState(false);
  const [error, setError] = useState("");
  const [retryKey, setRetryKey] = useState(0);
  const [composing, setComposing] = useState(false);
  const [blankVisible, setBlankVisible] = useState({ recent: 5, arrivals: 5 });
  const inputRef = useRef<HTMLInputElement | null>(null);
  const requestSequenceRef = useRef(0);
  const latestQueryRef = useRef("");
  const activeModeTag = modeTags[mode];
  const bookingDateField =
    mode === "checkInDate"
      ? "checkIn"
      : mode === "checkOutDate"
        ? "checkOut"
        : null;
  const bookingDateKey = bookingDateField
    ? parseDateInputValue(query, dateFormat)
    : null;

  useEffect(() => {
    latestQueryRef.current = bookingDateField
      ? bookingDateKey || ""
      : normalizeText(query);
  }, [bookingDateField, bookingDateKey, query]);

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => {
      inputRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  const resetAndClose = useCallback(() => {
    setQuery("");
    setResponse(null);
    setBootstrap(null);
    setError("");
    setLoading(false);
    setShowLoading(false);
    setBlankVisible({ recent: 5, arrivals: 5 });
    onClose();
  }, [onClose]);

  const clearModeTag = useCallback(() => {
    setQuery("");
    setResponse(null);
    setError("");
    setLoading(false);
    setShowLoading(false);
    onClearMode();
    window.requestAnimationFrame(() => {
      inputRef.current?.focus({ preventScroll: true });
    });
  }, [onClearMode]);

  const runSearch = useCallback(
    async (
      normalizedQuery: string,
      signal: AbortSignal,
      sequence: number,
      dateField: "checkIn" | "checkOut" | null = null,
    ) => {
      const recentBookingIds = readRecentBookings(user?.userId).map(
        (entry) => entry.bookingId,
      );
      const { data } = await axios.post<
        SearchResponse | SearchBootstrapResponse
      >(
        `${API_URL}/search`,
        normalizedQuery
          ? {
              query: normalizedQuery,
              ...(dateField
                ? { group: "bookings", bookingDateField: dateField }
                : {}),
            }
          : { recentBookingIds },
        { withCredentials: true, signal },
      );
      if (requestSequenceRef.current !== sequence) return;
      if (data.mode === "bootstrap") {
        setBootstrap(data);
        setResponse(null);
      } else {
        setResponse(data);
      }
    },
    [user?.userId],
  );

  useEffect(() => {
    if (!open || composing) return;
    const controller = new AbortController();
    const sequence = ++requestSequenceRef.current;
    if (mode === "commands") return () => controller.abort();
    const normalizedQuery = bookingDateField
      ? bookingDateKey || ""
      : normalizeText(query);
    let loadingTimer = 0;
    let debounceTimer = 0;

    const request = async () => {
      setLoading(true);
      setShowLoading(false);
      setError("");
      loadingTimer = window.setTimeout(() => setShowLoading(true), 200);
      try {
        await runSearch(
          normalizedQuery,
          controller.signal,
          sequence,
          bookingDateField,
        );
      } catch (requestError) {
        if (
          !axios.isCancel(requestError) &&
          requestSequenceRef.current === sequence
        ) {
          setError(
            axios.isAxiosError(requestError) &&
              requestError.response?.data?.message
              ? requestError.response.data.message
              : "ไม่สามารถค้นหาได้ กรุณาลองอีกครั้ง",
          );
        }
      } finally {
        window.clearTimeout(loadingTimer);
        if (requestSequenceRef.current === sequence) {
          setLoading(false);
          setShowLoading(false);
        }
      }
    };

    if (bookingDateField && !bookingDateKey) {
      return () => controller.abort();
    }
    if (normalizedQuery) {
      debounceTimer = window.setTimeout(request, 250);
    } else {
      request();
    }
    return () => {
      controller.abort();
      window.clearTimeout(debounceTimer);
      window.clearTimeout(loadingTimer);
    };
  }, [
    bookingDateField,
    bookingDateKey,
    composing,
    mode,
    open,
    query,
    retryKey,
    runSearch,
  ]);

  const commands = useMemo(() => {
    if (mode !== "search" && mode !== "commands") return [];
    const normalizedQuery = normalizeText(query);
    return commandDefinitions.filter((command) => {
      if (command.adminOnly && !user?.admin) return false;
      if (!normalizedQuery) {
        return mode === "commands" || command.commonOnBlank === true;
      }
      if (normalizedQuery.startsWith("/")) {
        return command.aliases?.some((alias) =>
          normalizeText(alias).startsWith(normalizedQuery),
        );
      }
      return normalizeText(`${command.label} ${command.keywords}`).includes(
        normalizedQuery,
      );
    });
  }, [mode, query, user?.admin]);

  const dataResults = useMemo(() => {
    if (mode === "commands") return [];
    if (!query.trim()) {
      if (bookingDateField) return [];
      return [
        ...(bootstrap?.recentBookings || []).slice(0, blankVisible.recent),
        ...(bootstrap?.todayArrivals || [])
          .filter(
            (arrival) =>
              !bootstrap?.recentBookings.some(
                (recent) => recent.bookingId === arrival.bookingId,
              ),
          )
          .slice(0, blankVisible.arrivals),
      ];
    }
    const groups = response?.groups;
    const results: SearchResult[] = [
      ...(groups?.bookings?.items || []),
      ...(groups?.transactions?.items || []),
      ...(groups?.rooms?.items || []),
    ];
    return mode === "bookingPick" || Boolean(bookingDateField)
      ? results.filter(
          (result): result is BookingSearchResult => result.kind === "booking",
        )
      : results;
  }, [blankVisible, bookingDateField, bootstrap, mode, query, response]);

  const options = useMemo<PaletteOption[]>(() => {
    if (!query.trim()) {
      const recentIds = new Set(
        (bootstrap?.recentBookings || []).map((booking) => booking.bookingId),
      );
      const blankData = dataResults.map<PaletteOption>((result) => ({
        id: `data-${result.kind}-${result.kind === "room" ? result.roomId : result.kind === "transaction" ? result.transactionId : result.bookingId}`,
        type: "data",
        result,
        priority: 0,
        section:
          result.kind === "booking" && recentIds.has(result.bookingId)
            ? "การจองล่าสุด"
            : "Arrivals วันนี้",
      }));
      return [
        ...blankData,
        ...commands.map<PaletteOption>((command) => ({
          id: `command-${command.id}`,
          type: "command",
          section: "คำสั่ง",
          command,
          priority: 1,
        })),
      ];
    }

    return [
      ...dataResults.map<PaletteOption>((result) => ({
        id: `data-${result.kind}-${result.kind === "room" ? result.roomId : result.kind === "transaction" ? result.transactionId : result.bookingId}`,
        type: "data",
        result,
        priority: dataPriority(result),
        section: dataSection(result),
      })),
      ...commands.map<PaletteOption>((command) => ({
        id: `command-${command.id}`,
        type: "command",
        section: "คำสั่ง",
        command,
        priority: 1,
      })),
    ].sort((first, second) => {
      if (first.priority !== second.priority)
        return first.priority - second.priority;
      const groupRank = (option: PaletteOption) =>
        option.type === "command"
          ? 3
          : option.result.kind === "booking"
            ? 0
            : option.result.kind === "transaction"
              ? 1
              : 2;
      return groupRank(first) - groupRank(second);
    });
  }, [bootstrap, commands, dataResults, query]);

  const selectDataResult = useCallback(
    (result: SearchResult) => {
      resetAndClose();
      if (result.kind === "booking") {
        rememberBooking(user?.userId, result.bookingId);
        navigate(
          resolveSearchDestination(
            mode === "bookingPick"
              ? {
                  kind: "bookingAction",
                  bookingId: result.bookingId,
                  action: "addTransaction",
                }
              : { kind: "booking", bookingId: result.bookingId },
          ),
        );
        return;
      }
      if (result.kind === "transaction") {
        if (result.sourceType !== "booking") return;
        rememberBooking(user?.userId, result.bookingId);
        navigate(
          resolveSearchDestination({
            kind: "bookingTransaction",
            bookingId: result.bookingId,
            transactionId: result.transactionId,
            highlight: {
              kind: "transaction",
              transactionId: result.transactionId,
            },
          }),
        );
        return;
      }
      navigate(
        resolveSearchDestination({
          kind: "room",
          roomId: result.roomId,
          date: result.date,
          highlight: {
            kind: "roomDate",
            roomId: result.roomId,
            date: result.date,
          },
        }),
      );
    },
    [mode, navigate, resetAndClose, user?.userId],
  );

  const runCommand = useCallback(
    (command: PaletteCommand) => {
      if (command.action === "navigate" && command.path) {
        resetAndClose();
        navigate(command.path);
      } else if (command.action === "addBooking") {
        onOpenAddBooking();
      } else if (command.action === "addTransaction") {
        setQuery("");
        onPickBookingForTransaction();
      } else if (command.action === "checkInDate") {
        setQuery("");
        setResponse(null);
        setLoading(false);
        setShowLoading(false);
        onPickCheckInDate();
      } else if (command.action === "checkOutDate") {
        setQuery("");
        setResponse(null);
        setLoading(false);
        setShowLoading(false);
        onPickCheckOutDate();
      } else if (command.action === "standaloneSale") {
        onOpenStandaloneSale();
      }
    },
    [
      navigate,
      onOpenAddBooking,
      onOpenStandaloneSale,
      onPickCheckInDate,
      onPickCheckOutDate,
      onPickBookingForTransaction,
      resetAndClose,
    ],
  );

  const handleOption = useCallback(
    (option: PaletteOption | null) => {
      if (!option) return;
      if (option.type === "command") runCommand(option.command);
      else selectDataResult(option.result);
    },
    [runCommand, selectDataResult],
  );

  const autocomplete = useAutocomplete<PaletteOption>({
    id: "hostelflow-global-search",
    options,
    open: options.length > 0,
    value: null,
    inputValue: query,
    autoHighlight: true,
    handleHomeEndKeys: true,
    filterOptions: (available) => available,
    getOptionLabel: optionLabel,
    isOptionEqualToValue: (option, value) => option.id === value.id,
    onInputChange: (_event, value, reason) => {
      if (reason === "input" || reason === "clear") {
        const nextValue = bookingDateField
          ? formatDateModeDraft(value, dateFormat, query)
          : value;
        setQuery(nextValue);
        setResponse(null);
        setError("");
        setLoading(
          mode !== "commands" &&
            (!bookingDateField ||
              parseDateInputValue(nextValue, dateFormat) !== null),
        );
      }
    },
    onChange: (_event, option) => handleOption(option),
  });
  const autocompleteInputProps = autocomplete.getInputProps();
  const handleInputRef = useForkRef(autocompleteInputProps.ref, inputRef);

  const loadMore = async (group: SearchGroupName) => {
    if (!response || !query.trim()) return;
    const requestedQuery = bookingDateField
      ? bookingDateKey || ""
      : normalizeText(query);
    if (!requestedQuery) return;
    const current = response.groups[group];
    if (!current?.hasMore) return;
    setLoading(true);
    try {
      const { data } = await axios.post<SearchResponse>(
        `${API_URL}/search`,
        {
          query: requestedQuery,
          group,
          page: current.page + 1,
          limit: 5,
          ...(bookingDateField ? { bookingDateField } : {}),
        },
        { withCredentials: true },
      );
      const next = data.groups[group];
      if (!next || latestQueryRef.current !== requestedQuery) return;
      setResponse((previous) =>
        previous
          ? {
              ...previous,
              groups: {
                ...previous.groups,
                [group]: {
                  ...next,
                  items: [
                    ...(previous.groups[group]?.items || []),
                    ...next.items,
                  ],
                },
              },
            }
          : previous,
      );
    } catch (requestError) {
      setError(
        axios.isAxiosError(requestError) && requestError.response?.data?.message
          ? requestError.response.data.message
          : "ไม่สามารถโหลดผลลัพธ์เพิ่มได้",
      );
    } finally {
      setLoading(false);
    }
  };

  const sectionedOptions = useMemo(() => {
    const sections = new Map<string, PaletteOption[]>();
    options.forEach((option) => {
      const current = sections.get(option.section) || [];
      current.push(option);
      sections.set(option.section, current);
    });
    return [...sections.entries()];
  }, [options]);

  const showMoreGroup = (section: string): SearchGroupName | null => {
    if (section.startsWith("Bookings")) return "bookings";
    if (section.startsWith("Transactions")) return "transactions";
    if (section.startsWith("Rooms")) return "rooms";
    return null;
  };

  const lastSectionForGroup = new Map<SearchGroupName, string>();
  sectionedOptions.forEach(([section]) => {
    const group = showMoreGroup(section);
    if (group) lastSectionForGroup.set(group, section);
  });

  let optionIndex = 0;
  return (
    <>
      {/* <DialogTitle id="global-search-title" className="globalSearch__title">
        {mode === "bookingPick" ? "เลือก Booking เพื่อเพิ่มรายการ" : "ค้นหาและไปยังส่วนต่าง ๆ"}
      </DialogTitle> */}
      <DialogContent className="globalSearch__content">
        <div
          {...autocomplete.getRootProps()}
          className="globalSearch__combobox"
        >
          <i className="bx bx-search" aria-hidden="true" />
          {activeModeTag ? (
            <button
              type="button"
              tabIndex={-1}
              className={`globalSearch__modeTag${modeTagColorClass(mode)}`}
              aria-label={activeModeTag.ariaLabel}
              onMouseDown={(event) => event.preventDefault()}
              onClick={clearModeTag}
            >
              <i className={`bx ${activeModeTag.icon}`} aria-hidden="true" />
              {activeModeTag.label}
              <i className="bx bx-x" aria-hidden="true" />
            </button>
          ) : null}
          <input
            {...autocompleteInputProps}
            ref={handleInputRef}
            type="search"
            autoFocus
            autoComplete="off"
            inputMode={
              bookingDateField && dateFormat === "dd/MM/yyyy"
                ? "numeric"
                : "text"
            }
            placeholder={
              mode === "bookingPick"
                ? "ค้นหา ชื่อแขก หรือ Booking ID"
                : mode === "commands"
                  ? "ค้นหาคำสั่ง"
                  : bookingDateField
                    ? dateFormatPlaceholder(dateFormat)
                    : "ค้นหา ชื่อแขก, Booking ID, ห้อง, ยอดเงิน หรือวันที่"
            }
            onCompositionStart={() => setComposing(true)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing || composing) {
                event.stopPropagation();
                return;
              }
              if (
                event.key === "Tab" &&
                (mode === "search" || mode === "commands")
              ) {
                event.preventDefault();
                event.stopPropagation();
                setLoading(false);
                setShowLoading(false);
                onToggleCommandMode();
                return;
              }
              if (
                activeModeTag &&
                query.length === 0 &&
                (event.key === "Backspace" || event.key === "Delete")
              ) {
                event.preventDefault();
                event.stopPropagation();
                clearModeTag();
                return;
              }
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                resetAndClose();
              }
            }}
            onCompositionEnd={(event) => {
              setQuery(
                bookingDateField
                  ? formatDateModeDraft(
                      event.currentTarget.value,
                      dateFormat,
                      query,
                    )
                  : event.currentTarget.value,
              );
              setComposing(false);
            }}
          />
          {bookingDateField && (
            <span
              className="globalSearch__datePicker"
              title={`เลือกวัน ${bookingDateField === "checkIn" ? "Check-in" : "Check-out"}`}
            >
              <i className="bx bx-calendar" aria-hidden="true" />
              <input
                type="date"
                value={bookingDateKey || ""}
                aria-label={`เลือกวัน ${bookingDateField === "checkIn" ? "Check-in" : "Check-out"} จากปฏิทิน`}
                onChange={(event) => {
                  const nextDate = event.currentTarget.value;
                  setQuery(formatDateInputValue(nextDate, dateFormat));
                  setResponse(null);
                  setError("");
                  setLoading(Boolean(nextDate));
                }}
              />
            </span>
          )}
          {showLoading && loading && (
            <span
              className="globalSearch__spinner"
              role="status"
              aria-label="กำลังค้นหา"
            />
          )}
          <kbd>Esc</kbd>
        </div>

        {error && (
          <div
            className="globalSearch__message globalSearch__message--error"
            role="alert"
          >
            <span>{error}</span>
            <button
              type="button"
              onClick={() => setRetryKey((value) => value + 1)}
            >
              <i className="bx bx-refresh" />
            </button>
          </div>
        )}

        {!error && bookingDateField && !bookingDateKey && (
          <p className="globalSearch__message">
            กรอกวันที่ตามรูปแบบด้านบน หรือเลือกจากปฏิทิน
          </p>
        )}

        {!error &&
          !loading &&
          options.length === 0 &&
          (!bookingDateField || Boolean(bookingDateKey)) && (
            <p className="globalSearch__message">ไม่พบผลลัพธ์ที่ตรงกัน</p>
          )}

        <ul {...autocomplete.getListboxProps()} className="globalSearch__list">
          {sectionedOptions.map(([section, sectionOptions]) => {
            const group = showMoreGroup(section);
            const hasMore = group
              ? response?.groups[group]?.hasMore &&
                lastSectionForGroup.get(group) === section
              : false;
            const blankHasMore =
              !query.trim() &&
              (section === "การจองล่าสุด"
                ? (bootstrap?.recentBookings.length || 0) > blankVisible.recent
                : section === "Arrivals วันนี้"
                  ? (bootstrap?.todayArrivals.length || 0) >
                    blankVisible.arrivals
                  : false);
            return (
              <Fragment key={section}>
                <li className="globalSearch__groupLabel" role="presentation">
                  {section}
                </li>
                {sectionOptions.map((option) => {
                  const props = autocomplete.getOptionProps({
                    option,
                    index: optionIndex++,
                  });
                  return (
                    <li
                      {...props}
                      key={option.id}
                      className={`globalSearch__option${option.type === "command" ? ` globalSearch__option--command globalSearch__option--action-${commandColorClass(option.command)}` : option.result.kind === "room" ? " globalSearch__option--room" : ""}`}
                    >
                      <span
                        className={`globalSearch__optionIcon${option.type === "command" ? " globalSearch__optionIcon--command" : option.result.kind === "room" ? " globalSearch__optionIcon--room" : ""}`}
                        style={
                          option.type === "data"
                            ? { color: resultIconColor(option.result) }
                            : undefined
                        }
                      >
                        <i
                          className={`bx ${option.type === "command" ? option.command.icon : resultIcon(option.result)}`}
                          aria-hidden="true"
                        />
                      </span>
                      <span className="globalSearch__optionCopy">
                        <strong>{optionLabel(option)}</strong>
                        <small>
                          {option.type === "command"
                            ? option.command.description
                            : resultMeta(option.result, dateFormat)}
                        </small>
                      </span>
                      {option.type === "data" &&
                        option.result.kind === "booking" &&
                        option.result.voided && (
                          <span className="globalSearch__badge">Voided</span>
                        )}
                    </li>
                  );
                })}
                {(hasMore || blankHasMore) && (
                  <li className="globalSearch__showMore" role="presentation">
                    <button
                      type="button"
                      disabled={loading}
                      onClick={() => {
                        if (group) void loadMore(group);
                        else if (section === "การจองล่าสุด") {
                          setBlankVisible((current) => ({
                            ...current,
                            recent: current.recent + 5,
                          }));
                        } else {
                          setBlankVisible((current) => ({
                            ...current,
                            arrivals: current.arrivals + 5,
                          }));
                        }
                      }}
                    >
                      แสดงเพิ่ม
                    </button>
                  </li>
                )}
              </Fragment>
            );
          })}
        </ul>
        <p className="globalSearch__hint">
          <span>↑↓ เลือก</span>
          <span>Enter เลือก</span>
          <span>Tab คำสั่ง</span>
          <span>Esc ปิด</span>
        </p>
      </DialogContent>
    </>
  );
};

const GlobalSearchPalette = (props: GlobalSearchPaletteProps) => (
  <Dialog
    open={props.open}
    onClose={props.onClose}
    fullWidth
    maxWidth={false}
    className="globalSearch"
    aria-label={
      props.mode === "bookingPick"
        ? "เลือก Booking เพื่อเพิ่มรายการ"
        : "ค้นหาและไปยังส่วนต่าง ๆ"
    }
  >
    <GlobalSearchPaletteContent {...props} />
  </Dialog>
);

export default GlobalSearchPalette;
