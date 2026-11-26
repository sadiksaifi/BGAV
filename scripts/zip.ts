// Packs dist/ into bgav-<version>.zip for the Chrome Web Store. Run with: pnpm zip
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { join, relative, resolve } from "node:path";

const { version } = JSON.parse(readFileSync("dist/manifest.json", "utf8")) as { version: string };
const elk = JSON.parse(readFileSync("node_modules/elkjs/package.json", "utf8")) as {
  version: string;
};

mkdirSync("dist/licenses", { recursive: true });
copyFileSync("LICENSE", "dist/LICENSE");
copyFileSync("node_modules/@primer/octicons/LICENSE", "dist/licenses/octicons-MIT.txt");
copyFileSync("node_modules/elkjs/LICENSE.md", "dist/licenses/elkjs-EPL-2.0.md");
writeFileSync(
  "dist/licenses/README.txt",
  `This extension includes GitHub Octicons under the MIT License. See octicons-MIT.txt.\n\n` +
    `The source code for elkjs ${elk.version} is available under the Eclipse Public License 2.0 at:\n` +
    `https://github.com/kieler/elkjs/tree/${elk.version}\nSee elkjs-EPL-2.0.md.\n`,
);

const out = resolve(`bgav-${version}.zip`);
const dist = resolve("dist");
const files = readdirSync(dist, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => relative(dist, join(entry.parentPath, entry.name)))
  .toSorted();
// Retried builds must produce the same archive for the same release.
const timestamp = new Date("2000-01-01T00:00:00Z");
for (const file of files) {
  const path = join(dist, file);
  chmodSync(path, 0o644);
  utimesSync(path, timestamp, timestamp);
}

rmSync(out, { force: true });
execFileSync("zip", ["-X", out, "-@"], {
  cwd: dist,
  env: { ...process.env, TZ: "UTC" },
  input: `${files.join("\n")}\n`,
  stdio: ["pipe", "inherit", "inherit"],
});
console.log(`Wrote ${out}`);
