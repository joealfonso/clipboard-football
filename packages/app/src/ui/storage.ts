// Settings (localStorage), the autosave (IndexedDB) and the local playtest log. Nothing leaves the
// browser. Every call tolerates blocked storage (private windows, denied permission): the game
// plays and the status line says it can't be saved.

import type { MarkLabelSetting, MotionSetting, SpeedSetting, TextSize } from "./screens";

export interface Settings {
  textSize: TextSize;
  reducedMotion: MotionSetting;
  markLabels: MarkLabelSetting;
  speed: SpeedSetting;
}

const SETTINGS_KEY = "clipboard-football.settings";
const LOG_KEY = "clipboard-football.log";
export const DEFAULT_SETTINGS: Settings = { textSize: 100, reducedMotion: "system", markLabels: "involved", speed: "1x" };

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw === null) return { ...DEFAULT_SETTINGS };
    const v = JSON.parse(raw) as Partial<Settings>;
    return {
      textSize: [100, 125, 150, 200].includes(v.textSize as number) ? (v.textSize as TextSize) : DEFAULT_SETTINGS.textSize,
      reducedMotion: v.reducedMotion === "on" || v.reducedMotion === "off" ? v.reducedMotion : "system",
      markLabels: v.markLabels === "all" || v.markLabels === "none" ? v.markLabels : "involved",
      speed: v.speed === "2x" || v.speed === "skip" ? v.speed : "1x",
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    // Settings that can't be stored last for this page.
  }
}

// ---------------------------------------------------------------- autosave

const DB = "clipboard-football";
const STORE = "saves";
const KEY = "current";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB, 1);
    } catch (e) {
      reject(e as Error);
      return;
    }
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB failed to open"));
    req.onblocked = () => reject(new Error("IndexedDB is blocked"));
  });
}

async function tx<T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const r = f(t.objectStore(STORE));
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error ?? new Error("IndexedDB request failed"));
    });
  } finally {
    db.close();
  }
}

/** Whether this window can store a save at all. */
export async function storageAvailable(): Promise<boolean> {
  try {
    if (typeof indexedDB === "undefined") return false;
    await tx("readonly", (s) => s.count());
    return true;
  } catch {
    return false;
  }
}

export async function readSave(): Promise<unknown> {
  return tx("readonly", (s) => s.get(KEY));
}

export async function writeSave(save: unknown): Promise<void> {
  await tx("readwrite", (s) => s.put(save, KEY));
}

export async function deleteSave(): Promise<void> {
  await tx("readwrite", (s) => s.delete(KEY));
}

// ---------------------------------------------------------------- local playtest log

/** Counts for the gate playtest (design "How the gate is tested"); kept in this browser only. */
export interface PlayLog {
  gamesStarted: number;
  gamesFinished: number;
  detailsOpens: number;
  challenges: number;
  sameCalls: number;
  escBackOuts: number;
  /** Seconds from a request appearing to the answer, last 500. */
  deadBallSeconds: number[];
}

export function bumpLog(f: (l: PlayLog) => void): void {
  try {
    const raw = localStorage.getItem(LOG_KEY);
    const l: PlayLog = raw === null ? { gamesStarted: 0, gamesFinished: 0, detailsOpens: 0, challenges: 0, sameCalls: 0, escBackOuts: 0, deadBallSeconds: [] } : (JSON.parse(raw) as PlayLog);
    f(l);
    if (l.deadBallSeconds.length > 500) l.deadBallSeconds = l.deadBallSeconds.slice(-500);
    localStorage.setItem(LOG_KEY, JSON.stringify(l));
  } catch {
    // The log is a convenience for the playtest; losing it never blocks play.
  }
}
