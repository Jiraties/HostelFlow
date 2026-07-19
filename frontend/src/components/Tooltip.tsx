import type { CSSProperties, ReactNode } from "react";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import "./Tooltip.css";

const VIEWPORT_GAP = 10;
const CLOSE_DELAY_MS = 180;

const Tooltip = ({
  children,
  content,
  className = "",
  style,
  ariaLabel,
  stopClickPropagation = false,
}: {
  children: ReactNode;
  content: ReactNode;
  className?: string;
  style?: CSSProperties;
  ariaLabel?: string;
  stopClickPropagation?: boolean;
}) => {
  const tooltipId = useId();
  const triggerRef = useRef<HTMLSpanElement | null>(null);
  const tooltipRef = useRef<HTMLSpanElement | null>(null);
  const closeTimeoutRef = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({
    left: 0,
    top: 0,
    arrowLeft: 0,
    placement: "top" as "top" | "bottom",
  });

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    const tooltip = tooltipRef.current;
    if (!trigger || !tooltip) return;

    const triggerRect = trigger.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    const idealLeft =
      triggerRect.left + triggerRect.width / 2 - tooltipRect.width / 2;
    const left = Math.min(
      window.innerWidth - tooltipRect.width - VIEWPORT_GAP,
      Math.max(VIEWPORT_GAP, idealLeft),
    );
    const fitsAbove = triggerRect.top >= tooltipRect.height + VIEWPORT_GAP;
    const top = fitsAbove
      ? triggerRect.top - tooltipRect.height - 8
      : triggerRect.bottom + 8;
    const arrowLeft = Math.min(
      tooltipRect.width - 12,
      Math.max(12, triggerRect.left + triggerRect.width / 2 - left),
    );

    setPosition({
      left,
      top,
      arrowLeft,
      placement: fitsAbove ? "top" : "bottom",
    });
  }, []);

  const cancelClose = () => {
    if (closeTimeoutRef.current === null) return;
    window.clearTimeout(closeTimeoutRef.current);
    closeTimeoutRef.current = null;
  };

  const showTooltip = () => {
    cancelClose();
    setOpen(true);
  };

  const scheduleClose = () => {
    cancelClose();
    closeTimeoutRef.current = window.setTimeout(() => {
      setOpen(false);
      closeTimeoutRef.current = null;
    }, CLOSE_DELAY_MS);
  };

  useEffect(() => () => cancelClose(), []);

  useLayoutEffect(() => {
    if (!open) return;

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, updatePosition]);

  return (
    <>
      <span
        ref={triggerRef}
        className={`appTooltip__trigger ${className}`.trim()}
        style={style}
        tabIndex={0}
        aria-label={ariaLabel}
        aria-describedby={open ? tooltipId : undefined}
        onMouseEnter={showTooltip}
        onMouseLeave={scheduleClose}
        onFocus={showTooltip}
        onBlur={scheduleClose}
        onClick={(event) => {
          if (stopClickPropagation) event.stopPropagation();
        }}
      >
        {children}
      </span>
      {open &&
        createPortal(
          <span
            ref={tooltipRef}
            id={tooltipId}
            className="appTooltip"
            role="tooltip"
            data-placement={position.placement}
            onMouseEnter={showTooltip}
            onMouseLeave={scheduleClose}
            style={
              {
                left: position.left,
                top: position.top,
                "--app-tooltip-arrow-left": `${position.arrowLeft}px`,
              } as CSSProperties
            }
          >
            {content}
          </span>,
          document.body,
        )}
    </>
  );
};

export default Tooltip;
