import dotenv from "dotenv";
import mongoose from "mongoose";
import Booking from "../models/booking";
import Activity from "../models/activity";
import StatusCorrection from "../models/statusCorrection";
import FocusedBookingAction from "../models/focusedBookingAction";
import { assertDeploymentIdentity } from "../config/deploymentIdentity";

dotenv.config();

const groupedCounts = (
  model: mongoose.Model<any>,
  field: string,
) =>
  model.aggregate([
    { $group: { _id: `$${field}`, count: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ]).exec();

const run = async () => {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is required");
  await mongoose.connect(process.env.MONGO_URI, { autoIndex: false });
  const deployment = assertDeploymentIdentity();
  const [
    bookingsByStatus,
    activitiesByAction,
    resolutions,
    resolveTransactions,
    statusCorrectionCount,
    focusedActionCount,
  ] = await Promise.all([
    groupedCounts(Booking, "status"),
    groupedCounts(Activity, "action"),
    Booking.aggregate([
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
    Booking.aggregate([
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
    StatusCorrection.countDocuments(),
    FocusedBookingAction.countDocuments(),
  ]);
  console.log(
    JSON.stringify(
      {
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
      },
      null,
      2,
    ),
  );
  await mongoose.disconnect();
};

run().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect().catch(() => undefined);
  process.exitCode = 1;
});
