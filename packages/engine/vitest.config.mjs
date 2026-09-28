// Vitest settings. The slow tests (whole-pack compiles, every golden text,
// the ReDoS guard) also pass their own timeout; this is the floor for every
// test, so a busy CI runner does not fail a test at vitest's 5-second default.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
