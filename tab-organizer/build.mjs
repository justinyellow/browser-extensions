import { build } from "esbuild";

await build({
  entryPoints: ["src/background.js", "src/popup.js", "src/options.js"],
  outdir: "extension",
  bundle: true,
  format: "esm",
  target: "chrome120",
  minify: false,
  logLevel: "info",
});
