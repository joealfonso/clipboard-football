// E3: CI reads the committed validation summary and fails if it records a gated failure,
// so a failing caller cannot look green. Accepted misses count only when
// data/caller/tolerances.json lists them with approved_by "Joseph".

import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bytes = (p: string): Buffer => readFileSync(join(root, p));
const json = <T>(p: string): T => JSON.parse(bytes(p).toString("utf8")) as T;

interface Summary {
  configHash: string;
  tolerancesHash: string;
  codeHash: string;
  fileHashes: Record<string, string>;
  passed: boolean;
  gatedFailures: string[];
  metrics: { id: string; status: string; n: number; minN: number; predicted: number; actual: number; tolerance: number }[];
}
interface Tolerances {
  known_deviations: { metric: string; approved_by?: string | null }[];
}

// Same as pipeline/caller/config.py: sha256 over each file's bytes followed by a NUL.
function sha(...parts: Buffer[]): string {
  const h = createHash("sha256");
  for (const p of parts) {
    h.update(p);
    h.update(Buffer.from([0]));
  }
  return h.digest("hex");
}

describe("committed validation summary", () => {
  const summary = json<Summary>("data/caller/validation.json");
  const tolerances = json<Tolerances>("data/caller/tolerances.json");
  const approved = new Set(tolerances.known_deviations.filter((d) => d.approved_by === "Joseph").map((d) => d.metric));

  it("was produced from the committed config, catalog and tolerances", () => {
    expect(summary.configHash).toBe(sha(bytes("data/calls/catalog.json"), bytes("data/caller/config.json")));
    expect(summary.tolerancesHash).toBe(sha(bytes("data/caller/tolerances.json")));
  });

  it("validated exactly the committed tables and golden file", () => {
    const names = ["defense.table.json", "golden.json", "offense.table.json"];
    expect(Object.keys(summary.fileHashes ?? {}).sort()).toEqual(names);
    for (const name of names) {
      const actual = createHash("sha256").update(bytes(`data/caller/${name}`)).digest("hex");
      expect(summary.fileHashes[name], name).toBe(actual);
    }
  });

  it("was produced by the committed pipeline/caller code", () => {
    // Same as pipeline/caller/config.py code_hash: *.py sorted by name, name then bytes.
    const dir = "pipeline/caller";
    const files = readdirSync(join(root, dir)).filter((f) => f.endsWith(".py")).sort();
    expect(files.length).toBeGreaterThan(0);
    expect(summary.codeHash).toBe(sha(...files.flatMap((f) => [Buffer.from(f), bytes(`${dir}/${f}`)])));
  });

  it("statuses agree with the numbers", () => {
    for (const m of summary.metrics) {
      if (m.n < m.minN) {
        expect(m.status, m.id).toBe("not gated");
        continue;
      }
      const within = Math.abs(m.predicted - m.actual) * 100 <= m.tolerance + 1e-6;
      expect(m.status, m.id).toBe(within ? "pass" : approved.has(m.id) ? "accepted" : "fail");
    }
  });

  it("records no gated failure", () => {
    const failing = summary.metrics.filter((m) => m.status === "fail").map((m) => m.id);
    expect(failing).toEqual([]);
    expect(summary.gatedFailures).toEqual([]);
    expect(summary.passed).toBe(true);
  });
});
