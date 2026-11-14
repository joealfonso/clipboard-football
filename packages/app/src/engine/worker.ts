// The sim's Web Worker. Loads and checks the data, then hands every message to a Session. The UI
// thread never imports the sim; it only sees what this worker posts.

import { DataError, loadData } from "./data";
import type { FromWorker, ToWorker } from "./protocol";
import { DEFAULT_LEAGUE_SEED, Session, prepare, uiDataOf } from "./session";

// The app's tsconfig has the DOM lib, not WebWorker; these are the two worker members used.
const scope = self as unknown as { postMessage(m: FromWorker): void; onmessage: ((e: MessageEvent<ToWorker>) => void) | null };
const send = (m: FromWorker): void => scope.postMessage(m);

let session: Session | null = null;
const queue: ToWorker[] = [];

async function init(): Promise<void> {
  try {
    const loaded = await loadData((file, done, total) => send({ t: "progress", file, done, total }));
    const p = prepare(loaded.data, loaded.dataHash);
    session = new Session(p, send);
    send({ t: "ready", ui: uiDataOf(p, loaded.uiTemplates), leagueSeed: DEFAULT_LEAGUE_SEED });
    for (const m of queue.splice(0)) session.handle(m);
  } catch (e) {
    const file = e instanceof DataError ? e.file : "unknown";
    send({ t: "dataError", file, message: (e as Error).message });
  }
}

scope.onmessage = (e) => {
  const m = e.data;
  if (m.t === "init") {
    void init();
    return;
  }
  if (session === null) queue.push(m);
  else session.handle(m);
};
