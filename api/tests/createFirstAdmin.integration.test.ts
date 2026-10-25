import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, beforeEach, test } from "node:test";
import bcrypt from "bcrypt";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import User from "../src/models/user";
import { bootstrapUri, createFirstAdmin } from "../src/scripts/createFirstAdmin";

let database: MongoMemoryServer;
// Entirely synthetic credentials, used only in the disposable local test DB.
const credentials = () => ({
  username: "synthetic-bootstrap-admin",
  name: "Synthetic bootstrap admin",
  password: randomBytes(24).toString("hex"),
});

before(async () => {
  database = await MongoMemoryServer.create();
  await mongoose.connect(database.getUri(), {
    dbName: "dev",
    autoCreate: false,
    autoIndex: false,
  });
});

beforeEach(async () => { await User.deleteMany({}); });
after(async () => {
  await mongoose.disconnect();
  if (database) await database.stop();
});

test("bootstrap rejects production, missing expectations, and URI/database mismatches", () => {
  const environment = {
    NODE_ENV: "development",
    EXPECTED_DATABASE_NAME: "dev",
    MONGO_URI: "mongodb://127.0.0.1:27017/dev",
  };
  assert.equal(bootstrapUri(environment), environment.MONGO_URI);
  assert.throws(() => bootstrapUri({ ...environment, NODE_ENV: "production" }));
  assert.throws(() => bootstrapUri({ ...environment, EXPECTED_DATABASE_NAME: "" }));
  assert.throws(() => bootstrapUri({ ...environment, MONGO_URI: "mongodb://127.0.0.1:27017/hostelflow" }));
  assert.throws(() => bootstrapUri({ ...environment, MONGO_URI: "mongodb://127.0.0.1:27017/" }));
  assert.throws(() => bootstrapUri({ ...environment, MONGO_URI: "invalid" }));
});

test("first admin can authenticate with bcrypt and receives normal application defaults", async () => {
  const input = credentials();
  await createFirstAdmin(input);
  const user = await User.findOne({ username: input.username }).lean();
  assert.ok(user);
  assert.equal(user.admin, true);
  assert.equal(user.active, true);
  assert.equal(user.name, input.name);
  assert.equal(user.profilePictureUrl, "/uploads/default.jpg");
  assert.equal(user.settings.calendarColorMode, "status");
  assert.notEqual(user.password, input.password);
  assert.equal(await bcrypt.compare(input.password, user.password), true);
});

test("rerunning refuses an existing admin without changing its password", async () => {
  const first = credentials();
  await createFirstAdmin(first);
  const original = await User.findOne({ username: first.username }).lean();
  await assert.rejects(createFirstAdmin(credentials()), /admin already exists/);
  assert.equal(await User.countDocuments(), 1);
  assert.equal((await User.findOne({ username: first.username }).lean())?.password, original?.password);
});

test("existing staff accounts are never promoted or overwritten", async () => {
  const input = credentials();
  await User.create({ ...input, password: "synthetic-unused-hash", admin: false });
  await assert.rejects(createFirstAdmin(input), /username already exists/);
  assert.equal(await User.countDocuments({ admin: true }), 0);
});

test("password policy and required names are enforced before creating any user", async () => {
  await assert.rejects(createFirstAdmin({ ...credentials(), password: "short" }));
  await assert.rejects(createFirstAdmin({ ...credentials(), password: "ก".repeat(25) }));
  await assert.rejects(createFirstAdmin({ ...credentials(), username: " " }));
  assert.equal(await User.countDocuments(), 0);
});

test("connected database is checked independently of environment settings", async () => {
  await mongoose.disconnect();
  await mongoose.connect(database.getUri(), { dbName: "synthetic_wrong_target", autoCreate: false, autoIndex: false });
  try {
    await assert.rejects(createFirstAdmin(credentials()), /outside the dev database/);
    assert.equal(await User.countDocuments(), 0);
  } finally {
    await mongoose.disconnect();
    await mongoose.connect(database.getUri(), { dbName: "dev", autoCreate: false, autoIndex: false });
  }
});
