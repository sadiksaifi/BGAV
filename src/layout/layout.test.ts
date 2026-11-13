import { describe, expect, it } from "vitest";
import { parseMatrixJobs } from "../github/parse";
import { buildView } from "../model/view";
import { fixture, graphFixture } from "../test/fixtures";
import { type Box, headerText, layoutGraph } from "./layout";

describe("layoutGraph", () => {
  it("packs parallel siblings of a wide pipeline into bundles", async () => {
    const view = buildView(graphFixture("uv-graph.html"), {
      collapsed: new Map(),
      simplifyEdges: true,
      matrixJobs: () => undefined,
      matrixFailed: () => false,
    });
    const layout = await layoutGraph(view);
    expect(layout.bundles.size).toBeGreaterThan(0);
    expect(layout.edges.length).toBeLessThan(view.edges.length);
  });

  it("places every node top-down and routes edges between their boxes", async () => {
    const view = buildView(graphFixture("uv-graph.html"), {
      collapsed: new Map(),
      simplifyEdges: true,
      matrixJobs: () => undefined,
      matrixFailed: () => false,
    });
    const layout = await layoutGraph(view);
    expect(layout.nodes.size).toBe(view.nodes.length);
    expect(layout.clusters.size).toBe(view.clusters.length);
    const boxes = new Map<string, Box>([...layout.nodes, ...layout.bundles]);
    // Every dependency is drawn, directly or through a bundle.
    for (const e of view.edges) {
      expect(layout.edges.some((p) => p.fromIds.includes(e.from) && p.toIds.includes(e.to))).toBe(
        true,
      );
    }

    for (const edge of layout.edges) {
      const from = boxes.get(edge.from);
      const to = boxes.get(edge.to);
      if (!from || !to) throw new Error("edge to unknown node");
      const start = edge.points[0];
      const end = edge.points.at(-1);
      if (!start || !end) throw new Error("edge without points");
      // Edges leave the bottom of the upstream node and enter the top of the downstream node.
      expect(Math.abs(start.y - (from.y + from.height))).toBeLessThan(1);
      expect(start.x).toBeGreaterThanOrEqual(from.x - 1);
      expect(start.x).toBeLessThanOrEqual(from.x + from.width + 1);
      expect(Math.abs(end.y - to.y)).toBeLessThan(1);
      expect(end.x).toBeGreaterThanOrEqual(to.x - 1);
      expect(end.x).toBeLessThanOrEqual(to.x + to.width + 1);
      expect(to.y).toBeGreaterThan(from.y);
    }

    for (const bundle of layout.bundles.values()) {
      expect(bundle.members.length).toBeGreaterThanOrEqual(4);
      for (const id of bundle.members) {
        const node = layout.nodes.get(id);
        if (!node) throw new Error("bundle member not placed");
        expect(node.x).toBeGreaterThanOrEqual(bundle.x);
        expect(node.y).toBeGreaterThanOrEqual(bundle.y);
        expect(node.x + node.width).toBeLessThanOrEqual(bundle.x + bundle.width + 0.5);
        expect(node.y + node.height).toBeLessThanOrEqual(bundle.y + bundle.height + 0.5);
      }
    }

    // No two nodes overlap.
    const placed = [...layout.nodes.values()];
    for (const [i, a] of placed.entries()) {
      for (const b of placed.slice(i + 1)) {
        const overlap =
          a.x < b.x + b.width &&
          b.x < a.x + a.width &&
          a.y < b.y + b.height &&
          b.y < a.y + a.height;
        expect(overlap).toBe(false);
      }
    }

    for (const node of layout.nodes.values()) {
      const parent = node.node.parent ? layout.clusters.get(node.node.parent) : undefined;
      if (!parent) continue;
      expect(node.x).toBeGreaterThanOrEqual(parent.x);
      expect(node.y).toBeGreaterThanOrEqual(parent.y);
      expect(node.x + node.width).toBeLessThanOrEqual(parent.x + parent.width);
      expect(node.y + node.height).toBeLessThanOrEqual(parent.y + parent.height);
    }
  });

  it("starts every job without dependencies in the top row", async () => {
    const run = graphFixture("spaceterm-graph.html");
    const matrix = run.cards.find((c) => c.matrix);
    if (!matrix) throw new Error("missing matrix");
    const jobs = parseMatrixJobs(fixture("spaceterm-matrix-expanded.html"), matrix.id);
    expect(jobs.length).toBe(10);
    const view = buildView(run, {
      collapsed: new Map(),
      simplifyEdges: true,
      matrixJobs: (id) => (id === matrix.id ? jobs : undefined),
      matrixFailed: () => false,
    });
    const layout = await layoutGraph(view);
    const byTitle = (title: string) => {
      const node = [...layout.nodes.values()].find((n) => n.node.title === title);
      if (!node) throw new Error(`missing ${title}`);
      return node;
    };

    // Jobs that need nothing start the run, so they share the top row.
    const top = Math.min(...[...layout.nodes.values()].map((n) => n.y));
    for (const title of [
      "Plan compatibility pairs",
      "Validate release",
      "Compile linux",
      "Compile macos",
    ]) {
      expect(byTitle(title).y).toBeCloseTo(top);
    }

    // Jobs in the same layer as the tall matrix start at its top edge.
    const matrixNode = layout.nodes.get(matrix.id);
    expect(
      byTitle("Verify final Core linux and its floor activation without secrets").y,
    ).toBeCloseTo(matrixNode?.y ?? Number.NaN);
  });

  it("names an untitled group after the workflow calls of its jobs", () => {
    const view = buildView(graphFixture("uv-graph.html"), {
      collapsed: new Map(),
      simplifyEdges: true,
      matrixJobs: () => undefined,
      matrixFailed: () => false,
    });
    const untitled = view.nodes.filter((n) => n.kind === "group" && !n.title);
    const titles = untitled.map(headerText);
    expect(titles).toContain("test-integration, test-system");
    // With many callers, or inside a cluster, the job count is the title.
    expect(titles).toContain("22 jobs");
    expect(titles).toContain("2 jobs");
  });
});
