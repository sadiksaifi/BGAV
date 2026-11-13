import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RunGraph } from "../model/types";
import type { AppHooks } from "../view/app";
import { fixture } from "../test/fixtures";

const state = vi.hoisted(() => ({
  mode: "bgav" as "bgav" | "native",
  apps: [] as {
    hooks: AppHooks;
    update: ReturnType<typeof vi.fn<(run: RunGraph) => void>>;
    setReadable: ReturnType<typeof vi.fn<(readable: boolean) => void>>;
  }[],
}));

vi.mock("../view/app", () => ({
  BgavApp: class {
    host = document.createElement("div");
    update = vi.fn<(run: RunGraph) => void>();
    setReadable = vi.fn<(readable: boolean) => void>();
    constructor(
      _prefs: unknown,
      readonly hooks: AppHooks,
    ) {
      state.apps.push(this);
    }
    destroy() {
      this.host.remove();
    }
  },
}));

vi.mock("../lib/prefs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/prefs")>();
  return { ...actual, loadPrefs: async () => ({ ...actual.DEFAULT_PREFS, mode: state.mode }) };
});

const RUN_PATH = "/o/r/actions/runs/1";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
/** Longer than the content script's parse delay. */
const PARSE_WAIT = 200;

let main: typeof import("./main");

async function open(html: string): Promise<(typeof state.apps)[number]> {
  history.replaceState({}, "", RUN_PATH);
  document.body.innerHTML = html;
  main.sync();
  await sleep(10);
  const app = state.apps.at(-1);
  if (!app) throw new Error("BGAV did not mount");
  return app;
}

beforeEach(async () => {
  vi.resetModules();
  state.mode = "bgav";
  state.apps = [];
  main = await import("./main");
});

afterEach(() => {
  history.replaceState({}, "", "/");
  main.sync();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("content script", () => {
  it("does not parse while GitHub's graph is chosen, and catches up on the switch back", async () => {
    state.mode = "native";
    const app = await open(fixture("rust-running-graph.html"));
    expect(app.update).not.toHaveBeenCalled();
    document.querySelector(".WorkflowStage")?.setAttribute("data-test", "changed");
    await sleep(PARSE_WAIT);
    expect(app.update).not.toHaveBeenCalled();

    app.hooks.onModeChange("bgav");
    expect(app.update).toHaveBeenCalledTimes(1);
  });

  it("falls back when the graph has no jobs, and recovers when it does", async () => {
    const app = await open('<div role="region" aria-label="Workflow run graph"></div>');
    expect(app.setReadable).toHaveBeenLastCalledWith(false);

    const region = document.querySelector('[role="region"]');
    if (region) region.outerHTML = fixture("rust-running-graph.html");
    await sleep(PARSE_WAIT);
    expect(app.setReadable).toHaveBeenLastCalledWith(true);
    expect(app.update).toHaveBeenCalled();
  });

  it("ignores hooks from an app that was replaced", async () => {
    const first = await open(fixture("rust-running-graph.html"));
    history.replaceState({}, "", "/");
    main.sync();
    const second = await open(fixture("rust-running-graph.html"));
    expect(second).not.toBe(first);

    first.hooks.onProblemChange(true);
    expect(document.documentElement.getAttribute("data-bgav")).toBe("bgav");
  });

  it("hides the graph region it found, even under a different label", async () => {
    const html = fixture("rust-running-graph.html").replace(
      'aria-label="Workflow run graph"',
      'aria-label="Run graph"',
    );
    await open(html);
    const region = document.querySelector("action-graph")?.closest("[role=region]");
    expect(region?.hasAttribute("data-bgav-region")).toBe(true);
    expect(region ? getComputedStyle(region).display : "").toBe("none");
  });
});
