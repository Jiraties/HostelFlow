import { cloneElement, type HTMLAttributes, type ReactElement } from "react";
import SurfaceTransition from "./SurfaceTransition";

type MotionDropdownProps = {
  open: boolean;
  origin?: "top-left" | "top-center" | "top-right" | "bottom-left" | "bottom-center" | "bottom-right";
  children: ReactElement<HTMLAttributes<HTMLElement>>;
};

const MotionDropdown = ({ open, origin = "top-left", children }: MotionDropdownProps) => (
  <SurfaceTransition in={open} kind="dropdown" mountOnEnter unmountOnExit>
    {cloneElement(children, {
      "aria-hidden": !open || undefined,
      inert: !open,
      ...{ "data-origin": origin },
    })}
  </SurfaceTransition>
);

export default MotionDropdown;
