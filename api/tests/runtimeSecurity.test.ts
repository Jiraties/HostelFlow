import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import type { Express } from "express";

import { createApp } from "../src/app";
import {
  MAX_TRUST_PROXY_HOPS,
  trustProxyHops,
  validateProductionWebSecurity,
} from "../src/config/runtimeSecurity";
import { loginAttemptKeys } from "../src/services/loginProtection";

const productionEnvironment = {
  NODE_ENV: "production",
  ALLOWED_ORIGINS: "https://hostelflow.example",
};

const observeRequest = async (
  app: Express,
  forwardedFor: string,
  forwardedProto = "https",
) => {
  app.get("/__proxy-observation", (req, res) => {
    res.json({
      ip: req.ip,
      ips: req.ips,
      protocol: req.protocol,
      loginKeys: loginAttemptKeys(req, "same-account"),
    });
  });

  const server = app.listen(0);
  try {
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const { port } = server.address() as AddressInfo;
    const response = await fetch(
      `http://127.0.0.1:${port}/__proxy-observation`,
      {
        headers: {
          "x-forwarded-for": forwardedFor,
          "x-forwarded-proto": forwardedProto,
        },
      },
    );
    assert.equal(response.status, 200);
    return response.json() as Promise<{
      ip: string;
      ips: string[];
      protocol: string;
      loginKeys: string[];
    }>;
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
};

test("production requires an explicitly configured proxy hop count", () => {
  assert.throws(
    () => createApp(productionEnvironment),
    /TRUST_PROXY_HOPS is required/,
  );
  const app = createApp({
    ...productionEnvironment,
    TRUST_PROXY_HOPS: "1",
  });
  assert.equal(app.get("trust proxy"), 1);
});

test("proxy hop parsing rejects malformed and unreasonable values", () => {
  for (const value of [
    "abc",
    "-1",
    "0",
    "1.5",
    "1e0",
    " 1",
    "01",
    String(MAX_TRUST_PROXY_HOPS + 1),
    "999999999999999999999999",
  ]) {
    assert.throws(
      () =>
        validateProductionWebSecurity({
          ...productionEnvironment,
          TRUST_PROXY_HOPS: value,
        }),
      /TRUST_PROXY_HOPS/,
      value,
    );
  }

  assert.equal(trustProxyHops({ TRUST_PROXY_HOPS: "1" }), 1);
  assert.equal(trustProxyHops({}), undefined);
});

test("development and test do not trust forwarded headers by default", async () => {
  assert.equal(createApp({ NODE_ENV: "development" }).get("trust proxy"), false);
  assert.equal(createApp({ NODE_ENV: "test" }).get("trust proxy"), false);

  const observed = await observeRequest(
    createApp({ NODE_ENV: "development" }),
    "203.0.113.10",
  );

  assert.notEqual(observed.ip, "203.0.113.10");
  assert.deepEqual(observed.ips, []);
  assert.equal(observed.protocol, "http");
});

test("one trusted Render hop resolves IP, limiter keys, and HTTPS safely", async () => {
  const environment = {
    ...productionEnvironment,
    TRUST_PROXY_HOPS: "1",
  };
  const first = await observeRequest(
    createApp(environment),
    "198.51.100.200, 203.0.113.10",
  );
  const second = await observeRequest(
    createApp(environment),
    "198.51.100.200, 203.0.113.11",
  );

  assert.equal(first.ip, "203.0.113.10");
  assert.deepEqual(first.ips, ["203.0.113.10"]);
  assert.equal(first.protocol, "https");
  assert.notEqual(first.loginKeys[0], second.loginKeys[0]);
  assert.equal(first.loginKeys[1], second.loginKeys[1]);
});
