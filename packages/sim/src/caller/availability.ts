// Availability rules from data/calls/catalog.json. A choice is available when its own rule
// holds and, unless its screen is a root, the choice that opens its screen is available too.

import type { Catalog, Rule, Situation } from "../../../shared/src/types";

export function evalRule(rule: Rule, situation: Situation): boolean {
  if ("all" in rule) return rule.all.every((r) => evalRule(r, situation));
  if ("any" in rule) return rule.any.some((r) => evalRule(r, situation));
  if ("not" in rule) return !evalRule(rule.not, situation);
  const actual = situation[rule.field];
  const expected = rule.value;
  switch (rule.op) {
    case "eq":
      return actual === expected;
    case "ne":
      return actual !== expected;
    case "lt":
      return actual < expected;
    case "lte":
      return actual <= expected;
    case "gt":
      return actual > expected;
    case "gte":
      return actual >= expected;
  }
}

export interface AvailabilityIndex {
  isAvailable(choiceId: string, situation: Situation): boolean;
  /** Choice ids in catalog order: screens in file order, choices by key. */
  readonly order: readonly string[];
}

export function indexCatalog(catalog: Catalog): AvailabilityIndex {
  const roots = new Set(catalog.roots);
  const choiceById = new Map<string, { rule: Rule | undefined; screen: string }>();
  const openerOf = new Map<string, string>();
  const order: string[] = [];
  for (const screen of catalog.screens) {
    for (const c of screen.choices) {
      choiceById.set(c.id, { rule: c.availableWhen, screen: screen.id });
      order.push(c.id);
      // The first opener in catalog order is the screen's parent for availability.
      if (c.opens !== undefined && !openerOf.has(c.opens)) openerOf.set(c.opens, c.id);
    }
  }
  const isAvailable = (choiceId: string, situation: Situation): boolean => {
    const entry = choiceById.get(choiceId);
    if (entry === undefined) throw new RangeError(`unknown choice ${choiceId}`);
    if (entry.rule !== undefined && !evalRule(entry.rule, situation)) return false;
    if (roots.has(entry.screen)) return true;
    const parent = openerOf.get(entry.screen);
    return parent === undefined ? true : isAvailable(parent, situation);
  };
  return { isAvailable, order };
}
