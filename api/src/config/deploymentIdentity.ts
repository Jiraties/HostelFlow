import mongoose from "mongoose";

export const assertDeploymentIdentity = (
  environment: NodeJS.ProcessEnv = process.env,
) => {
  const environmentId = environment.DEPLOYMENT_ENVIRONMENT_ID?.trim();
  const expectedDatabase = environment.EXPECTED_DATABASE_NAME?.trim();
  const clusterId = environment.DEPLOYMENT_CLUSTER_ID?.trim();
  if (!environmentId || !expectedDatabase || !clusterId) {
    throw new Error(
      "DEPLOYMENT_ENVIRONMENT_ID, EXPECTED_DATABASE_NAME, and DEPLOYMENT_CLUSTER_ID are required",
    );
  }
  const connectedDatabase = mongoose.connection.db?.databaseName;
  if (!connectedDatabase || connectedDatabase !== expectedDatabase) {
    throw new Error(
      `Connected database ${connectedDatabase || "(unknown)"} does not match EXPECTED_DATABASE_NAME`,
    );
  }
  return { environmentId, databaseName: connectedDatabase, clusterId };
};
