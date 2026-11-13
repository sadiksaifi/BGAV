// Packs dist/ into bgav-<version>.zip for the Chrome Web Store. Run with: pnpm zip
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const { version } = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };
const out = resolve(`bgav-${version}.zip`);
rmSync(out, { force: true });
execFileSync("zip", ["-r", "-X", out, "."], { cwd: "dist", stdio: "inherit" });
console.log(`Wrote ${out}`);
