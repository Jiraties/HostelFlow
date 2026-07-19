declare module "canvas-confetti" {
  type ConfettiOptions = {
    angle?: number;
    colors?: string[];
    disableForReducedMotion?: boolean;
    drift?: number;
    gravity?: number;
    origin?: { x?: number; y?: number };
    particleCount?: number;
    scalar?: number;
    spread?: number;
    startVelocity?: number;
    ticks?: number;
    zIndex?: number;
  };

  const confetti: (options?: ConfettiOptions) => Promise<null> | null;

  export default confetti;
}
