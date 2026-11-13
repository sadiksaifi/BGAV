import { describe, expect, it } from "vitest";
import { graphFixture } from "../test/fixtures";
import type { Edge } from "./types";
import {
  buildView,
  clusterId,
  COLLAPSE_THRESHOLD,
  criticalPath,
  lineage,
  transitiveReduction,
  type ViewOptions,
} from "./view";

const options = (overrides: Partial<ViewOptions> = {}): ViewOptions => ({
  collapsed: new Map(),
  simplifyEdges: true,
  matrixJobs: () => undefined,
  matrixFailed: () => false,
  ...overrides,
});

describe("transitiveReduction", () => {
  it("drops edges implied by a longer path", () => {
    const edges: Edge[] = [
      { from: "a", to: "b" },
      { from: "b", to: "c" },
      { from: "a", to: "c" },
    ];
    expect(transitiveReduction(edges)).toEqual([
      { from: "a", to: "b" },
      { from: "b", to: "c" },
    ]);
  });

  it("keeps parallel branches", () => {
    const edges: Edge[] = [
      { from: "a", to: "b" },
      { from: "a", to: "c" },
      { from: "b", to: "d" },
      { from: "c", to: "d" },
    ];
    expect(transitiveReduction(edges)).toEqual(edges);
  });
});

describe("lineage", () => {
  it("collects upstream and downstream nodes", () => {
    const edges: Edge[] = [
      { from: "a", to: "b" },
      { from: "b", to: "c" },
      { from: "x", to: "c" },
    ];
    expect(lineage("b", edges)).toEqual(new Set(["a", "b", "c"]));
  });
});

describe("buildView", () => {
  it("clusters cards from the same reusable workflow call", () => {
    const view = buildView(graphFixture("uv-graph.html"), options());
    const titles = view.clusters.map((c) => c.title);
    expect(titles).toContain("build-release-artifacts");
    expect(titles).toContain("test-system");
    // build-dev-binaries is a single card, so it stays a plain group.
    expect(titles).not.toContain("build-dev-binaries");
    const release = view.clusters.find((c) => c.title === "build-release-artifacts");
    expect(release?.children.length).toBeGreaterThanOrEqual(8);
    for (const id of release?.children ?? []) {
      expect(view.nodes.find((n) => n.id === id)?.parent).toBe(release?.id);
    }
  });

  it("collapses large groups by default and respects explicit choices", () => {
    const run = graphFixture("uv-graph.html");
    const group = run.cards.find((c) => c.title === "build-dev-binaries");
    if (!group) throw new Error("missing group");
    // 11 jobs stay expanded by default.
    expect(buildView(run, options()).nodes.find((n) => n.id === group.id)?.collapsed).toBe(false);
    const collapsed = buildView(run, options({ collapsed: new Map([[group.id, true]]) }));
    expect(collapsed.nodes.find((n) => n.id === group.id)?.collapsed).toBe(true);
    const large = run.cards.find((c) => c.jobs.length > COLLAPSE_THRESHOLD);
    if (!large) throw new Error("missing large group");
    expect(buildView(run, options()).nodes.find((n) => n.id === large.id)?.collapsed).toBe(true);
  });

  it("replaces a collapsed cluster with one node and remaps its edges", () => {
    const run = graphFixture("uv-graph.html");
    const id = clusterId("build-release-artifacts");
    const view = buildView(run, options({ collapsed: new Map([[id, true]]) }));
    const node = view.nodes.find((n) => n.id === id);
    expect(node?.kind).toBe("cluster");
    expect(node?.cardCount).toBeGreaterThanOrEqual(8);
    expect(view.nodes.some((n) => n.parent === id)).toBe(false);
    const ids = new Set(view.nodes.map((n) => n.id));
    for (const e of view.allEdges) {
      expect(ids.has(e.from) && ids.has(e.to)).toBe(true);
    }
  });

  it("simplifies the converging edges of a large pipeline", () => {
    const run = graphFixture("uv-graph.html");
    const full = buildView(run, options({ simplifyEdges: false }));
    const simple = buildView(run, options());
    expect(simple.edges.length).toBeLessThan(full.edges.length);
    expect(simple.allEdges).toEqual(full.allEdges);
  });
});

describe("criticalPath", () => {
  it("follows the longest chain of durations", () => {
    const view = buildView(graphFixture("uv-graph.html"), options({ simplifyEdges: false }));
    const path = criticalPath(view, Date.now());
    expect(path.nodes.size).toBeGreaterThan(1);
    expect(path.edges.size).toBe(path.nodes.size - 1);
  });
});

describe("settled runs", () => {
  it("shows jobs that never started as skipped once nothing is active", () => {
    const run = graphFixture("uv-graph.html");
    expect(run.cards.some((c) => c.jobs.some((j) => j.status === "pending"))).toBe(true);
    const view = buildView(run, options());
    expect(view.nodes.some((n) => n.jobs.some((j) => j.status === "pending"))).toBe(false);
  });

  it("keeps pending jobs pending while the run is active", () => {
    const view = buildView(graphFixture("rust-running-graph.html"), options());
    const pending = view.nodes.flatMap((n) => n.jobs).filter((j) => j.status === "pending");
    expect(pending.length).toBeGreaterThan(0);
  });
});
