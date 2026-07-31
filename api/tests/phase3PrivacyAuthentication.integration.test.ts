import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import os from "node:os";
import crypto from "node:crypto";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";

import Activity from "../src/models/activity";
import Booking, {
  ADDITIONAL_GUEST_SENSITIVE_SELECT,
  PASSPORT_SENSITIVE_SELECT,
} from "../src/models/booking";
import LoginAttempt from "../src/models/loginAttempt";
import User from "../src/models/user";
import { requirePassportAccess } from "../src/middleware/passportAuthorization";
import {
  LOGIN_COOLDOWN_MS,
  assertLoginAllowed,
  loginAttemptKeys,
  recordLoginFailure,
} from "../src/services/loginProtection";
import {
  trustProxyHops,
  validateProductionWebSecurity,
} from "../src/config/runtimeSecurity";
import authMiddleware from "../src/middleware/authMiddleware";

type AuthController = typeof import("../src/controller/auth");
type BookingController = typeof import("../src/controller/booking");
type CapturedResponse = {
  statusCode: number;
  body: any;
  headers: Record<string, string>;
  cookieValue?: string;
  cookieOptions?: Record<string, unknown>;
  status: (code: number) => CapturedResponse;
  json: (body: any) => CapturedResponse;
  send: (body: any) => CapturedResponse;
  setHeader: (name: string, value: string) => CapturedResponse;
  cookie: (
    name: string,
    value: string,
    options: Record<string, unknown>,
  ) => CapturedResponse;
};

const response = (): CapturedResponse => ({
  statusCode: 200,
  body: undefined,
  headers: {},
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
  send(body) {
    this.body = body;
    return this;
  },
  setHeader(name, value) {
    this.headers[name.toLowerCase()] = value;
    return this;
  },
  cookie(_name, value, options) {
    this.cookieValue = value;
    this.cookieOptions = options;
    return this;
  },
});

const loginRequest = (
  username: string,
  password: string,
  ip = "203.0.113.10",
) =>
  ({
    body: { username, password },
    cookies: {},
    ip,
    socket: { remoteAddress: ip },
  }) as any;

const encrypt = (plaintext: string) => {
  const key = Buffer.from(process.env.CRYPTO_SECRET!, "hex");
  const iv = Buffer.alloc(12, 7);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const cipherText = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]).toString("hex");
  return {
    cipherText,
    iv: iv.toString("hex"),
    authTag: cipher.getAuthTag().toString("hex"),
  };
};

let replicaSet: MongoMemoryReplSet;
let authController: AuthController;
let bookingController: BookingController;

before(async () => {
  replicaSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replicaSet.getUri(), { dbName: "hostelflow_phase3" });
  await Promise.all([
    Activity.syncIndexes(),
    Booking.syncIndexes(),
    LoginAttempt.syncIndexes(),
    User.syncIndexes(),
  ]);

  process.env.CRYPTO_SECRET = "22".repeat(32);
  process.env.JWT_SECRET = "synthetic-jwt-secret-for-tests";
  const previousCwd = process.cwd();
  process.chdir(os.tmpdir());
  authController = require("../src/controller/auth");
  bookingController = require("../src/controller/booking");
  process.chdir(previousCwd);
});

after(async () => {
  await new Promise((resolve) => setTimeout(resolve, 50));
  await mongoose.disconnect();
  await replicaSet.stop();
});

beforeEach(async () => {
  process.env.NODE_ENV = "test";
  await Promise.all(
    Object.values(mongoose.connection.collections).map((collection) =>
      collection.deleteMany({}),
    ),
  );
});

test("passport authorization allows authenticated staff and administrators", () => {
  for (const [user, expectedStatus, expectedNext] of [
    [undefined, 401, false],
    [{ username: "staff", admin: false }, 200, true],
    [{ username: "admin", admin: true }, 200, true],
  ] as const) {
    const res = response();
    let nextCalled = false;
    requirePassportAccess(
      { user } as any,
      res as any,
      (() => {
        nextCalled = true;
      }) as any,
    );
    assert.equal(res.statusCode, expectedStatus);
    assert.equal(nextCalled, expectedNext);
  }
});

