// Lets Node run the TypeScript sources directly (Node strips the types): an extensionless
// relative import resolves to the .ts file. Used by validate.ts, run from the pipeline.
import { register } from "node:module";

register("./resolve-ts.mjs", import.meta.url);
