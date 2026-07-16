"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.approveReviewEvent = exports.getReviewEvents = exports.upsertDailyClose = exports.closeCashShift = exports.startCashShift = exports.resolveCashShiftAudit = exports.getCashShiftAudit = exports.getCashPosition = exports.getReconciliation = exports.getTodayRevenueSummary = exports.getTodayRevenueBreakdown = exports.getExpectedStayRevenueBreakdown = void 0;
const mongoose_1 = __importDefault(require("mongoose"));
const booking_1 = __importDefault(require("../models/booking"));
const cashShift_1 = __importDefault(require("../models/cashShift"));
const dailyClose_1 = __importDefault(require("../models/dailyClose"));
const user_1 = __importDefault(require("../models/user"));
const activityServices_1 = require("../services/activityServices");
const financeHelpers_1 = require("../helpers/financeHelpers");
const commercialSegmentHelpers_1 = require("../helpers/commercialSegmentHelpers");
const mutationIdempotency_1 = require("../services/mutationIdempotency");
const cashShiftMutationLock_1 = require("../services/cashShiftMutationLock");
const cashLedgerTransaction_1 = require("../services/cashLedgerTransaction");
const sendDuplicateMutationResponse = (res) => res.status(409).json({
    error: "DUPLICATE_REQUEST",
    message: "คำขอนี้ถูกส่งซ้ำหรือเพิ่งดำเนินการสำเร็จ กรุณารีเฟรชข้อมูล",
});
const BUSINESS_TIME_ZONE = "Asia/Bangkok";
const BANGKOK_UTC_OFFSET_HOURS = 7;
const expectedStayRevenueTransactionMeta = {
    roomCharge: { label: "ค่าห้อง", color: "#51d1dc", icon: "bx-bed-alt" },
    depositKept: {
        label: "มัดจำที่แขกยอมเสีย",
        color: "#eab308",
        icon: "bx-wallet",
    },
    adjustment: { label: "ปรับราคา", color: "#a78bfa", icon: "bx-edit-alt" },
    towel: { label: "ผ้าเช็ดตัว", color: "#38bdf8", icon: "bx-bath" },
    motorbike: { label: "มอเตอร์ไซค์", color: "#fb923c", icon: "bx-cycling" },
    slowBoat: { label: "Slow Boat", color: "#2dd4bf", icon: "bx-water" },
    joinTour: { label: "Join Tour", color: "#22c55e", icon: "bx-map" },
    extraBed: { label: "เตียงเสริม", color: "#ec4899", icon: "bx-bed" },
    pickACraft: { label: "Pick A Craft", color: "#f59e0b", icon: "bx-palette" },
    trek2D: { label: "Trek 2D", color: "#16a34a", icon: "bx-map-alt" },
    setMenu: { label: "Set Menu", color: "#84cc16", icon: "bx-food-menu" },
    sleeperBus: { label: "Sleeper Bus", color: "#6366f1", icon: "bx-bus" },
    onlyWalk: { label: "Only Walk", color: "#14b8a6", icon: "bx-walk" },
    laundry: { label: "Laundry", color: "#60a5fa", icon: "bx-washer" },
    bicycle: { label: "Bicycle", color: "#fb923c", icon: "bx-cycling" },
    car: { label: "Car", color: "#64748b", icon: "bx-car" },
    misc: { label: "Misc", color: "#94a3b8", icon: "bx-dots-horizontal-rounded" },
    cardSurcharge: {
        label: "ค่าธรรมเนียมบัตร 3%",
        color: "#94a3b8",
        icon: "bx-credit-card-alt",
    },
    roomRefund: { label: "คืนค่าห้อง", color: "#fb7185", icon: "bx-undo" },
    cancellationRefund: {
        label: "คืนเงินยกเลิก",
        color: "#fb7185",
        icon: "bx-calendar-x",
    },
    compensation: { label: "ชดเชยลูกค้า", color: "#38bdf8", icon: "bx-gift" },
};
const expectedStayRevenueTypes = new Set([
    "roomCharge",
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
    "cardSurcharge",
]);
const expectedStayRevenueReductionTypes = new Set([
    "roomRefund",
    "cancellationRefund",
    "compensation",
]);
const paymentMethodMeta = {
    OTA: { label: "OTA", icon: "bx-bank" },
    Cash: { label: "Cash", icon: "bx-currency-notes" },
    Card: { label: "Card", icon: "bx-credit-card-alt" },
    Transfer: { label: "Transfer", icon: "bx-arrow-right-left" },
    Unpaid: { label: "Unpaid", icon: "bx-error" },
};
const getBusinessDateParts = (date = new Date()) => {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: BUSINESS_TIME_ZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).formatToParts(date);
    return {
        year: Number(parts.find((part) => part.type === "year")?.value),
        month: Number(parts.find((part) => part.type === "month")?.value),
        day: Number(parts.find((part) => part.type === "day")?.value),
    };
};
const getBusinessDateStart = (year, month, day) => new Date(Date.UTC(year, month - 1, day, -BANGKOK_UTC_OFFSET_HOURS, 0, 0, 0));
const formatBusinessDateKey = (date) => {
    const parts = getBusinessDateParts(date);
    return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
};
const parseBusinessDateKey = (dateKey) => {
    if (!dateKey || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey))
        return null;
    const [year, month, day] = dateKey.split("-").map(Number);
    if (!year || !month || !day)
        return null;
    return getBusinessDateStart(year, month, day);
};
const getBusinessMonthBounds = (date = new Date()) => {
    const parts = getBusinessDateParts(date);
    const start = getBusinessDateStart(parts.year, parts.month, 1);
    const end = parts.month === 12
        ? getBusinessDateStart(parts.year + 1, 1, 1)
        : getBusinessDateStart(parts.year, parts.month + 1, 1);
    return { start, end };
};
const getExpectedStayRevenueBounds = (startDate, endDate) => {
    if (!startDate && !endDate)
        return getBusinessMonthBounds();
    const start = parseBusinessDateKey(startDate);
    const end = parseBusinessDateKey(endDate);
    if (!start || !end || start >= end)
        return null;
    return { start, end };
};
const getBusinessDayBoundsFromKey = (dateKey) => {
    if (dateKey && !/^\d{4}-\d{2}-\d{2}$/.test(dateKey))
        return null;
    const parts = dateKey
        ? dateKey.split("-").map(Number)
        : [
            getBusinessDateParts().year,
            getBusinessDateParts().month,
            getBusinessDateParts().day,
        ];
    const start = getBusinessDateStart(parts[0], parts[1], parts[2]);
    const end = new Date(start.getTime() + 86400000);
    return {
        businessDate: `${parts[0]}-${String(parts[1]).padStart(2, "0")}-${String(parts[2]).padStart(2, "0")}`,
        start,
        end,
    };
};
const getTransactionsForBusinessDate = async (businessDate, staffUsername) => {
    const bounds = getBusinessDayBoundsFromKey(businessDate);
    if (!bounds)
        return null;
    const bookings = await booking_1.default.find({
        $or: [
            { "transactions.createdAt": { $gte: bounds.start, $lt: bounds.end } },
            { checkIn: { $gte: bounds.start, $lt: bounds.end } },
            { checkOut: { $gte: bounds.start, $lt: bounds.end } },
            { "cancellation.cancelledAt": { $gte: bounds.start, $lt: bounds.end } },
            { "checkout.checkedOutAt": { $gte: bounds.start, $lt: bounds.end } },
        ],
    }).lean();
    const transactions = bookings.flatMap((booking) => (booking.transactions || [])
        .filter((transaction) => (0, financeHelpers_1.transactionFallsOnBusinessDate)(transaction, booking.checkIn, bounds.start, bounds.end))
        .filter((transaction) => {
        if (!staffUsername)
            return true;
        return (transaction.createdBy || booking.staffUsername) === staffUsername;
    })
        .map((transaction) => ({
        ...transaction,
        bookingId: booking.bookingId,
        guestName: booking.name,
        staffUsername: transaction.createdBy || booking.staffUsername,
    })));
    return {
        ...bounds,
        transactions,
        summary: (0, financeHelpers_1.summarizeTransactions)(transactions),
    };
};
const attachDailyCloseStaffProfiles = async (dailyCloses) => {
    const usernames = [
        ...new Set(dailyCloses.flatMap((dailyClose) => [
            dailyClose.staffUsername,
            dailyClose.createdBy,
        ])),
    ].filter((username) => Boolean(username));
    const users = await user_1.default.find({ username: { $in: usernames } })
        .select("username name profilePictureUrl")
        .lean();
    const usersByUsername = new Map(users.map((user) => [user.username, user]));
    return dailyCloses.map((dailyClose) => {
        const closeObject = dailyClose.toObject();
        const staff = usersByUsername.get(dailyClose.staffUsername);
        const closedBy = usersByUsername.get(dailyClose.createdBy);
        return {
            ...closeObject,
            staff: staff
                ? {
                    username: staff.username,
                    name: staff.name,
                    profilePictureUrl: staff.profilePictureUrl,
                }
                : undefined,
            closedBy: closedBy
                ? {
                    username: closedBy.username,
                    name: closedBy.name,
                    profilePictureUrl: closedBy.profilePictureUrl,
                }
                : undefined,
        };
    });
};
const getShiftTransactions = async (shift, session) => {
    const shiftId = String(shift._id);
    const bookings = await booking_1.default.find({ "transactions.cashShiftId": shiftId })
        .session(session || null)
        .lean();
    return bookings.flatMap((booking) => (booking.transactions || [])
        .filter((transaction) => transaction.cashShiftId === shiftId)
        .map((transaction) => ({
        ...transaction,
        bookingId: booking.bookingId,
        guestName: booking.name,
        staffUsername: transaction.createdBy || booking.staffUsername,
    })));
};
const getUnassignedCashTransactionsBetween = async (start, end) => {
    const bookings = await booking_1.default.find({
        "transactions.createdAt": { $gte: start, $lt: end },
    }).lean();
    return bookings.flatMap((booking) => (booking.transactions || [])
        .filter((transaction) => {
        if (transaction.cashShiftId)
            return false;
        const createdAt = new Date(transaction.createdAt || booking.checkIn);
        return createdAt >= start && createdAt < end;
    })
        .map((transaction) => ({
        ...transaction,
        bookingId: booking.bookingId,
        guestName: booking.name,
        staffUsername: transaction.createdBy || booking.staffUsername,
    })));
};
const enrichCashShift = async (cashShift) => {
    const shiftObject = typeof cashShift.toObject === "function" ? cashShift.toObject() : cashShift;
    const movements = (0, financeHelpers_1.summarizeCashStashes)(await getShiftTransactions(shiftObject));
    const operatingExpectedCash = Number(shiftObject.operatingOpeningCash || 0) +
        movements.operatingCashIn -
        movements.operatingCashOut;
    return {
        ...shiftObject,
        operatingCashIn: movements.operatingCashIn,
        operatingCashOut: movements.operatingCashOut,
        operatingExpectedCash,
    };
};
const operatingCashShiftView = (shift) => {
    const { depositOpeningCash: _depositOpeningCash, depositCashIn: _depositCashIn, depositCashOut: _depositCashOut, depositExpectedCash: _depositExpectedCash, depositActualCash: _depositActualCash, depositVariance: _depositVariance, depositPreparation: _depositPreparation, ...operatingShift } = shift;
    return operatingShift;
};
const cashShiftAuditView = (shift) => {
    const legacyValues = [
        shift.depositOpeningCash,
        shift.depositCashIn,
        shift.depositCashOut,
        shift.depositExpectedCash,
        shift.depositActualCash,
        shift.depositVariance,
        shift.depositPreparation,
    ];
    return {
        ...operatingCashShiftView(shift),
        legacyDeposit: legacyValues.some((value) => value !== undefined && value !== null)
            ? {
                openingCash: shift.depositOpeningCash,
                cashIn: shift.depositCashIn,
                cashOut: shift.depositCashOut,
                expectedCash: shift.depositExpectedCash,
                actualCash: shift.depositActualCash,
                variance: shift.depositVariance,
                preparation: shift.depositPreparation,
            }
            : undefined,
    };
};
const attachCashShiftStaffProfiles = async (cashShifts) => {
    const usernames = [
        ...new Set(cashShifts.map((cashShift) => cashShift.staffUsername)),
    ].filter((username) => Boolean(username));
    const users = await user_1.default.find({ username: { $in: usernames } })
        .select("username name profilePictureUrl")
        .lean();
    const usersByUsername = new Map(users.map((user) => [user.username, user]));
    return cashShifts.map((cashShift) => {
        const staff = cashShift.staffUsername
            ? usersByUsername.get(cashShift.staffUsername)
            : undefined;
        return {
            ...cashShift,
            staff: staff
                ? {
                    username: staff.username,
                    name: staff.name,
                    profilePictureUrl: staff.profilePictureUrl,
                }
                : undefined,
        };
    });
};
const getCashPositionForDate = async (businessDate) => {
    const bounds = getBusinessDayBoundsFromKey(businessDate);
    if (!bounds)
        return null;
    const shifts = await cashShift_1.default.find({ businessDate: bounds.businessDate }).sort({
        shiftNumber: 1,
    });
    const activeShift = shifts.find((shift) => shift.status === "open");
    const previousShift = [...shifts]
        .reverse()
        .find((shift) => shift.status === "closed");
    const enrichedShifts = await attachCashShiftStaffProfiles(await Promise.all(shifts.map(enrichCashShift)));
    const enrichedActiveShift = activeShift
        ? enrichedShifts.find((shift) => String(shift._id) === String(activeShift._id))
        : null;
    const enrichedPreviousShift = previousShift
        ? enrichedShifts.find((shift) => String(shift._id) === String(previousShift._id))
        : null;
    const unassignedStart = activeShift
        ? activeShift.startedAt
        : previousShift?.endedAt || bounds.start;
    const unassignedMovements = (0, financeHelpers_1.summarizeCashStashes)(await getUnassignedCashTransactionsBetween(unassignedStart, bounds.end));
    const currentOperatingCash = enrichedActiveShift
        ? enrichedActiveShift.operatingExpectedCash
        : (enrichedPreviousShift?.operatingActualCash || 0) +
            unassignedMovements.operatingCashIn -
            unassignedMovements.operatingCashOut;
    return {
        businessDate: bounds.businessDate,
        threshold: financeHelpers_1.CASH_VARIANCE_THRESHOLD,
        activeShift: enrichedActiveShift
            ? operatingCashShiftView(enrichedActiveShift)
            : null,
        previousShift: enrichedPreviousShift
            ? operatingCashShiftView(enrichedPreviousShift)
            : null,
        current: {
            operatingCash: currentOperatingCash,
        },
        unassignedCash: {
            operatingCashIn: unassignedMovements.operatingCashIn,
            operatingCashOut: unassignedMovements.operatingCashOut,
        },
        handoff: {
            operatingCash: activeShift
                ? enrichedPreviousShift?.operatingActualCash || 0
                : currentOperatingCash,
            fromShiftId: enrichedPreviousShift
                ? String(enrichedPreviousShift._id)
                : undefined,
            fromShiftNumber: enrichedPreviousShift?.shiftNumber,
        },
        shifts: enrichedShifts.map(operatingCashShiftView),
    };
};
const hasCashMovement = (movements) => Math.abs(movements.operatingCashIn) > 0 ||
    Math.abs(movements.operatingCashOut) > 0;
