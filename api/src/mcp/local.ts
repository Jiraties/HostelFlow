import express from "express";
import { createServer } from "node:http";
import { createMcpRouter } from "./server";
import { connectStore } from "./store";

const required = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(name + " must be set");
  return value;
};
function loopbackUrl(name: string, path?: string) {
  const url = new URL(required(name));
  if (!["http:", "https:"].includes(url.protocol) || url.hostname !== "127.0.0.1" ||
    url.username || url.password || url.search || url.hash || (path && url.pathname !== path)) {
    throw new Error(name + " must be a canonical loopback URL");
  }
  return url;
}
async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("The MCP launcher is local only");
  const mongodb = required("MCP_MONGO_URI");
  const database = required("MCP_MONGO_DB");
  // DB connection is restricted to a single loopback mongod with a synthetic MCP database.
  // Controlled options prohibit SRV, extra hosts or replica-set discovery.
  if (!/^mongodb:\/\/[^/?#@]+:[^/?#@]+@127\.0\.0\.1:\d{1,5}\/(hostelflow_mcp_[a-z0-9_]+)\?authSource=\1&directConnection=true$/.test(mongodb) ||
    !/^hostelflow_mcp_[a-z0-9_]+$/.test(database) || !mongodb.includes("/" + database + "?")) throw new Error("Invalid local MCP MongoDB configuration");
  const resource = loopbackUrl("MCP_RESOURCE_URL", "/mcp");
  if (resource.protocol !== "http:" || !resource.port) throw new Error("Use an explicit HTTP port on loopback");
  const issuer = loopbackUrl("MCP_OAUTH_ISSUER");
  const issuerValue = required("MCP_OAUTH_ISSUER");
  if (issuer.origin + (issuer.pathname === "/" ? "" : issuer.pathname) !== issuerValue && issuer.href !== issuerValue) throw new Error("Invalid OAuth issuer");
  const jwksUrl = loopbackUrl("MCP_OAUTH_JWKS_URL");
  const ownerSubject = required("MCP_OWNER_SUBJECT");
  const clientId = required("MCP_OAUTH_CLIENT_ID");
  const revoked = process.env.MCP_REVOKED_BEFORE;
  if (revoked !== undefined && !/^\d{1,12}$/.test(revoked)) throw new Error("Invalid MCP_REVOKED_BEFORE");
  const store = await connectStore(mongodb, database);
  const app = express();
  app.disable("x-powered-by");
  const mcp = createMcpRouter({
    store, policy: { resource, issuer: issuerValue, jwksUrl, ownerSubject, clientId, revokedBefore: revoked === undefined ? undefined : Number(revoked) },
  });
  app.use(mcp.router);
  const server = createServer({ requestTimeout: 8000, headersTimeout: 5000, maxHeaderSize: 8192 }, app);
  server.on("error", () => { process.stderr.write("MCP listener could not start\n"); process.exitCode = 1; void stop(); });
  async function stop() {
    server.close();
    server.closeAllConnections();
    await mcp.close();
    await store.close();
  }
  process.once("SIGINT", () => void stop());
  process.once("SIGTERM", () => void stop());
  server.listen(Number(resource.port), "127.0.0.1", () => process.stderr.write("HostelFlow MCP listening on loopback\n"));
}
if (require.main === module) {
  main().catch(() => {
    process.stderr.write("MCP startup failed: check local settings and read-only MongoDB privileges\n");
    process.exitCode = 1;
  });
}
