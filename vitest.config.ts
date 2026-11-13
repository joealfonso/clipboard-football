import { defineConfig } from "vitest/config";

// Heavy files (*.heavy.test.ts: the 2 x 10,000-game home-field check and the 1,000-game
// calibration slice) run in their own project, vitest.heavy.config.ts, without file
// parallelism (`pnpm test:heavy`, its own CI job), so the default run stays parallel and fast.
export const HEAVY = ["test/**/*.heavy.test.ts"];

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts", "test/**/*.test.ts"],
    exclude: ["**/node_modules/**", ...HEAVY],
  },
});
