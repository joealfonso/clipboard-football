// Action refs must be tags that exist. These were checked against the GitHub API on
// 2026-11-11: the floating majors below exist, but astral-sh/setup-uv stopped publishing
// floating majors after v7, so it must be pinned to a full release tag.

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workflow = readFileSync(join(root, ".github", "workflows", "ci.yml"), "utf8");
const refs = [...workflow.matchAll(/uses:\s*([^\s@]+)@(\S+)/g)].map((m) => ({
  action: m[1] ?? "",
  ref: m[2] ?? "",
}));

const VERIFIED_FLOATING: Record<string, string> = {
  "actions/checkout": "v7",
  "actions/setup-node": "v7",
  "pnpm/action-setup": "v6",
  "gitleaks/gitleaks-action": "v3",
};
const FULL_TAG_ONLY = new Set(["astral-sh/setup-uv"]);

describe("CI action refs", () => {
  it("finds the actions in the workflow", () => {
    expect(refs.length).toBeGreaterThan(0);
  });

  it.each(refs)("$action@$ref is a verified tag", ({ action, ref }) => {
    if (FULL_TAG_ONLY.has(action)) {
      expect(ref).toMatch(/^v\d+\.\d+\.\d+$/);
    } else {
      expect(VERIFIED_FLOATING[action]).toBe(ref);
    }
  });
});
