import "./FinancialBreakdown.css";

import axios from "axios";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";

import { API_URL } from "../../config/api";
import ModalCloseButton from "../../components/ModalCloseButton";
import Tooltip from "../../components/Tooltip";
import { PreferredDateInput } from "../../components/PreferredDateInput";
import { useAuth } from "../../context/AuthContext";
import {
  formatDisplayDate,
  formatDisplayDateTime,
} from "../../helpers/displayDate";
import { profilePictureUrl } from "../../helpers/profilePictureUrl";
import type { DateFormatPreference } from "../../types/userSettings";
import type {
  PaymentMethod,
  PlatformId,
  TransactionDirection,
  TransactionType,
} from "../../types/bookingTypes";

type ExpectedStayRevenueBreakdownTransaction = {
  transactionId?: string;
  bookingId?: string;
  saleId?: string;
  sourceType?: "booking" | "standaloneSale";
  guestName: string;
  platformId: PlatformId;
  type: TransactionType;
  label: string;
  color: string;
  icon: string;
  amount: number;
  paymentMethod: PaymentMethod;
  paymentMethodLabel?: string;
  stayChargeKind?: "original" | "extension";
  direction?: TransactionDirection;
  createdAt?: string | Date;
  createdBy?: string;
  staff?: {
    username: string;
    name?: string;
    profilePictureUrl?: string;
  };
  note?: string;
  reference?: string;
};

type ExpectedStayRevenueBreakdownCategory = {
  type: TransactionType;
  label: string;
  color: string;
  icon: string;
  total: number;
  percentage: number;
  transactionCount: number;
  transactions: ExpectedStayRevenueBreakdownTransaction[];
};

type ExpectedStayRevenuePaymentMethodBreakdown = {
  paymentMethod: PaymentMethod;
  label: string;
  icon: string;
  total: number;
  percentage: number;
  transactionCount: number;
  transactions: ExpectedStayRevenueBreakdownTransaction[];
};

type ExpectedStayRevenueBreakdownResponse = {
  period: {
    startDate: string;
    endDate: string;
    basis:
      | "bookingOrExtensionStart"
      | "bookingOrExtensionStartAndServiceCreatedAt"
      | "checkInAndTransactionCreatedAt";
  };
  totals: {
    grossStayCharges: number;
    grossRoomCharges?: number;
    grossServiceRevenue?: number;
    expectedStayRevenue: number;
    collectedRevenue?: number;
    unpaidRevenue?: number;
    reductions: number;
    netAfterReductions: number;
    transactionCount: number;
  };
  categories: ExpectedStayRevenueBreakdownCategory[];
  reductions: ExpectedStayRevenueBreakdownCategory[];
  paymentMethods: ExpectedStayRevenuePaymentMethodBreakdown[];
};

type BreakdownMode = "type" | "payment";

type BreakdownDisplayGroup = {
  key: string;
  label: string;
  color: string;
  icon?: string;
  total: number;
  percentage: number;
  transactionCount: number;
  transactions: ExpectedStayRevenueBreakdownTransaction[];
  paymentMethod?: PaymentMethod;
  sourceType?: TransactionType;
};

const EXTENSION_ROOM_CHARGE_COLOR = "#8adfe6";

const roomChargeDisplayGroups = (
  category: ExpectedStayRevenueBreakdownCategory,
): BreakdownDisplayGroup[] => {
  const originalTransactions = category.transactions.filter(
    (transaction) => transaction.stayChargeKind !== "extension",
  );
  const extensionTransactions = category.transactions.filter(
    (transaction) => transaction.stayChargeKind === "extension",
  );

  return [
    {
      key: "roomCharge-original",
      label: "ค่าห้อง — การจองเดิม",
      color: category.color,
      transactions: originalTransactions,
    },
    {
      key: "roomCharge-extension",
      label: "ค่าห้อง — Extension",
      color: EXTENSION_ROOM_CHARGE_COLOR,
      transactions: extensionTransactions,
    },
  ]
    .filter((group) => group.transactions.length > 0)
    .map((group) => {
      const total = group.transactions.reduce(
        (sum, transaction) => sum + transaction.amount,
        0,
      );

      return {
        ...group,
        sourceType: category.type,
        total,
        percentage:
          category.total > 0
            ? (total / category.total) * category.percentage
            : 0,
        transactionCount: group.transactions.length,
      };
    });
};

