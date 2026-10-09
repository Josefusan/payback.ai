import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// L4 (T-L4-001): the dashboard builds against IF-01 fixtures until G2 flips it to the live Worker.
// The dev proxy lets the same code talk to `wrangler dev` (:8787) later without a rebuild.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://localhost:8787", changeOrigin: true },
      "/webhooks": { target: "http://localhost:8787", changeOrigin: true },
    },
    // Fixtures live outside this app: packages/contracts/fixtures/*.json (IF-01, T-INT-002).
    fs: { allow: ["..", "../.."] },
  },
  build: { outDir: "dist", sourcemap: true },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    // Renders one AG Grid per account (and one for the P&L), and AG Grid does real layout work in jsdom:
    // a single grid mount measures 1.4-3.4s here. The 5s default left almost no headroom, so those two
    // tests failed intermittently under parallel load — a timeout, never a wrong assertion. 20s is a
    // ceiling for a genuinely slow renderer, not a licence to write slow tests.
    testTimeout: 20000,
    css: false,
    restoreMocks: true,
  },
});
