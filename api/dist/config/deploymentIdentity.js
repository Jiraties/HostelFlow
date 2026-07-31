"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.assertDeploymentIdentity = void 0;
const mongoose_1 = __importDefault(require("mongoose"));
const assertDeploymentIdentity = (environment = process.env) => {
    const environmentId = environment.DEPLOYMENT_ENVIRONMENT_ID?.trim();
    const expectedDatabase = environment.EXPECTED_DATABASE_NAME?.trim();
    const clusterId = environment.DEPLOYMENT_CLUSTER_ID?.trim();
    if (!environmentId || !expectedDatabase || !clusterId) {
        throw new Error("DEPLOYMENT_ENVIRONMENT_ID, EXPECTED_DATABASE_NAME, and DEPLOYMENT_CLUSTER_ID are required");
    }
    const connectedDatabase = mongoose_1.default.connection.db?.databaseName;
    if (!connectedDatabase || connectedDatabase !== expectedDatabase) {
        throw new Error(`Connected database ${connectedDatabase || "(unknown)"} does not match EXPECTED_DATABASE_NAME`);
    }
    return { environmentId, databaseName: connectedDatabase, clusterId };
};
exports.assertDeploymentIdentity = assertDeploymentIdentity;
//# sourceMappingURL=deploymentIdentity.js.map