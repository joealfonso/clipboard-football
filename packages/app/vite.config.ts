import { defineConfig } from "vite";

// The game's data files live in the repo's data/ folder; the worker imports them with `?url`
// and fetches each one, so the loading screen can show progress per file.
export default defineConfig({
  server: { fs: { allow: ["../.."] } },
  worker: { format: "es" },
  build: { target: "es2022" },
});
