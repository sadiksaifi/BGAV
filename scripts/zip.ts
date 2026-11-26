// Packs dist/ into bgav-<version>.zip for the Chrome Web Store. Run with: pnpm zip
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

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
rmSync(out, { force: true });
execFileSync("zip", ["-r", "-X", out, "."], { cwd: "dist", stdio: "inherit" });
console.log(`Wrote ${out}`);
