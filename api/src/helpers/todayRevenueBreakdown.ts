import type { booking, commercialSegment, PaymentMethod, PlatformId, transcation, TransactionType } from "../models/booking";
import { businessDateKey } from "./businessDateHelpers";
import { effectiveCommercialSegments, transactionPlatformId } from "./commercialSegmentHelpers";
import { bookingTransactionTodayReductionAmount, bookingTodayArrivalRevenueAmount, calculateTodayRevenueSummary, isCheckInRoundingAdjustment, targetSegmentForCheckInRounding, transactionTodayExtrasRevenueAmount, transactionDirection } from "./financeHelpers";
import { buildExpectedStayRevenueEntries, buildExpectedStayRevenueServiceEntries } from "./expectedStayRevenueHelpers";

const expectedStayRevenueTransactionMeta: Partial<
  Record<TransactionType, { label: string; color: string; icon: string }>
> = {
  roomCharge: { label: "ค่าห้อง", color: "#51d1dc", icon: "bx-bed-alt" },
  depositKept: {
    label: "มัดจำที่แขกยอมเสีย",
    color: "#eab308",
    icon: "bx-wallet",
  },
  adjustment: { label: "ปรับราคา", color: "#a78bfa", icon: "bx-edit-alt" },
  towel: { label: "Towel", color: "#38bdf8", icon: "bx-bath" },
  motorbike: { label: "Motorbike", color: "#fb923c", icon: "bx-cycling" },
  slowBoat: { label: "Slow Boat", color: "#2dd4bf", icon: "bx-water" },
  joinTour: { label: "Join Tour", color: "#22c55e", icon: "bx-map" },
  extraBed: { label: "Extra Bed", color: "#ec4899", icon: "bx-bed" },
  pickACraft: { label: "Pick A Craft", color: "#f59e0b", icon: "bx-palette" },
  trek2D: { label: "Trek 2D", color: "#16a34a", icon: "bx-map-alt" },
  setMenu: { label: "Set Menu", color: "#84cc16", icon: "bx-food-menu" },
  sleeperBus: { label: "Sleeper Bus", color: "#6366f1", icon: "bx-bus" },
  onlyWalk: { label: "Only Walk", color: "#14b8a6", icon: "bx-walk" },
  laundry: { label: "Laundry", color: "#60a5fa", icon: "bx-washer" },
  bicycle: { label: "Bicycle", color: "#fb923c", icon: "bx-cycling" },
  car: { label: "Car", color: "#64748b", icon: "bx-car" },
  misc: { label: "Misc", color: "#94a3b8", icon: "bx-dots-horizontal-rounded" },
  rainCoat: { label: "Rain Coat", color: "#0ea5e9", icon: "bx-cloud-rain" },
  passwordLock: { label: "Password Lock", color: "#8b5cf6", icon: "bx-lock" },
  cooking: { label: "Cooking", color: "#f97316", icon: "bx-food-menu" },
  cardSurcharge: {
    label: "ค่าธรรมเนียมบัตร 3%",
    color: "#94a3b8",
    icon: "bx-credit-card-alt",
  },
  roomRefund: { label: "คืนค่าห้อง", color: "#fb7185", icon: "bx-undo" },
  roomChargeWriteOff: {
    label: "ปิดยอดค่าห้องที่เหลือ",
    color: "#94a3b8",
    icon: "bx-calendar-x",
  },
  cancellationRefund: {
    label: "คืนเงินยกเลิก",
    color: "#fb7185",
    icon: "bx-calendar-x",
  },
  compensation: { label: "ชดเชยลูกค้า", color: "#38bdf8", icon: "bx-gift" },
};

const paymentMethodMeta: Record<
  PaymentMethod,
  { label: string; icon: string }
> = {
  OTA: { label: "OTA", icon: "bx-bank" },
  Cash: { label: "Cash", icon: "bx-currency-notes" },
  Card: { label: "Card", icon: "bx-credit-card-alt" },
  Transfer: { label: "Transfer", icon: "bx-arrow-right-left" },
  Unpaid: { label: "Unpaid", icon: "bx-alert-triangle" },
};

export type ExpectedStayRevenueBreakdownTransaction = {
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
  paymentMethod: transcation["paymentMethod"];
  paymentMethodLabel?: string;
  stayChargeKind?: "original" | "extension";
  stayStartDate?: string;
  direction?: transcation["direction"];
  createdAt?: Date;
  createdBy?: string;
  staff?: {
    username: string;
    name?: string;
    profilePictureUrl?: string;
  };
  note?: string;
  reference?: string;
};

