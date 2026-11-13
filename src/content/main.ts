import {
  findGraphRegion,
  findRunStatusElement,
  GRAPH_REGION_SELECTOR,
  parseGraph,
  readRunStatus,
} from "../github/parse";
import type { RunGraph } from "../model/types";
import { loadPrefs, type Prefs } from "../lib/prefs";
import { BgavApp } from "../view/app";
import { isRunPage } from "./route";

const MODE_ATTR = "data-bgav";
/** Marks the graph region BGAV found, which may not match GRAPH_REGION_SELECTOR. */
const REGION_ATTR = "data-bgav-region";
const PARSE_DELAY_MS = 150;

// Hides GitHub's graph while BGAV shows its own. GitHub keeps updating its graph
// in the background, and BGAV reads those updates.
const PAGE_CSS = `html[${MODE_ATTR}="bgav"] [${REGION_ATTR}] { display: none !important; }`;

let app: BgavApp | undefined;
let region: Element | null = null;
let observer: MutationObserver | undefined;
let parseTimer = 0;
let prefs: Promise<Prefs> | undefined;
let mounting = false;
/** The graph the user picked; GitHub's graph also shows while BGAV has a problem. */
let userMode: Prefs["mode"] = "bgav";
let problem = false;
/** The run summary's status value; its changes trigger a parse too. */
let statusEl: Element | null = null;

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

function applyPageMode(): void {
  setMode(problem ? null : userMode);
}

function setRegion(next: Element | null): void {
  if (region === next) return;
  region?.removeAttribute(REGION_ATTR);
  region = next;
  region?.setAttribute(REGION_ATTR, "");
}

/** True for added markup that holds a run graph. */
function holdsGraph(node: Node): boolean {
  return (
    node instanceof Element &&
    (node.matches(GRAPH_REGION_SELECTOR) ||
      node.matches("action-graph") ||
      findGraphRegion(node) !== null)
  );
}

function unmount(): void {
  window.clearTimeout(parseTimer);
  observer?.disconnect();
  observer = undefined;
  app?.destroy();
  app = undefined;
  setRegion(null);
  statusEl = null;
  problem = false;
  setMode(null);
}

function parseNow(): void {
  if (!app) return;
  const current = findGraphRegion();
  if (!current) return;
  if (current !== region || !app.host.isConnected || app.host.nextElementSibling !== current) {
    setRegion(current);
    current.before(app.host);
  }
  // GitHub's graph is showing by choice; parse again when the user switches back.
  if (userMode === "native") return;
  let run: RunGraph;
  try {
    run = parseGraph(current);
  } catch (error) {
    console.error("[BGAV] Could not read the run graph", error);
    app.setReadable(false);
    return;
  }
  // A run graph always has cards. None means GitHub changed its markup.
  if (run.cards.length === 0) {
    console.warn("[BGAV] Found no jobs in the run graph");
    app.setReadable(false);
    return;
  }
  statusEl = findRunStatusElement();
  run.runStatus = readRunStatus();
  app.setReadable(true);
  app.update(run);
}

function scheduleParse(): void {
  window.clearTimeout(parseTimer);
  parseTimer = window.setTimeout(parseNow, PARSE_DELAY_MS);
}

function relevant(mutations: MutationRecord[]): boolean {
  if (!region?.isConnected) return true;
  // GitHub replaced the run summary; a parse finds the new status value.
  if (statusEl && !statusEl.isConnected) return true;
  for (const m of mutations) {
    if (app?.host.contains(m.target)) continue;
    if (region.contains(m.target)) return true;
    if (statusEl?.contains(m.target)) return true;
    for (const node of m.addedNodes) if (holdsGraph(node)) return true;
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
    userMode = loaded.mode;
    problem = false;
    // Hooks from an app that was replaced or destroyed are ignored.
    const instance: BgavApp = new BgavApp(loaded, {
      onModeChange: (mode) => {
        if (app !== instance) return;
        prefs = Promise.resolve({ ...loaded, mode });
        userMode = mode;
        applyPageMode();
        if (mode === "bgav") parseNow();
      },
      onProblemChange: (value) => {
        if (app !== instance) return;
        problem = value;
        applyPageMode();
      },
    });
    app = instance;
    setRegion(found);
    found.before(app.host);
    applyPageMode();
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