const formatMoney = (value: number) =>
  value.toLocaleString("th-TH", {
    minimumFractionDigits: value % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });

const formatDateTime = (
  date: string | Date | undefined,
  dateFormat: DateFormatPreference,
) => (date ? formatDisplayDateTime(date, dateFormat) : "-");

const formatDate = (date: string, dateFormat: DateFormatPreference) =>
  formatDisplayDate(`${date}T00:00:00`, dateFormat);

const formatExclusiveEndDate = (
  date: string,
  dateFormat: DateFormatPreference,
) => {
  const exclusiveEnd = new Date(`${date}T00:00:00`);
  exclusiveEnd.setDate(exclusiveEnd.getDate() - 1);
  return formatDisplayDate(exclusiveEnd, dateFormat);
};

const localDateKey = (date = new Date()) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;

const monthDateRange = (month: string) => {
  const [year, monthNumber] = month.split("-").map(Number);
  const nextMonth = new Date(Date.UTC(year, monthNumber, 1));
  return {
    startDate: `${month}-01`,
    endDate: `${nextMonth.getUTCFullYear()}-${String(
      nextMonth.getUTCMonth() + 1,
    ).padStart(2, "0")}-01`,
  };
};

const paymentMethodLabel: Record<PaymentMethod, string> = {
  OTA: "OTA",
  Cash: "Cash",
  Card: "Card",
  Transfer: "Transfer",
  Unpaid: "Unpaid",
};

const paymentMethodIconMap: Record<PaymentMethod, string> = {
  OTA: "bx-bank",
  Cash: "bx-currency-notes",
  Card: "bx-credit-card-alt",
  Transfer: "bx-arrow-right-left",
  Unpaid: "bx-alert-triangle",
};

const paymentMethodColorMap: Record<PaymentMethod, string> = {
  OTA: "var(--payment-method-ota)",
  Cash: "var(--payment-method-cash)",
  Card: "var(--payment-method-card)",
  Transfer: "var(--payment-method-transfer)",
  Unpaid: "var(--payment-method-unpaid)",
};

const getFetchErrorMessage = (err: unknown) => {
  if (axios.isAxiosError(err) && err.response?.data?.message) {
    return err.response.data.message;
  }

  return "เกิดข้อผิดพลาดในการโหลดข้อมูล";
};