export const standaloneSaleBookingView = (sale: { saleId: string; customerName?: string; createdBy?: string; transactions?: transcation[] }): booking =>
  ({
    bookingId: sale.saleId,
    name: sale.customerName || "ลูกค้าทั่วไป",
    platformId: "WALK",
    checkIn: new Date(0),
    checkOut: new Date(0),
    status: "checkedOut",
    transactions: sale.transactions || [],
    staffUsername: sale.createdBy,
    sourceType: "standaloneSale",
    saleId: sale.saleId,
  }) as unknown as booking;

export const standaloneTransactionMeta = (source: booking) => {
  const value = source as unknown as {
    sourceType?: "standaloneSale";
    saleId?: string;
  };
  return value.sourceType === "standaloneSale"
    ? {
        sourceType: "standaloneSale" as const,
        saleId: value.saleId || source.bookingId,
      }
    : { sourceType: "booking" as const, bookingId: source.bookingId };
};

export type ExpectedStayRevenueBreakdownCategory = {
  type: TransactionType;
  label: string;
  color: string;
  icon: string;
  total: number;
  percentage: number;
  transactionCount: number;
  transactions: ExpectedStayRevenueBreakdownTransaction[];
};

export type ExpectedStayRevenuePaymentMethodBreakdown = {
  paymentMethod: PaymentMethod;
  label: string;
  icon: string;
  total: number;
  percentage: number;
  transactionCount: number;
  transactions: ExpectedStayRevenueBreakdownTransaction[];
};

export const addBreakdownTransaction = (
  categories: Map<TransactionType, ExpectedStayRevenueBreakdownCategory>,
  transaction: transcation,
  booking: booking,
  amount: number,
  direction: NonNullable<transcation["direction"]>,
  paymentMethodLabel?: string,
  stayChargeKind?: "original" | "extension",
  stayStartDate?: string,
) => {
  const meta = expectedStayRevenueTransactionMeta[transaction.type] || {
    label: transaction.type,
    color: "#94a3b8",
    icon: "bx-receipt",
  };
  const existingCategory =
    categories.get(transaction.type) ||
    ({
      type: transaction.type,
      label: meta.label,
      color: meta.color,
      icon: meta.icon,
      total: 0,
      percentage: 0,
      transactionCount: 0,
      transactions: [],
    } satisfies ExpectedStayRevenueBreakdownCategory);

  existingCategory.total += amount;
  existingCategory.transactionCount += 1;
  existingCategory.transactions.push({
    transactionId: transaction._id ? String(transaction._id) : undefined,
    ...standaloneTransactionMeta(booking),
    guestName: booking.name,
    platformId: transactionPlatformId(booking, transaction),
    type: transaction.type,
    label: meta.label,
    color: meta.color,
    icon: meta.icon,
    amount,
    paymentMethod: transaction.paymentMethod,
    paymentMethodLabel,
    stayChargeKind,
    stayStartDate,
    direction,
    createdAt: transaction.createdAt,
    createdBy: transaction.createdBy || booking.staffUsername,
    note: transaction.note,
    reference: transaction.reference,
  });

  categories.set(transaction.type, existingCategory);
};

const paymentAllocationEntries = (
  paymentAmounts: Record<PaymentMethod, number> | undefined,
) =>
  paymentAmounts
    ? (Object.entries(paymentAmounts) as Array<[PaymentMethod, number]>).filter(
        ([, amount]) => amount > 0,
      )
    : [];

const paymentAllocationKey = (booking: booking, transactionId: string) =>
  `${booking.bookingId}::${transactionId}`;

export const paymentAllocationDisplay = (
  paymentAmounts: Record<PaymentMethod, number> | undefined,
  fallback: PaymentMethod,
) => {
  const entries = paymentAllocationEntries(paymentAmounts);
  if (!entries.length) return { paymentMethod: fallback };

  return {
    paymentMethod: entries[0][0],
    paymentMethodLabel:
      entries.length > 1
        ? entries
            .map(([paymentMethod]) => paymentMethodMeta[paymentMethod].label)
            .join(" + ")
        : undefined,
  };
};

type ResolvedPaymentTransaction = {
  transaction: transcation;
  isAggregatePayment?: boolean;
};

type PaymentMethodBreakdownOptions = {
  stayChargeKind?: "original" | "extension";
  stayStartDate?: string;
  isAggregatePayment?: boolean;
  resolvePaymentTransaction?: (
    paymentMethod: PaymentMethod,
  ) => ResolvedPaymentTransaction;
};

