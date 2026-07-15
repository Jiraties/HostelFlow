"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.trustProxyHops = exports.validateProductionWebSecurity = exports.MAX_TRUST_PROXY_HOPS = void 0;
exports.MAX_TRUST_PROXY_HOPS = 10;
const parseTrustProxyHops = (value) => {
    if (!/^[1-9]\d*$/.test(value)) {
        throw new Error("TRUST_PROXY_HOPS must be a positive integer");
    }
    const hops = Number(value);
    if (!Number.isSafeInteger(hops) || hops > exports.MAX_TRUST_PROXY_HOPS) {
        throw new Error(`TRUST_PROXY_HOPS must not exceed ${exports.MAX_TRUST_PROXY_HOPS}`);
    }
    return hops;
};
const validateProductionWebSecurity = (environment = process.env) => {
    if (environment.NODE_ENV !== "production")
        return;
    const origins = environment.ALLOWED_ORIGINS?.split(",")
        .map((origin) => origin.trim())
        .filter(Boolean);
    if (!origins?.length) {
        throw new Error("ALLOWED_ORIGINS is required in production");
    }
    for (const origin of origins) {
        const parsed = new URL(origin);
        if (parsed.protocol !== "https:" || parsed.origin !== origin) {
            throw new Error("Production ALLOWED_ORIGINS must contain exact HTTPS origins");
        }
    }
    if (!environment.TRUST_PROXY_HOPS) {
        throw new Error("TRUST_PROXY_HOPS is required in production");
    }
    parseTrustProxyHops(environment.TRUST_PROXY_HOPS);
};
exports.validateProductionWebSecurity = validateProductionWebSecurity;
const trustProxyHops = (environment = process.env) => {
    const value = environment.TRUST_PROXY_HOPS;
    return value === undefined || value === ""
        ? undefined
        : parseTrustProxyHops(value);
};
exports.trustProxyHops = trustProxyHops;
//# sourceMappingURL=runtimeSecurity.js.map