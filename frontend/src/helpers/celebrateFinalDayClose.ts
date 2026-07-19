import confetti from "canvas-confetti";

export type CelebrationOrigin = {
  x: number;
  y: number;
};

export const celebrateFinalDayClose = (origin: CelebrationOrigin) => {
  void confetti({
    angle: 90,
    colors: ["#51d1dc", "#22c55e", "#facc15", "#fb7185", "#8b5cf6"],
    disableForReducedMotion: true,
    drift: 0,
    gravity: 0.9,
    origin,
    particleCount: 35,
    scalar: 0.75,
    spread: 50,
    startVelocity: 20,
    ticks: 100,
    zIndex: 2147483647,
  });
};
