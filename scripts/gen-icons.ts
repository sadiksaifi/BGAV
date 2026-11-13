// Renders assets/icon.svg to the PNG sizes Chrome uses. Run with: pnpm gen:icons
import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const svg = readFileSync(new URL("../assets/icon.svg", import.meta.url), "utf8");
const browser = await chromium.launch();
const page = await browser.newPage();
for (const size of [16, 32, 48, 128]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
  );
  await page.screenshot({ path: `public/icons/icon-${size}.png`, omitBackground: true });
}
await browser.close();
console.log("Wrote public/icons/icon-{16,32,48,128}.png");
