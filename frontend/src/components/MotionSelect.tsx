import { createContext, useContext, useEffect, useRef, useState } from "react";
import BaseSelect, {
  components,
  type GroupBase,
  type InputProps,
  type MenuProps,
  type Props,
  type SelectInstance,
} from "react-select";
import useMediaQuery from "@mui/material/useMediaQuery";
import { surfaceDuration } from "../helpers/surfaceMotion";
import { ModalPortalContext } from "./ModalPortalContext";

const ClosingContext = createContext(false);

const MotionMenu = <Option, IsMulti extends boolean, Group extends GroupBase<Option>>(
  props: MenuProps<Option, IsMulti, Group>,
) => {
  const closing = useContext(ClosingContext);
  return <components.Menu {...props} innerProps={{ ...props.innerProps, inert: closing, "aria-hidden": closing || undefined }} />;
};

const MotionInput = <Option, IsMulti extends boolean, Group extends GroupBase<Option>>(
  props: InputProps<Option, IsMulti, Group>,
) => {
  const closing = useContext(ClosingContext);
  return <components.Input {...props} aria-expanded={closing ? false : props["aria-expanded"]} aria-activedescendant={closing ? undefined : props["aria-activedescendant"]} />;
};

const MotionSelect = <Option, IsMulti extends boolean = false, Group extends GroupBase<Option> = GroupBase<Option>>({
  menuIsOpen, defaultMenuIsOpen = false, onMenuOpen, onMenuClose, onInputChange,
  onKeyDown, styles, components: customComponents, ...props
}: Props<Option, IsMulti, Group>) => {
  const selectRef = useRef<SelectInstance<Option, IsMulti, Group>>(null);
  const modalPortalTarget = useContext(ModalPortalContext);
  const [internalOpen, setInternalOpen] = useState(defaultMenuIsOpen);
  const open = !props.isDisabled && (menuIsOpen ?? internalOpen);
  const [retained, setRetained] = useState(open);
  if (open && !retained) setRetained(true);
  const closing = !open && retained;
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");

  useEffect(() => {
    if (!closing) return;
    const timer = window.setTimeout(() => setRetained(false), reducedMotion ? 0 : surfaceDuration("dropdown", "close"));
    return () => window.clearTimeout(timer);
  }, [closing, reducedMotion]);

  const openMenu = () => { setInternalOpen(true); onMenuOpen?.(); };

  return (
    <ClosingContext.Provider value={closing}>
      <BaseSelect<Option, IsMulti, Group>
        {...props}
        menuPortalTarget={modalPortalTarget ?? props.menuPortalTarget}
        menuPosition={modalPortalTarget ? "fixed" : props.menuPosition}
        menuPlacement={modalPortalTarget ? "auto" : props.menuPlacement}
        menuShouldScrollIntoView={modalPortalTarget ? false : props.menuShouldScrollIntoView}
        ref={selectRef}
        menuIsOpen={open || retained}
        tabSelectsValue={closing ? false : props.tabSelectsValue}
        components={{ Menu: MotionMenu, Input: MotionInput, ...customComponents }}
        styles={{
          ...styles,
          menu: (provided, state) => {
            const styled = styles?.menu ? styles.menu(provided, state) : provided;
            return {
              ...styled,
              animation: closing
                ? "surfaceDropdownExit var(--dropdown-close-dur, 120ms) var(--dropdown-ease) both"
                : styled.animation || "surfaceDropdownEnter var(--dropdown-open-dur, 160ms) var(--dropdown-ease) both",
              pointerEvents: closing ? "none" : styled.pointerEvents,
              "@media (prefers-reduced-motion: reduce)": { animation: "none" },
            };
          },
        }}
        onMenuOpen={openMenu}
        onMenuClose={() => { setInternalOpen(false); onMenuClose?.(); }}
        onInputChange={(value, meta) => {
          if (closing && meta.action === "input-change") openMenu();
          return onInputChange?.(value, meta);
        }}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (!closing || event.defaultPrevented) return;
          // The retained menu is visual only; never select a hidden option.
          if (["Enter", " ", "ArrowDown", "ArrowUp"].includes(event.key)) {
            event.preventDefault();
            if (event.key !== "Enter") selectRef.current?.openMenu(event.key === "ArrowUp" ? "last" : "first");
          }
        }}
      />
    </ClosingContext.Provider>
  );
};

export default MotionSelect;