export const resolveSegmentPaymentTransaction = (
  booking: booking,
  segment: commercialSegment,
  roomCharge: transcation,
  paymentMethod: PaymentMethod,
): ResolvedPaymentTransaction => {
  if (paymentMethod === "Unpaid") {
    return { transaction: roomCharge, isAggregatePayment: false };
  }

  const currentSegmentId = segment._id ? String(segment._id) : "";
  const matchingPayments = (booking.transactions || []).filter((candidate) => {
    if (String(candidate._id || "") === String(roomCharge._id || "")) {
      return false;
    }
    if (
      candidate.paymentMethod !== paymentMethod ||
      transactionDirection(candidate) !== "in" ||
      Math.abs(candidate.amount || 0) <= 0
    ) {
      return false;
    }
    if (
      !["settlementCharge", "paymentCorrection", "adjustment"].includes(
        candidate.type,
      ) ||
      candidate.reasonOfAdjustment === "rounding"
    ) {
      return false;
    }
    const targetsExplicitly =
      (Boolean(currentSegmentId) &&
        candidate.commercialSegmentId === currentSegmentId) ||
      candidate.relatedTransactionId === segment.transactionId;
    const targetsOriginalImplicitly =
      !candidate.commercialSegmentId &&
      !candidate.relatedTransactionId &&
      candidate.relatedTransactionType === "roomCharge" &&
      segment.kind === "original";

    return targetsExplicitly || targetsOriginalImplicitly;
  });

  const contributingReceipts = [
    ...(roomCharge.paymentMethod === paymentMethod &&
    Math.abs(roomCharge.amount || 0) > 0
      ? [roomCharge]
      : []),
    ...matchingPayments,
  ];

  if (!contributingReceipts.length) {
    return { transaction: roomCharge, isAggregatePayment: false };
  }

  if (contributingReceipts.length > 1) {
    return {
      transaction: {
        ...roomCharge,
        _id: undefined,
        createdAt: undefined,
        createdBy: undefined,
        note: undefined,
        reference: undefined,
      },
      isAggregatePayment: true,
    };
  }

  const singleReceipt = contributingReceipts[0];

  return {
    transaction: {
      ...roomCharge,
      _id: singleReceipt._id || roomCharge._id,
      createdAt: singleReceipt.createdAt || roomCharge.createdAt,
      createdBy: singleReceipt.createdBy || roomCharge.createdBy,
      note: singleReceipt.note ?? roomCharge.note,
      reference: singleReceipt.reference ?? roomCharge.reference,
    },
    isAggregatePayment: false,
  };
};

export const addPaymentAllocationBreakdown = (
  paymentMethods: Map<PaymentMethod, ExpectedStayRevenuePaymentMethodBreakdown>,
  transaction: transcation,
  booking: booking,
  paymentAmounts: Record<PaymentMethod, number> | undefined,
  options?: PaymentMethodBreakdownOptions,
) => {
  const entries = paymentAllocationEntries(paymentAmounts);
  if (!entries.length) {
    addPaymentMethodBreakdownTransaction(
      paymentMethods,
      transaction,
      booking,
      Math.abs(transaction.amount || 0),
      transactionDirection(transaction),
      options,
    );
    return;
  }

  entries.forEach(([paymentMethod, amount]) => {
    const direction = paymentMethod === "Unpaid" ? "neutral" : "in";
    const resolvedPayment = options?.resolvePaymentTransaction?.(paymentMethod);
    const baseTransaction = resolvedPayment?.transaction || transaction;
    addPaymentMethodBreakdownTransaction(
      paymentMethods,
      { ...baseTransaction, paymentMethod, amount, direction },
      booking,
      amount,
      direction,
      {
        ...options,
        isAggregatePayment: resolvedPayment?.isAggregatePayment,
      },
    );
  });
};