test("ordinary booking reads exclude encrypted passport material by default", async () => {
  await Booking.create({
    name: "Synthetic Passport Guest",
    bookingId: "PASSPORT-1",
    status: "checkedIn",
    passport: {
      passportHash: "synthetic-hash",
      namePrefix: "Ms",
      nationality: "TH",
      passportNo: encrypt("SYNTHETIC-NUMBER"),
      passportName: encrypt("Synthetic Passport Guest"),
    },
    additionalGuests: [
      {
        identityDocument: {
          passportHash: "synthetic-additional-hash",
          namePrefix: "Mr",
          nationality: "US",
          passportNo: encrypt("SYNTHETIC-ADDITIONAL-NUMBER"),
          passportName: encrypt("Synthetic Additional Guest"),
        },
        createdBy: "admin",
      },
    ],
  });

  const ordinary = await Booking.findOne({ bookingId: "PASSPORT-1" }).lean();
  const ordinaryJson = JSON.stringify(ordinary);
  assert.equal(ordinaryJson.includes("passportHash"), false);
  assert.equal(ordinaryJson.includes("cipherText"), false);
  assert.equal(ordinaryJson.includes("authTag"), false);
  assert.equal(ordinaryJson.includes('"iv"'), false);

  const controllerResponse = response();
  await bookingController.getBookingById(
    { params: { bookingId: "PASSPORT-1" } } as any,
    controllerResponse as any,
  );
  assert.equal(controllerResponse.statusCode, 200);
  assert.equal(JSON.stringify(controllerResponse.body).includes("cipherText"), false);

  const privileged = await Booking.findOne({ bookingId: "PASSPORT-1" })
    .select(
      `passport.namePrefix passport.nationality ${PASSPORT_SENSITIVE_SELECT} ${ADDITIONAL_GUEST_SENSITIVE_SELECT}`,
    )
    .lean();
  assert.ok(privileged?.passport?.passportNo?.cipherText);
  assert.ok(
    privileged?.additionalGuests[0].identityDocument?.passportNo?.cipherText,
  );
});

test("authorized passport reveal decrypts, audits and disables caching", async () => {
  await Booking.create({
    name: "Synthetic Authorized Guest",
    bookingId: "PASSPORT-2",
    status: "checkedIn",
    passport: {
      passportHash: "synthetic-hash",
      namePrefix: "Mr",
      nationality: "US",
      passportNo: encrypt("SYNTHETIC-42"),
      passportName: encrypt("Synthetic Authorized Guest"),
    },
  });

  const res = response();
  await bookingController.getPassportData(
    {
      params: { bookingId: "PASSPORT-2" },
      user: { userId: "staff-id", username: "staff", admin: false },
    } as any,
    res as any,
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.passportData.passportNo, "SYNTHETIC-42");
  assert.equal(res.headers["cache-control"], "no-store");
  const audit = await Activity.findOne({ action: "VIEW_PASSPORT" }).lean();
  assert.ok(audit);
  assert.equal(JSON.stringify(audit).includes("SYNTHETIC-42"), false);
});

test("Mongo-backed login cooldown limits both IP and account identifiers", async () => {
  const password = "synthetic-password-123";
  await User.create({
    username: "staff",
    password: await bcrypt.hash(password, 10),
    name: "Synthetic Staff",
    admin: false,
    active: true,
  });

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const res = response();
    await authController.login(
      loginRequest("staff", "wrong-password"),
      res as any,
      (() => undefined) as any,
    );
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.error, "AUTHENTICATION_FAILED");
  }

  const sameAccount = response();
  await authController.login(
    loginRequest("staff", "wrong-password", "198.51.100.20"),
    sameAccount as any,
    (() => undefined) as any,
  );
  assert.equal(sameAccount.statusCode, 429);

  const sameIp = response();
  await authController.login(
    loginRequest("another-user", "wrong-password"),
    sameIp as any,
    (() => undefined) as any,
  );
  assert.equal(sameIp.statusCode, 429);
  assert.ok(Number(sameIp.headers["retry-after"]) > 0);

  const keys = loginAttemptKeys(loginRequest("staff", password), "staff");
  await assert.doesNotReject(
    assertLoginAllowed(keys, new Date(Date.now() + LOGIN_COOLDOWN_MS + 1000)),
  );
});

