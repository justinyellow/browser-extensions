import { mkdirSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const extensions = ["bug-capture", "tab-organizer", "vault-context"];

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

for (const name of extensions) {
  const build = spawnSync("npm", ["run", "build"], { cwd: join(root, name), stdio: "inherit" });
  if (build.status !== 0) process.exit(build.status ?? 1);
  const zip = join(dist, `${name}.zip`);
  const packed = spawnSync("zip", ["-r", "-X", zip, ".", "-x", "*.map"], {
    cwd: join(root, name, "extension"),
    stdio: "inherit",
  });
  if (packed.status !== 0) process.exit(packed.status ?? 1);
  console.log(`Wrote ${zip}`);
}
