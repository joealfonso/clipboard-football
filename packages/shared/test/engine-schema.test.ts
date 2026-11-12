// A2 (player schema), E3 (why templates bind only to known trace fields) and the engine data
// files parsing through their schemas.

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { personnelSchema, playerSchema, ratingsSchema, whySchema } from "../src/engine-schema";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const json = (p: string): unknown => JSON.parse(readFileSync(join(root, p), "utf8"));

const good = {
  schemaVersion: 1,
  id: "p1",
  name: "Test Player",
  position: "QB",
  ratings: { speed: 60, strength: 50, agility: 70, awareness: 80 },
  skills: { throwPower: 75, accuracy: 70 },
};

describe("player schema (A2)", () => {
  it("accepts a valid player", () => {
    expect(playerSchema.safeParse(good).success).toBe(true);
  });

  it.each([
    ["a rating of 100", { ...good, ratings: { ...good.ratings, speed: 100 } }],
    ["a rating of -1", { ...good, ratings: { ...good.ratings, speed: -1 } }],
    ["a non-integer", { ...good, skills: { ...good.skills, accuracy: 70.5 } }],
    ["a missing base rating", { ...good, ratings: { speed: 60, strength: 50, agility: 70 } }],
    ["a skill not listed for the position", { ...good, skills: { ...good.skills, hands: 60 } }],
    ["a missing skill", { ...good, skills: { throwPower: 75 } }],
    ["an unknown schemaVersion", { ...good, schemaVersion: 2 }],
    ["an unknown position", { ...good, position: "XX" }],
  ])("rejects %s", (_label, bad) => {
    expect(playerSchema.safeParse(bad).success).toBe(false);
  });
});

describe("designed engine files parse", () => {
  it("personnel, ratings and why", () => {
    expect(() => personnelSchema.parse(json("data/engine/personnel.json"))).not.toThrow();
    expect(() => ratingsSchema.parse(json("data/players/ratings.json"))).not.toThrow();
    expect(() => whySchema.parse(json("data/engine/why.json"))).not.toThrow();
  });

  it("a rating effect on a rating the position does not have is rejected", () => {
    const r = json("data/players/ratings.json") as { effects: { inputs: { position: string; rating: string }[] }[] };
    const bad = structuredClone(r);
    (bad.effects[0] as { inputs: { position: string; rating: string }[] }).inputs[0] = { ...(bad.effects[0]?.inputs[0] as object), position: "K", rating: "passBlock" } as never;
    expect(ratingsSchema.safeParse(bad).success).toBe(false);
  });
});

describe("why templates (E3)", () => {
  const why = json("data/engine/why.json") as { templates: { id: string; text: string; factors: string[] }[] };

  it("rejects a slot that names an unknown trace field", () => {
    const bad = structuredClone(why);
    (bad.templates[0] as { text: string }).text = "Flag: {penalty.yardage}.";
    expect(whySchema.safeParse(bad).success).toBe(false);
  });

  it("rejects an unknown factor", () => {
    const bad = structuredClone(why);
    (bad.templates[0] as { factors: string[] }).factors = ["weather"];
    expect(whySchema.safeParse(bad).success).toBe(false);
  });
});
