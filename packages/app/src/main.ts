// Entry point: checks the browser can run the game, then starts the app.

import "./styles.css";
import { App } from "./ui/app";

function missingFeatures(): string[] {
  const missing: string[] = [];
  if (typeof Worker === "undefined") missing.push("Web Workers");
  const c = document.createElement("canvas");
  if (c.getContext("2d") === null) missing.push("Canvas 2D");
  const es2022 = typeof Array.prototype.at === "function" && typeof Object.hasOwn === "function" && typeof structuredClone === "function";
  if (!es2022) missing.push("a modern JavaScript engine (ES2022)");
  return missing;
}

const missing = missingFeatures();
const byId = (id: string): HTMLElement => {
  const el = document.getElementById(id);
  if (el === null) throw new Error(`index.html has no #${id}`);
  return el;
};

if (missing.length > 0) {
  // In the main menu under the wordmark (the first paint), never in the hidden game panel.
  const lead = byId("main-menu").querySelector(".menu-lead");
  const p = document.createElement("p");
  p.className = "menu-lead";
  p.textContent = "This browser can't run Clipboard Football.";
  const needs = document.createElement("p");
  needs.className = "soft";
  needs.textContent = `It needs ${missing.join(", ")}.`;
  lead?.replaceWith(p, needs);
} else {
  new App({ topBar: byId("top-bar"), panel: byId("panel"), canvas: byId("field") as HTMLCanvasElement, live: byId("live"), small: byId("too-small"), markCard: byId("mark-card"), main: byId("layout"), menu: byId("main-menu"), rail: byId("play-rail") });
}
