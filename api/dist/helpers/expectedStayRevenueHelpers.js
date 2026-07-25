"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.expectedStayRevenueBookingQuery = exports.summarizeExpectedStayRevenue = exports.buildExpectedStayRevenueServiceEntries = exports.buildExpectedStayRevenueEntries = exports.EXPECTED_STAY_REVENUE_SERVICE_TYPES = void 0;
const commercialSegmentHelpers_1 = require("./commercialSegmentHelpers");
const financeHelpers_1 = require("./financeHelpers");
const transactionCorrections_1 = require("../services/transactionCorrections");
const ESR_REDUCTION_TYPES = new Set([
    "roomRefund",
    "roomChargeWriteOff",
    "cancellationRefund",
    "compensation",
]);
const ESR_PAYMENT_TYPES = new Set([
    "settlementCharge",
    "paymentCorrection",
]);
exports.EXPECTED_STAY_REVENUE_SERVICE_TYPES = [
    "towel",
    "motorbike",
    "slowBoat",
    "joinTour",
    "extraBed",
    "pickACraft",
    "trek2D",
    "setMenu",
    "sleeperBus",
    "onlyWalk",
    "laundry",
    "bicycle",
    "car",
    "misc",
    "rainCoat",
    "passwordLock",
    "cooking",
];
const ESR_SERVICE_TYPES = new Set(exports.EXPECTED_STAY_REVENUE_SERVICE_TYPES);
const PAID_METHODS = ["OTA", "Cash", "Card", "Transfer"];
const roundMoney = (value) => Number(value.toFixed(2));
const transactionId = (transaction) => String(transaction._id || "");
const segmentId = (segment) => String(segment._id || "");
const plainBooking = (record) => typeof record.toObject === "function"
    ? record.toObject()
    : record;
const plainTransaction = (transaction) => typeof transaction.toObject === "function"
    ? transaction.toObject()
    : { ...transaction };
const emptyPaymentAmounts = () => ({
    OTA: 0,
    Cash: 0,
    Card: 0,
    Transfer: 0,
    Unpaid: 0,
});
const transactionTargetsSegment = (transaction, segment) => {
    const currentSegmentId = segmentId(segment);
    return ((currentSegmentId &&
        transaction.commercialSegmentId === currentSegmentId) ||
        transaction.relatedTransactionId === segment.transactionId ||
        transactionId(transaction) === segment.transactionId);
};
const targetSegmentForTransaction = (transaction, segments) => {
    const explicitTarget = segments.find((segment) => transactionTargetsSegment(transaction, segment));
    if (explicitTarget)
        return explicitTarget;
    if (ESR_REDUCTION_TYPES.has(transaction.type) ||
        (ESR_PAYMENT_TYPES.has(transaction.type) &&
            transaction.relatedTransactionType === "roomCharge")) {
        return segments.find((segment) => segment.kind === "original");
    }
    return undefined;
};
const isNonRoundingRoomAdjustment = (transaction) => transaction.type === "adjustment" &&
    transaction.reasonOfAdjustment !== "rounding" &&
    (transaction.relatedTransactionType === "roomCharge" ||
        Boolean(transaction.relatedTransactionId) ||
        Boolean(transaction.commercialSegmentId));
