"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createFirstAdmin = exports.bootstrapUri = void 0;
const bcrypt_1 = __importDefault(require("bcrypt"));
const dotenv_1 = __importDefault(require("dotenv"));
const mongoose_1 = __importDefault(require("mongoose"));
const promises_1 = require("node:readline/promises");
const node_stream_1 = require("node:stream");
const user_1 = __importDefault(require("../models/user"));
const passwordPolicy_1 = require("../services/passwordPolicy");
class FirstAdminSetupError extends Error {
}
// This bootstrap command is for the separate development database only.
const bootstrapUri = (environment) => {
    if (environment.NODE_ENV === "production") {
        throw new FirstAdminSetupError("First-admin setup is only available for development.");
    }
    if (environment.EXPECTED_DATABASE_NAME?.trim() !== "dev") {
        throw new FirstAdminSetupError("Set EXPECTED_DATABASE_NAME=dev before running first-admin setup.");
    }
    const uri = environment.MONGO_URI?.trim();
    if (!uri)
        throw new FirstAdminSetupError("MONGO_URI is required.");
    let database;
    try {
        database = decodeURIComponent(new URL(uri).pathname.slice(1));
    }
    catch {
        throw new FirstAdminSetupError("MONGO_URI is invalid; its value has been withheld.");
    }
    if (database !== "dev") {
        throw new FirstAdminSetupError("MONGO_URI must explicitly select /dev. Refusing another database.");
    }
    return uri;
};
exports.bootstrapUri = bootstrapUri;
const createFirstAdmin = async (credentials) => {
    if (mongoose_1.default.connection.db?.databaseName !== "dev") {
        throw new FirstAdminSetupError("Refusing to create an admin outside the dev database.");
    }
    const username = credentials.username.trim();
    const name = credentials.name.trim();
    if (!username || !name)
        throw new FirstAdminSetupError("Username and display name are required.");
    const passwordError = (0, passwordPolicy_1.passwordPolicyError)(credentials.password);
    if (passwordError)
        throw new FirstAdminSetupError(passwordError);
    if (await user_1.default.exists({ admin: true })) {
        throw new FirstAdminSetupError("An admin already exists. Use the app's user management instead.");
    }
    if (await user_1.default.exists({ username })) {
        throw new FirstAdminSetupError("That username already exists. Choose a different username.");
    }
    // Match the model's unique username constraint even in a brand-new database.
    await user_1.default.collection.createIndex({ username: 1 }, { unique: true });
    await user_1.default.create({
        username,
        name,
        password: await bcrypt_1.default.hash(credentials.password, 12),
        admin: true,
        active: true,
    });
};
exports.createFirstAdmin = createFirstAdmin;
const run = async () => {
    dotenv_1.default.config({ quiet: true });
    const uri = (0, exports.bootstrapUri)(process.env);
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
        throw new FirstAdminSetupError("Run this command in an interactive terminal to enter credentials securely.");
    }
    await mongoose_1.default.connect(uri, {
        autoCreate: false,
        autoIndex: false,
        serverSelectionTimeoutMS: 10000,
    });
    if (await user_1.default.exists({ admin: true })) {
        throw new FirstAdminSetupError("An admin already exists. Use the app's user management instead.");
    }
    let hidden = false;
    const output = new node_stream_1.Writable({
        write(chunk, _encoding, callback) {
            if (!hidden)
                process.stdout.write(chunk);
            callback();
        },
    });
    const prompt = (0, promises_1.createInterface)({ input: process.stdin, output, terminal: true });
    const cancellation = new AbortController();
    prompt.on("SIGINT", () => cancellation.abort());
    const question = (label) => prompt.question(label, { signal: cancellation.signal });
    try {
        console.log("Create the first admin in database: dev");
        const username = await question("Username: ");
        const name = await question("Display name: ");
        process.stdout.write("Password (hidden, 12+ characters): ");
        hidden = true;
        const password = await question("");
        process.stdout.write("\nConfirm password (hidden): ");
        const confirmation = await question("");
        hidden = false;
        process.stdout.write("\n");
        if (password !== confirmation)
            throw new FirstAdminSetupError("Passwords do not match.");
        await (0, exports.createFirstAdmin)({ username, name, password });
        console.log("Admin created in dev. You can now sign in to the app.");
    }
    finally {
        prompt.close();
        output.end();
    }
};
if (require.main === module) {
    run()
        .catch((error) => {
        // Connection/validation errors may contain credentials or user input.
        if (error instanceof FirstAdminSetupError) {
            console.error(error.message);
        }
        else {
            console.error("Setup failed. Check Atlas connectivity/access and retry; raw error withheld.");
        }
        process.exitCode = 1;
    })
        .finally(() => mongoose_1.default.disconnect());
}
//# sourceMappingURL=createFirstAdmin.js.map