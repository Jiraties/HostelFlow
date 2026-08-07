import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const closeButtonStyles = () =>
  readFileSync("../frontend/src/components/ModalCloseButton.css", "utf8");
const appStyles = () => readFileSync("../frontend/src/App.css", "utf8");

test("mobile modal close button remains accessible while its body scrolls", () => {
  const styles = closeButtonStyles();

  assert.match(
    styles,
    /\.modalCloseButton\s*{[\s\S]*?position: sticky;[\s\S]*?top: 0\.75rem;[\s\S]*?align-self: flex-end;/,
  );
  assert.ok(styles.includes("margin-bottom: calc(-1 * var(--mobile-touch-target"));
});

test("mobile modals are flush on three sides with rounded top corners", () => {
  const styles = appStyles();

  assert.match(
    styles,
    /\.home__modalCenter\s*{[\s\S]*?padding: 0\.5rem 0 0;/,
  );
  assert.ok(styles.includes("border-radius: 1rem 1rem 0 0 !important"));
  assert.ok(
    styles.includes(
      "max-height: calc(100dvh - 0.5rem - env(safe-area-inset-top)) !important",
    ),
  );
});
