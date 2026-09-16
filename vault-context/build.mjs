import { build } from "esbuild";

const common = { outdir: "extension", bundle: true, target: "chrome120", minify: false, logLevel: "info" };

await build({ ...common, entryPoints: ["src/background.js", "src/popup.js", "src/picker.js", "src/options.js"], format: "esm" });
await build({ ...common, entryPoints: ["src/content.js"], format: "iife" });
