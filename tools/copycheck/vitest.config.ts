// Vitest config for the layout-from-data check only (yarn copycheck); see copycheck.cmp.ts.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    root: new URL("../..", import.meta.url).pathname,
    include: ["tools/copycheck/**/*.cmp.ts"],
    environment: "node",
    testTimeout: 30 * 60 * 1000,
    silent: false,
  },
});
