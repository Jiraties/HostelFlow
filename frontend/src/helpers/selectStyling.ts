import type { StylesConfig } from "react-select";

export type OptionType = {
  value: string;
  label: string;
  color?: string;
};

export const customStyles = <T>(): StylesConfig<T, false> => ({
  control: (provided) => ({
    ...provided,
    fontFamily: '"IBM Plex Sans Thai", sans-serif',
    padding: "0.6rem",
    borderRadius: "0.5rem",
    border: "none",
    boxShadow: "rgba(149, 157, 165, 0.25) 0px 8px 24px",
    width: "100%",
    color: "var(--text)",
    backgroundColor: "#fff",
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

  menu: (provided) => ({
    ...provided,
    borderRadius: "0.5rem",
    overflow: "hidden",
    fontFamily: '"IBM Plex Sans Thai", sans-serif',
  }),

  option: (provided, state) => ({
    ...provided,
    backgroundColor: state.isFocused ? "#f3f3f3" : "#fff",
    color: "var(--text)",
    cursor: "pointer",
  }),

  dropdownIndicator: (provided) => ({
    ...provided,
    color: "#fff",
  }),

  indicatorSeparator: () => ({
    display: "none",
  }),
});
