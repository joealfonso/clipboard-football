// A9 and D7: the sim imports only its own files and the type-only part of shared, never
// zod or the shared schema, and the caller files sit under the existing purity rules.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const simSrc = resolve(dirname(fileURLToPath(import.meta.url)), "../src");
const repoRoot = resolve(simSrc, "../../..");
const sharedSrc = join(repoRoot, "packages/shared/src");
const ALLOWED_SHARED = new Set(["types.ts", "situation.ts", "catalog.ts", "caller.ts"]);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith(".ts") ? [p] : [];
  });
}

function importsOf(file: string): string[] {
  return ts.preProcessFile(readFileSync(file, "utf8"), true, true).importedFiles.map((f) => f.fileName);
}

function resolveImport(from: string, spec: string): string {
  const base = resolve(dirname(from), spec);
  return base.endsWith(".ts") ? base : `${base}.ts`;
}

describe("sim imports", () => {
  const files = walk(simSrc);

  it("includes the caller files", () => {
    expect(files.map((f) => relative(simSrc, f))).toEqual(expect.arrayContaining(["caller/offense.ts", "caller/defense.ts", "caller/bins.ts"]));
  });

  it("every import is relative and stays in sim/src or the type-only shared files, transitively", () => {
    const seen = new Set<string>();
    const stack = [...files];
    const bad: string[] = [];
    while (stack.length) {
      const f = stack.pop() as string;
      if (seen.has(f)) continue;
      seen.add(f);
      for (const spec of importsOf(f)) {
        if (!spec.startsWith(".")) {
          bad.push(`${relative(repoRoot, f)} imports package ${spec}`);
          continue;
        }
        const target = resolveImport(f, spec);
        const inSim = target.startsWith(simSrc + "/");
        const inShared = dirname(target) === sharedSrc && ALLOWED_SHARED.has(target.slice(sharedSrc.length + 1));
        if (!inSim && !inShared) bad.push(`${relative(repoRoot, f)} imports ${relative(repoRoot, target)}`);
        else stack.push(target);
      }
    }
    expect(bad).toEqual([]);
  });

  it("no sim source mentions zod", () => {
    for (const f of files) expect(readFileSync(f, "utf8"), f).not.toMatch(/\bzod\b/);
  });

  it("flags an import of zod or the shared schema", () => {
    const fake = join(simSrc, "caller", "fake.ts");
    for (const spec of ["zod", "../../../shared/src/schema"]) {
      const target = spec.startsWith(".") ? resolveImport(fake, spec) : spec;
      const ok = spec.startsWith(".") && dirname(target) === sharedSrc && ALLOWED_SHARED.has(target.slice(sharedSrc.length + 1));
      expect(ok, spec).toBe(false);
    }
  });

  it("lint bans Math.random in a caller file", async () => {
    const eslint = new ESLint({ cwd: repoRoot });
    const [result] = await eslint.lintText("export const r = (): number => Math.random();\n", {
      filePath: join(simSrc, "caller", "uses-random.ts"),
    });
    expect(result?.errorCount).toBeGreaterThan(0);
  });
});
