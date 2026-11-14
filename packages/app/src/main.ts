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
  const panel = byId("panel");
  panel.replaceChildren();
  const h1 = document.createElement("h1");
  h1.textContent = "This browser can't run Clipboard Football.";
  const p = document.createElement("p");
  p.textContent = `It needs ${missing.join(", ")}.`;
  panel.append(h1, p);
} else {
  new App({ topBar: byId("top-bar"), panel: byId("panel"), canvas: byId("field") as HTMLCanvasElement, live: byId("live"), small: byId("too-small") });
}
