"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.trustProxyHops = exports.validateProductionWebSecurity = void 0;
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
    const trustProxyHops = Number(environment.TRUST_PROXY_HOPS);
    if (!Number.isInteger(trustProxyHops) || trustProxyHops < 1) {
        throw new Error("TRUST_PROXY_HOPS must be a positive integer");
    }
};
exports.validateProductionWebSecurity = validateProductionWebSecurity;
const trustProxyHops = (environment = process.env) => Number(environment.TRUST_PROXY_HOPS || 1);
exports.trustProxyHops = trustProxyHops;
//# sourceMappingURL=runtimeSecurity.js.map