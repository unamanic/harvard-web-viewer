import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// `base: "./"` keeps asset URLs relative so the build works under any
// GitHub Pages path (e.g. https://<user>.github.io/<repo>/).
export default defineConfig({
  base: "./",
  plugins: [react()],
  test: { environment: "node" },
});
