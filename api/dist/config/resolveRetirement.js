"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveReplacementFor = exports.resolveRetirementFlags = void 0;
const enabled = (value, defaultValue) => (value === undefined ? defaultValue : value.toLowerCase() === "true");
const resolveRetirementFlags = (environment = process.env) => ({
    dedicatedNoShow: enabled(environment.DEDICATED_NO_SHOW_ENABLED, true),
    specialCaseFallback: enabled(environment.RESOLVE_SPECIAL_CASE_ENABLED, true),
    postCloseFallback: enabled(environment.RESOLVE_POST_CLOSE_ENABLED, true),
    genericResolveApi: enabled(environment.GENERIC_RESOLVE_API_ENABLED, true),
});
exports.resolveRetirementFlags = resolveRetirementFlags;
const resolveReplacementFor = (variant) => {
    if (variant === "no_show")
        return "MARK_NO_SHOW";
    if (variant === "post_close_adjustment") {
        return "CORRECT_CLOSED_ROOM_AVAILABILITY_OR_FINANCIAL_ACTION";
    }
    return "CHECK_OUT_CANCEL_OR_FINANCIAL_ACTION";
};
exports.resolveReplacementFor = resolveReplacementFor;
//# sourceMappingURL=resolveRetirement.js.map