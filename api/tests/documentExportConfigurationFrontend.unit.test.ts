import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

const createComponent = (relative: string, mocks: Record<string, any> = {}) => {
  const slots: any[] = [];
  let cursor = 0;
  const cache = new Map<string, any>();
  const jsx = (type: any, props: any) => ({ type, props });
  const load = (file: string): any => {
    if (file.endsWith(".css")) return {};
    if (cache.has(file)) return cache.get(file);
    const module = { exports: {} as any };
    const source = ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
    vm.runInNewContext(source, {
      module, exports: module.exports,
      require: (name: string): any => {
        if (name === "react") return { useState(initial: any) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial; return [slots[index], (next: any) => { slots[index] = typeof next === "function" ? next(slots[index]) : next; }]; } };
        if (name === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: "fragment" };
        if (name in mocks) return mocks[name];
        if (/components\//.test(name)) return { default: name };
        const resolved = path.resolve(path.dirname(file), name);
        const target = [resolved, `${resolved}.ts`, `${resolved}.tsx`].find((candidate) => fs.existsSync(candidate));
        assert(target, name);
        return load(target);
      },
    });
    cache.set(file, module.exports);
    return module.exports;
  };
  const component = load(path.resolve(__dirname, "../../frontend/src", relative)).default;
  return (props = {}) => { cursor = 0; return component(props); };
};
const nodes = (node: any): any[] => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
const find = (tree: any, predicate: (node: any) => boolean) => { const node = nodes(tree).find(predicate); assert(node); return node; };

test("collapsed groups hide choices and bulk actions keep all distinct from none", () => {
  const render = createComponent("features/documents/ExportFilterGroup.tsx");
  let value = ["one", "two"];
  let expanded = false;
  const props = () => ({ id: "synthetic", label: "ช่องทาง", allLabel: "ทุกช่องทาง", expanded, onToggle: () => { expanded = !expanded; }, options: [{ value: "one", label: "Synthetic One" }, { value: "two", label: "Synthetic Two" }], value, onChange: (next: string[]) => { value = next; } });
  let tree = render(props());
  assert.equal(nodes(tree).filter((node) => node.props?.type === "checkbox").length, 0);
  find(tree, (node) => node.props?.["aria-expanded"] === false).props.onClick();
  tree = render(props());
  assert.equal(nodes(tree).filter((node) => node.props?.type === "checkbox").length, 2);
  find(tree, (node) => node.props?.type === "checkbox").props.onChange();
  assert.deepEqual([...value], ["two"]);
  tree = render(props());
  find(tree, (node) => node.type === "button" && node.props.children === "เลือกทั้งหมด").props.onClick();
  assert.deepEqual([...value], ["one", "two"]);
  tree = render(props());
  find(tree, (node) => node.type === "button" && node.props.children === "ล้าง").props.onClick();
  assert.deepEqual([...value], []);
  tree = render(props());
  assert(nodes(tree).some((node) => node.props?.children === "ยังไม่ได้เลือก"));
});

test("booking export retains selections across modal closing and sends exact filter parameters", () => {
  const requests: any[] = [];
  const render = createComponent("features/documents/ManagementExportPanel.tsx", {
    "./useDocumentExport": { useDocumentExport: () => ({ busy: {}, errors: {}, clearError() {}, download: (request: any) => { requests.push(request); } }) },
  });
  let tree = render();
  find(tree, (node) => node.props?.text === "ตั้งค่าการส่งออก").props.onClick();
  tree = render();
  const modal = find(tree, (node) => node.props?.["aria-labelledby"] === "documents-export-title");
  assert.equal(modal.props.open, true);
  assert.equal(nodes(tree).filter((node) => node.props?.id === "export-channels").length, 0);
  find(tree, (node) => node.props?.["aria-controls"] === "export-filters").props.onClick();
  tree = render();
  find(tree, (node) => node.props?.id === "export-channels").props.onToggle();
  tree = render();
  assert.equal(find(tree, (node) => node.props?.id === "export-channels").props.expanded, true);
  find(tree, (node) => node.props?.id === "export-channels").props.onChange(["BOOK"]);
  find(tree, (node) => node.props?.id === "export-statuses").props.onToggle();
  tree = render();
  assert.equal(find(tree, (node) => node.props?.id === "export-channels").props.expanded, false);
  assert.equal(find(tree, (node) => node.props?.id === "export-statuses").props.expanded, true);
  assert.deepEqual([...find(tree, (node) => node.props?.id === "export-channels").props.value], ["BOOK"]);
  find(tree, (node) => node.props?.id === "export-month").props.onChange("2026-08");
  modal.props.onClose();
  assert.equal(find(render(), (node) => node.props?.["aria-labelledby"] === "documents-export-title").props.open, false);
  find(render(), (node) => node.props?.text === "ตั้งค่าการส่งออก").props.onClick();
  tree = render();
  assert.equal(find(tree, (node) => node.props?.["aria-controls"] === "export-filters").props["aria-expanded"], false);
  find(tree, (node) => node.props?.["aria-controls"] === "export-filters").props.onClick();
  tree = render();
  assert.deepEqual([...find(tree, (node) => node.props?.id === "export-channels").props.value], ["BOOK"]);
  find(tree, (node) => node.props?.text === "ส่งออก Excel").props.onClick();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].endpoint, "getBookingsReport");
  assert.equal(requests[0].params.month, "2026-08");
  assert.equal(requests[0].params.bookingChannels, "BOOK");
  assert.equal(requests[0].params.filterVersion, "2");
  assert(!requests[0].params.bookingStatuses.split(",").includes("cancelled"));
  find(tree, (node) => node.props?.id === "export-categories").props.onChange([]);
  tree = render();
  const exportButton = find(tree, (node) => node.props?.text === "ส่งออก Excel");
  assert.equal(exportButton.props.disabled, true);
  exportButton.props.onClick();
  assert.equal(requests.length, 1);
  find(tree, (node) => node.type === "button" && node.props.children === "คืนค่าเริ่มต้น").props.onClick();
  tree = render();
  assert.equal(find(tree, (node) => node.props?.text === "ส่งออก Excel").props.disabled, false);
  assert(!find(tree, (node) => node.props?.id === "export-statuses").props.value.includes("cancelled"));
});
