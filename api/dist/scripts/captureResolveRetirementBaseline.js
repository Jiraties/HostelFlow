"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = __importDefault(require("dotenv"));
const mongoose_1 = __importDefault(require("mongoose"));
const booking_1 = __importDefault(require("../models/booking"));
const activity_1 = __importDefault(require("../models/activity"));
const statusCorrection_1 = __importDefault(require("../models/statusCorrection"));
const focusedBookingAction_1 = __importDefault(require("../models/focusedBookingAction"));
const deploymentIdentity_1 = require("../config/deploymentIdentity");
dotenv_1.default.config();
const groupedCounts = (model, field) => model.aggregate([
    { $group: { _id: `$${field}`, count: { $sum: 1 } } },
    { $sort: { _id: 1 } },
]).exec();
const run = async () => {
    if (!process.env.MONGO_URI)
        throw new Error("MONGO_URI is required");
    await mongoose_1.default.connect(process.env.MONGO_URI, { autoIndex: false });
    const deployment = (0, deploymentIdentity_1.assertDeploymentIdentity)();
    const [bookingsByStatus, activitiesByAction, resolutions, resolveTransactions, statusCorrectionCount, focusedActionCount,] = await Promise.all([
        groupedCounts(booking_1.default, "status"),
        groupedCounts(activity_1.default, "action"),
        booking_1.default.aggregate([
            { $match: { resolution: { $exists: true } } },
            {
                $group: {
                    _id: {
                        outcome: "$resolution.outcome",
                        finalStatus: "$resolution.finalStatus",
                        roomReleaseStatus: "$resolution.roomReleaseStatus",
                    },
                    count: { $sum: 1 },
                },
            },
            { $sort: { "_id.outcome": 1, "_id.finalStatus": 1 } },
        ]),
        booking_1.default.aggregate([
            { $unwind: "$transactions" },
            { $match: { "transactions.sourceAction": "RESOLVE_STAY" } },
            {
                $group: {
                    _id: "$transactions.type",
                    count: { $sum: 1 },
                    amount: { $sum: "$transactions.amount" },
                },
            },
            { $sort: { _id: 1 } },
        ]),
        statusCorrection_1.default.countDocuments(),
        focusedBookingAction_1.default.countDocuments(),
    ]);
    console.log(JSON.stringify({
        capturedAt: new Date().toISOString(),
        deployment,
        frontendVersion: process.env.FRONTEND_VERSION || "unknown",
        apiCommit: process.env.API_COMMIT_SHA || "unknown",
        counts: {
            bookingsByStatus,
            activitiesByAction,
            resolutions,
            resolveTransactions,
            statusCorrections: statusCorrectionCount,
            focusedBookingActions: focusedActionCount,
        },
    }, null, 2));
    await mongoose_1.default.disconnect();
};
run().catch(async (error) => {
    console.error(error);
    await mongoose_1.default.disconnect().catch(() => undefined);
    process.exitCode = 1;
});
//# sourceMappingURL=captureResolveRetirementBaseline.js.map