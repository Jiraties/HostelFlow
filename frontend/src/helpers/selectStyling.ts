import type { StylesConfig } from "react-select";

export type OptionType = {
  value: string;
  label: string;
  color?: string;
  isDisabled?: boolean;
};

export const customStyles = <
  T,
  IsMulti extends boolean = false,
>(): StylesConfig<T, IsMulti> => ({
  control: (provided, state) => ({
    ...provided,
    fontFamily: '"IBM Plex Sans Thai", sans-serif',
    minHeight: "3.3rem",
    padding: "0.45rem 0.55rem",
    borderRadius: "0.5rem",
    border: "none",
    boxShadow: state.isFocused
      ? "rgba(149, 157, 165, 0.25) 0px 8px 24px, 0 0 0 2px var(--primary-color)"
      : "rgba(149, 157, 165, 0.25) 0px 8px 24px",
    width: "100%",
    color: "var(--text)",
    backgroundColor: "#fff",
  }),

  valueContainer: (provided) => ({
    ...provided,
    gap: "0.6rem",
    padding: "0.1rem 0.25rem",
  }),

  input: (provided) => ({
    ...provided,
    padding: 0,
    margin: 0,
    boxShadow: "none",
  }),

  singleValue: (provided) => ({
    ...provided,
    color: "var(--text)",
  }),

  multiValue: (provided) => ({
    ...provided,
    alignItems: "center",
    borderRadius: "0.4rem",
    backgroundColor: "#f3f3f3",
    margin: 0,
    // minHeight: "3.2rem",
  }),

  multiValueLabel: (provided) => ({
    ...provided,
    color: "var(--text)",
    fontSize: "0.9rem",
    fontWeight: 400,
    padding: ".25rem",
  }),

  multiValueRemove: (provided) => ({
    ...provided,
    alignSelf: "stretch",
    alignItems: "center",
    color: "var(--text)",
    cursor: "pointer",
    padding: "0 0.6rem 0 0.35rem",
    ":hover": {
      backgroundColor: "#e8e8e8",
      color: "var(--text)",
    },
  }),

  menu: (provided, state) => ({
    animation: "surfaceDropdownEnter var(--dropdown-open-dur, 160ms) var(--dropdown-ease, cubic-bezier(0.25, 1, 0.5, 1)) both",
    transformOrigin: state.placement === "top" ? "bottom left" : "top left",
    "@media (prefers-reduced-motion: reduce)": { animation: "none" },
    ...provided,
    zIndex: 1000,
    borderRadius: "0.5rem",
    overflow: "hidden",
    fontFamily: '"IBM Plex Sans Thai", sans-serif',
  }),

  menuPortal: (provided) => ({
    ...provided,
    zIndex: 9999,
  }),

  option: (provided, state) => ({
    ...provided,
    backgroundColor: state.isDisabled
      ? "#f7f7f7"
      : state.isFocused
        ? "#f3f3f3"
        : "#fff",
    color: state.isDisabled ? "#a0a0a0" : "var(--text)",
    cursor: state.isDisabled ? "not-allowed" : "pointer",
    opacity: state.isDisabled ? 0.65 : 1,
  }),

  dropdownIndicator: (provided) => ({
    ...provided,
    color: "#fff",
  }),

  clearIndicator: (provided) => ({
    ...provided,
    alignItems: "center",
    color: "#777",
    padding: "0 0.6rem",
    ":hover": {
      color: "var(--text)",
    },
  }),

  indicatorSeparator: () => ({
    display: "none",
  }),
});
