// Unfinished analytics is an explicit local-development preview only.
export const analyticsPreviewEnabled =
  import.meta.env.DEV && import.meta.env.VITE_ENABLE_ANALYTICS === "true";
