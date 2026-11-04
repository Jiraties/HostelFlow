import { cloneElement, forwardRef, useMemo, type HTMLAttributes, type ReactElement } from "react";
import Fade, { type FadeProps } from "@mui/material/Fade";
import useMediaQuery from "@mui/material/useMediaQuery";
import { enterSurface, exitSurface, surfaceDuration, type SurfaceKind } from "../helpers/surfaceMotion";
import "../styles/surfaceMotion.css";

type SurfaceTransitionProps = Omit<FadeProps, "children"> & {
  children: ReactElement<HTMLAttributes<HTMLElement>>;
  kind?: SurfaceKind;
};

const SurfaceTransition = forwardRef<unknown, SurfaceTransitionProps>(function SurfaceTransition(
  { children, kind = "modal", onEnter, onEntered, onExit, onExited, ...props }, ref,
) {
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const durations = useMemo(() => ({
    enter: reducedMotion ? 0 : surfaceDuration(kind, "open"),
    exit: reducedMotion ? 0 : surfaceDuration(kind, "close"),
  }), [kind, reducedMotion]);
  return (
    <Fade
      {...props}
      ref={ref}
      timeout={durations}
      onEnter={(node, appearing) => { enterSurface(node); onEnter?.(node, appearing); }}
      onEntered={(node, appearing) => { node.dataset.motionSettled = "true"; onEntered?.(node, appearing); }}
      onExit={(node) => { exitSurface(node); onExit?.(node); }}
      onExited={(node) => { node.classList.remove("is-closing"); onExited?.(node); }}
    >
      {cloneElement(children, {
        className: `${children.props.className || ""} t-${kind} ${props.in ? "is-open" : "is-closing"}`,
      })}
    </Fade>
  );
});

export default SurfaceTransition;
