import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "@playwright/test";

// Browser suites against the built console and a mocked API: `perf/` holds the
// load budget (`pnpm perf:load`), `e2e/` the UI scenarios (`pnpm e2e`). Unit
// tests stay in Vitest. Workers inherit the environment, so every process of
// one run shares one per-run artifact directory outside the repository.
process.env.TENKAI_CONSOLE_PW_OUT ??= join(
  tmpdir(),
  `tenkai-console-pw-${process.pid}-${randomUUID().slice(0, 8)}`,
);

export default defineConfig({
  testDir: ".",
  testMatch: ["perf/**/*.spec.ts", "e2e/**/*.spec.ts"],
  outputDir: process.env.TENKAI_CONSOLE_PW_OUT,
  timeout: 180_000,
  workers: 1,
  use: { browserName: "chromium", headless: true },
});
