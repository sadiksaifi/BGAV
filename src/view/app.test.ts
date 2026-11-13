import { afterEach, describe, expect, it, vi } from "vitest";
import { type Layout, layoutGraph, measure } from "../layout/layout";
import { DEFAULT_PREFS } from "../lib/prefs";
import type { Card, Job, RunGraph, Status } from "../model/types";
import type { ViewGraph } from "../model/view";
import { BgavApp } from "./app";

vi.mock("../layout/layout", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../layout/layout")>();
  return { ...actual, layoutGraph: vi.fn<typeof actual.layoutGraph>() };
});

/** The private parts of the app these tests drive. */
interface Internals {
  run: RunGraph;
  view: ViewGraph;
  viewport: HTMLElement;
  collapsed: Map<string, boolean>;
  transform: { x: number; y: number; k: number };
  refresh(): Promise<void>;
  onResize(): void;
  fit(): void;
  setMode(mode: "bgav" | "native"): void;
  setAllCollapsed(collapsed: boolean): void;
  setStatusFilter(status: Status | undefined): void;
  setFullscreen(on: boolean): void;
}

const noop = () => {};
const apps: BgavApp[] = [];
afterEach(() => {
  for (const app of apps.splice(0)) app.destroy();
  vi.mocked(layoutGraph).mockReset();
});

function card(id: string, status: Status = "running"): Card {
  return {
    id,
    kind: "job",
    title: id,
    path: [],
    jobs: [
      {
        key: id,
        jobId: id,
        name: id,
        path: [],
        status,
        ...(status === "running"
          ? { startedAt: Date.now() - 60_000 }
          : { durationText: "1m", durationSec: 60 }),
      },
    ],
    stage: 0,
    order: 0,
  };
}

function job(key: string, status: Status, path: string[] = []): Job {
  return { key, jobId: key, name: key, path, status, durationText: "1m", durationSec: 60 };
}

/** A group card of `count` jobs with the given status, called from `caller`. */
function group(id: string, count: number, status: Status, caller?: string): Card {
  const path = caller ? [caller, id] : [id];
  return {
    id,
    kind: "group",
    title: id,
    path,
    jobs: Array.from({ length: count }, (_, i) => job(`${id}-${i}`, status, path)),
    stage: 0,
    order: 0,
  };
}

