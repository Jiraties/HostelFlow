import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

// Exercise the component handlers with synthetic options and focus targets.
test("filter remains open when clicking an option and closes on outside focus", () => {
  const slots: any[] = [];
  let cursor = 0;
  const react = {
    useState(initial: unknown) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], (value: unknown) => { slots[index] = value; }];
    },
    useRef(initial: unknown) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index];
    },
    useEffect() {},
  };
  const source = fs.readFileSync(path.resolve(__dirname, "../../frontend/src/components/ExportMultiSelect.tsx"), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const module = { exports: {} as any };
  const jsx = (type: unknown, props: unknown) => ({ type, props });
  vm.runInNewContext(output, {
    module, exports: module.exports,
    window: { innerHeight: 900, innerWidth: 1200 },
    require: (name: string) => name === "react" ? react : name === "react/jsx-runtime" ? { jsx, jsxs: jsx } : {},
  });
  let selected = ["one", "two"];
  const render = () => {
    cursor = 0;
    return module.exports.default({ id: "synthetic", label: "Filter", countLabel: "items", options: [{ label: "One", value: "one" }, { label: "Two", value: "two" }], value: selected, onChange: (value: string[]) => { selected = value; } });
  };
  let root = render();
  root.props.ref.current = { getBoundingClientRect: () => ({ top: 200, bottom: 260, left: 100, width: 200 }) };
  root.props.children[1].props.onClick();
  root = render();
  assert.match(root.props.className, /exportMultiSelect--open/);
  root.props.onBlur({ relatedTarget: null, currentTarget: { contains: () => false } });
  root = render();
  const transition = root.props.children[2];
  assert.equal(transition.props.open, true);
  const menu = transition.props.children;
  assert(menu, "the option click must not close the menu on blur");
  const options = menu.props.children[2].props.children[0];
  options[0].props.children[0].props.onChange({ target: { checked: false } });
  assert.deepEqual(selected, ["two"]);
  root.props.onBlur({ relatedTarget: {}, currentTarget: { contains: () => false } });
  assert.equal(render().props.children[2].props.open, false);
});
