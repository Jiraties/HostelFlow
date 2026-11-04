export type SurfaceKind = "modal" | "dropdown";

export const surfaceDuration = (kind: SurfaceKind, phase: "open" | "close") => {
  const fallback = kind === "modal"
    ? phase === "open" ? 200 : 150
    : phase === "open" ? 160 : 120;
  if (typeof document === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(`--${kind}-${phase}-dur`).trim();
  const amount = Number.parseFloat(value);
  return Number.isFinite(amount) ? amount * (value.endsWith("ms") ? 1 : 1000) : fallback;
};

export const enterSurface = (node: HTMLElement) => {
  // Fade supplies mount/unmount timing; the skill's CSS owns both properties.
  node.style.transition = "";
  delete node.dataset.motionSettled;
  node.classList.remove("is-open", "is-closing");
  void node.offsetWidth;
  node.classList.add("is-open");
};

export const exitSurface = (node: HTMLElement) => {
  node.style.transition = "";
  delete node.dataset.motionSettled;
  node.classList.remove("is-open");
  node.classList.add("is-closing");
};
