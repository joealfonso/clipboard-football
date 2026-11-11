import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig([
  globalIgnores(["**/node_modules/", "pipeline/"]),
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    // Every random draw in the sim goes through the seeded Rng so games replay from a seed.
    files: ["packages/sim/**/*.ts"],
    rules: {
      "no-restricted-properties": [
        "error",
        {
          object: "Math",
          property: "random",
          message: "Use the seeded Rng passed into the sim. Math.random breaks replay.",
        },
      ],
      // no-restricted-properties only sees a bare `Math` object, so also catch
      // globalThis.Math.random and computed Math["random"].
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "MemberExpression:matches([property.name='random'], [property.value='random']):matches([object.name='Math'], [object.property.name='Math'], [object.property.value='Math'])",
          message: "Use the seeded Rng passed into the sim. Math.random breaks replay.",
        },
      ],
    },
  },
]);
