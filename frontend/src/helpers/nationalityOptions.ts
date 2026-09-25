import countries from "i18n-iso-countries";
import en from "i18n-iso-countries/langs/en.json";
import type { OptionType } from "./selectStyling";

countries.registerLocale(en);

const frequentNationalityCodes = ["DE", "GB", "FR", "US", "ES"];
const frequentNationalitySet = new Set(frequentNationalityCodes);

const getFlagEmoji = (code: string) =>
  code
    .toUpperCase()
    .replace(/./g, (char) => String.fromCodePoint(127397 + char.charCodeAt(0)));

export const nationalityOptions: OptionType[] = Object.entries(
  countries.getNames("en"),
).map(([code, name]) => ({
  value: code,
  label: `${name} ${getFlagEmoji(code)}`,
}));

const optionsByCode = new Map(
  nationalityOptions.map((option) => [option.value, option]),
);

export const nationalitySelectOptions = [
  {
    label: "สัญชาติที่พบบ่อย",
    options: frequentNationalityCodes
      .map((code) => optionsByCode.get(code))
      .filter((option): option is OptionType => option !== undefined),
  },
  {
    label: "สัญชาติอื่น",
    options: nationalityOptions
      .filter((option) => !frequentNationalitySet.has(option.value))
      .sort((left, right) => left.label.localeCompare(right.label, "en")),
  },
];