test("concurrent limiter writes remain atomic across shared MongoDB state", async () => {
  const req = loginRequest("distributed-user", "wrong-password");
  const keys = loginAttemptKeys(req, "distributed-user");
  await Promise.all(
    Array.from({ length: 5 }, () => recordLoginFailure(keys)),
  );

  const records = await LoginAttempt.find({ key: { $in: keys } }).lean();
  assert.equal(records.length, 2);
  records.forEach((record) => {
    assert.equal(record.failureCount, 5);
    assert.ok(record.blockedUntil && record.blockedUntil > new Date());
  });
});

test("successful login clears failures and production cookies remain secure", async () => {
  const password = "synthetic-password-123";
  await User.create({
    username: "admin",
    password: await bcrypt.hash(password, 10),
    name: "Synthetic Admin",
    admin: true,
    active: true,
  });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    await authController.login(
      loginRequest("admin", "wrong-password"),
      response() as any,
      (() => undefined) as any,
    );
  }

  process.env.NODE_ENV = "production";
  const res = response();
  const req = loginRequest("admin", password);
  await authController.login(req, res as any, (() => undefined) as any);
  assert.equal(res.statusCode, 200);
  assert.equal(res.cookieOptions?.httpOnly, true);
  assert.equal(res.cookieOptions?.secure, true);
  assert.equal(res.cookieOptions?.sameSite, "lax");
  assert.equal(
    await LoginAttempt.countDocuments({ key: { $in: loginAttemptKeys(req, "admin") } }),
    0,
  );
});

test("a verified login replaces an abandoned session and invalidates its token", async () => {
  const password = "synthetic-password-123";
  const abandonedSessionId = "abandoned-session";
  const user = await User.create({
    username: "reconnect-staff",
    password: await bcrypt.hash(password, 10),
    name: "Reconnect Staff",
    admin: false,
    active: true,
    currentSessionId: abandonedSessionId,
    currentSessionIssuedAt: new Date(),
  });
  const abandonedToken = jwt.sign(
    {
      userId: user._id,
      admin: false,
      username: user.username,
      sessionId: abandonedSessionId,
    },
    process.env.JWT_SECRET!,
    { expiresIn: "1d" },
  );

  const loginResponse = response();
  await authController.login(
    loginRequest("reconnect-staff", password),
    loginResponse as any,
    (() => undefined) as any,
  );
  assert.equal(loginResponse.statusCode, 200);

  const updatedUser = await User.findById(user._id).lean();
  assert.ok(updatedUser?.currentSessionId);
  assert.notEqual(updatedUser?.currentSessionId, abandonedSessionId);

  const oldSessionResponse = response();
  let oldSessionAccepted = false;
  await authMiddleware(
    {
      method: "GET",
      cookies: { token: abandonedToken },
    } as any,
    oldSessionResponse as any,
    (() => {
      oldSessionAccepted = true;
    }) as any,
  );
  assert.equal(oldSessionResponse.statusCode, 401);
  assert.equal(oldSessionAccepted, false);

  const replacementSessionResponse = response();
  let replacementSessionAccepted = false;
  await authMiddleware(
    {
      method: "GET",
      cookies: { token: loginResponse.cookieValue },
    } as any,
    replacementSessionResponse as any,
    (() => {
      replacementSessionAccepted = true;
    }) as any,
  );
  assert.equal(replacementSessionAccepted, true);
});