export const addPaymentMethodBreakdownTransaction = (
  paymentMethods: Map<PaymentMethod, ExpectedStayRevenuePaymentMethodBreakdown>,
  transaction: transcation,
  booking: booking,
  amount: number,
  direction: NonNullable<transcation["direction"]>,
  options?: Pick<
    PaymentMethodBreakdownOptions,
    "stayChargeKind" | "stayStartDate" | "isAggregatePayment"
  >,
) => {
  const methodMeta = paymentMethodMeta[transaction.paymentMethod];
  const transactionMeta = expectedStayRevenueTransactionMeta[
    transaction.type
  ] || {
    label: transaction.type,
    color: "#94a3b8",
    icon: "bx-receipt",
  };
  const existingPaymentMethod =
    paymentMethods.get(transaction.paymentMethod) ||
    ({
      paymentMethod: transaction.paymentMethod,
      label: methodMeta.label,
      icon: methodMeta.icon,
      total: 0,
      percentage: 0,
      transactionCount: 0,
      transactions: [],
    } satisfies ExpectedStayRevenuePaymentMethodBreakdown);

  existingPaymentMethod.total += amount;
  existingPaymentMethod.transactionCount += 1;
  existingPaymentMethod.transactions.push({
    transactionId: options?.isAggregatePayment
      ? undefined
      : transaction._id
        ? String(transaction._id)
        : undefined,
    ...standaloneTransactionMeta(booking),
    guestName: booking.name,
    platformId: transactionPlatformId(booking, transaction),
    type: transaction.type,
    label: transactionMeta.label,
    color: transactionMeta.color,
    icon: transactionMeta.icon,
    amount,
    paymentMethod: transaction.paymentMethod,
    stayChargeKind: options?.stayChargeKind,
    stayStartDate: options?.stayStartDate,
    direction,
    createdAt: options?.isAggregatePayment ? undefined : transaction.createdAt,
    createdBy: options?.isAggregatePayment
      ? undefined
      : transaction.createdBy || booking.staffUsername,
    note: options?.isAggregatePayment ? undefined : transaction.note,
    reference: options?.isAggregatePayment ? undefined : transaction.reference,
  });

  paymentMethods.set(transaction.paymentMethod, existingPaymentMethod);
};

const resolveTodayArrivalPaymentTransaction = (
  booking: booking,
  roomCharge: transcation,
): ResolvedPaymentTransaction => {
  if (roomCharge.paymentMethod !== "Unpaid") {
    return { transaction: roomCharge, isAggregatePayment: false };
  }

  const settlements = (booking.transactions || []).filter(
    (transaction) =>
      transaction.type === "settlementCharge" &&
      transaction.paymentMethod !== "Unpaid" &&
      transactionDirection(transaction) === "in" &&
      Math.abs(transaction.amount || 0) > 0 &&
      transaction.relatedTransactionType === "roomCharge" &&
      transaction.relatedTransactionId === String(roomCharge._id),
  );
  if (!settlements.length) {
    return { transaction: roomCharge, isAggregatePayment: false };
  }
  if (settlements.length > 1) {
    return {
      transaction: {
        ...roomCharge,
        _id: undefined,
        paymentMethod: settlements[0].paymentMethod,
        createdAt: undefined,
        createdBy: undefined,
        note: undefined,
        reference: undefined,
      },
      isAggregatePayment: true,
    };
  }
  const settlement = settlements[0];

  return {
    transaction: {
      ...roomCharge,
      _id: settlement._id || roomCharge._id,
      paymentMethod: settlement.paymentMethod,
      createdAt: settlement.createdAt || roomCharge.createdAt,
      createdBy: settlement.createdBy || roomCharge.createdBy,
      note: settlement.note ?? roomCharge.note,
      reference: settlement.reference ?? roomCharge.reference,
    },
    isAggregatePayment: false,
  };
};

export const todayArrivalPaymentMethod = (
  booking: booking,
  roomCharge: transcation,
): PaymentMethod =>
  resolveTodayArrivalPaymentTransaction(booking, roomCharge).transaction
    .paymentMethod;

export const finalizeBreakdownCategories = (
  categories: Map<TransactionType, ExpectedStayRevenueBreakdownCategory>,
  expectedStayRevenue: number,
) =>
  Array.from(categories.values())
    .map((category) => ({
      ...category,
      total: Number(category.total.toFixed(2)),
      percentage:
        expectedStayRevenue === 0
          ? 0
          : Number(((category.total / expectedStayRevenue) * 100).toFixed(2)),
      transactions: category.transactions.sort((first, second) => {
        const firstTime = first.createdAt
          ? new Date(first.createdAt).getTime()
          : 0;
        const secondTime = second.createdAt
          ? new Date(second.createdAt).getTime()
          : 0;
        return secondTime - firstTime;
      }),
    }))
    .sort((first, second) => second.total - first.total);

