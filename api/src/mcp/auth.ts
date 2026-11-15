import { property, scope, type OwnerContext } from "./contracts";

export type AuthPolicy = {
  resource: URL;
  issuer: string;
  jwksUrl: URL;
  ownerSubject: string;
  clientId: string;
  revokedBefore?: number;
};
export type AuthDecision = { owner: OwnerContext } | { denied: "missing" | "invalid" | "forbidden" | "scope" };
const validToken = /^Bearer ([\w-]+\.[\w-]+\.[\w-]+)$/i;
const maxLifetime = 600;

export function tokenVerifier(policy: AuthPolicy) {
  const options = async () => {
    const { createRemoteJWKSet, customFetch, jwtVerify } = await import("jose");
    const jwks = createRemoteJWKSet(policy.jwksUrl, {
      timeoutDuration: 1300, cooldownDuration: 30_000, cacheMaxAge: 5 * 60_000,
      // Never follow a discovery endpoint redirect or permit token-supplied key URLs.
      [customFetch]: async (url: string, init: RequestInit) => fetch(url, { ...init, redirect: "error" }),
    });
    return { jwks, jwtVerify };
  };
  let setup: ReturnType<typeof options> | undefined;
  return async (header: string | undefined): Promise<AuthDecision> => {
    if (!header) return { denied: "missing" };
    if (header.length > 6000) return { denied: "invalid" };
    const token = validToken.exec(header)?.[1];
    if (!token) return { denied: "invalid" };
    try {
      const { jwks, jwtVerify } = await (setup ??= options());
      const { payload } = await jwtVerify(token, jwks, {
        algorithms: ["RS256"], issuer: policy.issuer, audience: policy.resource.href,
        requiredClaims: ["exp", "iat", "sub", "aud"], maxTokenAge: maxLifetime,
      });
      const { iat, exp, aud, azp, client_id: clientId } = payload;
      const now = Math.floor(Date.now() / 1000);
      if (!Number.isSafeInteger(iat) || !Number.isSafeInteger(exp) || iat! > now || exp! <= iat! ||
        exp! - iat! > maxLifetime || (policy.revokedBefore !== undefined && iat! <= policy.revokedBefore) ||
        (Array.isArray(aud) ? aud.length !== 1 || aud[0] !== policy.resource.href : aud !== policy.resource.href)) {
        return { denied: "invalid" };
      }
      if (payload.sub !== policy.ownerSubject || (clientId ?? azp) !== policy.clientId ||
        (azp !== undefined && azp !== policy.clientId)) return { denied: "forbidden" };
      if (typeof payload.scope !== "string" || !payload.scope.split(" ").includes(scope)) return { denied: "scope" };
      return { owner: { property } };
    } catch {
      return { denied: "invalid" };
    }
  };
}
