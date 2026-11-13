import { afterEach, describe, expect, it, vi } from "vitest";
import { type Layout, layoutGraph, measure } from "../layout/layout";
import { DEFAULT_PREFS } from "../lib/prefs";
import type { Card, RunGraph, Status } from "../model/types";
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
  refresh(): Promise<void>;
  onResize(): void;
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

function laid(view: ViewGraph): Layout {
  const nodes = new Map(
    view.nodes.map((node, i) => {
      const metrics = measure(node);
      return [
        node.id,
        { node, metrics, x: 0, y: i * 50, width: metrics.width, height: metrics.height },
      ];
    }),
  );
  return { width: 500, height: 300, nodes, clusters: new Map(), bundles: new Map(), edges: [] };
}

function mount(): { app: BgavApp; internals: Internals } {
  const app = new BgavApp(
    { ...DEFAULT_PREFS },
    { onModeChange: () => {}, onProblemChange: () => {} },
  );
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
});
