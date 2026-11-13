// Opens GitHub Actions run pages in Playwright's Chromium with the built
// extension loaded, and saves a screenshot of each page.
//
//   pnpm build && pnpm preview <run-url>... [--out dir] [--dark] [--width 1400] [--full]
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const option = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? (args[i + 1] as string) : fallback;
};
const urls = args.filter((a, i) => a.startsWith("https://") && !args[i - 1]?.startsWith("--out"));
if (urls.length === 0) {
  console.error("Usage: pnpm preview <run-url>... [--out dir] [--dark] [--width 1400] [--full]");
  process.exit(1);
}
const out = resolve(option("out", "preview"));
mkdirSync(out, { recursive: true });

const extension = resolve("dist");
const context = await chromium.launchPersistentContext(
  join(tmpdir(), `bgav-preview-${process.pid}`),
  {
    channel: "chromium",
    headless: !flag("headed"),
    colorScheme: flag("dark") ? "dark" : "light",
    viewport: { width: Number(option("width", "1400")), height: 1000 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  },
);

for (const [i, url] of urls.entries()) {
  const page = await context.newPage();
  page.on("console", (msg) => {
    if (msg.text().includes("[BGAV]")) console.log(`  console: ${msg.text()}`);
  });
  page.on("pageerror", (err) => console.log(`  page error: ${err.message}`));
  await page.goto(url, { waitUntil: "domcontentloaded" });
  try {
    await page.waitForFunction(
      () =>
        (document.querySelector("#bgav-root")?.shadowRoot?.querySelectorAll(".node").length ?? 0) >
        0,
      undefined,
      { timeout: 30_000 },
    );
  } catch {
    console.log(`  no BGAV graph on ${url}`);
  }
  // Let matrix partials load and the layout settle.
  await page.waitForTimeout(Number(option("wait", "4000")));
  const host = page.locator("#bgav-root");
  const file = join(out, `run-${i + 1}${flag("dark") ? "-dark" : ""}.png`);
  if (flag("full") || (await host.count()) === 0)
    await page.screenshot({ path: file, fullPage: flag("full") });
  else await host.screenshot({ path: file });
  const stats = await page.evaluate(() => {
    const root = document.querySelector("#bgav-root")?.shadowRoot;
    return {
      nodes: root?.querySelectorAll(".node").length ?? 0,
      clusters: root?.querySelectorAll(".cluster").length ?? 0,
      edges: root?.querySelectorAll(".edge").length ?? 0,
      pills: root?.querySelectorAll(".pill").length ?? 0,
      mode: document.documentElement.getAttribute("data-bgav"),
    };
  });
  console.log(`${url}\n  ${JSON.stringify(stats)}\n  saved ${file}`);
  await page.close();
}
await context.close();
