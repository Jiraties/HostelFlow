import "./FinancialBreakdown.css";

import axios from "axios";
import { useEffect, useMemo, useState } from "react";

import { API_URL } from "../../config/api";
import { useAuth } from "../../context/AuthContext";
import {
  formatDisplayDate,
  formatDisplayDateTime,
} from "../../helpers/displayDate";
import type { DateFormatPreference } from "../../types/userSettings";
import type {
  PaymentMethod,
  PlatformId,
  TransactionDirection,
  TransactionType,
} from "../../types/bookingTypes";

type ExpectedStayRevenueBreakdownTransaction = {
  transactionId?: string;
  bookingId: string;
  guestName: string;
  platformId: PlatformId;
  type: TransactionType;
  label: string;
  color: string;
  icon: string;
  amount: number;
  paymentMethod: PaymentMethod;
  direction?: TransactionDirection;
  createdAt?: string | Date;
  createdBy?: string;
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
    basis: "transactionCreatedAt" | "checkInAndTransactionCreatedAt";
  };
  totals: {
    grossStayCharges: number;
    expectedStayRevenue: number;
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
  Unpaid: "bx-error",
};

const paymentMethodColorMap: Record<PaymentMethod, string> = {
  OTA: "#4f8fda",
  Cash: "#4fb58a",
  Card: "#8b6fd6",
  Transfer: "#d9a441",
  Unpaid: "#d66f61",
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
  dateFormat,
  negative = false,
}: {
  title: string;
  emptyText: string;
  groups: BreakdownDisplayGroup[];
  dateFormat: DateFormatPreference;
  negative?: boolean;
}) => {
  const [openGroupKey, setOpenGroupKey] = useState<
    string | null | undefined
  >(undefined);
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
        <span>{groups.length} groups</span>
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
                        className="financialBreakdown__transaction"
                        key={
                          transaction.transactionId ||
                          `${transaction.bookingId}-${group.key}-${index}`
                        }
                      >
                        <div className="financialBreakdown__transactionMain">
                          <strong>{transaction.guestName}</strong>
                          <span>
                            {transaction.bookingId} · {transaction.label} ·{" "}
                            {formatDateTime(transaction.createdAt, dateFormat)}
                          </span>
                        </div>
                        <div className="financialBreakdown__transactionSide">
                          <strong className="financialBreakdown__transactionAmount">
                            {negative ? "-" : ""}
                            {formatMoney(transaction.amount)} ฿
                          </strong>
                          <span className="financialBreakdown__paymentMethod">
                            {paymentMethodLabel[transaction.paymentMethod]}
                            <i
                              className={`bx ${paymentMethodIconMap[transaction.paymentMethod]}`}
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
  initialType = null,
}: {
  mode?: "monthly" | "today";
  initialType?: TransactionType | null;
}) => {
  const { user } = useAuth();
  const dateFormat = user?.settings.dateFormat || "dd/MM/yyyy";
  const [breakdown, setBreakdown] =
    useState<ExpectedStayRevenueBreakdownResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [breakdownMode, setBreakdownMode] = useState<BreakdownMode>("type");
  const [selectedType, setSelectedType] = useState<TransactionType | null>(
    initialType,
  );
  const typeGroups = useMemo<BreakdownDisplayGroup[]>(
    () =>
      (breakdown?.categories || []).map((category) => ({
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
      ? selectedType
        ? typeGroups.filter((group) => group.key === selectedType)
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
          { withCredentials: true },
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
  }, [mode]);

  return (
    <div className="viewBooking__wrapper">
      <div className="financialBreakdown__header">
        <div>
          <h1 className="viewBooking__name">
            {mode === "today" ? "Today’s Revenue" : "Expected Stay Revenue"}
          </h1>
          <p>
            {mode === "today"
              ? "มูลค่าการจองที่เช็คอินวันนี้ รวมบริการเสริมวันนี้ หลังหักรายการลดรายได้"
              : "รายได้จากการเข้าพักหลังหักรายการลดรายได้ ไม่รวมมัดจำและรายการรับเงินจริง"}
          </p>
        </div>
        {breakdown && (
          <span>
            {formatDate(breakdown.period.startDate, dateFormat)} -{" "}
            {formatExclusiveEndDate(breakdown.period.endDate, dateFormat)}
          </span>
        )}
      </div>

      {loading && (
        <div className="financialBreakdown__state">
          <i className="bx bx-loader-alt bx-spin" />
          <p>กำลังโหลดข้อมูลรายได้</p>
        </div>
      )}

      {!loading && error && (
        <div className="financialBreakdown__state financialBreakdown__state--error">
          <i className="bx bx-error-circle" />
          <p>{error}</p>
        </div>
      )}

      {!loading && !error && breakdown && (
        <>
          <section className="financialBreakdown__summary">
            <div className="financialBreakdown__summaryPrimary">
              <p>{mode === "today" ? "Today’s Revenue" : "Expected Stay Revenue"}</p>
              <strong>
                {formatMoney(breakdown.totals.expectedStayRevenue)} ฿
              </strong>
            </div>
            <div className="financialBreakdown__summaryMeta">
              <span>
                <small>
                  {mode === "today" ? "ก่อนหักรายการลด" : "Gross Stay Charges"}
                </small>
                <strong>
                  {formatMoney(breakdown.totals.grossStayCharges)} ฿
                </strong>
              </span>
              <span>
                <small>รายการหักลด</small>
                <strong>{formatMoney(breakdown.totals.reductions)} ฿</strong>
              </span>
              <span>
                <small>รายการ</small>
                <strong>{breakdown.totals.transactionCount}</strong>
              </span>
            </div>
          </section>

          <div className="financialBreakdown__analysisHeader">
            <div>
              <h2>{activeTitle}</h2>
              <p>สัดส่วนรายได้และรายละเอียดรายการ</p>
            </div>
            <div
              className={
                selectedType && breakdownMode === "type"
                  ? "financialBreakdown__modeToggle financialBreakdown__modeToggle--filtered"
                  : "financialBreakdown__modeToggle"
              }
            >
              {selectedType && breakdownMode === "type" && (
                <button
                  className="financialBreakdown__modeButton financialBreakdown__modeButton--active"
                  type="button"
                  onClick={() => setSelectedType(null)}
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
              <span
                className="financialBreakdown__distributionSegment"
                key={`bar-${breakdownMode}-${group.key}`}
                style={{
                  backgroundColor: group.color,
                  flexGrow: group.total,
                }}
                title={`${group.label}: ${formatMoney(group.total)} ฿ (${formatMoney(
                  group.percentage,
                )}%)`}
              >
                <span className="financialBreakdown__distributionTooltip">
                  <strong>{group.label}</strong>
                  <span>
                    {formatMoney(group.total)} ฿ ·{" "}
                    {formatMoney(group.percentage)}%
                  </span>
                </span>
              </span>
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
                dateFormat={dateFormat}
              />
              <BreakdownSection
                title="Reductions"
                emptyText="ยังไม่มีรายการลดรายได้ในช่วงนี้"
                groups={reductionGroups}
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
