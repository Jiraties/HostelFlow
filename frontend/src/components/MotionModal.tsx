import { useState } from "react";
import MuiModal, { type ModalProps } from "@mui/material/Modal";
import SurfaceTransition from "./SurfaceTransition";
import { ModalPortalContext } from "./ModalPortalContext";

const MotionModal = ({ children, open, className = "", ...props }: ModalProps) => {
  const [portalTarget, setPortalTarget] = useState<HTMLDivElement | null>(null);
  // Callers often clear the selected record when closing. Retain the last open
  // element for the short exit so the sheet does not turn into empty content.
  const [lastOpenChildren, setLastOpenChildren] = useState(children);
  if (open && lastOpenChildren !== children) setLastOpenChildren(children);
  return (
    <MuiModal {...props} open={open} className={`${className} motionModal`} data-motion-open={open} closeAfterTransition>
      <SurfaceTransition in={open}>
        <div
          ref={setPortalTarget}
          className="motionModal__surface"
          role="dialog"
          aria-modal="true"
          aria-label={props["aria-label"]}
          aria-labelledby={props["aria-labelledby"]}
          aria-describedby={props["aria-describedby"]}
          aria-hidden={!open || undefined}
          inert={!open}
        >
          <ModalPortalContext.Provider value={portalTarget}>
            {open ? children : lastOpenChildren}
          </ModalPortalContext.Provider>
        </div>
      </SurfaceTransition>
    </MuiModal>
  );
};

export default MotionModal;
