// UI motion that survives a rebuild. The panel and the top bar are rebuilt from state on every
// change (dom.ts), often several times inside one 360 ms tick, so a CSS animation started on one
// build would restart or vanish on the next. A flight records when a change started and what it
// changed from; each build asks how far in it is and starts its animation that far in (a negative
// animation-delay). Pure, so the timing can be tested without a DOM.

export interface Flight<T> {
  /** Milliseconds since the change started. */
  readonly elapsed: number;
  readonly data: T;
}

export class Flights<T> {
  private readonly map = new Map<string, { readonly at: number; readonly data: T }>();

  start(key: string, data: T, now: number): void {
    this.map.set(key, { at: now, data });
  }

  /** The flight under `key` while it is younger than `ms`; null (and forgotten) once it is done. */
  get(key: string, ms: number, now: number): Flight<T> | null {
    const f = this.map.get(key);
    if (f === undefined) return null;
    const elapsed = now - f.at;
    if (elapsed >= ms || elapsed < 0) {
      this.map.delete(key);
      return null;
    }
    return { elapsed, data: f.data };
  }

  clear(): void {
    this.map.clear();
  }
}

/**
 * Adds an animation class and sets `prop` (default `--since`, 0ms in :root) to the flight's age;
 * styles.css subtracts it from the animation's delay, so a rebuilt element picks up where the last
 * one left off.
 */
export function resume(el: HTMLElement, cls: string, elapsed: number, prop = "--since"): HTMLElement {
  el.classList.add(cls);
  el.style.setProperty(prop, `${Math.round(elapsed)}ms`);
  return el;
}
