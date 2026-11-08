import { createContext } from "react";

// Menus stay inside the dialog's focus boundary but outside its scrollable form.
export const ModalPortalContext = createContext<HTMLElement | null>(null);
