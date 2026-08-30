const configuredApiUrl = import.meta.env.VITE_API_URL?.trim();

export const IS_DEMO_MODE = import.meta.env.VITE_DEMO_MODE === "true";

export const API_URL = configuredApiUrl
  ? configuredApiUrl.replace(/\/$/, "")
  : "/api";
