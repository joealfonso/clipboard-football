// A7: no rule numbers in the machine's code. Every numeric literal in packages/sim/src/game
// must be 0 or 1, except in frame.ts, which holds the coordinate frame and nothing else.

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const gameDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../src/game");
const ALLOWED = new Set(["0", "1"]);
const FRAME_ONLY = "frame.ts";

function numericLiterals(text: string): string[] {
  const scanner = ts.createScanner(ts.ScriptTarget.ES2022, true, ts.LanguageVariant.Standard, text);
  const out: string[] = [];
  // Brace depth per open template expression, so `}` closing a `${...}` is rescanned as template text.
  const templates: number[] = [];
  for (let t = scanner.scan(); t !== ts.SyntaxKind.EndOfFileToken; t = scanner.scan()) {
    if (t === ts.SyntaxKind.NumericLiteral) out.push(scanner.getTokenText());
    if (t === ts.SyntaxKind.TemplateHead) templates.push(0);
    else if (t === ts.SyntaxKind.OpenBraceToken && templates.length > 0) templates[templates.length - 1]! += 1;
    else if (t === ts.SyntaxKind.CloseBraceToken && templates.length > 0) {
      if (templates[templates.length - 1] === 0) {
        if (scanner.reScanTemplateToken(false) === ts.SyntaxKind.TemplateTail) templates.pop();
      } else templates[templates.length - 1]! -= 1;
    }
  }
  return out;
}

describe("no rule-number literals in the machine (A7)", () => {
  const files = readdirSync(gameDir).filter((f) => f.endsWith(".ts") && f !== FRAME_ONLY);

  it("covers the machine's files", () => {
    expect(files).toEqual(expect.arrayContaining(["machine.ts", "resolve.ts", "enforce.ts", "progress.ts", "periods.ts"]));
  });

  it.each(files)("%s has only 0 and 1", (f) => {
    const bad = numericLiterals(readFileSync(join(gameDir, f), "utf8")).filter((n) => !ALLOWED.has(n));
    expect(bad).toEqual([]);
  });

  it("frame.ts holds only the frame: the field length and the halving divisor", () => {
    const nums = numericLiterals(readFileSync(join(gameDir, FRAME_ONLY), "utf8")).filter((n) => !ALLOWED.has(n));
    expect(nums.sort()).toEqual(["100", "2"]);
  });

  it("flags a banned literal", () => {
    expect(numericLiterals("const kick = 35; const q = `a${900}b${f({ x: 120 })}c`; const y = 25;").filter((n) => !ALLOWED.has(n))).toEqual(["35", "900", "120", "25"]);
  });
});
