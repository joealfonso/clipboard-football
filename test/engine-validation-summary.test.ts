// F3: CI reads the committed engine validation summary and recomputes every status from its
// numbers, and checks it was produced from the committed tolerances, config, tables and code.
// A gated failure keeps CI red until Joseph decides (known_deviations, approved_by "Joseph").

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bytes = (p: string): Buffer => readFileSync(join(root, p));
const json = <T>(p: string): T => JSON.parse(bytes(p).toString("utf8")) as T;

interface Row {
  id: string;
  status: string;
  n: number;
  minN: number;
  predicted: number | null;
  actual: number | null;
  tolerance: number;
  unit: "pp" | "yd";
  kind: string;
}
interface Summary {
  configHash: string;
  matchupHash: string;
  tolerancesHash: string;
  codeHash: string;
  fileHashes: Record<string, string>;
  passed: boolean;
  gatedFailures: string[];
  metrics: Row[];
  inSample: { metrics: Row[] };
}

// Same as pipeline/engine/config.py sha: each part's bytes followed by a NUL.
function sha(...parts: Buffer[]): string {
  const h = createHash("sha256");
  for (const p of parts) {
    h.update(p);
    h.update(Buffer.from([0]));
  }
  return h.digest("hex");
}

// The import graph of the validation, the same walk as pipeline/engine/config.py code_files.
const TS_IMPORT = /(?:import|export)\s[^;]*?from\s*"(\.{1,2}\/[^"]+)"|import\s*"(\.{1,2}\/[^"]+)"/g;
const PY_IMPORT = /^\s*from\s+(pipeline[\w.]*)\s+import\s+(\([^)]*\)|[^\n]+)|^\s*import\s+(pipeline[\w.]*)/gm;

function pyModule(mod: string): string[] {
  const base = mod.split(".").join("/");
  if (existsSync(join(root, base)) && statSync(join(root, base)).isDirectory()) return existsSync(join(root, base, "__init__.py")) ? [`${base}/__init__.py`] : [];
  return existsSync(join(root, `${base}.py`)) ? [`${base}.py`] : [];
}

function codeFiles(): string[] {
  const seen = new Set<string>();
  const stack = ["scripts/engine/validate.ts", ...readdirSync(join(root, "scripts/engine")).filter((f) => f.endsWith(".mjs")).sort().map((f) => `scripts/engine/${f}`)];
  while (stack.length > 0) {
    const f = stack.pop() as string;
    if (seen.has(f)) continue;
    seen.add(f);
    if (!f.endsWith(".ts")) continue;
    for (const m of readFileSync(join(root, f), "utf8").matchAll(TS_IMPORT)) {
      const spec = (m[1] ?? m[2]) as string;
      let t = posix.normalize(posix.join(posix.dirname(f), spec));
      if (!/\.(ts|mjs|js)$/.test(t)) t = `${t}.ts`;
      stack.push(t);
    }
  }
  const pstack = readdirSync(join(root, "pipeline/engine")).filter((f) => f.endsWith(".py")).sort().map((f) => `pipeline/engine/${f}`);
  while (pstack.length > 0) {
    const f = pstack.pop() as string;
    if (seen.has(f)) continue;
    seen.add(f);
    for (const m of readFileSync(join(root, f), "utf8").matchAll(PY_IMPORT)) {
      if (m[3] !== undefined) {
        pstack.push(...pyModule(m[3]));
        continue;
      }
      const mod = m[1] as string;
      pstack.push(...pyModule(mod));
      for (const name of ((m[2] as string).split("#")[0] ?? "").match(/\w+/g) ?? []) {
        const sub = `${mod}.${name}`;
        const path = sub.split(".").join("/");
        if (existsSync(join(root, `${path}.py`)) || (existsSync(join(root, path)) && statSync(join(root, path)).isDirectory())) pstack.push(...pyModule(sub));
      }
    }
  }
  return [...seen].sort();
}

function codeHash(override: Record<string, Buffer> = {}): string {
  return sha(...codeFiles().flatMap((f) => [Buffer.from(f), override[f] ?? bytes(f)]));
}

const summary = json<Summary>("data/engine/validation.json");
const tolerances = json<{ known_deviations: { metric: string; approved_by?: string }[] }>("data/engine/tolerances.json");
const approved = new Set(tolerances.known_deviations.filter((d) => d.approved_by === "Joseph").map((d) => d.metric));

function expected(m: Row): string {
  // Checks added after the tolerances were pre-registered are reported, never gated.
  if (m.kind.startsWith("check (no pre-registered tolerance")) return "not gated";
  if (m.n < m.minN) return "not gated";
  const d = ((m.predicted ?? 0) - (m.actual ?? 0)) * (m.unit === "pp" ? 100 : 1);
  if (Math.abs(d) <= m.tolerance + 1e-6) return "pass";
  return approved.has(m.id) ? "accepted" : "fail";
}

describe("committed engine validation summary", () => {
  it("was produced from the committed catalog, configs, matchup table, personnel and tolerances", () => {
    expect(summary.configHash).toBe(sha(bytes("data/calls/catalog.json"), bytes("data/caller/config.json"), bytes("data/engine/config.json")));
    expect(summary.matchupHash).toBe(sha(bytes("data/engine/matchup.json"), bytes("data/engine/personnel.json")));
    expect(summary.tolerancesHash).toBe(sha(bytes("data/engine/tolerances.json")));
  });

  it("validated exactly the committed generated and designed files", () => {
    expect(Object.keys(summary.fileHashes).length).toBeGreaterThan(10);
    for (const [path, hash] of Object.entries(summary.fileHashes)) {
      expect(createHash("sha256").update(bytes(path)).digest("hex"), path).toBe(hash);
    }
  });

  it("was produced by the committed code: every source in the validation's import graph", () => {
    expect(summary.codeHash).toBe(codeHash());
  });

  it("the code hash covers the caller, situation, RNG and schema code the validation imports", () => {
    const files = codeFiles();
    for (const f of [
      "packages/sim/src/caller/bins.ts",
      "packages/sim/src/caller/offense.ts",
      "packages/sim/src/caller/defense.ts",
      "packages/sim/src/game/situation.ts",
      "packages/sim/src/rng.ts",
      "packages/shared/src/engine-schema.ts",
      "packages/sim/src/engine/resolve.ts",
      "scripts/engine/validate.ts",
      "pipeline/caller/shares.py",
      "pipeline/caller/mapping.py",
      "pipeline/engine/center.py",
    ]) {
      expect(files, f).toContain(f);
    }
  });

  it("editing any of those sources, or the caller tables, makes this summary stale", () => {
    for (const f of ["packages/sim/src/caller/bins.ts", "packages/sim/src/rng.ts", "pipeline/caller/shares.py"]) {
      expect(codeHash({ [f]: Buffer.concat([bytes(f), Buffer.from("\n")]) }), f).not.toBe(summary.codeHash);
    }
    for (const f of ["data/caller/offense.table.json", "data/caller/defense.table.json", "data/calls/catalog.json", "data/caller/config.json"]) {
      const want = summary.fileHashes[f];
      expect(want, f).toBeDefined();
      expect(createHash("sha256").update(Buffer.concat([bytes(f), Buffer.from(" ")])).digest("hex"), f).not.toBe(want);
    }
  });

  it("statuses agree with the numbers", () => {
    for (const m of summary.metrics) expect(m.status, m.id).toBe(expected(m));
    expect(summary.gatedFailures.sort()).toEqual(summary.metrics.filter((m) => m.status === "fail").map((m) => m.id).sort());
  });

  it("records no gated failure", () => {
    expect(summary.metrics.filter((m) => m.status === "fail").map((m) => m.id)).toEqual([]);
    expect(summary.passed).toBe(true);
  });
});

describe("committed engine tables (D3, B10)", () => {
  it("the centered matchup table reproduces the baseline within 0.1 pp for every leaf", () => {
    const c = json<{ check: Record<string, { baseline: number[]; centered: number[] }> }>("data/engine/matchup.centered.json");
    for (const [leaf, ck] of Object.entries(c.check)) {
      ck.baseline.forEach((b, i) => expect(Math.abs(b - (ck.centered[i] as number)) * 100, `${leaf} ${i}`).toBeLessThanOrEqual(0.1));
    }
  });

  it("generated engine and player tables fit the 2 MB budget", () => {
    const files = ["data/engine/baseline.scrimmage.json", "data/engine/baseline.special.json", "data/engine/baseline.penalties.json", "data/engine/matchup.centered.json", "data/players/distributions.json"];
    expect(files.reduce((a, f) => a + statSync(join(root, f)).size, 0)).toBeLessThanOrEqual(2_000_000);
  });
});