test("profile picture upload persists in MongoDB and serves with image headers", async () => {
  const user = await User.create({
    username: "picture-staff",
    password: await bcrypt.hash("synthetic-password-123", 10),
    name: "Picture Staff",
    admin: false,
    active: true,
  });
  const imageData = Buffer.from("synthetic-image-data");
  const uploadResponse = response();

  await authController.setProfilePicture(
    {
      user: {
        userId: String(user._id),
        username: user.username,
        admin: false,
      },
      file: {
        buffer: imageData,
        mimetype: "image/png",
      },
    } as any,
    uploadResponse as any,
  );

  assert.equal(uploadResponse.statusCode, 200);
  assert.match(
    uploadResponse.body.user.profilePictureUrl,
    new RegExp(`/auth/users/${user._id}/profile-picture\\?v=\\d+`),
  );

  const storedUser = await User.findById(user._id)
    .select("+profilePicture.data +profilePicture.contentType");
  assert.equal(storedUser?.profilePicture?.contentType, "image/png");
  assert.deepEqual(Buffer.from(storedUser!.profilePicture!.data), imageData);

  const imageResponse = response();
  await authController.getProfilePicture(
    { params: { userId: String(user._id) } } as any,
    imageResponse as any,
  );

  assert.equal(imageResponse.statusCode, 200);
  assert.equal(imageResponse.headers["content-type"], "image/png");
  assert.equal(
    imageResponse.headers["cache-control"],
    "public, max-age=31536000, immutable",
  );
  assert.deepEqual(imageResponse.body, imageData);
});

test("inactive users get generic failure and weak passwords are rejected", async () => {
  await User.create({
    username: "inactive",
    password: await bcrypt.hash("synthetic-password-123", 10),
    name: "Inactive Synthetic User",
    admin: false,
    active: false,
  });
  const inactiveResponse = response();
  await authController.login(
    loginRequest("inactive", "synthetic-password-123"),
    inactiveResponse as any,
    (() => undefined) as any,
  );
  assert.equal(inactiveResponse.statusCode, 401);
  assert.equal(inactiveResponse.body.error, "AUTHENTICATION_FAILED");

  const weakCreate = response();
  await authController.adminCreateUser(
    {
      user: { userId: "admin-id", username: "admin", admin: true },
      body: { username: "weak", name: "Weak User", password: "short" },
    } as any,
    weakCreate as any,
  );
  assert.equal(weakCreate.statusCode, 400);
  assert.equal(weakCreate.body.error, "WEAK_PASSWORD");
});

test("authenticated staff directory returns display names without login secrets", async () => {
  await User.create({
    username: "frontdesk-login",
    password: "stored-login-secret",
    name: "Front Desk Display Name",
    admin: false,
    active: true,
  });

  const directoryResponse = response();
  await authController.getStaffDirectory(
    {
      user: { userId: "staff-id", username: "staff", admin: false },
    } as any,
    directoryResponse as any,
  );

  assert.equal(directoryResponse.statusCode, 200);
  assert.deepEqual(directoryResponse.body.staff, [
    {
      username: "frontdesk-login",
      name: "Front Desk Display Name",
      profilePictureUrl: "/uploads/default.jpg",
    },
  ]);
  assert.equal(JSON.stringify(directoryResponse.body).includes("stored-login-secret"), false);
});

test("production web security requires exact HTTPS origins and proxy hops", () => {
  assert.throws(
    () => validateProductionWebSecurity({ NODE_ENV: "production" }),
    /ALLOWED_ORIGINS/,
  );
  assert.throws(
    () =>
      validateProductionWebSecurity({
        NODE_ENV: "production",
        ALLOWED_ORIGINS: "http://example.test",
      }),
    /HTTPS origins/,
  );
  assert.throws(
    () =>
      validateProductionWebSecurity({
        NODE_ENV: "production",
        ALLOWED_ORIGINS: "https://hostelflow.example",
      }),
    /TRUST_PROXY_HOPS/,
  );
  assert.doesNotThrow(() =>
    validateProductionWebSecurity({
      NODE_ENV: "production",
      ALLOWED_ORIGINS: "https://hostelflow.example",
      TRUST_PROXY_HOPS: "1",
    }),
  );
  assert.equal(trustProxyHops({ TRUST_PROXY_HOPS: "2" }), 2);
});
