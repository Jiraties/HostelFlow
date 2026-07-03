import { useState, useEffect, useRef } from "react";
import Skeleton from "react-loading-skeleton";
import "react-loading-skeleton/dist/skeleton.css";
import "./StatCard.css";

interface StatCardProps {
  label: string;
  value: number;
  loading: boolean;
  suffix?: string;
  helperText?: string;
}

function AnimatedDigit({
  char,
  direction,
}: {
  char: string;
  direction: "up" | "down" | null;
}) {
  const [prevChar, setPrevChar] = useState("0"); // ✅ start from 0
  const [animating, setAnimating] = useState(false);
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => {
    if (char === prevChar) return;

    if (timeoutRef.current) clearTimeout(timeoutRef.current);

    setAnimating(true);

    timeoutRef.current = window.setTimeout(() => {
      setPrevChar(char);
      setAnimating(false);
    }, 350);

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [char, prevChar]);

  const translateOut = direction === "up" ? "-100%" : "100%";
  const translateIn = direction === "up" ? "100%" : "-100%";

  return (
    <span
      style={{
        display: "inline-block",
        position: "relative",
        overflow: "hidden",
        lineHeight: "2.5rem",
        height: "2.5rem",
        width: "0.65em",
        verticalAlign: "bottom",
      }}
    >
      {/* Outgoing */}
      <span
        style={{
          position: "absolute",
          inset: 0,
          transform: animating
            ? `translateY(${translateOut})`
            : "translateY(0)",
          opacity: animating ? 0 : 1,
          transition: animating
            ? "transform 0.35s cubic-bezier(0.22,1,0.36,1), opacity 0.2s"
            : "none",
        }}
      >
        {prevChar}
      </span>

      {/* Incoming */}
      <span
        style={{
          transform: animating ? "translateY(0)" : `translateY(${translateIn})`,
          opacity: animating ? 1 : 0,
          transition: animating
            ? "transform 0.35s cubic-bezier(0.22,1,0.36,1), opacity 0.2s"
            : "none",
        }}
      >
        {char}
      </span>
    </span>
  );
}

export default function StatCard({
  label,
  value,
  loading,
  suffix = "",
  helperText,
}: StatCardProps) {
  const prevValue = useRef<number>(0); // ✅ start from 0
  const [direction, setDirection] = useState<"up" | "down">("up");
  const [flash, setFlash] = useState<"green" | "red" | null>(null);

  // ✅ Animate when value changes (including first load)
  useEffect(() => {
    if (loading) return;

    const dir = value >= prevValue.current ? "up" : "down";
    setDirection(dir);
    setFlash(dir === "up" ? "green" : "red");

    prevValue.current = value;

    const t = setTimeout(() => setFlash(null), 800);
    return () => clearTimeout(t);
  }, [value, loading]);

  // ✅ This is the key: animate from 0 → value
  const displayValue = loading ? 0 : value;
  const formatted = displayValue.toLocaleString("en-US");

  type Slot =
    | { type: "digit"; char: string; key: string }
    | { type: "sep"; char: string; idx: number };

  const slots: Slot[] = [];
  let digitPositionFromRight = 0;

  for (let i = formatted.length - 1; i >= 0; i--) {
    const char = formatted[i];

    if (char === "," || char === "." || char === "$") {
      slots.unshift({ type: "sep", char, idx: i });
    } else {
      slots.unshift({
        type: "digit",
        char,
        key: `d-${digitPositionFromRight}`,
      });
      digitPositionFromRight++;
    }
  }

  const flashColor =
    flash === "green"
      ? "var(--primary-color)"
      : flash === "red"
        ? "#ff5050"
        : "var(--text)";

  return (
    <div
      className="statCardShell"
      style={{ fontFamily: "'IBM Plex Sans Thai', sans-serif" }}
    >
      <div className="statLabel">
        {label}
        {helperText && (
          <span className="statTooltip" title={helperText} aria-label={helperText}>
            <i className="bx bx-info-circle" />
          </span>
        )}
      </div>

      <div
        style={{
          fontSize: "2.5rem",
          fontWeight: 400,
          color: flashColor,
          display: "flex",
          alignItems: "baseline",
          transition: "color 0.4s",
        }}
      >
        {loading ? (
          <Skeleton height="2.5rem" width={80} />
        ) : (
          slots.map((slot) =>
            slot.type === "sep" ? (
              <span
                key={`sep-${slot.idx}`}
                style={{ opacity: 0.8, lineHeight: "0.5" }}
              >
                {slot.char}
              </span>
            ) : (
              <AnimatedDigit
                key={slot.key}
                char={slot.char}
                direction={direction}
              />
            ),
          )
        )}
        {!loading && suffix && <span className="statSuffix">{suffix}</span>}
      </div>
    </div>
  );
}
