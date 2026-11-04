import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

// Synthetic modal nodes exercise retained exit DOM and interrupted reopening.
const harness = () => {
  const frames: (() => void)[] = [];
  let notify!: (mutations: unknown[]) => void;
  let focusCount = 0;
  const document = { activeElement: null as unknown, body: {}, querySelectorAll: () => [modal] };
  class FakeElement {
    tabIndex = 0;
    isConnected = true;
    open = "true";
    getAttribute(name: string) { return name === "data-motion-open" ? this.open : null; }
    hasAttribute() { return false; }
    getClientRects() { return [{}]; }
    contains(node: unknown) { return node === field; }
    matches(selector: string) { return selector === ".MuiModal-root" ? this === modal : this === field; }
    closest() { return modal; }
    querySelectorAll() { return this === modal ? [field] : []; }
    focus() { document.activeElement = this; focusCount++; }
  }
  const modal = new FakeElement();
  const field = new FakeElement();
  const source = fs.readFileSync(path.resolve(__dirname, "../../frontend/src/hooks/useModalInputAutofocus.ts"), "utf8");
  const module = { exports: {} as any };
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, {
    module, exports: module.exports, document,
    Element: FakeElement, HTMLElement: FakeElement,
    window: { requestAnimationFrame: (callback: () => void) => frames.push(callback) },
    MutationObserver: class {
      constructor(callback: typeof notify) { notify = callback; }
      observe() {}
      disconnect() {}
    },
    require: () => ({ useEffect: (effect: () => void) => effect() }),
  });
  module.exports.useModalInputAutofocus();
  const flush = () => { while (frames.length) frames.shift()!(); };
  const setOpen = (open: boolean) => {
    modal.open = String(open);
    notify([{ type: "attributes", target: modal, addedNodes: [] }]);
  };
  return { flush, setOpen, get focusCount() { return focusCount; }, clearFocus: () => { document.activeElement = null; } };
};

test("a modal reopened during its exit gets field focus again on the same retained root", () => {
  const modal = harness();
  modal.flush();
  assert.equal(modal.focusCount, 1);
  modal.setOpen(false);
  modal.clearFocus();
  modal.setOpen(true);
  modal.flush();
  assert.equal(modal.focusCount, 2);
});

test("scheduled autofocus cannot steal focus back into a closing modal", () => {
  const modal = harness();
  modal.setOpen(false);
  modal.flush();
  assert.equal(modal.focusCount, 0);
  modal.setOpen(true);
  modal.flush();
  assert.equal(modal.focusCount, 1);
});
