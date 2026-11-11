// Checks from docs/specs/m1-step1-scaffold-and-data-survey.md on repo wiring that the
// sim's guarantees depend on (A10 via `pnpm typecheck`) and on the CI and Dependabot
// files (B1, B4, B5). These read config text only; the real B1 to B3 checks run on GitHub.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (p: string): string => readFileSync(join(repoRoot, p), "utf8");

describe("root scripts", () => {
  const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };

  it("defines test, lint and typecheck", () => {
    for (const name of ["test", "lint", "typecheck"]) {
      expect(pkg.scripts[name], name).toBeTruthy();
    }
  });

  it("typechecks packages/sim with its own DOM-free tsconfig (A10)", () => {
    // `tsc -p packages/sim` and not only the test config, which allows Node types.
    expect(pkg.scripts["typecheck"]).toMatch(/tsc -p packages\/sim(?:\/tsconfig\.json)?(?:\s|&|$)/);
  });
});

describe("CI workflow", () => {
  const ci = read(".github/workflows/ci.yml");

  it("runs on push and pull_request (B1)", () => {
    expect(ci).toMatch(/^on:\s*\n(?:\s+.*\n)*?\s+pull_request:/m);
    expect(ci).toMatch(/^on:\s*\n(?:\s+.*\n)*?\s+push:/m);
  });

  it("has lint, typecheck, test, pipeline pytest and gitleaks steps (B1)", () => {
    expect(ci).toMatch(/pnpm lint/);
    expect(ci).toMatch(/pnpm typecheck/);
    expect(ci).toMatch(/pnpm test/);
    expect(ci).toMatch(/uv run[^\n]*pytest pipeline/);
    expect(ci).toMatch(/gitleaks/);
  });

  it("never runs the nflverse inventory (B4)", () => {
    expect(ci).not.toMatch(/pipeline\.inventory/);
    expect(ci).not.toMatch(/nflreadpy\.load/);
  });

  it("has no deploy, release or publish step (non-goal)", () => {
    expect(ci).not.toMatch(/\b(deploy|publish|release)\b/i);
  });
});

describe("Dependabot", () => {
  it("lists npm at the root and a Python ecosystem for pipeline/ (B5)", () => {
    const path = ".github/dependabot.yml";
    expect(existsSync(join(repoRoot, path))).toBe(true);
    const text = read(path);
    expect(text).toMatch(/^version:\s*2\s*$/m);
    const entries = text.split(/\n\s*-\s+package-ecosystem:/).slice(1);
    const parsed = entries.map((e) => ({
      ecosystem: /^\s*"?([\w-]+)"?/.exec(e)?.[1],
      directory: /directory:\s*"?([^"\n]+)"?/.exec(e)?.[1]?.trim(),
      hasSchedule: /schedule:\s*\n\s+interval:/.test(e),
    }));
    expect(parsed).toContainEqual({ ecosystem: "npm", directory: "/", hasSchedule: true });
    const py = parsed.find((p) => p.directory === "/pipeline");
    expect(py?.ecosystem).toMatch(/^(uv|pip)$/);
    expect(py?.hasSchedule).toBe(true);
  });
});
