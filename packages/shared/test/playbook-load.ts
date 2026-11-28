// Loads the playbook files (data/plays) and what they are checked against, for the playbook
// tests here and in packages/sim. Validation goes through the shared zod schemas, in tests only.

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { DefenseDesign, OffenseDesign, Playbook, PlaybookRefs } from "../src/playbook";
import { parsePlaybook } from "../src/playbook-schema";

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

export function readJson<T = unknown>(path: string): T {
  return JSON.parse(readFileSync(join(repoRoot, path), "utf8")) as T;
}

type Json = Record<string, unknown>;
/** The raw files as plain JSON, loosely typed so a test can break one on purpose. */
export interface RawPlaybook {
  alignments: { offense: Record<string, Json>; defense: Record<string, Json>; presetAlignment: Record<string, Json> };
  library: { assignments: Record<string, Json> };
  offense: { designs: (Json & { id: string; assignments: Json })[] };
  defense: { designs: (Json & { id: string; assignments: Json })[] };
  config: Json;
}

/** A fresh copy of the five files on every call. */
export function rawPlaybook(): RawPlaybook {
  return {
    alignments: readJson("data/plays/alignments.json"),
    library: readJson("data/plays/library.json"),
    offense: readJson("data/plays/offense.json"),
    defense: readJson("data/plays/defense.json"),
    config: readJson("data/plays/config.json"),
  };
}

interface CallerConfigBits {
  offenseMapping: { depth: { shortBelow: number; deepFrom: number } };
  defenseMapping: { boxHeavyMin: number; presets: PlaybookRefs["presets"] };
}

export function playbookRefs(): PlaybookRefs {
  const caller = readJson<CallerConfigBits>("data/caller/config.json");
  return {
    personnel: readJson<PlaybookRefs["personnel"]>("data/engine/personnel.json"),
    presets: caller.defenseMapping.presets,
    boxHeavyMin: caller.defenseMapping.boxHeavyMin,
    depthEdges: caller.offenseMapping.depth,
  };
}

let cached: Playbook | undefined;
export function loadPlaybook(): Playbook {
  cached ??= parsePlaybook(rawPlaybook(), playbookRefs());
  return cached;
}

const list = (name: string, items: readonly string[]): string => `${name} ${items.length === 0 ? "none" : items.join(", ")}`;

/** The line docs/PLAYBOOK.md must hold for a design: label, id, description and every tag. */
export function designLine(d: OffenseDesign | DefenseDesign): string {
  const tags = [
    ..."depth" in d.tags && d.tags.depth !== undefined ? [`depth ${d.tags.depth}`] : [],
    `timing ${d.tags.timing}`,
    ..."pressure" in d.tags ? [`pressure ${d.tags.pressure}`] : [],
    list("situations", d.tags.situations),
    list("traits", d.traits),
  ];
  return `- **${d.label}** (\`${d.id}\`): ${d.description} Tags: ${tags.join("; ")}.${d.default ? " Default." : ""}`;
}

interface CatalogBits {
  screens: { id: string; choices: { id: string; label: string }[] }[];
}

/** Call ids to the labels the menus use (data/calls/catalog.json). */
export function callLabels(): Map<string, string> {
  return new Map(readJson<CatalogBits>("data/calls/catalog.json").screens.flatMap((s) => s.choices.map((c) => [c.id, c.label] as const)));
}

/** The group heading docs/PLAYBOOK.md uses for a design. */
export function groupHeading(d: OffenseDesign | DefenseDesign, labels: ReadonlyMap<string, string>): string {
  return "formation" in d ? `${labels.get(d.formation) ?? d.formation}: ${labels.get(d.concept) ?? d.concept}` : (labels.get(d.coverage) ?? d.coverage);
}
