// The UI thread never loads the sim or zod: only the worker does. A value import of either
// package root from a UI-thread file would pull them into the main bundle (the shared root also
// exports the zod schemas). Type-only imports are erased and are fine.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const src = join(import.meta.dirname, "../src");
const WORKER_ONLY = new Set(["engine/worker.ts", "engine/session.ts", "engine/data.ts"]);

function uiThreadFiles(): string[] {
  const out: string[] = [];
  for (const dir of ["", "ui", "engine"]) for (const n of readdirSync(join(src, dir))) if (n.endsWith(".ts") && !WORKER_ONLY.has(dir === "" ? n : `${dir}/${n}`)) out.push(dir === "" ? n : `${dir}/${n}`);
  return out;
}

describe("UI-thread bundle", () => {
  it.each(uiThreadFiles())("%s imports no value from the sim or the shared package root", (f) => {
    const text = readFileSync(join(src, f), "utf8");
    const valueImports = [...text.matchAll(/^import\s+(?!type\b)[^;]*?from\s+"(@clipboard-football\/(?:sim|shared))";/gms)].map((m) => m[1]);
    expect(valueImports).toEqual([]);
  });
});
