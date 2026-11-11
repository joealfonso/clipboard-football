// Guards for the rules that keep the sim pure: no Math.random, no DOM, no runtime deps.

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const simDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(simDir, "../..");

describe("Math.random ban", () => {
  it.each([
    "export const roll = (): number => Math.random();",
    "export const roll = (): number => globalThis.Math.random();",
    'export const roll = (): number => Math["random"]();',
    'export const roll = (): number => globalThis["Math"].random();',
    "const { random } = Math;\nexport const roll = (): number => random();",
    "export const r = Math.random;",
  ])("fails lint in sim source: %s", async (code) => {
    const eslint = new ESLint({ cwd: repoRoot });
    const [result] = await eslint.lintText(`${code}\n`, {
      filePath: join(simDir, "src", "uses-math-random.ts"),
    });
    const ruleIds = result?.messages.map((m) => m.ruleId) ?? [];
    expect(
      ruleIds.some((id) => id === "no-restricted-properties" || id === "no-restricted-syntax"),
    ).toBe(true);
  });

  it("does not flag other Math members or a seeded rng.random()", async () => {
    const eslint = new ESLint({ cwd: repoRoot });
    const [result] = await eslint.lintText(
      "export const f = (rng: { random(): number }): number => Math.floor(rng.random());\n",
      { filePath: join(simDir, "src", "ok.ts") },
    );
    expect(result?.errorCount).toBe(0);
  });

  it("passes lint for the same code outside packages/sim", async () => {
    const eslint = new ESLint({ cwd: repoRoot });
    const [result] = await eslint.lintText("export const roll = (): number => Math.random();\n", {
      filePath: join(repoRoot, "packages", "shared", "src", "uses-math-random.ts"),
    });
    expect(result?.errorCount).toBe(0);
  });
});

describe("no DOM in the sim", () => {
  const configPath = join(simDir, "tsconfig.json");
  const parsed = ts.parseJsonConfigFileContent(
    ts.readConfigFile(configPath, (p) => ts.sys.readFile(p)).config,
    ts.sys,
    simDir,
  );

  it("has no DOM lib and no ambient types", () => {
    const libs = (parsed.options.lib ?? []).map((l) => l.toLowerCase());
    expect(libs.some((l) => l.includes("dom"))).toBe(false);
    expect(libs.length).toBeGreaterThan(0);
    expect(parsed.options.types).toEqual([]);
  });

  it("typechecks the real sim sources cleanly", () => {
    const program = ts.createProgram(parsed.fileNames, parsed.options);
    expect(ts.getPreEmitDiagnostics(program).map((d) => d.messageText)).toEqual([]);
  });

  it("rejects a sim source file that references window or document", () => {
    const fixturePath = join(simDir, "src", "uses-dom.ts");
    const fixtureText = "export const w = window;\nexport const d = document;\n";
    const host = ts.createCompilerHost(parsed.options);
    const readFile = host.readFile.bind(host);
    const fileExists = host.fileExists.bind(host);
    const getSourceFile = host.getSourceFile.bind(host);
    host.readFile = (p) => (p === fixturePath ? fixtureText : readFile(p));
    host.fileExists = (p) => p === fixturePath || fileExists(p);
    host.getSourceFile = (p, lang, onError, create) =>
      p === fixturePath
        ? ts.createSourceFile(p, fixtureText, lang)
        : getSourceFile(p, lang, onError, create);

    const program = ts.createProgram([...parsed.fileNames, fixturePath], parsed.options, host);
    const names = ts
      .getPreEmitDiagnostics(program)
      .filter((d) => d.file?.fileName === fixturePath)
      .map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"));
    expect(names.some((m) => m.includes("'window'"))).toBe(true);
    expect(names.some((m) => m.includes("'document'"))).toBe(true);
  });
});

describe("sim package manifest", () => {
  it("has no runtime dependencies", () => {
    const pkg = JSON.parse(readFileSync(join(simDir, "package.json"), "utf8")) as Record<
      string,
      unknown
    >;
    expect(pkg["dependencies"] ?? {}).toEqual({});
  });
});
