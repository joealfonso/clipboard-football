// The UI thread's handle on the sim worker. Says "Working..." when a reply takes over 300 ms
// (no fake delays anywhere), and turns a worker crash into a sim error.

import { isFromWorker } from "./messages";
import type { FromWorker, ToWorker } from "./protocol";

export const SLOW_MS = 300;

export class SimClient {
  private readonly worker: Worker;
  private slowTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly onMessage: (m: FromWorker) => void,
    private readonly onSlow: (slow: boolean) => void,
  ) {
    this.worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (e: MessageEvent<unknown>) => {
      const m = e.data;
      if (!isFromWorker(m)) {
        this.settle();
        this.onMessage({ t: "simError", error: { name: "WorkerError", message: "the sim worker sent a malformed message", seed: null, playCount: null } });
        return;
      }
      if (m.t !== "progress") this.settle();
      this.onMessage(m);
    };
    this.worker.onerror = (e) => {
      this.settle();
      this.onMessage({ t: "simError", error: { name: "WorkerError", message: e.message || "the sim worker stopped", seed: null, playCount: null } });
    };
    this.worker.onmessageerror = () => {
      this.settle();
      this.onMessage({ t: "simError", error: { name: "WorkerError", message: "a worker message could not be read", seed: null, playCount: null } });
    };
  }

  send(m: ToWorker): void {
    if (this.slowTimer === null && m.t !== "init") this.slowTimer = setTimeout(() => this.onSlow(true), SLOW_MS);
    this.worker.postMessage(m);
  }

  private settle(): void {
    if (this.slowTimer !== null) clearTimeout(this.slowTimer);
    this.slowTimer = null;
    this.onSlow(false);
  }
}
