import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const children = new Set();
const useProcessGroups = process.platform !== "win32";
let stopping = false;
let forceStop;

const signalChild = (child, signal) => {
  if (!child.pid) return;
  try {
    if (useProcessGroups) process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch (error) {
    if (error.code !== "ESRCH") console.error("Could not stop a dev process:", error.code);
  }
};

const stop = (exitCode = 0) => {
  if (stopping) {
    for (const child of children) signalChild(child, "SIGKILL");
    return;
  }
  stopping = true;
  process.exitCode = exitCode;
  for (const child of children) signalChild(child, "SIGTERM");
  forceStop = setTimeout(() => {
    for (const child of children) signalChild(child, "SIGKILL");
  }, 5000);
  forceStop.unref();
};

process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());

console.log("Starting API and frontend. Press Ctrl+C to stop both.");
for (const [directory, command] of [["api", "dev"], ["frontend", "start"]]) {
  const child = spawn("pnpm", ["--dir", directory, command], {
    cwd: root,
    stdio: "inherit",
    detached: useProcessGroups,
  });
  children.add(child);
  child.on("error", (error) => {
    console.error(`Could not start ${directory}:`, error.code);
    stop(1);
  });
  child.on("close", (code) => {
    children.delete(child);
    if (!stopping) {
      console.error(`${directory} stopped; stopping the other dev server.`);
      stop(code || 1);
    }
    if (children.size === 0) clearTimeout(forceStop);
  });
}
