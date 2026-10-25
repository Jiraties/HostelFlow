import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import ExtraSaleAnnotation from "../src/models/extraSaleAnnotation";
import RoomMutationLock from "../src/models/roomMutationLock";
import { getMonthCalendar } from "../src/controller/booking";
import {
  createExtraSaleAnnotation,
  removeExtraSaleAnnotation,
  updateExtraSaleNote,
} from "../src/controller/extraSaleAnnotations";

const response = () => ({
  statusCode: 200,
  body: {} as any,
  status(code: number) { this.statusCode = code; return this; },
  json(body: any) { this.body = body; return this; },
}) as any;

const request = (body: Record<string, unknown> = {}, annotationId = "") => ({
  body,
  params: { annotationId },
  user: { userId: "staff-id", username: "synthetic-staff", admin: false },
}) as any;

let replicaSet: MongoMemoryReplSet;

before(async () => {
  replicaSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replicaSet.getUri(), { dbName: "hostelflow_extra_sale_annotations" });
  await Promise.all([ExtraSaleAnnotation.syncIndexes(), RoomMutationLock.syncIndexes()]);
});

beforeEach(async () => {
  await Promise.all([ExtraSaleAnnotation.deleteMany({}), RoomMutationLock.deleteMany({})]);
});

after(async () => {
  await mongoose.disconnect();
  await replicaSet.stop();
});

test("staff can create, view, update, and remove an annotation", async () => {
  const created = response();
  await createExtraSaleAnnotation(request({
    roomIds: ["Balcony", "Window"], from: "2026-10-01", to: "2026-10-04", note: "Synthetic extra sale",
  }), created);
  assert.equal(created.statusCode, 201);
  const id = String(created.body.annotation._id);
  const stored = await ExtraSaleAnnotation.findById(id).lean();
  assert.deepEqual(stored?.roomIds, ["Balcony", "Window"]);
  assert.equal(stored?.kind, "EXTRA_SALE");
  assert.equal(stored?.createdBy, "synthetic-staff");

  const calendar = response();
  await getMonthCalendar({ query: { month: "9", year: "2026" } } as any, calendar);
  assert.equal(calendar.statusCode, 200);
  assert.equal(calendar.body.find((room: any) => room.roomId === "Balcony").extraSaleAnnotations[0].annotationId, id);

  const changed = response();
  await updateExtraSaleNote(request({ note: "Updated synthetic note" }, id), changed);
  assert.equal(changed.statusCode, 200);
  assert.equal(changed.body.annotation.note, "Updated synthetic note");
  assert.equal(changed.body.annotation.updatedBy, "synthetic-staff");
  assert.ok(changed.body.annotation.updatedAt);

  const removed = response();
  await removeExtraSaleAnnotation(request({}, id), removed);
  assert.equal(removed.statusCode, 200);
  assert.equal(removed.body.annotation.removedBy, "synthetic-staff");
  assert.ok(removed.body.annotation.removedAt);

  const afterRemoval = response();
  await getMonthCalendar({ query: { month: "9", year: "2026" } } as any, afterRemoval);
  assert.equal(afterRemoval.body.find((room: any) => room.roomId === "Balcony").extraSaleAnnotations.length, 0);
});

test("active annotations reject overlaps for the same room and allow adjacent ranges", async () => {
  const first = response();
  await createExtraSaleAnnotation(request({ roomIds: ["Balcony"], from: "2026-10-01", to: "2026-10-04" }), first);
  assert.equal(first.statusCode, 201);

  const conflict = response();
  await createExtraSaleAnnotation(request({ roomIds: ["Balcony"], from: "2026-10-03", to: "2026-10-05" }), conflict);
  assert.equal(conflict.statusCode, 409);

  const adjacent = response();
  await createExtraSaleAnnotation(request({ roomIds: ["Balcony"], from: "2026-10-04", to: "2026-10-05" }), adjacent);
  assert.equal(adjacent.statusCode, 201);

  const anotherRoom = response();
  await createExtraSaleAnnotation(request({ roomIds: ["Window"], from: "2026-10-01", to: "2026-10-04" }), anotherRoom);
  assert.equal(anotherRoom.statusCode, 201);
});

test("invalid room and date ranges are rejected", async () => {
  const invalidRoom = response();
  await createExtraSaleAnnotation(request({ roomIds: ["Not a room"], from: "2026-10-01", to: "2026-10-04" }), invalidRoom);
  assert.equal(invalidRoom.statusCode, 400);

  const invalidDate = response();
  await createExtraSaleAnnotation(request({ roomIds: ["Balcony"], from: "2026-10-05", to: "2026-10-04" }), invalidDate);
  assert.equal(invalidDate.statusCode, 400);
});

test("custom calendar notes require a reason and retain it in month output", async () => {
  const missingReason = response();
  await createExtraSaleAnnotation(request({
    roomIds: ["Balcony"], from: "2026-10-01", to: "2026-10-04", kind: "OTHER",
  }), missingReason);
  assert.equal(missingReason.statusCode, 400);

  const unknownKind = response();
  await createExtraSaleAnnotation(request({
    roomIds: ["Balcony"], from: "2026-10-01", to: "2026-10-04", kind: "INVALID",
  }), unknownKind);
  assert.equal(unknownKind.statusCode, 400);

  const created = response();
  await createExtraSaleAnnotation(request({
    roomIds: ["Balcony"], from: "2026-10-01", to: "2026-10-04",
    kind: "OTHER", customReason: "Synthetic handover", note: "Synthetic details",
  }), created);
  assert.equal(created.statusCode, 201);

  const calendar = response();
  await getMonthCalendar({ query: { month: "9", year: "2026" } } as any, calendar);
  const annotation = calendar.body.find((room: any) => room.roomId === "Balcony").extraSaleAnnotations[0];
  assert.equal(annotation.kind, "OTHER");
  assert.equal(annotation.customReason, "Synthetic handover");
  assert.equal(annotation.note, "Synthetic details");
});
