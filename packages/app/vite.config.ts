import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { defineConfig } from "vite";

const repo = resolve(import.meta.dirname, "../..");

/**
 * sha256 over the sim and shared sources (path and bytes, sorted), baked into the build as
 * __SIM_CODE_HASH__. A save records it, so a build whose engine code changed doesn't silently
 * replay an old answer log into a different game. The dev server computes it once at start.
 */
export function simCodeHash(root = repo): string {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const n of readdirSync(dir).sort()) {
      const p = join(dir, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith(".ts")) files.push(p);
    }
  };
  walk(join(root, "packages/sim/src"));
  walk(join(root, "packages/shared/src"));
  const h = createHash("sha256");
  for (const f of files) h.update(relative(root, f)).update("\0").update(readFileSync(f)).update("\0");
  return h.digest("hex");
}

// The game's data files live in the repo's data/ folder; the worker imports them with `?url`
// and fetches each one, so the loading screen can show progress per file.
export default defineConfig({
  server: { fs: { allow: ["../.."] } },
  worker: { format: "es" },
  build: { target: "es2022" },
  define: { __SIM_CODE_HASH__: JSON.stringify(simCodeHash()) },
});
