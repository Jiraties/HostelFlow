import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

const frontend = path.resolve(__dirname, "../../frontend");
const frontendRequire = createRequire(path.join(frontend, "package.json"));
const React = frontendRequire("react");
const { renderToStaticMarkup } = frontendRequire("react-dom/server");
const useAutocomplete = frontendRequire("@mui/material/useAutocomplete").default;

const calendarHarness = () => {
  const slots: any[] = [];
  let cursor = 0;
  const selections: string[] = [];
  const react = {
    useId: () => "synthetic-calendar",
    useEffect() {},
    useRef(initial: unknown) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index];
    },
    useState(initial: unknown) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], (next: any) => { slots[index] = typeof next === "function" ? next(slots[index]) : next; }];
    },
  };
  const jsx = (type: unknown, props: unknown) => ({ type, props });
  const cache = new Map<string, any>();
  const load = (file: string): any => {
    if (cache.has(file)) return cache.get(file);
    const module = { exports: {} as any };
    cache.set(file, module.exports);
    const output = ts.transpileModule(fs.readFileSync(file, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText;
    vm.runInNewContext(output, {
      module, exports: module.exports,
      window: { innerWidth: 1200, innerHeight: 900, requestAnimationFrame: (callback: () => void) => callback() },
      document: { body: {} },
      require: (name: string) => {
        if (name === "react") return react;
        if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
        if (name === "react-dom") return { createPortal: (content: unknown) => content };
        if (name.endsWith(".css") || name === "./MonthPickerPanel") return {};
        if (name.startsWith(".")) return load(path.resolve(path.dirname(file), `${name}.ts`));
        return frontendRequire(name);
      },
    }, { filename: file });
    cache.set(file, module.exports);
    return module.exports;
  };
  const CalendarInput = load(path.join(frontend, "src/components/CalendarInput.tsx")).CalendarInput;
  const render = () => {
    cursor = 0;
    return CalendarInput({ value: "2026-11-03", onChange: (value: string) => selections.push(value) });
  };
  const root = render();
  root.props.children[0].props.ref.current = {
    getBoundingClientRect: () => ({ bottom: 200, top: 160, left: 100 }),
    closest: () => null,
    focus() {},
  };
  return { render, selections };
};

const searchHarness = () => {
  let autocomplete: any;
  const selected: unknown[] = [];
  const Harness = () => {
    autocomplete = useAutocomplete({
      id: "synthetic-search", options: ["Synthetic booking result"],
      filterOptions: (items: unknown[]) => items, open: true, autoHighlight: true,
      inputValue: "03/11/2026", value: null,
      onChange: (_event: unknown, option: unknown) => selected.push(option),
    });
    return null;
  };
  renderToStaticMarkup(React.createElement(Harness));
  return { selected, keyDown: (event: unknown) => autocomplete.getRootProps().onKeyDown(event) };
};

const keyboardEvent = (key: string) => ({
  key, which: key === "Enter" ? 13 : 0, defaultPrevented: false, stopped: false,
  target: { tagName: "BUTTON" },
  preventDefault() { this.defaultPrevented = true; },
  stopPropagation() { this.stopped = true; },
});

test("calendar Enter and navigation keys stay out of the search autocomplete without suppressing button activation", () => {
  // Verify the actual MUI handler would select a search result without isolation.
  const control = searchHarness();
  control.keyDown(keyboardEvent("Enter"));
  assert.deepEqual(control.selected, ["Synthetic booking result"]);

  const calendar = calendarHarness();
  calendar.render().props.children[0].props.onClick({ defaultPrevented: false });
  const panel = calendar.render().props.children[1];
  for (const key of ["Enter", " ", "ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Tab"]) {
    const search = searchHarness();
    const event = keyboardEvent(key);
    panel.props.onKeyDown?.(event);
    if (!event.stopped) search.keyDown(event);
    assert.equal(event.stopped, true, key);
    assert.equal(event.defaultPrevented, false, key);
    assert.deepEqual(search.selected, [], key);
  }
  const days = panel.props.children[0].props.children[2].props.children;
  days.find((day: any) => day.props["data-date"] === "2026-11-04").props.onClick();
  assert.deepEqual(calendar.selections, ["2026-11-04"]);
  assert.equal(calendar.render().props.children[1], false);
});

test("calendar trigger activation opens the picker without selecting a search result", () => {
  for (const key of ["Enter", " ", "ArrowDown", "F4"]) {
    const calendar = calendarHarness();
    const search = searchHarness();
    const trigger = calendar.render().props.children[0];
    const event = keyboardEvent(key);
    trigger.props.onKeyDown(event);
    if (!event.stopped) search.keyDown(event);
    assert.equal(event.stopped, true, key);
    assert.deepEqual(search.selected, [], key);
    if (!event.defaultPrevented) trigger.props.onClick(event);
    assert(calendar.render().props.children[1], key);
  }
});
