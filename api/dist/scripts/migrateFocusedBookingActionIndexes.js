"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = __importDefault(require("dotenv"));
const mongoose_1 = __importDefault(require("mongoose"));
const focusedBookingAction_1 = __importDefault(require("../models/focusedBookingAction"));
const deploymentIdentity_1 = require("../config/deploymentIdentity");
dotenv_1.default.config();
const run = async () => {
    if (!process.env.MONGO_URI)
        throw new Error("MONGO_URI is required");
    if (process.env.RUN_FOCUSED_ACTION_INDEX_MIGRATION !== "true") {
        throw new Error("Set RUN_FOCUSED_ACTION_INDEX_MIGRATION=true to run this migration");
    }
    await mongoose_1.default.connect(process.env.MONGO_URI, { autoIndex: false });
    const deployment = (0, deploymentIdentity_1.assertDeploymentIdentity)();
    await focusedBookingAction_1.default.createIndexes();
    const indexes = await focusedBookingAction_1.default.collection.indexes();
    console.log(JSON.stringify({
        deployment,
        collection: focusedBookingAction_1.default.collection.collectionName,
        indexes,
    }, null, 2));
    await mongoose_1.default.disconnect();
};
run().catch(async (error) => {
    console.error(error);
    await mongoose_1.default.disconnect().catch(() => undefined);
    process.exitCode = 1;
});
//# sourceMappingURL=migrateFocusedBookingActionIndexes.js.map