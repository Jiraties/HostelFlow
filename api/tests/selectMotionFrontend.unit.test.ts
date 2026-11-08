import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

// Fabricated select state verifies that exit retention never enables selection.
const harness = (modalTarget: object | null = null, selectProps: Record<string, unknown> = {}) => {
  const slots: any[] = [];
  const timers = new Map<number, () => void>();
  let cursor = 0;
  let closing = false;
  let timerId = 0;
  const react = {
    createContext: () => ({ Provider: "provider" }),
    useContext: (context: unknown) => context === modalContext ? modalTarget : closing,
    useRef(initial: unknown) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index];
    },
    useState(initial: unknown) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], (value: unknown) => { slots[index] = value; }];
    },
    useEffect(effect: () => (() => void) | undefined, dependencies: unknown[]) {
      const index = cursor++;
      if (!slots[index] || dependencies.some((value, i) => value !== slots[index].dependencies[i])) {
        slots[index]?.cleanup?.();
        slots[index] = { dependencies, cleanup: effect() };
      }
    },
  };
  const jsx = (type: unknown, props: unknown) => ({ type, props });
  const modalContext = {};
  const module = { exports: {} as any };
  const source = fs.readFileSync(path.resolve(__dirname, "../../frontend/src/components/MotionSelect.tsx"), "utf8");
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText, {
    module, exports: module.exports,
    window: {
      setTimeout: (callback: () => void, duration: number) => {
        assert.equal(duration, 120);
        timers.set(++timerId, callback);
        return timerId;
      },
      clearTimeout: (id: number) => timers.delete(id),
    },
    require: (name: string) => {
      if (name === "react") return react;
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
      if (name === "react-select") return { default: "select", components: { Menu: "menu", Input: "input" } };
      if (name === "@mui/material/useMediaQuery") return () => false;
      if (name === "./ModalPortalContext") return { ModalPortalContext: modalContext };
      return { surfaceDuration: () => 120 };
    },
  });
  const render = () => {
    cursor = 0;
    const tree = module.exports.default({ options: [{ value: "one", label: "Synthetic one" }], ...selectProps });
    closing = tree.props.value;
    const props = tree.props.children.props;
    props.ref.current = { openMenu: props.onMenuOpen };
    return props;
  };
  const open = () => { render().onMenuOpen(); render(); return render(); };
  const close = () => { render().onMenuClose(); return render(); };
  return { render, open, close, timers };
};

test("modal selects render outside the scrolling form without scrolling it into view", () => {
  const modalTarget = {};
  const bodyTarget = {};
  const select = harness(modalTarget, { menuPortalTarget: bodyTarget, menuPosition: "absolute" }).render();
  assert.equal(select.menuPortalTarget, modalTarget);
  assert.equal(select.menuPosition, "fixed");
  assert.equal(select.menuPlacement, "auto");
  assert.equal(select.menuShouldScrollIntoView, false);
});

test("selects outside modals retain their caller's portal settings", () => {
  const target = {};
  const select = harness(null, { menuPortalTarget: target, menuPosition: "fixed" }).render();
  assert.equal(select.menuPortalTarget, target);
  assert.equal(select.menuPosition, "fixed");
});

test("select exits last 120ms while options are inert, hidden, and cannot be selected by Enter or Tab", () => {
  const select = harness();
  assert.equal(select.open().menuIsOpen, true);
  const exiting = select.close();
  assert.equal(exiting.menuIsOpen, true);
  assert.equal(exiting.tabSelectsValue, false);
  const menu = exiting.components.Menu({ innerProps: {} });
  assert.equal(menu.props.innerProps.inert, true);
  assert.equal(menu.props.innerProps["aria-hidden"], true);
  const input = exiting.components.Input({ "aria-expanded": true, "aria-activedescendant": "synthetic-option" });
  assert.equal(input.props["aria-expanded"], false);
  assert.equal(input.props["aria-activedescendant"], undefined);
  const event = { key: "Enter", defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
  exiting.onKeyDown(event);
  assert.equal(event.defaultPrevented, true);
  assert.equal(select.timers.size, 1);
  [...select.timers.values()][0]();
  assert.equal(select.render().menuIsOpen, false);
});

test("reopening or typing during a select exit cancels the pending removal", () => {
  for (const reopen of [
    (props: any) => props.onMenuOpen(),
    (props: any) => props.onInputChange("Synthetic", { action: "input-change" }),
    (props: any) => props.onKeyDown({ key: "ArrowDown", defaultPrevented: false, preventDefault() {} }),
  ]) {
    const select = harness();
    select.open();
    const exiting = select.close();
    assert.equal(select.timers.size, 1);
    reopen(exiting);
    const open = select.render();
    assert.equal(open.menuIsOpen, true);
    assert.equal(select.timers.size, 0);
    assert.equal(open.components.Menu({ innerProps: {} }).props.innerProps.inert, false);
  }
});
