import { build } from "esbuild";

const common = { outdir: "extension", bundle: true, target: "chrome120", minify: false, logLevel: "info" };

await build({ ...common, entryPoints: ["src/background.js", "src/popup.js", "src/options.js"], format: "esm" });
// Runs in the page's MAIN world, so it must be a plain script with no module exports.
await build({ ...common, entryPoints: ["src/recorder.js"], format: "iife" });
