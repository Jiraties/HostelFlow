import type { ComponentProps } from "react";
import { CalendarInput } from "./CalendarInput";

type MonthInputProps = Omit<ComponentProps<typeof CalendarInput>, "mode">;

const MonthInput = (props: MonthInputProps) => <CalendarInput {...props} mode="month" />;

export default MonthInput;
