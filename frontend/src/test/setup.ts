import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Without Vitest globals, Testing Library can't register its own cleanup: do it here so every
// test starts with an empty document.
afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
  window.localStorage.clear();
});
