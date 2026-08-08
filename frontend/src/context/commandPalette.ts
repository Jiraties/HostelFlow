import { createContext, useContext } from "react";

export type PaletteMode =
  | "search"
  | "commands"
  | "bookingPick"
  | "checkInDate"
  | "checkOutDate";

export type CommandPaletteContextValue = {
  openPalette: (mode?: PaletteMode) => void;
  closePalette: () => void;
};

export const CommandPaletteContext =
  createContext<CommandPaletteContextValue | null>(null);

export const useCommandPalette = () => {
  const value = useContext(CommandPaletteContext);
  if (!value) {
    throw new Error("useCommandPalette must be used within its provider");
  }
  return value;
};