const BreakdownSection = ({
  title,
  emptyText,
  groups,
  groupUnit,
  dateFormat,
  negative = false,
}: {
  title: string;
  emptyText: string;
  groups: BreakdownDisplayGroup[];
  groupUnit: "แหล่ง" | "ช่องทาง";
  dateFormat: DateFormatPreference;
  negative?: boolean;
}) => {
  const navigate = useNavigate();
  const [openGroupKey, setOpenGroupKey] = useState<string | null | undefined>(
    undefined,
  );
  const activeOpenGroupKey =
    openGroupKey === null
      ? null
      : groups.some((group) => group.key === openGroupKey)
        ? openGroupKey
        : groups[0]?.key;

  return (
    <section className="financialBreakdown__section">
      <div className="financialBreakdown__sectionHeader">
        <h2>{title}</h2>
        <span>
          {groups.length} {groupUnit}
        </span>
      </div>

      {groups.length === 0 ? (
        <p className="financialBreakdown__emptyText">{emptyText}</p>
      ) : (
        <div className="financialBreakdown__categoryList">
          {groups.map((group) => {
            const isOpen = activeOpenGroupKey === group.key;

            return (
              <article
                className={
                  isOpen
                    ? "financialBreakdown__category financialBreakdown__category--open"
                    : "financialBreakdown__category"
                }
                key={`${negative ? "reduction" : "revenue"}-${group.key}`}
              >
                <button
                  className="financialBreakdown__categoryHeader"
                  type="button"
                  onClick={() => setOpenGroupKey(isOpen ? null : group.key)}
                >
                  <div className="financialBreakdown__categoryIdentity">
                    {group.icon ? (
                      <span
                        className="financialBreakdown__methodIcon"
                        style={{ backgroundColor: group.color }}
                      >
                        <i className={`bx ${group.icon}`} />
                      </span>
                    ) : (
                      <span
                        className="financialBreakdown__colorDot"
                        style={{ backgroundColor: group.color }}
                      />
                    )}
                    <div>
                      <h3>{group.label}</h3>
                      <p>
                        {group.transactionCount} รายการ ·{" "}
                        {formatMoney(group.percentage)}%
                      </p>
                    </div>
                  </div>
                  <div className="financialBreakdown__categoryTotal">
                    <strong>
                      {negative ? "-" : ""}
                      {formatMoney(group.total)} ฿
                    </strong>
                    <i
                      className={
                        isOpen ? "bx bx-chevron-up" : "bx bx-chevron-down"
                      }
                    />
                  </div>
                </button>

                {isOpen && (
                  <div className="financialBreakdown__transactions">
                    {group.transactions.map((transaction, index) => (
                      <div
                        className={
                          transaction.bookingId
                            ? "financialBreakdown__transaction financialBreakdown__transaction--booking"
                            : "financialBreakdown__transaction"
                        }
                        key={
                          transaction.transactionId ||
                          `${transaction.bookingId || transaction.saleId}-${group.key}-${index}`
                        }
                        role={transaction.bookingId ? "link" : undefined}
                        tabIndex={transaction.bookingId ? 0 : undefined}
                        aria-label={
                          transaction.bookingId
                            ? `เปิด booking ${transaction.bookingId} ของ ${transaction.guestName} ในรายการทั้งหมด`
                            : undefined
                        }
                        onClick={() => {
                          if (!transaction.bookingId) return;
                          navigate(
                            `/master?bookingId=${encodeURIComponent(transaction.bookingId)}`,
                          );
                        }}
                        onKeyDown={(event) => {
                          if (
                            !transaction.bookingId ||
                            (event.key !== "Enter" && event.key !== " ")
                          ) {
                            return;
                          }

                          event.preventDefault();
                          navigate(
                            `/master?bookingId=${encodeURIComponent(transaction.bookingId)}`,
                          );
                        }}
                      >
                        <div className="financialBreakdown__transactionMain">
                          <strong>
                            {transaction.sourceType === "standaloneSale" && (
                              <span className="nonGuestBadge">แขกนอก</span>
                            )}
                            {transaction.guestName}
                            {transaction.stayChargeKind === "extension" && (
                              <span className="financialBreakdown__extensionBadge">
                                Extension
                              </span>
                            )}
                          </strong>
                          <div className="financialBreakdown__transactionMeta">
                            <span className="financialBreakdown__transactionMetaText">
                              {transaction.saleId || transaction.bookingId} ·{" "}
                              {transaction.label} ·{" "}
                              {formatDateTime(
                                transaction.createdAt,
                                dateFormat,
                              )}
                            </span>
                            {transaction.staff && (
                              // <Tooltip
                              //   className="financialBreakdown__staffTooltip"
                              //   ariaLabel={`บันทึกโดย ${transaction.staff.name || transaction.staff.username}`}
                              //   content={
                              //     <>
                              //       <span>
                              //         บันทึกโดย {transaction.staff.name || transaction.staff.username}
                              //       </span>
                              //       {transaction.staff.name &&
                              //         transaction.staff.name !== transaction.staff.username && (
                              //           <span>@{transaction.staff.username}</span>
                              //         )}
                              //     </>
                              //   }
                              // >
                              <div className="financialBreakdown__transactionStaffNameBadge">
                                <p>
                                  {transaction.staff.name ||
                                    "ไม่ทราบชื่อพนักงาน"}
                                </p>
                                <img
                                  className="financialBreakdown__staffAvatar"
                                  src={profilePictureUrl(
                                    transaction.staff.profilePictureUrl,
                                  )}
                                  alt=""
                                />
                              </div>
                              // </Tooltip>
                            )}
                          </div>
                          {transaction.note?.trim() && (
                            <p className="financialBreakdown__transactionRemark">
                              <i
                                className="bx bx-message-dots"
                                aria-hidden="true"
                              />
                              <span>{transaction.note.trim()}</span>
                            </p>
                          )}
                        </div>
                        <div className="financialBreakdown__transactionSide">
                          <strong className="financialBreakdown__transactionAmount">
                            {negative ? "-" : ""}
                            {formatMoney(transaction.amount)} ฿
                          </strong>
                          <span className="financialBreakdown__paymentMethod">
                            {transaction.paymentMethodLabel ||
                              paymentMethodLabel[transaction.paymentMethod]}
                            <i
                              className={`bx ${
                                transaction.paymentMethodLabel
                                  ? "bx-wallet"
                                  : paymentMethodIconMap[
                                      transaction.paymentMethod
                                    ]
                              }`}
                            />
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
};

const FinancialBreakdown = ({
  mode = "monthly",
  month,
  initialType = null,
  initialGroupKey = null,
  contextNote,
  onClose,
}: {
  mode?: "monthly" | "today";
  month?: string;
  initialType?: TransactionType | null;
  initialGroupKey?: string | null;
  contextNote?: string;
  onClose: () => void;
}) => {
  const { user } = useAuth();
  const dateFormat = user?.settings.dateFormat || "dd/MM/yyyy";
  const [breakdown, setBreakdown] =
    useState<ExpectedStayRevenueBreakdownResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [breakdownMode, setBreakdownMode] = useState<BreakdownMode>("type");
  const [selectedBusinessDate, setSelectedBusinessDate] =
    useState(localDateKey);
  const [selectedType, setSelectedType] = useState<TransactionType | null>(
    initialType,
  );
  const [selectedGroupKey, setSelectedGroupKey] = useState(initialGroupKey);
  const typeGroups = useMemo<BreakdownDisplayGroup[]>(
    () =>
      (breakdown?.categories || []).flatMap((category) =>
        category.type === "roomCharge"
          ? roomChargeDisplayGroups(category)
          : [
              {
                key: category.type,
                sourceType: category.type,
                label: category.label,
                color: category.color,
                total: category.total,
                percentage: category.percentage,
                transactionCount: category.transactionCount,
                transactions: category.transactions,
              },
            ],
      ),
    [breakdown],
  );
  const paymentMethodGroups = useMemo<BreakdownDisplayGroup[]>(
    () =>
      (breakdown?.paymentMethods || []).map((paymentMethod) => ({
        key: paymentMethod.paymentMethod,
        label: paymentMethod.label,
        color: paymentMethodColorMap[paymentMethod.paymentMethod],
        icon: paymentMethod.icon,
        total: paymentMethod.total,
        percentage: paymentMethod.percentage,
        transactionCount: paymentMethod.transactionCount,
        transactions: paymentMethod.transactions,
        paymentMethod: paymentMethod.paymentMethod,
      })),
    [breakdown],
  );
  const activeGroups =
    breakdownMode === "type"
      ? selectedGroupKey
        ? typeGroups.filter((group) => group.key === selectedGroupKey)
        : selectedType
        ? typeGroups.filter((group) => group.sourceType === selectedType)
        : typeGroups
      : paymentMethodGroups;
  const activeTitle =
    breakdownMode === "type" ? "แหล่งที่มาของรายได้" : "ช่องทางชำระเงิน";
  const activeEmptyText =
    breakdownMode === "type"
      ? "ยังไม่มีรายการรายได้ในช่วงนี้"
      : "ยังไม่มีรายการแยกตามช่องทางชำระเงิน";
  const reductionGroups = useMemo<BreakdownDisplayGroup[]>(
    () =>
      (breakdown?.reductions || []).map((category) => ({
        key: category.type,
        label: category.label,
        color: category.color,
        total: category.total,
        percentage: category.percentage,
        transactionCount: category.transactionCount,
        transactions: category.transactions,
      })),
    [breakdown],
  );

  useEffect(() => {
    let ignore = false;

    const fetchBreakdown = async () => {
      setLoading(true);
      setError("");

      try {
        const response = await axios.get<ExpectedStayRevenueBreakdownResponse>(
          mode === "today"
            ? `${API_URL}/finance/today-revenue-breakdown`
            : `${API_URL}/finance/expected-stay-revenue-breakdown`,
          {
            params:
              mode === "today"
                ? { businessDate: selectedBusinessDate }
                : month
                  ? monthDateRange(month)
                  : undefined,
            withCredentials: true,
          },
        );

        if (!ignore) setBreakdown(response.data);
      } catch (err) {
        if (!ignore) {
          setBreakdown(null);
          setError(getFetchErrorMessage(err));
        }
      } finally {
        if (!ignore) setLoading(false);
      }
    };

    fetchBreakdown();

    return () => {
      ignore = true;
    };
  }, [mode, month, selectedBusinessDate]);

  return (
    <div className="viewBooking__wrapper">
      <ModalCloseButton onClick={onClose} />
      <div className="financialBreakdown__header">
        <div>
          <h1 className="viewBooking__name">
            {mode === "today" ? "Today’s Revenue" : "Expected Stay Revenue"}
          </h1>
          {contextNote && <p>{contextNote}</p>}
          <p>
            {mode === "today"
              ? "ค่าห้องจากการจองเดิมที่เริ่มเข้าพักวันนี้ รายการเพิ่มคืนที่เริ่มวันนี้ และบริการเสริมที่บันทึกวันนี้ หลังหักรายการลดรายได้"
              : "ค่าห้องจากการจองเดิมและรายการเพิ่มคืน นับตามวันที่แต่ละช่วงเริ่มต้น ส่วนบริการเสริมนับตามวันที่บันทึกรายการ"}
          </p>
        </div>
        {mode === "today" ? (
          <label className="financialBreakdown__datePicker">
            <span className="financialBreakdown__dateLabel">วันที่รายได้</span>
            <PreferredDateInput
              className="financialBreakdown__dateInput"
              aria-label="เลือกวันที่สำหรับรายได้"
              value={selectedBusinessDate}
              onChange={(event) => {
                if (event.target.value) {
                  setSelectedBusinessDate(event.target.value);
                }
              }}
            />
          </label>
        ) : breakdown ? (
          <span>
            {formatDate(breakdown.period.startDate, dateFormat)} -{" "}
            {formatExclusiveEndDate(breakdown.period.endDate, dateFormat)}
          </span>
        ) : null}
      </div>

      {loading && (
        <div className="financialBreakdown__state">
          <i className="bx bx-loader-lines bx-spin" />
          <p>กำลังโหลดข้อมูลรายได้</p>
        </div>
      )}

      {!loading && error && (
        <div className="financialBreakdown__state financialBreakdown__state--error">
          <i className="bx bx-alert-circle" />
          <p>{error}</p>
        </div>
      )}

      {!loading && !error && breakdown && (
        <>
          <section className="financialBreakdown__summary">
            <div className="financialBreakdown__summaryPrimary">
              <p>
                {mode === "today" ? "Today’s Revenue" : "Expected Stay Revenue"}
              </p>
              <strong>
                {formatMoney(breakdown.totals.expectedStayRevenue)} ฿
              </strong>
            </div>
            <div className="financialBreakdown__summaryMeta">
              <span>
                <small>
                  {mode === "today" ? "ก่อนหักรายการลด" : "Gross Revenue"}
                </small>
                <strong>
                  {formatMoney(breakdown.totals.grossStayCharges)} ฿
                </strong>
              </span>
              {mode === "monthly" ? (
                <>
                  <span>
                    <small>รับแล้ว</small>
                    <strong>
                      {formatMoney(breakdown.totals.collectedRevenue || 0)} ฿
                    </strong>
                  </span>
                  <span>
                    <small>Unpaid</small>
                    <strong>
                      {formatMoney(breakdown.totals.unpaidRevenue || 0)} ฿
                    </strong>
                  </span>
                </>
              ) : (
                <>
                  <span>
                    <small>รายการหักลด</small>
                    <strong>
                      {formatMoney(breakdown.totals.reductions)} ฿
                    </strong>
                  </span>
                  <span>
                    <small>รายการ</small>
                    <strong>{breakdown.totals.transactionCount}</strong>
                  </span>
                </>
              )}
            </div>
          </section>

          <div className="financialBreakdown__analysisHeader">
            <div>
              <h2>{activeTitle}</h2>
              <p>สัดส่วนรายได้และรายละเอียดรายการ</p>
            </div>
            <div
              className={
                (selectedType || selectedGroupKey) && breakdownMode === "type"
                  ? "financialBreakdown__modeToggle financialBreakdown__modeToggle--filtered"
                  : "financialBreakdown__modeToggle"
              }
            >
              {(selectedType || selectedGroupKey) && breakdownMode === "type" && (
                <button
                  className="financialBreakdown__modeButton financialBreakdown__modeButton--active"
                  type="button"
                  onClick={() => {
                    setSelectedType(null);
                    setSelectedGroupKey(null);
                  }}
                >
                  ดูทั้งหมด
                </button>
              )}
              <button
                className={
                  breakdownMode === "type"
                    ? "financialBreakdown__modeButton financialBreakdown__modeButton--active"
                    : "financialBreakdown__modeButton"
                }
                type="button"
                onClick={() => setBreakdownMode("type")}
              >
                Type
              </button>
              <button
                className={
                  breakdownMode === "payment"
                    ? "financialBreakdown__modeButton financialBreakdown__modeButton--active"
                    : "financialBreakdown__modeButton"
                }
                type="button"
                onClick={() => setBreakdownMode("payment")}
              >
                Payment
              </button>
            </div>
          </div>

          <div
            className={
              activeGroups.length > 0
                ? "financialBreakdown__distributionBar"
                : "financialBreakdown__distributionBar financialBreakdown__distributionBar--empty"
            }
            aria-label={`${mode === "today" ? "Today’s Revenue" : "Expected Stay Revenue"} distribution across ${activeGroups.length} ${breakdownMode} categories`}
          >
            {activeGroups.map((group) => (
              <Tooltip
                content={
                  <>
                    <strong>{group.label}</strong>
                    <span>
                      {formatMoney(group.total)} ฿ ·{" "}
                      {formatMoney(group.percentage)}%
                    </span>
                  </>
                }
                className="financialBreakdown__distributionSegment"
                key={`bar-${breakdownMode}-${group.key}`}
                style={{
                  backgroundColor: group.color,
                  flexGrow: group.total,
                }}
                ariaLabel={`${group.label}: ${formatMoney(group.total)} ฿ (${formatMoney(group.percentage)}%)`}
              >
                <span />
              </Tooltip>
            ))}
          </div>

          {breakdown.categories.length === 0 &&
          breakdown.reductions.length === 0 ? (
            <div className="financialBreakdown__state">
              <i className="bx bx-info-circle" />
              <p>ยังไม่มีรายการรายได้ในช่วงนี้</p>
            </div>
          ) : (
            <>
              <BreakdownSection
                title={activeTitle}
                emptyText={activeEmptyText}
                groups={activeGroups}
                groupUnit={breakdownMode === "type" ? "แหล่ง" : "ช่องทาง"}
                dateFormat={dateFormat}
              />
              <BreakdownSection
                title="Reductions"
                emptyText="ยังไม่มีรายการลดรายได้ในช่วงนี้"
                groups={reductionGroups}
                groupUnit="แหล่ง"
                dateFormat={dateFormat}
                negative
              />
            </>
          )}
        </>
      )}
    </div>
  );
};

export default FinancialBreakdown;
