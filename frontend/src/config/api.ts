const configuredApiUrl = import.meta.env.VITE_API_URL?.trim();

export const API_URL = configuredApiUrl?.startsWith("/")
  ? configuredApiUrl.replace(/\/$/, "")
  : "/api";