/** Lets pending promises and timers run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function laid(view: ViewGraph, width = 500, height = 300): Layout {
  const nodes = new Map(
    view.nodes.map((node, i) => {
      const metrics = measure(node);
      return [
        node.id,
        { node, metrics, x: 0, y: i * 50, width: metrics.width, height: metrics.height },
      ];
    }),
  );
  return { width, height, nodes, clusters: new Map(), bundles: new Map(), edges: [] };
}

function mount(onProblemChange: (problem: boolean) => void = noop): {
  app: BgavApp;
  internals: Internals;
} {
  const app = new BgavApp({ ...DEFAULT_PREFS }, { onModeChange: noop, onProblemChange });
  apps.push(app);
  document.body.append(app.host);
  return { app, internals: app as unknown as Internals };
}

describe("BgavApp", () => {
  it("draws the newest statuses when they arrive while a layout runs", async () => {
    const { app, internals } = mount();
    vi.mocked(layoutGraph).mockImplementation(async (view) => laid(view));
    internals.run = { cards: [card("a")], edges: [] };
    await internals.refresh();

    // A new job changes the structure, so a layout starts and stays pending.
    let finish = noop;
    vi.mocked(layoutGraph).mockImplementationOnce(
      (view) =>
        new Promise((resolve) => {
          finish = () => resolve(laid(view));
        }),
    );
    internals.run = { cards: [card("a"), card("b")], edges: [] };
    const pending = internals.refresh();
    // Job b finishes before the layout returns. Its size does not change.
    internals.run = { cards: [card("a"), card("b", "success")], edges: [] };
    await internals.refresh();
    finish();
    await pending;

    expect(internals.view.nodes.find((n) => n.id === "b")?.status).toBe("success");
    const drawn = app.host.shadowRoot?.querySelector('[data-id="b"]');
    expect(drawn?.classList.contains("s-success")).toBe(true);
  });

  it("keeps the height the user drags the panel to", async () => {
    const { app, internals } = mount();
    vi.mocked(layoutGraph).mockImplementation(async (view) => laid(view));
    Object.defineProperty(internals.viewport, "clientWidth", { get: () => 1000 });
    internals.run = { cards: [card("a")], edges: [] };
    await internals.refresh();

    const handle = app.host.shadowRoot?.querySelector<HTMLElement>(".resize");
    if (!handle) throw new Error("missing resize handle");
    handle.setPointerCapture = () => {};
    handle.dispatchEvent(new PointerEvent("pointerdown", { clientY: 0, pointerId: 1 }));
    // The drag changes the height, which fires the resize observer.
    internals.viewport.style.height = "600px";
    internals.onResize();
    expect(internals.viewport.style.height).toBe("600px");
  });
  it("ignores a layout failure after the app is destroyed", async () => {
    const onProblemChange = vi.fn<(problem: boolean) => void>();
    const { app, internals } = mount(onProblemChange);
    let fail = noop;
    vi.mocked(layoutGraph).mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          fail = () => reject(new Error("ELK failed"));
        }),
    );
    vi.spyOn(console, "error").mockImplementation(noop);
    internals.run = { cards: [card("a")], edges: [] };
    const pending = internals.refresh();
    app.destroy();
    fail();
    await pending;
    expect(onProblemChange).not.toHaveBeenCalled();
  });

  it("ignores a layout failure after a switch to GitHub's graph", async () => {
    const onProblemChange = vi.fn<(problem: boolean) => void>();
    const { app, internals } = mount(onProblemChange);
    let fail = noop;
    vi.mocked(layoutGraph).mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          fail = () => reject(new Error("ELK failed"));
        }),
    );
    vi.spyOn(console, "error").mockImplementation(noop);
    internals.run = { cards: [card("a")], edges: [] };
    const pending = internals.refresh();
    internals.setMode("native");
    fail();
    await pending;
    expect(onProblemChange).not.toHaveBeenCalled();
    const bar = app.host.shadowRoot?.querySelector(".native-bar");
    expect(bar?.textContent).toContain("Show BGAV graph");
  });

  it("keeps a fitted view fitted when the graph grows", async () => {
    const { internals } = mount();
    Object.defineProperty(internals.viewport, "clientWidth", { get: () => 1000 });
    Object.defineProperty(internals.viewport, "clientHeight", { get: () => 400 });
    vi.mocked(layoutGraph).mockImplementation(async (view) => laid(view));
    internals.run = { cards: [card("a")], edges: [] };
    await internals.refresh();
    internals.fit();

    // The graph grows past the readable zoom; the view should still show all of it.
    vi.mocked(layoutGraph).mockImplementation(async (view) => laid(view, 4000, 2000));
    internals.run = { cards: [card("a"), card("b")], edges: [] };
    await internals.refresh();
    expect(internals.transform.k).toBeLessThan(0.3);
  });

  it("collapses and expands every group, including clusters and the cards inside them", async () => {
    const { internals } = mount();
    vi.mocked(layoutGraph).mockImplementation(async (view) => laid(view));
    internals.run = {
      cards: [group("x", 2, "success", "rw"), group("y", 2, "success", "rw")],
      edges: [],
    };
    await internals.refresh();
    internals.setAllCollapsed(true);
    expect(internals.collapsed.get("cluster:rw")).toBe(true);

    internals.setAllCollapsed(false);
    expect(internals.collapsed.get("cluster:rw")).toBe(false);
    expect(internals.collapsed.get("x")).toBe(false);
    expect(internals.collapsed.get("y")).toBe(false);
  });

  it("expands a collapsed group whose matching job is not listed", async () => {
    const { internals } = mount();
    vi.mocked(layoutGraph).mockImplementation(async (view) => laid(view));
    // Five failures; a collapsed group lists only the first three.
    internals.run = { cards: [group("g", 5, "failure")], edges: [] };
    internals.collapsed.set("g", true);
    await internals.refresh();
    internals.setStatusFilter("failure");
    await settle();
    expect(internals.collapsed.get("g")).toBe(false);
  });

  it("keeps keyboard focus on a status chip when the chips re-render", async () => {
    const { app, internals } = mount();
    vi.mocked(layoutGraph).mockImplementation(async (view) => laid(view));
    internals.run = { cards: [card("a")], edges: [] };
    await internals.refresh();
    const chip = app.host.shadowRoot?.querySelector<HTMLElement>(".chip.s-running");
    chip?.focus();
    await internals.refresh();
    const active = app.host.shadowRoot?.activeElement;
    expect(active?.classList.contains("s-running")).toBe(true);
  });

  it("makes the rest of the page inert while full screen", async () => {
    const { internals } = mount();
    const other = document.createElement("button");
    document.body.append(other);
    internals.setFullscreen(true);
    expect(other.inert).toBe(true);
    internals.setFullscreen(false);
    expect(other.inert).toBe(false);
    other.remove();
  });
});