export const finalizePaymentMethodBreakdowns = (
  paymentMethods: Map<PaymentMethod, ExpectedStayRevenuePaymentMethodBreakdown>,
  expectedStayRevenue: number,
) =>
  Array.from(paymentMethods.values())
    .map((paymentMethod) => ({
      ...paymentMethod,
      total: Number(paymentMethod.total.toFixed(2)),
      percentage:
        expectedStayRevenue === 0
          ? 0
          : Number(
              ((paymentMethod.total / expectedStayRevenue) * 100).toFixed(2),
            ),
      transactions: paymentMethod.transactions.sort((first, second) => {
        const firstTime = first.createdAt
          ? new Date(first.createdAt).getTime()
          : 0;
        const secondTime = second.createdAt
          ? new Date(second.createdAt).getTime()
          : 0;
        return secondTime - firstTime;
      }),
    }))
    .sort((first, second) => second.total - first.total);

/** Today’s Revenue rules shared by REST and the MCP read model. Records must already contain effective transactions. */
export const buildTodayRevenueBreakdown = (
  bookings: booking[],
  bounds: { start: Date; end: Date },
  formatBusinessDateKey = businessDateKey,
) => {
  const todaySummary = calculateTodayRevenueSummary(
    bookings,
    bounds.start,
    bounds.end,
  );
  const roomPaymentAmounts = new Map(
    buildExpectedStayRevenueEntries(bookings, bounds.start, bounds.end).map(
      (entry) => [
        paymentAllocationKey(entry.booking, entry.segment.transactionId),
        entry.paymentAmounts,
      ],
    ),
  );
  const servicePaymentAmounts = new Map(
    buildExpectedStayRevenueServiceEntries(
      bookings,
      bounds.start,
      bounds.end,
    ).map((entry) => [
      paymentAllocationKey(
        entry.booking,
        String(entry.transaction._id || ""),
      ),
      entry.paymentAmounts,
    ]),
  );
  const categories = new Map<
    TransactionType,
    ExpectedStayRevenueBreakdownCategory
  >();
  const reductions = new Map<
    TransactionType,
    ExpectedStayRevenueBreakdownCategory
  >();
  const paymentMethods = new Map<
    PaymentMethod,
    ExpectedStayRevenuePaymentMethodBreakdown
  >();

  bookings.forEach((booking) => {
    if (booking.voided) return;

    const isTodayArrival =
      new Date(booking.checkIn) >= bounds.start &&
      new Date(booking.checkIn) < bounds.end;

    if (
      isTodayArrival &&
      ["cancelled", "noShow"].includes(booking.status)
    ) {
      const arrivalAmount = bookingTodayArrivalRevenueAmount(booking);
      const roomCharge = (booking.transactions || []).find(
        (transaction) => transaction.type === "roomCharge",
      );

      if (arrivalAmount > 0 && roomCharge) {
        const stayStartDate = formatBusinessDateKey(new Date(booking.checkIn));
        const resolvedArrivalPayment = resolveTodayArrivalPaymentTransaction(
          booking,
          roomCharge,
        );
        const paymentMethod = resolvedArrivalPayment.transaction.paymentMethod;
        const arrivalCategoryTransaction = {
          ...roomCharge,
          amount: arrivalAmount,
          paymentMethod,
        };
        const arrivalPaymentTransaction = {
          ...resolvedArrivalPayment.transaction,
          amount: arrivalAmount,
          paymentMethod,
        };
        const direction = transactionDirection(arrivalCategoryTransaction);
        addBreakdownTransaction(
          categories,
          arrivalCategoryTransaction,
          booking,
          arrivalAmount,
          direction,
          undefined,
          "original",
          stayStartDate,
        );
        addPaymentMethodBreakdownTransaction(
          paymentMethods,
          arrivalPaymentTransaction,
          booking,
          arrivalAmount,
          direction,
          {
            stayChargeKind: "original",
            stayStartDate,
            isAggregatePayment: resolvedArrivalPayment.isAggregatePayment,
          },
        );
      }
    }

    if (!["cancelled", "noShow"].includes(booking.status)) {
      effectiveCommercialSegments(booking)
        .filter((segment) => {
          const segmentStart = new Date(segment.from);
          return segmentStart >= bounds.start && segmentStart < bounds.end;
        })
        .forEach((segment) => {
          const roomCharge = (booking.transactions || []).find(
            (transaction) =>
              String(transaction._id) === segment.transactionId,
          );
          if (!roomCharge) return;
          const stayStartDate = formatBusinessDateKey(new Date(segment.from));
          const amount = Math.abs(roomCharge.amount ?? segment.amount ?? 0);
          const segmentTransaction = {
            ...roomCharge,
            amount,
          };
          const paymentAmounts = roomPaymentAmounts.get(
            paymentAllocationKey(booking, segment.transactionId),
          );
          const displayPayment = paymentAllocationDisplay(
            paymentAmounts,
            segmentTransaction.paymentMethod,
          );
          const displayTransaction = {
            ...segmentTransaction,
            paymentMethod: displayPayment.paymentMethod,
          };
          const direction = transactionDirection(displayTransaction);
          addBreakdownTransaction(
            categories,
            displayTransaction,
            booking,
            amount,
            direction,
            displayPayment.paymentMethodLabel,
            segment.kind,
            stayStartDate,
          );
          addPaymentAllocationBreakdown(
            paymentMethods,
            segmentTransaction,
            booking,
            paymentAmounts,
            {
              stayChargeKind: segment.kind,
              stayStartDate,
              resolvePaymentTransaction: (paymentMethod) =>
                resolveSegmentPaymentTransaction(
                  booking,
                  segment,
                  roomCharge,
                  paymentMethod,
                ),
            },
          );
        });

      (booking.transactions || []).forEach((transaction) => {
        if (!isCheckInRoundingAdjustment(transaction)) return;
        const roundingAmount = Math.abs(transaction.amount || 0);
        if (roundingAmount <= 0) return;
        const targetSegment = targetSegmentForCheckInRounding(
          booking,
          transaction,
        );
        if (!targetSegment) return;
        const segmentStart = new Date(targetSegment.from);
        if (segmentStart < bounds.start || segmentStart >= bounds.end) return;

        const stayStartDate = formatBusinessDateKey(segmentStart);
        const roundingDirection = transactionDirection(transaction);
        addBreakdownTransaction(
          categories,
          transaction,
          booking,
          roundingAmount,
          roundingDirection,
          undefined,
          undefined,
          stayStartDate,
        );
        addPaymentMethodBreakdownTransaction(
          paymentMethods,
          transaction,
          booking,
          roundingAmount,
          roundingDirection,
          { stayStartDate },
        );
      });
    }

    (booking.transactions || []).forEach((transaction) => {
      if (!transaction.createdAt) return;
      const createdAt = new Date(transaction.createdAt);
      if (createdAt < bounds.start || createdAt >= bounds.end) return;

      const direction = transactionDirection(transaction);
      const extrasAmount = transactionTodayExtrasRevenueAmount(transaction);
      if (extrasAmount > 0) {
        const paymentAmounts = servicePaymentAmounts.get(
          paymentAllocationKey(booking, String(transaction._id || "")),
        );
        const displayPayment = paymentAllocationDisplay(
          paymentAmounts,
          transaction.paymentMethod,
        );
        const displayTransaction = {
          ...transaction,
          paymentMethod: displayPayment.paymentMethod,
        };
        addBreakdownTransaction(
          categories,
          displayTransaction,
          booking,
          extrasAmount,
          transactionDirection(displayTransaction),
          displayPayment.paymentMethodLabel,
        );
        addPaymentAllocationBreakdown(
          paymentMethods,
          transaction,
          booking,
          paymentAmounts,
        );
      }

      const reductionAmount = bookingTransactionTodayReductionAmount(
        booking,
        transaction,
        bounds.end,
      );
      const arrivalReductionAlreadyNetted =
        isTodayArrival &&
        ["cancelled", "noShow"].includes(booking.status) &&
        ["roomRefund", "roomChargeWriteOff", "cancellationRefund"].includes(
          transaction.type,
        );
      if (reductionAmount > 0 && !arrivalReductionAlreadyNetted) {
        addBreakdownTransaction(
          reductions,
          transaction,
          booking,
          reductionAmount,
          direction,
        );
      }
    });
  });

  const grossStayCharges = Array.from(categories.values()).reduce(
    (sum, category) => sum + category.total,
    0,
  );
  const reductionTotal = Array.from(reductions.values()).reduce(
    (sum, category) => sum + category.total,
    0,
  );
  const todayRevenue = todaySummary.todayRevenue;
  const finalizedCategories = finalizeBreakdownCategories(
    categories,
    grossStayCharges,
  );
  const finalizedReductions = finalizeBreakdownCategories(
    reductions,
    grossStayCharges,
  );
  const finalizedPaymentMethods = finalizePaymentMethodBreakdowns(
    paymentMethods,
    grossStayCharges,
  );
  return { todayRevenue, grossStayCharges, reductionTotal, finalizedCategories, finalizedReductions, finalizedPaymentMethods };
};
