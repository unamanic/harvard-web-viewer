// Vitest config for the reference comparison only (yarn compare). The main
// suite (yarn test, vite.config.ts) never runs it: its file is compare.cmp.ts,
// which vitest's default *.test.ts / *.spec.ts pattern does not match.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    root: new URL("../..", import.meta.url).pathname,
    include: ["tools/compare/**/*.cmp.ts"],
    environment: "node",
    testTimeout: 30 * 60 * 1000,
    silent: false,
  },
});
