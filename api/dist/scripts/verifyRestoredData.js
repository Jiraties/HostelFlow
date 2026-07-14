"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = __importDefault(require("dotenv"));
const mongoose_1 = __importDefault(require("mongoose"));
const restoreVerification_1 = require("../services/restoreVerification");
dotenv_1.default.config();
const main = async () => {
    const uri = process.env.RESTORE_VERIFY_MONGO_URI;
    if (!uri)
        throw new Error("RESTORE_VERIFY_MONGO_URI is required");
    if (uri === process.env.MONGO_URI) {
        throw new Error("Restore verification refuses the application's MONGO_URI");
    }
    if (process.env.RESTORE_VERIFY_ACKNOWLEDGE_ISOLATED !== "true") {
        throw new Error("Set RESTORE_VERIFY_ACKNOWLEDGE_ISOLATED=true after confirming this is an isolated restore");
    }
    await mongoose_1.default.connect(uri, { autoCreate: false, autoIndex: false });
    const result = await (0, restoreVerification_1.verifyRestoredData)();
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok)
        process.exitCode = 1;
};
main()
    .catch((error) => {
    console.error(error instanceof Error ? error.message : "Restore verification failed");
    process.exitCode = 1;
})
    .finally(async () => {
    await mongoose_1.default.disconnect();
});
//# sourceMappingURL=verifyRestoredData.js.map