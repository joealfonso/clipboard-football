// A tiny element builder: the panel is rebuilt from state on every change.

import { darkTier } from "./tokens";

type Child = Node | string | null | undefined | false;

export function h(tag: string, attrs: Readonly<Record<string, string | boolean | undefined>> = {}, ...children: Child[]): HTMLElement {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (v === true) el.setAttribute(k, "");
    else el.setAttribute(k, v);
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return el;
}

export function swatch(color: string): HTMLElement {
  // Dark-tier fills take the stronger inset ring (DESIGN.md hud.teamSwatch).
  const s = h("span", { class: darkTier(color) ? "swatch dark" : "swatch", "aria-hidden": "true" });
  s.style.background = color;
  return s;
}

/** A rating bar: the fill never carries the value alone, the number sits beside it. */
export function bar(label: string, value: number, fill: number): HTMLElement {
  const track = h("span", { class: "bar-track", "aria-hidden": "true" });
  const f = h("span", { class: "bar-fill" });
  f.style.width = `${Math.round(Math.max(0, Math.min(1, fill)) * 100)}%`;
  track.append(f);
  return h("div", { class: "bar" }, h("span", { class: "bar-label" }, label), track, h("span", { class: "bar-value mono" }, String(value)));
}
