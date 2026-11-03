import { useEffect, useRef, useState } from "react";
import type { OptionType } from "../helpers/selectStyling";
import "../features/bookings/BookingCheckbox.css";
import "./ExportMultiSelect.css";

const ExportMultiSelect = ({
  id,
  label,
  countLabel,
  options,
  value,
  onChange,
  disabled = false,
}: {
  id: string;
  label: string;
  countLabel: string;
  options: OptionType[];
  value: string[];
  onChange: (value: string[]) => void;
  disabled?: boolean;
}) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [openAbove, setOpenAbove] = useState(false);
  const [alignRight, setAlignRight] = useState(false);
  const [availableHeight, setAvailableHeight] = useState<number>();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const selectedLabels = options.filter((option) => value.includes(option.value)).map((option) => option.label);
  const visibleOptions = options.filter((option) => option.label.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const expanded = open && !disabled;
  const updatePlacement = () => {
    const bounds = rootRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const spaceBelow = window.innerHeight - bounds.bottom - 16;
    const spaceAbove = bounds.top - 16;
    const above = spaceBelow < 320 && spaceAbove > spaceBelow;
    const menuWidth = Math.min(Math.max(bounds.width, 272), window.innerWidth - 32);
    setOpenAbove(above);
    setAlignRight(bounds.left + menuWidth > window.innerWidth - 16);
    setAvailableHeight(Math.max(0, (above ? spaceAbove : spaceBelow) - 8));
  };
  const openMenu = () => {
    updatePlacement();
    setSearch("");
    setOpen(true);
  };

  useEffect(() => {
    if (!expanded) return;
    searchRef.current?.focus();
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    window.addEventListener("resize", updatePlacement);
    window.addEventListener("scroll", updatePlacement, true);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      window.removeEventListener("resize", updatePlacement);
      window.removeEventListener("scroll", updatePlacement, true);
    };
  }, [expanded]);

  return (
    <div
      className={`exportMultiSelect${expanded ? " exportMultiSelect--open" : ""}`}
      ref={rootRef}
      onBlur={(event) => {
        // Clicking a non-focusable part of an option can blur the search input
        // before the checkbox receives its click. Outside pointer presses are
        // handled separately, so only close here for a known focus destination.
        if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && expanded) {
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
          triggerRef.current?.focus();
        }
      }}
    >
      <label id={`${id}-label`} className="documents__label" htmlFor={id}>{label}</label>
      <button
        id={id}
        ref={triggerRef}
        type="button"
        className={`boxInput exportMultiSelect__trigger${value.length === 0 ? " boxInput--error" : ""}`}
        aria-haspopup="dialog"
        aria-expanded={expanded}
        aria-invalid={value.length === 0}
        aria-controls={expanded ? `${id}-menu` : undefined}
        aria-labelledby={`${id}-label ${id}-summary`}
        title={selectedLabels.join(", ")}
        disabled={disabled}
        onClick={() => expanded ? setOpen(false) : openMenu()}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") { event.preventDefault(); openMenu(); }
        }}
      >
        <span id={`${id}-summary`}>{value.length === options.length ? "ทั้งหมด" : value.length === 1 ? selectedLabels[0] : value.length ? `${value.length} ${countLabel}` : "เลือกอย่างน้อย 1 รายการ"}</span>
        <i className={`bx ${expanded ? "bx-chevron-up" : "bx-chevron-down"}`} aria-hidden="true" />
      </button>
      {expanded && (
        <div id={`${id}-menu`} role="dialog" aria-labelledby={`${id}-label`} className={`exportMultiSelect__menu${openAbove ? " exportMultiSelect__menu--above" : ""}${alignRight ? " exportMultiSelect__menu--right" : ""}`} style={{ maxHeight: availableHeight }}>
          <input
            ref={searchRef}
            className="exportMultiSelect__search"
            type="search"
            aria-label={`ค้นหา${label}`}
            placeholder="ค้นหา..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <div className="exportMultiSelect__controls">
            <button type="button" disabled={value.length === options.length} onClick={() => onChange(options.map((option) => option.value))}>เลือกทั้งหมด</button>
            <button type="button" disabled={value.length === 0} onClick={() => onChange([])}>ล้างทั้งหมด</button>
          </div>
          <div className="exportMultiSelect__options">
            {visibleOptions.map((option) => (
              <label key={option.value} className="checkbox exportMultiSelect__option">
                <input
                  type="checkbox"
                  checked={value.includes(option.value)}
                  onChange={(event) => onChange(event.target.checked ? [...value, option.value] : value.filter((item) => item !== option.value))}
                />
                <span className="box" aria-hidden="true" />
                <span>{option.label}</span>
              </label>
            ))}
            {visibleOptions.length === 0 && <p className="exportMultiSelect__empty">ไม่พบตัวเลือก</p>}
          </div>
        </div>
      )}
    </div>
  );
};

export default ExportMultiSelect;
