import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

const loadComponent = (filename: string) => {
  const slots: any[] = [];
  let cursor = 0;
  const react = {
    useState(initial: any) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], (value: any) => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
    },
    useRef(initial: unknown) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index];
    },
    useId: () => "synthetic-dialog",
    useEffect: () => {},
  };
  const jsx = (type: unknown, props: unknown) => ({ type, props });
  const source = fs.readFileSync(path.resolve(__dirname, "../../frontend/src/components", filename), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const module = { exports: {} as any };
  vm.runInNewContext(output, { module, exports: module.exports, require: (name: string) => {
    if (name === "react") return react;
    if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
    return { __esModule: true, default: () => null };
  } });
  return { exports: module.exports, render: (component: any, props?: unknown) => { cursor = 0; return component(props); } };
};

test("confirmation waits for explicit action, prevents duplicate requests and supports dismissal", async () => {
  const driver = loadComponent("useAppConfirmation.tsx");
  const hook = () => driver.render(driver.exports.useAppConfirmation);
  const first = hook().ask({ title: "Synthetic warning", confirmText: "Confirm" });
  assert.equal(await hook().ask({ title: "Duplicate", confirmText: "Confirm" }), null);
  let current = hook();
  assert.equal(current.dialog.props.open, true);
  current.dialog.props.children.props.onClose();
  assert.equal(await first, null);
  assert.equal(hook().dialog.props.open, false);
  const second = hook().ask({ title: "Synthetic warning", confirmText: "Confirm" });
  current = hook();
  current.dialog.props.children.props.onConfirm("");
  assert.equal(await second, "");
});

test("the shared confirmation requires a nonblank deletion reason before confirming", () => {
  const driver = loadComponent("ConfirmationModal.tsx");
  let confirmed: string | undefined;
  const props = { variant: "custom", title: "Synthetic title", confirmText: "Delete", reasonLabel: "Reason", dialogId: "synthetic", onConfirm: (reason: string) => { confirmed = reason; } };
  const render = () => driver.render(driver.exports.default, props);
  let view = render();
  let children = view.props.children;
  children[3].props.children[1].props.onClick();
  view = render();
  children = view.props.children;
  assert.equal(confirmed, undefined);
  assert.equal(children[2].props.children[1].props["aria-invalid"], true);
  children[2].props.children[1].props.onChange({ target: { value: "  synthetic reason  " } });
  view = render();
  view.props.children[3].props.children[1].props.onClick();
  assert.equal(confirmed, "synthetic reason");
});
