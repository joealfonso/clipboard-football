// One-off capture of packages/app/test/pr-baseline.json (PR-C1). Run from the repo root:
//   node --import ./scripts/engine/register.mjs <this file> <out.json>
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const REPO = "/Users/josephalfonso/Documents/GitHub/FootballGame";
const { prDigest, prPlays } = await import(join(REPO, "packages/app/test/pr-digest.ts"));
const FILES = ["packages/app/src/ui/timeline.ts", "packages/app/src/ui/motion.ts", "packages/app/src/ui/natural.ts", "packages/app/src/ui/templates.ts", "data/ui/motion.json", "data/ui/templates.json", "data/engine/personnel.json"];
const shaAll = (): Record<string, string> => Object.fromEntries(FILES.map((f) => [f, createHash("sha256").update(readFileSync(join(REPO, f))).digest("hex")]));
const git = (c: string): string => execSync(`git -C ${REPO} ${c}`, { encoding: "utf8" }).trimEnd();

const before = shaAll();
const t0 = Date.now();
const d = prDigest();
const ms = Date.now() - t0;
const after = shaAll();
if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error("a source file changed during the capture");
const again = prDigest({ only: (p: { source: string }) => p.source === "fixtures" });
for (const [k, v] of Object.entries(again.noRatings)) if (d.noRatings[k] !== v) throw new Error(`not repeatable: ${k}`);

const plays = prPlays() as { name: string; source: string; cls: string; event: { play: { kind: string } } }[];
const count = (f: (p: (typeof plays)[number]) => boolean): number => plays.filter(f).length;
const byKind: Record<string, number> = {};
for (const p of plays) byKind[p.event.play.kind] = (byKind[p.event.play.kind] ?? 0) + 1;
const status = git("status --porcelain --untracked-files=no").split("\n").filter((l) => l !== "");
const meta = {
  what: "PR-C1 baseline (docs/specs/m2-player-reactions.md): one digest per play from packages/app/test/pr-digest.ts, captured before the player-reactions build. Recaptured only by a person who has checked a change was intended.",
  capturedOn: "2026-11-23",
  gitHead: git("rev-parse HEAD"),
  gitBranch: git("rev-parse --abbrev-ref HEAD"),
  treeDirty: status.length > 0,
  treeNote: "Captured from the working tree, not from the commit: tracked files had uncommitted changes from other sessions. The sha256 values below say what the drawing code and data were.",
  modifiedTrackedFiles: status.map((l) => l.slice(3)),
  sha256: after,
  node: process.version,
  digest: "sha256 of JSON.stringify({ marks: [side:slot, keys] sorted by side:slot, ball, scale: ballScale, paths, liveEnd, total }), first 16 hex characters",
  built: "timeline({ event, runoffSeconds: 0, human: null, ownStart: 'lined' }, templates, { presetPackage, endZoneYards: 10, numbers: {}, pxPerYard: 9.26, markPx: 14, motion })",
  counts: {
    timelinesPerSection: plays.length,
    fixtures: count((p) => p.source === "fixtures"),
    simPlays: count((p) => p.source !== "fixtures"),
    scrimmage: count((p) => p.cls === "scrimmage"),
    kick: count((p) => p.cls === "kick"),
    dead: count((p) => p.cls === "dead"),
    fixturesByClass: { scrimmage: count((p) => p.source === "fixtures" && p.cls === "scrimmage"), kick: count((p) => p.source === "fixtures" && p.cls === "kick"), dead: count((p) => p.source === "fixtures" && p.cls === "dead") },
    simByClass: { scrimmage: count((p) => p.source !== "fixtures" && p.cls === "scrimmage"), kick: count((p) => p.source !== "fixtures" && p.cls === "kick"), dead: count((p) => p.source !== "fixtures" && p.cls === "dead") },
    byKind,
  },
};
const doc = {
  meta,
  inputs: { about: "A hash of what each source was drawn from (its play events and its rating table), not of a drawing. If one differs, the sim or a fixture changed and the digests below can't judge the drawing.", hashes: d.inputs },
  noRatings: { about: "Every play drawn with no ctx.ratings. PR1 and PR-C1: every one of these stays equal.", digests: d.noRatings },
  withRatings: {
    about: "RECORD OF THE BEHAVIOR BEFORE THE BUILD. Every play drawn with the ratings the app passes (speed, agility, awareness per player id, as app.ts motionRatings(); the fixtures use the fixed table prFixtureRatings()). PR2 and PR-C1 hold only the kick plays equal (kickoff, onsideKick, punt, fieldGoal, extraPoint). The scrimmage plays are meant to change: they are kept for before and after counts, not asserted.",
    digests: d.withRatings,
  },
};
writeFileSync(process.argv[2] as string, JSON.stringify(doc, null, 1) + "\n");
console.log(JSON.stringify(meta, null, 1));
console.log("capture ms", ms);