const cashMovementTotal = (movements) => movements.operatingCashIn -
    movements.operatingCashOut;
const formatCashAuditAmount = (amount) => new Intl.NumberFormat("th-TH", { maximumFractionDigits: 2 }).format(amount);
const getCashShiftAuditForDate = async (businessDate) => {
    const bounds = getBusinessDayBoundsFromKey(businessDate);
    if (!bounds)
        return null;
    const shifts = await cashShift_1.default.find({ businessDate: bounds.businessDate }).sort({
        shiftNumber: 1,
    });
    const enrichedShifts = await attachCashShiftStaffProfiles(await Promise.all(shifts.map(enrichCashShift)));
    const gaps = [];
    const coverage = [];
    if (shifts.length) {
        coverage.push({ start: bounds.start, end: shifts[0].startedAt });
        shifts.forEach((shift, index) => {
            const nextShift = shifts[index + 1];
            if (shift.endedAt && nextShift) {
                coverage.push({ start: shift.endedAt, end: nextShift.startedAt });
            }
            else if (shift.endedAt && !nextShift) {
                coverage.push({ start: shift.endedAt, end: bounds.end });
            }
        });
    }
    else {
        coverage.push({ start: bounds.start, end: bounds.end });
    }
    for (const gap of coverage) {
        if (gap.end <= gap.start)
            continue;
        const movements = (0, financeHelpers_1.summarizeCashStashes)(await getUnassignedCashTransactionsBetween(gap.start, gap.end));
        if (!hasCashMovement(movements))
            continue;
        gaps.push({
            from: gap.start,
            to: gap.end,
            movements: {
                operatingCashIn: movements.operatingCashIn,
                operatingCashOut: movements.operatingCashOut,
            },
            warning: {
                code: "unassigned_cash_activity",
                severity: "critical",
                message: `พบเงินสด ${formatCashAuditAmount(cashMovementTotal(movements))} บาทนอกกะเงินสด`,
            },
        });
    }
    const auditShifts = await Promise.all(enrichedShifts.map(async (shift, index) => {
        const shiftTransactions = await getShiftTransactions(shift);
        const flaggedTransactions = shiftTransactions.filter((transaction) => transaction.reviewStatus === "needs_review" ||
            Boolean(transaction.reviewFlags?.length));
        const warnings = [];
        const operatingVariance = Number(shift.operatingVariance || 0);
        if (shift.status === "closed" &&
            Math.abs(operatingVariance) > financeHelpers_1.CASH_VARIANCE_THRESHOLD) {
            warnings.push({
                code: "operating_variance",
                severity: "critical",
                message: `เงินดำเนินงานต่าง ${formatCashAuditAmount(operatingVariance)} บาท`,
            });
        }
        if (shift.status === "open") {
            warnings.push({
                code: "open_shift",
                severity: "warning",
                message: "กะนี้ยังไม่ปิดยอด",
            });
        }
        if (flaggedTransactions.length) {
            warnings.push({
                code: "flagged_transactions",
                severity: "warning",
                message: `มี ${flaggedTransactions.length} รายการที่ต้องตรวจ`,
            });
        }
        const previousShift = enrichedShifts[index - 1];
        let handoff;
        if (previousShift?.endedAt) {
            const handoffMovements = (0, financeHelpers_1.summarizeCashStashes)(await getUnassignedCashTransactionsBetween(new Date(previousShift.endedAt), new Date(shift.startedAt)));
            const expectedOperatingOpening = (0, financeHelpers_1.cashBalanceAfterMovements)(Number(previousShift.operatingActualCash || 0), handoffMovements.operatingCashIn, handoffMovements.operatingCashOut);
            const operatingDifference = Number(shift.operatingOpeningCash) - expectedOperatingOpening;
            const mismatch = shift.openingMode === "counted" &&
                Math.abs(operatingDifference) > financeHelpers_1.CASH_VARIANCE_THRESHOLD;
            if (mismatch) {
                warnings.push({
                    code: "handoff_mismatch",
                    severity: "critical",
                    message: "ยอดรับส่งเงินไม่ตรงกับกะก่อนหน้า",
                });
            }
            handoff = {
                fromShiftId: String(previousShift._id),
                fromShiftNumber: previousShift.shiftNumber,
                mode: shift.openingMode,
                elapsedMinutes: Math.max(0, Math.round((new Date(shift.startedAt).getTime() -
                    new Date(previousShift.endedAt).getTime()) /
                    60000)),
                expectedOperatingOpening,
                operatingDifference,
                movements: {
                    operatingCashIn: handoffMovements.operatingCashIn,
                    operatingCashOut: handoffMovements.operatingCashOut,
                },
                mismatch,
            };
        }
        return {
            ...cashShiftAuditView(shift),
            warnings,
            auditResolution: shift.auditResolution,
            flaggedTransactions,
            handoff,
        };
    }));
    return {
        businessDate: bounds.businessDate,
        threshold: financeHelpers_1.CASH_VARIANCE_THRESHOLD,
        shifts: auditShifts,
        gaps,
    };
};
const addBreakdownTransaction = (categories, transaction, booking, amount, direction) => {
    const meta = expectedStayRevenueTransactionMeta[transaction.type] || {
        label: transaction.type,
        color: "#94a3b8",
        icon: "bx-receipt",
    };
    const existingCategory = categories.get(transaction.type) ||
        {
            type: transaction.type,
            label: meta.label,
            color: meta.color,
            icon: meta.icon,
            total: 0,
            percentage: 0,
            transactionCount: 0,
            transactions: [],
        };
    existingCategory.total += amount;
    existingCategory.transactionCount += 1;
    existingCategory.transactions.push({
        transactionId: transaction._id ? String(transaction._id) : undefined,
        bookingId: booking.bookingId,
        guestName: booking.name,
        platformId: (0, commercialSegmentHelpers_1.transactionPlatformId)(booking, transaction),
        type: transaction.type,
        label: meta.label,
        color: meta.color,
        icon: meta.icon,
        amount,
        paymentMethod: transaction.paymentMethod,
        direction,
        createdAt: transaction.createdAt,
        createdBy: transaction.createdBy,
        note: transaction.note,
        reference: transaction.reference,
    });
    categories.set(transaction.type, existingCategory);
};
const addPaymentMethodBreakdownTransaction = (paymentMethods, transaction, booking, amount, direction) => {
    const methodMeta = paymentMethodMeta[transaction.paymentMethod];
    const transactionMeta = expectedStayRevenueTransactionMeta[transaction.type] || {
        label: transaction.type,
        color: "#94a3b8",
        icon: "bx-receipt",
    };
    const existingPaymentMethod = paymentMethods.get(transaction.paymentMethod) ||
        {
            paymentMethod: transaction.paymentMethod,
            label: methodMeta.label,
            icon: methodMeta.icon,
            total: 0,
            percentage: 0,
            transactionCount: 0,
            transactions: [],
        };
    existingPaymentMethod.total += amount;
    existingPaymentMethod.transactionCount += 1;
    existingPaymentMethod.transactions.push({
        transactionId: transaction._id ? String(transaction._id) : undefined,
        bookingId: booking.bookingId,
        guestName: booking.name,
        platformId: (0, commercialSegmentHelpers_1.transactionPlatformId)(booking, transaction),
        type: transaction.type,
        label: transactionMeta.label,
        color: transactionMeta.color,
        icon: transactionMeta.icon,
        amount,
        paymentMethod: transaction.paymentMethod,
        direction,
        createdAt: transaction.createdAt,
        createdBy: transaction.createdBy,
        note: transaction.note,
        reference: transaction.reference,
    });
    paymentMethods.set(transaction.paymentMethod, existingPaymentMethod);
};
const todayArrivalPaymentMethod = (booking, roomCharge) => {
    if (roomCharge.paymentMethod !== "Unpaid")
        return roomCharge.paymentMethod;
    const settlement = (booking.transactions || []).find((transaction) => transaction.type === "settlementCharge" &&
        transaction.paymentMethod !== "Unpaid" &&
        transaction.relatedTransactionType === "roomCharge" &&
        transaction.relatedTransactionId === String(roomCharge._id));
    return settlement?.paymentMethod || roomCharge.paymentMethod;
};
const finalizeBreakdownCategories = (categories, expectedStayRevenue) => Array.from(categories.values())
    .map((category) => ({
    ...category,
    total: Number(category.total.toFixed(2)),
    percentage: expectedStayRevenue === 0
        ? 0
        : Number(((category.total / expectedStayRevenue) * 100).toFixed(2)),
    transactions: category.transactions.sort((first, second) => {
        const firstTime = first.createdAt ? new Date(first.createdAt).getTime() : 0;
        const secondTime = second.createdAt
            ? new Date(second.createdAt).getTime()
            : 0;
        return secondTime - firstTime;
    }),
}))
    .sort((first, second) => second.total - first.total);
