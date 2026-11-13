import { findGraphRegion, GRAPH_REGION_SELECTOR, parseGraph } from "../github/parse";
import { loadPrefs, type Prefs } from "../lib/prefs";
import { BgavApp } from "../view/app";
import { isRunPage } from "./route";

const MODE_ATTR = "data-bgav";
const PARSE_DELAY_MS = 150;

// Hides GitHub's graph while BGAV shows its own. GitHub keeps updating its graph
// in the background, and BGAV reads those updates.
const PAGE_CSS = `html[${MODE_ATTR}="bgav"] ${GRAPH_REGION_SELECTOR} { display: none !important; }`;

let app: BgavApp | undefined;
let region: Element | null = null;
let observer: MutationObserver | undefined;
let parseTimer = 0;
let prefs: Promise<Prefs> | undefined;
let mounting = false;

function ensurePageStyle(): void {
  if (document.getElementById("bgav-page-style")) return;
  const style = document.createElement("style");
  style.id = "bgav-page-style";
  style.textContent = PAGE_CSS;
  (document.head ?? document.documentElement).append(style);
}

function setMode(mode: Prefs["mode"] | null): void {
  if (mode) document.documentElement.setAttribute(MODE_ATTR, mode);
  else document.documentElement.removeAttribute(MODE_ATTR);
}

function unmount(): void {
  window.clearTimeout(parseTimer);
  observer?.disconnect();
  observer = undefined;
  app?.destroy();
  app = undefined;
  region = null;
  setMode(null);
}

function parseNow(): void {
  if (!app) return;
  const current = findGraphRegion();
  if (!current) return;
  if (current !== region || !app.host.isConnected || app.host.nextElementSibling !== current) {
    region = current;
    current.before(app.host);
  }
  try {
    app.update(parseGraph(current));
  } catch (error) {
    console.error("[BGAV] Could not read the run graph", error);
    app.showError();
    setMode(null);
  }
}

function scheduleParse(): void {
  window.clearTimeout(parseTimer);
  parseTimer = window.setTimeout(parseNow, PARSE_DELAY_MS);
}

function relevant(mutations: MutationRecord[]): boolean {
  if (!region?.isConnected) return true;
  for (const m of mutations) {
    if (app?.host.contains(m.target)) continue;
    if (region.contains(m.target)) return true;
    for (const node of m.addedNodes) {
      if (
        node instanceof Element &&
        (node.matches(GRAPH_REGION_SELECTOR) || node.querySelector(GRAPH_REGION_SELECTOR))
      ) {
        return true;
      }
    }
  }
  return false;
}

async function mount(): Promise<void> {
  if (mounting || app) return;
  const found = findGraphRegion();
  if (!found) return;
  mounting = true;
  try {
    prefs ??= loadPrefs();
    const loaded = await prefs;
    if (app || !isRunPage(location.pathname)) return;
    ensurePageStyle();
    app = new BgavApp(loaded, {
      onModeChange: (mode) => {
        prefs = Promise.resolve({ ...loaded, mode });
        setMode(mode);
      },
      onError: () => setMode(null),
    });
    region = found;
    found.before(app.host);
    setMode(loaded.mode);
    observer = new MutationObserver((mutations) => {
      if (relevant(mutations)) scheduleParse();
    });
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
    parseNow();
  } finally {
    mounting = false;
  }
}

/** Waits for GitHub's graph to appear, since parts of the run page load after navigation. */
let waitObserver: MutationObserver | undefined;
function waitForGraph(): void {
  waitObserver?.disconnect();
  if (findGraphRegion()) {
    void mount();
    return;
  }
  waitObserver = new MutationObserver(() => {
    if (!isRunPage(location.pathname)) {
      waitObserver?.disconnect();
      return;
    }
    if (findGraphRegion()) {
      waitObserver?.disconnect();
      void mount();
    }
  });
  waitObserver.observe(document.body, { subtree: true, childList: true });
}

/** Mounts BGAV on run pages and removes it elsewhere. Safe to call on every navigation. */
export function sync(): void {
  if (!isRunPage(location.pathname)) {
    waitObserver?.disconnect();
    if (app) unmount();
    return;
  }
  if (app && region?.isConnected && app.host.isConnected) {
    scheduleParse();
    return;
  }
  if (app) unmount();
  waitForGraph();
}

// Picks up preference changes made in other tabs.
try {
  chrome.storage?.onChanged?.addListener((changes, area) => {
    if (area === "local" && changes["bgav:prefs"]) prefs = undefined;
  });
} catch {
  // The extension context can be gone after an update; nothing to listen to then.
}
