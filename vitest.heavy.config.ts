import { defineConfig } from "vitest/config";
import { HEAVY } from "./vitest.config";

export default defineConfig({
  test: {
    include: HEAVY,
    fileParallelism: false,
    testTimeout: 300_000,
    hookTimeout: 900_000,
  },
});
