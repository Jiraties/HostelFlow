import "../bookings/BookingCheckbox.css";

type ExportFilterGroupProps = {
  id: string;
  label: string;
  allLabel: string;
  options: { value: string; label: string }[];
  value: string[];
  onChange: (value: string[]) => void;
  disabled?: boolean;
  expanded: boolean;
  onToggle: () => void;
};

const ExportFilterGroup = ({ id, label, allLabel, options, value, onChange, disabled, expanded, onToggle }: ExportFilterGroupProps) => {
  const summary = value.length === options.length ? allLabel : value.length === 0 ? "ยังไม่ได้เลือก" : `เลือก ${value.length} จาก ${options.length}`;
  return (
    <div className="documentFilters__group">
      <h3 className="documentFilters__heading">
        <button type="button" id={`${id}-trigger`} className="documentFilters__trigger" aria-expanded={expanded} aria-controls={`${id}-options`} disabled={disabled} onClick={onToggle}>
          <span>{label}<span className={`documentFilters__summary${value.length === 0 ? " documentFilters__summary--empty" : ""}`}>{summary}</span></span>
          <i className={`bx bx-chevron-${expanded ? "up" : "down"}`} aria-hidden="true" />
        </button>
      </h3>
      {expanded && <fieldset id={`${id}-options`} aria-labelledby={`${id}-trigger`} className="documentFilters__options" disabled={disabled}>
        <legend className="documentFilters__legend">{label}</legend>
        <div className="documentFilters__bulk">
          <button type="button" disabled={disabled || value.length === options.length} onClick={() => onChange(options.map((option) => option.value))}>เลือกทั้งหมด</button>
          <button type="button" disabled={disabled || value.length === 0} onClick={() => onChange([])}>ล้าง</button>
        </div>
      <div className="documentFilters__choices">
        {options.map((option) => (
          <label className="checkbox documentFilters__choice" key={option.value}>
            <input type="checkbox" checked={value.includes(option.value)} onChange={() => onChange(value.includes(option.value) ? value.filter((item) => item !== option.value) : options.filter((item) => item.value === option.value || value.includes(item.value)).map((item) => item.value))} />
            <span className="box" aria-hidden="true" /><span>{option.label}</span>
          </label>
        ))}
      </div>
      </fieldset>}
    </div>
  );
};

export default ExportFilterGroup;