const normalizedPaidAmounts = (rawAmounts, expectedRevenue) => {
    const positiveAmounts = PAID_METHODS.map((paymentMethod) => ({
        paymentMethod,
        amount: Math.max(roundMoney(rawAmounts[paymentMethod]), 0),
    })).filter(({ amount }) => amount > 0);
    const rawCollected = positiveAmounts.reduce((total, payment) => total + payment.amount, 0);
    const collectedTarget = Math.min(roundMoney(rawCollected), Math.max(roundMoney(expectedRevenue), 0));
    const normalized = emptyPaymentAmounts();
    if (rawCollected > 0 && collectedTarget > 0) {
        let allocated = 0;
        positiveAmounts.forEach(({ paymentMethod, amount }, index) => {
            const isLast = index === positiveAmounts.length - 1;
            const normalizedAmount = isLast
                ? roundMoney(collectedTarget - allocated)
                : roundMoney((amount / rawCollected) * collectedTarget);
            normalized[paymentMethod] = normalizedAmount;
            allocated = roundMoney(allocated + normalizedAmount);
        });
    }
    normalized.Unpaid = Math.max(roundMoney(expectedRevenue - collectedTarget), 0);
    return normalized;
};
const buildExpectedStayRevenueEntries = (records, start, end) => records.flatMap((record) => {
    const sourceBooking = plainBooking(record);
    if (sourceBooking.voided ||
        sourceBooking.status === "cancelled" ||
        sourceBooking.status === "noShow") {
        return [];
    }
    const sourceTransactions = (sourceBooking.transactions || []).map(plainTransaction);
    const currentBooking = {
        ...sourceBooking,
        transactions: [
            ...(0, transactionCorrections_1.projectEffectiveTransactions)(sourceTransactions.filter((transaction) => transaction.type !== "adjustment"), sourceBooking.transactionCorrections || []),
            ...sourceTransactions.filter((transaction) => transaction.type === "adjustment"),
        ],
    };
    const segments = (0, commercialSegmentHelpers_1.effectiveCommercialSegments)(currentBooking);
    const roomCharges = new Map((currentBooking.transactions || [])
        .filter((transaction) => transaction.type === "roomCharge")
        .map((transaction) => [transactionId(transaction), transaction]));
    const reductionsBySegment = new Map();
    const chargeAdjustmentsBySegment = new Map();
    const paymentsBySegment = new Map();
    segments.forEach((segment) => {
        reductionsBySegment.set(segment.transactionId, []);
        chargeAdjustmentsBySegment.set(segment.transactionId, []);
        paymentsBySegment.set(segment.transactionId, emptyPaymentAmounts());
    });
    (currentBooking.transactions || []).forEach((transaction) => {
        if (transaction.type === "roomCharge")
            return;
        const targetSegment = targetSegmentForTransaction(transaction, segments);
        if (!targetSegment)
            return;
        if (isNonRoundingRoomAdjustment(transaction)) {
            const amount = Math.abs(transaction.amount || 0);
            const direction = (0, financeHelpers_1.transactionDirection)(transaction);
            if (direction === "out") {
                reductionsBySegment
                    .get(targetSegment.transactionId)
                    ?.push({ transaction, amount });
            }
            else {
                chargeAdjustmentsBySegment
                    .get(targetSegment.transactionId)
                    ?.push({ transaction, amount });
            }
            if (transaction.paymentMethod !== "Unpaid") {
                const paymentAmounts = paymentsBySegment.get(targetSegment.transactionId);
                if (paymentAmounts) {
                    paymentAmounts[transaction.paymentMethod] = roundMoney(paymentAmounts[transaction.paymentMethod] +
                        (0, financeHelpers_1.transactionSignedAmount)(transaction));
                }
            }
            return;
        }
        if (ESR_REDUCTION_TYPES.has(transaction.type)) {
            const amount = Math.abs(transaction.amount || 0);
            reductionsBySegment
                .get(targetSegment.transactionId)
                ?.push({ transaction, amount });
            if (transaction.paymentMethod !== "Unpaid" &&
                (0, financeHelpers_1.transactionDirection)(transaction) === "out") {
                const paymentAmounts = paymentsBySegment.get(targetSegment.transactionId);
                if (paymentAmounts) {
                    paymentAmounts[transaction.paymentMethod] = roundMoney(paymentAmounts[transaction.paymentMethod] - amount);
                }
            }
            return;
        }
        if (ESR_PAYMENT_TYPES.has(transaction.type) &&
            transaction.paymentMethod !== "Unpaid") {
            const paymentAmounts = paymentsBySegment.get(targetSegment.transactionId);
            if (paymentAmounts) {
                paymentAmounts[transaction.paymentMethod] = roundMoney(paymentAmounts[transaction.paymentMethod] +
                    (0, financeHelpers_1.transactionSignedAmount)(transaction));
            }
        }
    });
    return segments.flatMap((segment) => {
        const segmentStart = new Date(segment.from);
        if (segmentStart < start || segmentStart >= end)
            return [];
        const roomCharge = roomCharges.get(segment.transactionId) ||
            {
                _id: segment.transactionId,
                type: "roomCharge",
                paymentMethod: "Unpaid",
                amount: segment.amount,
                platformId: segment.platformId,
                commercialSegmentId: segmentId(segment) || undefined,
                createdAt: segment.createdAt,
                createdBy: segment.createdBy,
                note: segment.note,
            };
        const chargeAdjustments = chargeAdjustmentsBySegment.get(segment.transactionId) || [];
        const baseRoomRevenue = Math.abs(roomCharge.amount || segment.amount || 0);
        const chargeAdjustmentTotal = chargeAdjustments.reduce((total, adjustment) => total + adjustment.amount, 0);
        const grossRevenue = baseRoomRevenue + chargeAdjustmentTotal;
        const reductions = reductionsBySegment.get(segment.transactionId) || [];
        const reductionTotal = reductions.reduce((total, reduction) => total + reduction.amount, 0);
        const expectedRevenue = roundMoney(grossRevenue - reductionTotal);
        const rawPaymentAmounts = paymentsBySegment.get(segment.transactionId) || emptyPaymentAmounts();
        if (roomCharge.paymentMethod !== "Unpaid") {
            rawPaymentAmounts[roomCharge.paymentMethod] = roundMoney(rawPaymentAmounts[roomCharge.paymentMethod] + baseRoomRevenue);
        }
        const paymentAmounts = normalizedPaidAmounts(rawPaymentAmounts, expectedRevenue);
        const collectedRevenue = PAID_METHODS.reduce((total, paymentMethod) => total + paymentAmounts[paymentMethod], 0);
        return [
            {
                booking: currentBooking,
                segment,
                roomCharge,
                start: segmentStart,
                chargeAdjustments,
                grossRevenue: roundMoney(grossRevenue),
                reductions,
                reductionTotal: roundMoney(reductionTotal),
                expectedRevenue,
                collectedRevenue: roundMoney(collectedRevenue),
                unpaidRevenue: paymentAmounts.Unpaid,
                paymentAmounts,
            },
        ];
    });
});
exports.buildExpectedStayRevenueEntries = buildExpectedStayRevenueEntries;
const buildExpectedStayRevenueServiceEntries = (records, start, end) => records.flatMap((record) => {
    const sourceBooking = plainBooking(record);
    if (sourceBooking.voided)
        return [];
    const currentBooking = {
        ...sourceBooking,
        transactions: (0, transactionCorrections_1.projectEffectiveTransactions)((sourceBooking.transactions || []).map(plainTransaction), sourceBooking.transactionCorrections || []),
    };
    const transactions = currentBooking.transactions || [];
    const services = transactions.filter((transaction) => {
        if (!ESR_SERVICE_TYPES.has(transaction.type) ||
            !transaction.createdAt) {
            return false;
        }
        const transactionDate = new Date(transaction.createdAt);
        return transactionDate >= start && transactionDate < end;
    });
    return services.map((transaction) => {
        const serviceTransactionId = transactionId(transaction);
        const sameTypeServices = services.filter((candidate) => candidate.type === transaction.type);
        const rawPaymentAmounts = emptyPaymentAmounts();
        const grossRevenue = roundMoney(Math.abs(transaction.amount || 0));
        if (transaction.paymentMethod !== "Unpaid") {
            rawPaymentAmounts[transaction.paymentMethod] = grossRevenue;
        }
        transactions.forEach((payment) => {
            if (!ESR_PAYMENT_TYPES.has(payment.type) ||
                payment.paymentMethod === "Unpaid") {
                return;
            }
            const linkedById = Boolean(serviceTransactionId) &&
                payment.relatedTransactionId === serviceTransactionId;
            const unambiguousLegacyLink = !payment.relatedTransactionId &&
                payment.relatedTransactionType === transaction.type &&
                sameTypeServices.length === 1;
            if (!linkedById && !unambiguousLegacyLink)
                return;
            rawPaymentAmounts[payment.paymentMethod] = roundMoney(rawPaymentAmounts[payment.paymentMethod] +
                (0, financeHelpers_1.transactionSignedAmount)(payment));
        });
        const paymentAmounts = normalizedPaidAmounts(rawPaymentAmounts, grossRevenue);
        const collectedRevenue = PAID_METHODS.reduce((total, paymentMethod) => total + paymentAmounts[paymentMethod], 0);
        return {
            booking: currentBooking,
            transaction,
            start: new Date(transaction.createdAt),
            grossRevenue,
            expectedRevenue: grossRevenue,
            collectedRevenue: roundMoney(collectedRevenue),
            unpaidRevenue: paymentAmounts.Unpaid,
            paymentAmounts,
        };
    });
});
exports.buildExpectedStayRevenueServiceEntries = buildExpectedStayRevenueServiceEntries;
const summarizeExpectedStayRevenue = (records, start, end) => {
    const entries = (0, exports.buildExpectedStayRevenueEntries)(records, start, end);
    const serviceEntries = (0, exports.buildExpectedStayRevenueServiceEntries)(records, start, end);
    const grossRoomCharges = roundMoney(entries.reduce((total, entry) => total + entry.grossRevenue, 0));
    const grossServiceRevenue = roundMoney(serviceEntries.reduce((total, entry) => total + entry.grossRevenue, 0));
    return {
        entries,
        serviceEntries,
        grossStayCharges: roundMoney(grossRoomCharges + grossServiceRevenue),
        grossRoomCharges,
        grossServiceRevenue,
        reductions: roundMoney(entries.reduce((total, entry) => total + entry.reductionTotal, 0)),
        expectedStayRevenue: roundMoney(entries.reduce((total, entry) => total + entry.expectedRevenue, 0) +
            serviceEntries.reduce((total, entry) => total + entry.expectedRevenue, 0)),
        collectedRevenue: roundMoney(entries.reduce((total, entry) => total + entry.collectedRevenue, 0) +
            serviceEntries.reduce((total, entry) => total + entry.collectedRevenue, 0)),
        unpaidRevenue: roundMoney(entries.reduce((total, entry) => total + entry.unpaidRevenue, 0) +
            serviceEntries.reduce((total, entry) => total + entry.unpaidRevenue, 0)),
    };
};
exports.summarizeExpectedStayRevenue = summarizeExpectedStayRevenue;
const expectedStayRevenueBookingQuery = (start, end) => ({
    voided: { $ne: true },
    $or: [
        {
            $and: [
                { status: { $nin: ["cancelled", "noShow"] } },
                {
                    $or: [
                        {
                            commercialSegments: {
                                $elemMatch: {
                                    from: { $gte: start, $lt: end },
                                },
                            },
                        },
                        {
                            checkIn: { $gte: start, $lt: end },
                        },
                    ],
                },
            ],
        },
        {
            transactions: {
                $elemMatch: {
                    type: { $in: exports.EXPECTED_STAY_REVENUE_SERVICE_TYPES },
                    createdAt: { $gte: start, $lt: end },
                },
            },
        },
    ],
});
exports.expectedStayRevenueBookingQuery = expectedStayRevenueBookingQuery;
//# sourceMappingURL=expectedStayRevenueHelpers.js.map