const finalizePaymentMethodBreakdowns = (paymentMethods, expectedStayRevenue) => Array.from(paymentMethods.values())
    .map((paymentMethod) => ({
    ...paymentMethod,
    total: Number(paymentMethod.total.toFixed(2)),
    percentage: expectedStayRevenue === 0
        ? 0
        : Number(((paymentMethod.total / expectedStayRevenue) * 100).toFixed(2)),
    transactions: paymentMethod.transactions.sort((first, second) => {
        const firstTime = first.createdAt ? new Date(first.createdAt).getTime() : 0;
        const secondTime = second.createdAt
            ? new Date(second.createdAt).getTime()
            : 0;
        return secondTime - firstTime;
    }),
}))
    .sort((first, second) => second.total - first.total);
const getExpectedStayRevenueBreakdown = async (req, res) => {
    try {
        if (!req.user?.admin) {
            return res.status(403).json({
                message: "เฉพาะผู้ดูแลระบบเท่านั้นที่สามารถดูสรุปรายได้นี้ได้",
            });
        }
        const bounds = getExpectedStayRevenueBounds(req.query.startDate, req.query.endDate);
        if (!bounds) {
            return res.status(400).json({
                message: "Invalid date range. Use startDate and endDate as YYYY-MM-DD.",
            });
        }
        const bookings = await booking_1.default.find({
            "transactions.createdAt": { $gte: bounds.start, $lt: bounds.end },
        }).lean();
        const categories = new Map();
        const reductions = new Map();
        const paymentMethods = new Map();
        bookings.forEach((booking) => {
            (booking.transactions || []).forEach((transaction) => {
                if (!transaction.createdAt)
                    return;
                const createdAt = new Date(transaction.createdAt);
                if (createdAt < bounds.start || createdAt >= bounds.end)
                    return;
                const direction = (0, financeHelpers_1.transactionDirection)(transaction);
                const amount = Math.abs(transaction.amount || 0);
                if (amount === 0)
                    return;
                if (expectedStayRevenueTypes.has(transaction.type) ||
                    (transaction.type === "adjustment" && direction === "in")) {
                    addBreakdownTransaction(categories, transaction, booking, amount, direction);
                    addPaymentMethodBreakdownTransaction(paymentMethods, transaction, booking, amount, direction);
                    return;
                }
                if (expectedStayRevenueReductionTypes.has(transaction.type) ||
                    (transaction.type === "adjustment" && direction === "out")) {
                    addBreakdownTransaction(reductions, transaction, booking, amount, direction);
                }
            });
        });
        const grossStayCharges = Array.from(categories.values()).reduce((sum, category) => sum + category.total, 0);
        const reductionTotal = Array.from(reductions.values()).reduce((sum, category) => sum + category.total, 0);
        const expectedStayRevenue = grossStayCharges - reductionTotal;
        const finalizedCategories = finalizeBreakdownCategories(categories, grossStayCharges);
        const finalizedReductions = finalizeBreakdownCategories(reductions, grossStayCharges);
        const finalizedPaymentMethods = finalizePaymentMethodBreakdowns(paymentMethods, grossStayCharges);
        res.status(200).json({
            period: {
                startDate: formatBusinessDateKey(bounds.start),
                endDate: formatBusinessDateKey(bounds.end),
                basis: "transactionCreatedAt",
            },
            totals: {
                grossStayCharges: Number(grossStayCharges.toFixed(2)),
                expectedStayRevenue: Number(expectedStayRevenue.toFixed(2)),
                reductions: Number(reductionTotal.toFixed(2)),
                netAfterReductions: Number(expectedStayRevenue.toFixed(2)),
                transactionCount: finalizedCategories.reduce((sum, category) => sum + category.transactionCount, 0) +
                    finalizedReductions.reduce((sum, category) => sum + category.transactionCount, 0),
            },
            categories: finalizedCategories,
            reductions: finalizedReductions,
            paymentMethods: finalizedPaymentMethods,
        });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
};
exports.getExpectedStayRevenueBreakdown = getExpectedStayRevenueBreakdown;
const getTodayRevenueBreakdown = async (req, res) => {
    try {
        if (!req.user) {
            return res.status(403).json({
                message: "กรุณาเข้าสู่ระบบเพื่อดูสรุปรายได้นี้",
            });
        }
        const bounds = getBusinessDayBoundsFromKey(req.query.businessDate);
        if (!bounds) {
            return res.status(400).json({
                message: "Invalid business date. Use YYYY-MM-DD.",
            });
        }
        const bookings = await booking_1.default.find({
            $or: [
                { checkIn: { $gte: bounds.start, $lt: bounds.end } },
                { "transactions.createdAt": { $gte: bounds.start, $lt: bounds.end } },
            ],
        }).lean();
        const todaySummary = (0, financeHelpers_1.calculateTodayRevenueSummary)(bookings, bounds.start, bounds.end);
        const categories = new Map();
        const reductions = new Map();
        const paymentMethods = new Map();
        bookings.forEach((booking) => {
            const isTodayArrival = new Date(booking.checkIn) >= bounds.start &&
                new Date(booking.checkIn) < bounds.end;
            if (isTodayArrival) {
                const arrivalAmount = (0, financeHelpers_1.bookingTodayArrivalRevenueAmount)(booking);
                const roomCharge = (booking.transactions || []).find((transaction) => transaction.type === "roomCharge");
                if (arrivalAmount > 0 && roomCharge) {
                    const arrivalTransaction = {
                        ...roomCharge,
                        amount: arrivalAmount,
                        createdAt: booking.checkIn,
                        paymentMethod: todayArrivalPaymentMethod(booking, roomCharge),
                    };
                    const direction = (0, financeHelpers_1.transactionDirection)(arrivalTransaction);
                    addBreakdownTransaction(categories, arrivalTransaction, booking, arrivalAmount, direction);
                    addPaymentMethodBreakdownTransaction(paymentMethods, arrivalTransaction, booking, arrivalAmount, direction);
                }
            }
            (booking.transactions || []).forEach((transaction) => {
                if (!transaction.createdAt)
                    return;
                const createdAt = new Date(transaction.createdAt);
                if (createdAt < bounds.start || createdAt >= bounds.end)
                    return;
                const direction = (0, financeHelpers_1.transactionDirection)(transaction);
                const extrasAmount = (0, financeHelpers_1.transactionTodayExtrasRevenueAmount)(transaction);
                if (extrasAmount > 0) {
                    addBreakdownTransaction(categories, transaction, booking, extrasAmount, direction);
                    addPaymentMethodBreakdownTransaction(paymentMethods, transaction, booking, extrasAmount, direction);
                }
                const reductionAmount = (0, financeHelpers_1.transactionTodayReductionAmount)(transaction);
                const arrivalReductionAlreadyNetted = isTodayArrival &&
                    ["cancelled", "noShow"].includes(booking.status) &&
                    ["roomRefund", "cancellationRefund"].includes(transaction.type);
                if (reductionAmount > 0 && !arrivalReductionAlreadyNetted) {
                    addBreakdownTransaction(reductions, transaction, booking, reductionAmount, direction);
                }
            });
        });
        const grossStayCharges = Array.from(categories.values()).reduce((sum, category) => sum + category.total, 0);
        const reductionTotal = Array.from(reductions.values()).reduce((sum, category) => sum + category.total, 0);
        const todayRevenue = todaySummary.todayRevenue;
        const finalizedCategories = finalizeBreakdownCategories(categories, grossStayCharges);
        const finalizedReductions = finalizeBreakdownCategories(reductions, grossStayCharges);
        const finalizedPaymentMethods = finalizePaymentMethodBreakdowns(paymentMethods, grossStayCharges);
        res.status(200).json({
            period: {
                startDate: formatBusinessDateKey(bounds.start),
                endDate: formatBusinessDateKey(bounds.end),
                basis: "checkInAndTransactionCreatedAt",
            },
            totals: {
                grossStayCharges: Number(grossStayCharges.toFixed(2)),
                expectedStayRevenue: Number(todayRevenue.toFixed(2)),
                reductions: Number(reductionTotal.toFixed(2)),
                netAfterReductions: Number(todayRevenue.toFixed(2)),
                transactionCount: finalizedCategories.reduce((sum, category) => sum + category.transactionCount, 0) +
                    finalizedReductions.reduce((sum, category) => sum + category.transactionCount, 0),
            },
            categories: finalizedCategories,
            reductions: finalizedReductions,
            paymentMethods: finalizedPaymentMethods,
        });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
};
exports.getTodayRevenueBreakdown = getTodayRevenueBreakdown;
const getTodayRevenueSummary = async (req, res) => {
    try {
        if (!req.user) {
            return res.status(403).json({ message: "กรุณาเข้าสู่ระบบ" });
        }
        const bounds = getBusinessDayBoundsFromKey(req.query.businessDate);
        if (!bounds) {
            return res.status(400).json({
                message: "Invalid business date. Use YYYY-MM-DD.",
            });
        }
        const bookings = await booking_1.default.find({
            $or: [
                { checkIn: { $gte: bounds.start, $lt: bounds.end } },
                { "transactions.createdAt": { $gte: bounds.start, $lt: bounds.end } },
            ],
        }).lean();
        res.status(200).json((0, financeHelpers_1.calculateTodayRevenueSummary)(bookings, bounds.start, bounds.end));
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
};
exports.getTodayRevenueSummary = getTodayRevenueSummary;
const getReconciliation = async (req, res) => {
    try {
        const staffUsername = req.user?.admin
            ? typeof req.query.staffUsername === "string"
                ? req.query.staffUsername
                : undefined
            : req.user?.username;
        const reconciliation = await getTransactionsForBusinessDate(req.query.date, staffUsername);
        if (!reconciliation) {
            return res.status(400).json({ message: "Invalid date format" });
        }
        const dailyCloses = await dailyClose_1.default.find({
            businessDate: reconciliation.businessDate,
            ...(staffUsername ? { staffUsername } : {}),
        }).sort({ createdAt: -1, staffUsername: 1 });
        const dailyClosesWithStaff = await attachDailyCloseStaffProfiles(dailyCloses);
        const cashPosition = await getCashPositionForDate(reconciliation.businessDate);
        res.status(200).json({
            businessDate: reconciliation.businessDate,
            threshold: financeHelpers_1.CASH_VARIANCE_THRESHOLD,
            summary: reconciliation.summary,
            cashStashes: (0, financeHelpers_1.summarizeCashStashes)(reconciliation.transactions),
            cashShifts: cashPosition?.shifts || [],
            transactions: reconciliation.transactions,
            dailyCloses: dailyClosesWithStaff,
        });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
};
exports.getReconciliation = getReconciliation;
const getCashPosition = async (req, res) => {
    try {
        const cashPosition = await getCashPositionForDate(req.query.date);
        if (!cashPosition) {
            return res.status(400).json({ message: "Invalid date format" });
        }
        res.status(200).json(cashPosition);
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
};
exports.getCashPosition = getCashPosition;
const getCashShiftAudit = async (req, res) => {
    try {
        if (!req.user?.admin) {
            return res.status(403).json({
                message: "เฉพาะผู้ดูแลระบบเท่านั้นที่สามารถดูการตรวจสอบเงินสดได้",
            });
        }
        const audit = await getCashShiftAuditForDate(req.query.date);
        if (!audit) {
            return res.status(400).json({ message: "Invalid date format" });
        }
        res.status(200).json(audit);
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
};
exports.getCashShiftAudit = getCashShiftAudit;
const resolveCashShiftAudit = async (req, res) => {
    try {
        if (!req.user?.admin || !req.user.username) {
            return res.status(403).json({
                message: "เฉพาะผู้ดูแลระบบเท่านั้นที่สามารถรับทราบข้อยกเว้นได้",
            });
        }
        const note = String(req.body.note || "").trim();
        if (!note) {
            return res.status(400).json({
                message: "กรุณาระบุสรุปการตรวจสอบ",
            });
        }
        const cashShift = await cashShift_1.default.findById(req.params.shiftId);
        if (!cashShift) {
            return res.status(404).json({ message: "ไม่พบกะเงินสดนี้" });
        }
        const audit = await getCashShiftAuditForDate(cashShift.businessDate);
        const auditedShift = audit?.shifts.find((shift) => String(shift._id) === String(cashShift._id));
        if (!auditedShift?.warnings.length) {
            return res.status(400).json({
                message: "กะนี้ไม่มีข้อยกเว้นที่ต้องรับทราบ",
            });
        }
        cashShift.auditResolution = {
            note,
            reviewedBy: req.user.username,
            reviewedAt: new Date(),
        };
        await cashShift.save();
        await (0, activityServices_1.logActivity)(req.user.username, "DAILY_CLOSE", {
            summary: {
                action: "REVIEW_CASH_SHIFT_AUDIT",
                businessDate: cashShift.businessDate,
                shiftNumber: cashShift.shiftNumber,
                note,
                warningCodes: auditedShift.warnings.map((warning) => warning.code),
            },
        });
        res.status(200).json({ cashShift: cashShiftAuditView(cashShift.toObject()) });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
};
exports.resolveCashShiftAudit = resolveCashShiftAudit;
const startCashShift = async (req, res) => {
    try {
        if (!req.user?.username) {
            return res.status(401).json({ message: "กรุณาเข้าสู่ระบบใหม่" });
        }
        const bounds = getBusinessDayBoundsFromKey(req.body.businessDate);
        if (!bounds) {
            return res.status(400).json({ message: "Invalid date format" });
        }
        return await (0, cashShiftMutationLock_1.withCashShiftMutationLock)(bounds.businessDate, async () => {
            const finalizedDay = await cashShift_1.default.findOne({
                businessDate: bounds.businessDate,
                isFinalDayClose: true,
            }).select("_id");
            if (finalizedDay) {
                return res.status(409).json({
                    message: "วันนี้ปิดยอดสุดท้ายแล้ว ไม่สามารถเปิดกะเพิ่มได้",
                });
            }
            const existingOpenShift = await cashShift_1.default.findOne({
                businessDate: bounds.businessDate,
                status: "open",
            });
            if (existingOpenShift) {
                return res.status(409).json({
                    message: "มีกะเงินสดที่เปิดอยู่แล้ว กรุณาปิดกะเดิมก่อน",
                });
            }
            const previousShift = await cashShift_1.default.findOne({
                businessDate: bounds.businessDate,
                status: "closed",
            }).sort({ shiftNumber: -1 });
            const handoffMovements = (0, financeHelpers_1.summarizeCashStashes)(await getUnassignedCashTransactionsBetween(previousShift?.endedAt || bounds.start, new Date()));
            const openingMode = req.body.openingMode === "accepted_handoff"
                ? "accepted_handoff"
                : "counted";
            if (openingMode === "accepted_handoff" && !previousShift) {
                return res.status(400).json({
                    message: "ยังไม่มีกะก่อนหน้าให้รับส่งเงิน",
                });
            }
            const expectedOperatingOpening = (0, financeHelpers_1.cashBalanceAfterMovements)(previousShift?.operatingActualCash || 0, handoffMovements.operatingCashIn, handoffMovements.operatingCashOut);
            const operatingOpeningCash = openingMode === "accepted_handoff"
                ? expectedOperatingOpening
                : Number(req.body.operatingOpeningCash || 0);
            if (!(0, financeHelpers_1.isValidCashCount)(operatingOpeningCash)) {
                return res.status(400).json({ message: "ยอดเงินสดไม่ถูกต้อง" });
            }
            const openingNoteRequired = Math.abs(operatingOpeningCash - expectedOperatingOpening) >
                financeHelpers_1.CASH_VARIANCE_THRESHOLD;
            if (openingNoteRequired && !String(req.body.note || "").trim()) {
                return res.status(400).json({
                    message: "กรุณาระบุหมายเหตุเมื่อยอดรับส่งเงินไม่ตรงกัน",
                });
            }
            const shiftNumber = (previousShift?.shiftNumber || 0) + 1;
            const cashShift = await (0, mutationIdempotency_1.withMutationIdempotency)(req, () => cashShift_1.default.create({
                businessDate: bounds.businessDate,
                shiftNumber,
                staffUsername: req.user?.username,
                status: "open",
                openingMode,
                handoffFromShiftId: previousShift ? String(previousShift._id) : undefined,
                operatingOpeningCash,
                operatingExpectedCash: operatingOpeningCash,
                note: String(req.body.note || "").trim(),
                startedAt: new Date(),
                createdBy: req.user?.username,
            }));
            await (0, activityServices_1.logActivity)(req.user.username, "DAILY_CLOSE", {
                summary: {
                    action: "START_CASH_SHIFT",
                    businessDate: bounds.businessDate,
                    shiftNumber,
                    openingMode,
                    operatingOpeningCash,
                    expectedOperatingOpening,
                    note: String(req.body.note || "").trim(),
                },
            }).catch((err) => {
                console.error("Failed to log cash shift start", err);
            });
            return res.status(201).json({ cashShift });
        });
    }
    catch (err) {
        if (err instanceof cashShiftMutationLock_1.CashShiftMutationConflictError) {
            return res.status(409).json({
                message: "กำลังมีการเริ่มหรือปิดกะเงินสด กรุณาลองอีกครั้ง",
            });
        }
        if (err instanceof mutationIdempotency_1.IdempotencyConflictError) {
            return sendDuplicateMutationResponse(res);
        }
        res.status(500).json({ error: err.message });
    }
};
exports.startCashShift = startCashShift;
class CashShiftCloseValidationError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
        this.name = "CashShiftCloseValidationError";
    }
}
const closeCashShift = async (req, res) => {
    try {
        if (!req.user?.username) {
            return res.status(401).json({ message: "กรุณาเข้าสู่ระบบใหม่" });
        }
        const requestedShift = await cashShift_1.default.findById(req.params.shiftId);
        if (!requestedShift) {
            return res.status(404).json({ message: "ไม่พบกะเงินสดนี้" });
        }
        if (requestedShift.status !== "open") {
            return res.status(409).json({ message: "กะเงินสดนี้ปิดไปแล้ว" });
        }
        if (!req.user.admin &&
            requestedShift.staffUsername !== req.user.username) {
            return res.status(403).json({
                message: "เฉพาะผู้รับผิดชอบกะหรือผู้ดูแลระบบเท่านั้นที่ปิดกะได้",
            });
        }
        const operatingActualCash = Number(req.body.operatingActualCash);
        if (!(0, financeHelpers_1.isValidCashCount)(operatingActualCash)) {
            return res.status(400).json({ message: "ยอดเงินสดไม่ถูกต้อง" });
        }
        const closeDay = req.body.closeDay === true;
        const closingUsername = req.user.username;
        const result = await (0, cashShiftMutationLock_1.withCashShiftMutationLock)(requestedShift.businessDate, () => (0, mutationIdempotency_1.withMutationIdempotency)(req, async () => {
            const session = await mongoose_1.default.startSession();
            try {
                const transactionResult = await session.withTransaction(async () => {
                    const cashShift = await cashShift_1.default.findOne({
                        _id: requestedShift._id,
                        status: "open",
                    }).session(session);
                    if (!cashShift)
                        throw new cashLedgerTransaction_1.CashShiftLedgerConflictError();
                    const currentLedgerRevision = cashShift.ledgerRevision || 0;
                    const guardUpdate = await cashShift_1.default.updateOne({
                        _id: cashShift._id,
                        status: "open",
                        $or: [
                            { ledgerRevision: currentLedgerRevision },
                            { ledgerRevision: { $exists: false } },
                        ],
                    }, { $inc: { ledgerRevision: 1 } }, { session });
                    if (guardUpdate.modifiedCount !== 1) {
                        throw new cashLedgerTransaction_1.CashShiftLedgerConflictError();
                    }
                    const guardedLedgerRevision = currentLedgerRevision + 1;
                    if (closeDay) {
                        const existingFinalClose = await cashShift_1.default.findOne({
                            businessDate: cashShift.businessDate,
                            isFinalDayClose: true,
                            _id: { $ne: cashShift._id },
                        })
                            .select("_id")
                            .session(session);
                        if (existingFinalClose) {
                            throw new CashShiftCloseValidationError(409, "วันนี้ปิดยอดสุดท้ายแล้ว");
                        }
                    }
                    const movements = (0, financeHelpers_1.summarizeCashStashes)(await getShiftTransactions(cashShift, session));
                    const operatingExpectedCash = cashShift.operatingOpeningCash +
                        movements.operatingCashIn -
                        movements.operatingCashOut;
                    const operatingVariance = operatingActualCash - operatingExpectedCash;
                    if (Math.abs(operatingVariance) > financeHelpers_1.CASH_VARIANCE_THRESHOLD &&
                        !String(req.body.note || "").trim()) {
                        throw new CashShiftCloseValidationError(400, "กรุณาระบุหมายเหตุเมื่อยอดเงินสดไม่ตรงกัน");
                    }
                    const closedAt = new Date();
                    const closedShift = await cashShift_1.default.findOneAndUpdate({
                        _id: cashShift._id,
                        status: "open",
                        ledgerRevision: guardedLedgerRevision,
                    }, {
                        $set: {
                            status: "closed",
                            operatingCashIn: movements.operatingCashIn,
                            operatingCashOut: movements.operatingCashOut,
                            operatingExpectedCash,
                            operatingActualCash,
                            operatingVariance,
                            isFinalDayClose: closeDay,
                            note: String(req.body.note || cashShift.note || "").trim(),
                            endedAt: closedAt,
                            closedBy: closingUsername,
                        },
                    }, { returnDocument: "after", session, runValidators: true });
                    if (!closedShift)
                        throw new cashLedgerTransaction_1.CashShiftLedgerConflictError();
                    return {
                        closedShift,
                        auditSummary: {
                            action: "CLOSE_CASH_SHIFT",
                            businessDate: cashShift.businessDate,
                            shiftNumber: cashShift.shiftNumber,
                            closeDay,
                            operatingExpectedCash,
                            operatingActualCash,
                            operatingVariance,
                            operatingCashIn: movements.operatingCashIn,
                            operatingCashOut: movements.operatingCashOut,
                            note: String(req.body.note || cashShift.note || "").trim(),
                        },
                    };
                });
                if (!transactionResult)
                    throw new cashLedgerTransaction_1.CashShiftLedgerConflictError();
                return transactionResult;
            }
            finally {
                await session.endSession();
            }
        }));
        await (0, activityServices_1.logActivity)(closingUsername, "DAILY_CLOSE", {
            summary: result.auditSummary,
        }).catch((err) => {
            console.error("Failed to log cash shift close", err);
        });
        return res.status(200).json({ cashShift: result.closedShift });
    }
    catch (err) {
        if (err instanceof CashShiftCloseValidationError) {
            return res.status(err.status).json({ message: err.message });
        }
        if (err instanceof cashShiftMutationLock_1.CashShiftMutationConflictError ||
            err instanceof cashLedgerTransaction_1.CashShiftLedgerConflictError) {
            return res.status(409).json({
                error: "CASH_SHIFT_LEDGER_CONFLICT",
                message: "กะเงินสดกำลังเปลี่ยนแปลง กรุณารีเฟรชแล้วลองอีกครั้ง",
            });
        }
        if (err instanceof mutationIdempotency_1.IdempotencyConflictError) {
            return sendDuplicateMutationResponse(res);
        }
        res.status(500).json({ error: err.message });
    }
};
exports.closeCashShift = closeCashShift;
class DailyCloseRevisionConflictError extends Error {
    constructor() {
        super("DAILY_CLOSE_REVISION_CONFLICT");
        this.name = "DailyCloseRevisionConflictError";
    }
}
const upsertDailyClose = async (req, res) => {
    try {
        const staffUsername = req.user?.admin && typeof req.body.staffUsername === "string"
            ? req.body.staffUsername
            : req.user?.username;
        if (!staffUsername || !req.user?.username) {
            return res.status(401).json({ message: "กรุณาเข้าสู่ระบบใหม่" });
        }
        const requestUsername = req.user.username;
        const actualCash = Number(req.body.actualCash);
        const openingCash = Number(req.body.openingCash || 0);
        const expectedRevision = Number(req.body.expectedRevision);
        if (!(0, financeHelpers_1.isValidCashCount)(actualCash) ||
            !(0, financeHelpers_1.isValidCashCount)(openingCash) ||
            !Number.isInteger(expectedRevision) ||
            expectedRevision < 0) {
            return res.status(400).json({ message: "ยอดเงินสดไม่ถูกต้อง" });
        }
        const reconciliation = await getTransactionsForBusinessDate(req.body.businessDate, staffUsername);
        if (!reconciliation) {
            return res.status(400).json({ message: "Invalid date format" });
        }
        const expectedCash = openingCash + reconciliation.summary.cashIn - reconciliation.summary.cashOut;
        const variance = actualCash - expectedCash;
        if (Math.abs(variance) > financeHelpers_1.CASH_VARIANCE_THRESHOLD &&
            !String(req.body.note || "").trim()) {
            return res.status(400).json({
                message: "กรุณาระบุหมายเหตุเมื่อยอดเงินสดไม่ตรงกัน",
            });
        }
        const existingDailyClose = await dailyClose_1.default.findOne({
            businessDate: reconciliation.businessDate,
            staffUsername,
        }).lean();
        if ((existingDailyClose?.revision || 0) !== expectedRevision) {
            return res.status(409).json({
                error: "DAILY_CLOSE_REVISION_CONFLICT",
                message: "ยอดปิดวันถูกแก้ไขโดยผู้ใช้อื่น กรุณารีเฟรชแล้วลองใหม่",
                dailyClose: existingDailyClose,
            });
        }
        const now = new Date();
        const previousRevision = existingDailyClose
            ? {
                revision: existingDailyClose.revision || 1,
                openingCash: existingDailyClose.openingCash,
                expectedCash: existingDailyClose.expectedCash,
                actualCash: existingDailyClose.actualCash,
                variance: existingDailyClose.variance,
                cashIn: existingDailyClose.cashIn,
                cashOut: existingDailyClose.cashOut,
                note: existingDailyClose.note || "",
                createdBy: existingDailyClose.createdBy,
                createdAt: existingDailyClose.createdAt,
                supersededAt: now,
                supersededBy: requestUsername,
            }
            : null;
        const dailyClose = await (0, mutationIdempotency_1.withMutationIdempotency)(req, async () => {
            if (!existingDailyClose) {
                const created = await dailyClose_1.default.create({
                    businessDate: reconciliation.businessDate,
                    staffUsername,
                    revision: 1,
                    openingCash,
                    expectedCash,
                    actualCash,
                    variance,
                    cashIn: reconciliation.summary.cashIn,
                    cashOut: reconciliation.summary.cashOut,
                    note: req.body.note || "",
                    createdBy: requestUsername,
                    createdAt: now,
                    revisions: [],
                });
                return created;
            }
            const updated = await dailyClose_1.default.findOneAndUpdate({
                businessDate: reconciliation.businessDate,
                staffUsername,
                revision: expectedRevision,
            }, {
                $set: {
                    openingCash,
                    expectedCash,
                    actualCash,
                    variance,
                    cashIn: reconciliation.summary.cashIn,
                    cashOut: reconciliation.summary.cashOut,
                    note: req.body.note || "",
                    createdBy: requestUsername,
                    createdAt: now,
                },
                $inc: { revision: 1 },
                $push: { revisions: previousRevision },
            }, { returnDocument: "after", runValidators: true });
            if (!updated)
                throw new DailyCloseRevisionConflictError();
            return updated;
        });
        await (0, activityServices_1.logActivity)(requestUsername, "DAILY_CLOSE", {
            summary: {
                action: "SAVE_DAILY_RECONCILIATION",
                businessDate: reconciliation.businessDate,
                staffUsername,
                revision: dailyClose.revision,
                openingCash,
                expectedCash,
                actualCash,
                variance,
                cashIn: reconciliation.summary.cashIn,
                cashOut: reconciliation.summary.cashOut,
                note: req.body.note || "",
            },
        });
        res.status(200).json({ dailyClose });
    }
    catch (err) {
        if (err instanceof DailyCloseRevisionConflictError || err?.code === 11000) {
            const staffUsername = req.user?.admin && typeof req.body.staffUsername === "string"
                ? req.body.staffUsername
                : req.user?.username;
            const latest = staffUsername
                ? await dailyClose_1.default.findOne({
                    businessDate: req.body.businessDate,
                    staffUsername,
                })
                : null;
            return res.status(409).json({
                error: "DAILY_CLOSE_REVISION_CONFLICT",
                message: "ยอดปิดวันถูกแก้ไขโดยผู้ใช้อื่น กรุณารีเฟรชแล้วลองใหม่",
                dailyClose: latest,
            });
        }
        if (err instanceof mutationIdempotency_1.IdempotencyConflictError) {
            return sendDuplicateMutationResponse(res);
        }
        res.status(500).json({ error: err.message });
    }
};
exports.upsertDailyClose = upsertDailyClose;
const getReviewEvents = async (req, res) => {
    try {
        if (!req.user?.admin) {
            return res.status(403).json({
                message: "เฉพาะผู้ดูแลระบบเท่านั้นที่สามารถดูรายการตรวจสอบได้",
            });
        }
        const reconciliation = await getTransactionsForBusinessDate(req.query.date);
        if (!reconciliation) {
            return res.status(400).json({ message: "Invalid date format" });
        }
        const transactions = reconciliation.transactions.filter((transaction) => transaction.reviewStatus !== "reviewed" &&
            (transaction.reviewStatus === "needs_review" ||
                (transaction.reviewFlags || []).length > 0));
        res.status(200).json({
            businessDate: reconciliation.businessDate,
            transactions,
        });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
};
exports.getReviewEvents = getReviewEvents;
const approveReviewEvent = async (req, res) => {
    try {
        if (!req.user?.admin || !req.user.username) {
            return res.status(403).json({
                message: "เฉพาะผู้ดูแลระบบเท่านั้นที่สามารถอนุมัติรายการตรวจสอบได้",
            });
        }
        const bookingId = String(req.params.bookingId);
        const transactionId = String(req.params.transactionId);
        const booking = await booking_1.default.findOne({ bookingId });
        if (!booking) {
            return res.status(404).json({ message: "ไม่พบ Booking" });
        }
        const transaction = booking.transactions.find((existingTransaction) => String(existingTransaction._id) === transactionId);
        if (!transaction) {
            return res.status(404).json({ message: "ไม่พบรายการธุรกรรม" });
        }
        if (transaction.reviewStatus === "reviewed") {
            return res.status(200).json({
                message: "รายการนี้ได้รับการอนุมัติแล้ว",
                transaction,
            });
        }
        const requiresReview = transaction.reviewStatus === "needs_review" ||
            (transaction.reviewFlags || []).length > 0;
        if (!requiresReview) {
            return res.status(400).json({
                message: "รายการนี้ไม่จำเป็นต้องตรวจสอบ",
            });
        }
        const reviewedAt = transaction.reviewedAt || new Date();
        transaction.reviewStatus = "reviewed";
        transaction.reviewedBy = transaction.reviewedBy || req.user.username;
        transaction.reviewedAt = reviewedAt;
        booking.markModified("transactions");
        await booking.save();
        await (0, activityServices_1.logActivity)(req.user.username, "REVIEW_TRANSACTION", {
            summary: {
                bookingId,
                transactionId,
                guestName: booking.name,
                type: transaction.type,
                paymentMethod: transaction.paymentMethod,
                amount: transaction.amount,
                flags: transaction.reviewFlags || [],
                reviewedBy: transaction.reviewedBy,
                reviewedAt,
            },
        }, bookingId);
        res.status(200).json({
            transaction,
        });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
};
exports.approveReviewEvent = approveReviewEvent;
//# sourceMappingURL=finance.js.map