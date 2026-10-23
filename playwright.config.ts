import { defineConfig } from "@playwright/test";

// Browser load budget only (`pnpm perf:load`); unit tests stay in Vitest.
export default defineConfig({
  testDir: "perf",
  timeout: 180_000,
  workers: 1,
  use: { browserName: "chromium", headless: true },
});
