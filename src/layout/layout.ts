import ELK from "elkjs/lib/elk.bundled.js";
import type { ElkExtendedEdge, ElkNode, LayoutOptions } from "elkjs/lib/elk-api";
import type { Edge, Job } from "../model/types";
import { COLLAPSE_THRESHOLD, type ViewGraph, type ViewNode } from "../model/view";
import { textWidth } from "./text";

export const SIZE = {
  singleHeight: 36,
  singleMin: 150,
  singleMax: 340,
  pillHeight: 30,
  pillMin: 140,
  pillMax: 300,
  pillGap: 4,
  pad: 8,
  header: 30,
  collapsedMin: 250,
  collapsedMax: 320,
  summary: 40,
  more: 18,
  attentionMax: 3,
  clusterHeader: 30,
  clusterPad: 14,
  bundlePad: 12,
  bundleGap: 14,
  /** Rows per column before an expanded group adds a column. */
  rowsPerColumn: 12,
  /** Siblings with identical dependencies are packed into a grid from this count. */
  bundleMin: 4,
};

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Metrics {
  width: number;
  height: number;
  columns: number;
  pillWidth: number;
  /** Whether the node draws a header row (title, matrix label or summary). */
  header: boolean;
}

export interface PlacedNode extends Box {
  node: ViewNode;
  metrics: Metrics;
}

export interface PlacedCluster extends Box {
  id: string;
}

export interface PlacedBundle extends Box {
  id: string;
  members: string[];
}

export interface PlacedEdge {
  /** Endpoint ids as drawn: a node, or a bundle of nodes. */
  from: string;
  to: string;
  /** Node ids the endpoints stand for. */
  fromIds: string[];
  toIds: string[];
  points: { x: number; y: number }[];
}

export interface Layout {
  width: number;
  height: number;
  nodes: Map<string, PlacedNode>;
  clusters: Map<string, PlacedCluster>;
  bundles: Map<string, PlacedBundle>;
  edges: PlacedEdge[];
}

/** Jobs that need attention: failed, running, or waiting for approval. */
export function urgentJobs(node: ViewNode): Job[] {
  return node.jobs.filter(
    (j) => j.status === "failure" || j.status === "running" || j.status === "waiting",
  );
}

/** Jobs a collapsed node lists under its summary. */
export function attentionJobs(node: ViewNode): Job[] {
  return urgentJobs(node).slice(0, SIZE.attentionMax);
}

/** Duration text used for sizing. Running jobs reserve room so the layout stays put while the clock ticks. */
function durationLabel(job: Job): string {
  if (job.startedAt !== undefined) return "59m 59s";
  return job.durationText ?? "";
}

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, Math.ceil(n)));

export function pillWidth(job: Job): number {
  const duration = durationLabel(job);
  const durationW = duration ? 8 + Math.max(textWidth(duration, 400, 12), 34) : 0;
  return clamp(
    9 + 16 + 7 + textWidth(job.name, 500, 12) + durationW + 9 + 2,
    SIZE.pillMin,
    SIZE.pillMax,
  );
}

/** Whether an expanded group or matrix draws a header row. */
export function hasHeader(node: ViewNode): boolean {
  if (node.kind === "job") return false;
  if (node.kind === "cluster" || node.collapsed || node.kind === "matrix") return true;
  return node.title !== "" || node.jobs.length > COLLAPSE_THRESHOLD;
}

/**
 * Names a group that GitHub shows without a heading after the workflow calls
 * its jobs come from, when there are at most three. Inside a cluster, the
 * cluster title already names the call.
 */
function callerTitle(node: ViewNode): string | undefined {
  if (node.parent) return undefined;
  const callers = new Set(node.jobs.map((j) => j.path[0]));
  if (callers.size > 3 || callers.has(undefined)) return undefined;
  return [...callers].join(", ");
}

export function headerText(node: ViewNode): string {
  const title = node.title || callerTitle(node) || `${node.jobs.length} jobs`;
  const full = node.subtitle ? `${node.subtitle} / ${title}` : title;
  return node.kind === "matrix" && !node.collapsed ? `Matrix: ${full}` : full;
}

export function measure(node: ViewNode): Metrics {
  if (node.kind === "job") {
    const job = node.jobs[0];
    const label = job ? job.name : node.title;
    const sub = node.subtitle ? textWidth(`${node.subtitle} / `, 400, 13) : 0;
    const duration = job ? durationLabel(job) : "";
    const durationW = duration ? 10 + Math.max(textWidth(duration, 400, 12), 34) : 0;
    const width = clamp(
      12 + 16 + 8 + sub + textWidth(label, 600, 13) + durationW + 12 + 2,
      SIZE.singleMin,
      SIZE.singleMax,
    );
    return { width, height: SIZE.singleHeight, columns: 1, pillWidth: width, header: false };
  }

  const listHeight = (rows: number) =>
    rows * SIZE.pillHeight + Math.max(0, rows - 1) * SIZE.pillGap;
  // Header chrome: chevron, icon, the job and card counts, gaps and padding.
  const titleW = textWidth(headerText(node), 600, 12) + (node.kind === "cluster" ? 160 : 110);

  if (node.collapsed || node.kind === "cluster") {
    const attention = attentionJobs(node);
    const more = urgentJobs(node).length > attention.length;
    const width = clamp(
      Math.max(titleW, ...attention.map((j) => pillWidth(j) + SIZE.pad * 2)),
      SIZE.collapsedMin,
      SIZE.collapsedMax,
    );
    const extra = attention.length > 0 ? listHeight(attention.length) + SIZE.pillGap : 0;
    return {
      width,
      height: SIZE.header + SIZE.summary + extra + (more ? SIZE.more : 0) + SIZE.pad,
      columns: 1,
      pillWidth: width - SIZE.pad * 2,
      header: true,
    };
  }

  if (node.jobs.length === 0) {
    const width = clamp(Math.max(titleW, 220), SIZE.collapsedMin, SIZE.collapsedMax);
    return {
      width,
      height: SIZE.header + 34,
      columns: 1,
      pillWidth: width - SIZE.pad * 2,
      header: true,
    };
  }

  const header = hasHeader(node);
  const columns = Math.min(4, Math.ceil(node.jobs.length / SIZE.rowsPerColumn));
  const rows = Math.ceil(node.jobs.length / columns);
  let pill = Math.max(...node.jobs.map(pillWidth));
  if (header && columns === 1) pill = Math.max(pill, Math.min(SIZE.pillMax, titleW - SIZE.pad * 2));
  return {
    width: SIZE.pad * 2 + columns * pill + (columns - 1) * SIZE.pillGap,
    height: (header ? SIZE.header : SIZE.pad) + listHeight(rows) + SIZE.pad,
    columns,
    pillWidth: pill,
    header,
  };
}

export interface Bundle {
  id: string;
  parent: string | undefined;
  members: ViewNode[];
  width: number;
  height: number;
  offsets: Map<string, Box>;
}

/**
 * Packs siblings that share the same upstream and downstream nodes into a grid.
 * They run in parallel and connect the same way, so one box with one edge in
 * and one edge out says the same thing as dozens of side-by-side nodes.
 */
export function findBundles(view: ViewGraph, sizes: Map<string, Metrics>): Bundle[] {
  const preds = new Map<string, string[]>();
  const succs = new Map<string, string[]>();
  for (const { from, to } of view.edges) {
    (succs.get(from) ?? succs.set(from, []).get(from))?.push(to);
    (preds.get(to) ?? preds.set(to, []).get(to))?.push(from);
  }
  const groups = new Map<string, ViewNode[]>();
  for (const node of view.nodes) {
    const p = (preds.get(node.id) ?? []).toSorted().join(",");
    const s = (succs.get(node.id) ?? []).toSorted().join(",");
    if (p === "" && s === "") continue;
    const key = `${node.parent ?? ""}|${p}|${s}`;
    const list = groups.get(key) ?? [];
    list.push(node);
    groups.set(key, list);
  }

  const bundles: Bundle[] = [];
  for (const members of groups.values()) {
    if (members.length < SIZE.bundleMin) continue;
    const metrics = members.map((m) => sizes.get(m.id) ?? measure(m));
    const area = metrics.reduce((sum, m) => sum + m.width * m.height, 0);
    const avgWidth = metrics.reduce((sum, m) => sum + m.width, 0) / members.length;
    // Aim for a box about twice as wide as tall.
    const columns = Math.max(
      1,
      Math.min(members.length, Math.round(Math.sqrt(area * 2) / avgWidth)),
    );

    // Masonry: each member goes to the shortest column.
    const columnHeights = Array.from({ length: columns }, () => 0);
    const columnWidths = Array.from({ length: columns }, () => 0);
    const placement: { column: number; y: number }[] = [];
    for (const m of metrics) {
      const column = columnHeights.indexOf(Math.min(...columnHeights));
      placement.push({ column, y: columnHeights[column] ?? 0 });
      columnHeights[column] = (columnHeights[column] ?? 0) + m.height + SIZE.bundleGap;
      columnWidths[column] = Math.max(columnWidths[column] ?? 0, m.width);
    }
    const columnX: number[] = [];
    let x = SIZE.bundlePad;
    for (const w of columnWidths) {
      columnX.push(x);
      x += w + SIZE.bundleGap;
    }

    const offsets = new Map<string, Box>();
    members.forEach((member, i) => {
      const m = metrics[i] as Metrics;
      const { column, y } = placement[i] as { column: number; y: number };
      // Single jobs stretch to the column so the grid lines up.
      const width = member.kind === "job" ? (columnWidths[column] ?? m.width) : m.width;
      offsets.set(member.id, {
        x: columnX[column] ?? 0,
        y: SIZE.bundlePad + y,
        width,
        height: m.height,
      });
    });

    bundles.push({
      id: `bundle:${bundles.length}:${members[0]?.id ?? ""}`,
      parent: members[0]?.parent,
      members,
      width: x - SIZE.bundleGap + SIZE.bundlePad,
      height: Math.max(...columnHeights) - SIZE.bundleGap + SIZE.bundlePad * 2,
      offsets,
    });
  }
  return bundles;
}

const ROOT_OPTIONS: LayoutOptions = {
  "elk.algorithm": "layered",
  "elk.direction": "DOWN",
  "elk.hierarchyHandling": "INCLUDE_CHILDREN",
  "elk.edgeRouting": "ORTHOGONAL",
  "elk.layered.mergeEdges": "false",
  "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
  "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
  "elk.layered.nodePlacement.favorStraightEdges": "true",
  "elk.layered.thoroughness": "10",
  "elk.layered.spacing.nodeNodeBetweenLayers": "56",
  "elk.layered.spacing.edgeNodeBetweenLayers": "24",
  "elk.layered.spacing.edgeEdgeBetweenLayers": "12",
  "elk.spacing.nodeNode": "28",
  "elk.spacing.edgeNode": "16",
  "elk.spacing.edgeEdge": "12",
  "elk.spacing.componentComponent": "40",
  "elk.separateConnectedComponents": "false",
  "elk.padding": "[top=24,left=24,bottom=24,right=24]",
};

/**
 * Nodes sit at the top of their layer. Centered nodes float in the middle of a
 * layer that a tall matrix stretches, which leaves gaps above and below them.
 */
const NODE_OPTIONS: LayoutOptions = { "elk.alignment": "TOP" };

/** Jobs that need nothing start the run, so they all sit in the top layer. */
const SOURCE_OPTIONS: LayoutOptions = {
  ...NODE_OPTIONS,
  "elk.layered.layering.layerConstraint": "FIRST",
};

const CLUSTER_OPTIONS: LayoutOptions = {
  "elk.padding": `[top=${SIZE.clusterHeader + 8},left=${SIZE.clusterPad},bottom=${SIZE.clusterPad},right=${SIZE.clusterPad}]`,
};

/** Width a cluster needs for its header: chevron, title, status icon and padding. */
export function clusterTitleWidth(title: string): number {
  return Math.ceil(textWidth(title, 600, 12) + 64);
}

/**
 * ELK ignores minimum sizes on clusters laid out with their children, so the
 * members of a narrow cluster are widened until the cluster title fits.
 */
function widenForClusterTitles(view: ViewGraph, sizes: Map<string, Metrics>): void {
  const titles = new Map(
    view.clusters.map((c) => [c.id, clusterTitleWidth(c.title) - SIZE.clusterPad * 2]),
  );
  for (const node of view.nodes) {
    const needed = node.parent ? titles.get(node.parent) : undefined;
    const size = sizes.get(node.id);
    if (needed === undefined || !size || size.width >= needed) continue;
    const extra = needed - size.width;
    sizes.set(node.id, {
      ...size,
      width: needed,
      pillWidth: size.pillWidth + (node.kind === "job" ? extra : extra / size.columns),
    });
  }
}

let elk: InstanceType<typeof ELK> | undefined;

/** Lays the graph out top-down with ELK's layered algorithm. */
export async function layoutGraph(view: ViewGraph): Promise<Layout> {
  elk ??= new ELK();

  const sizes = new Map(view.nodes.map((n) => [n.id, measure(n)]));
  widenForClusterTitles(view, sizes);
  const bundles = findBundles(view, sizes);
  const bundleOf = new Map<string, Bundle>();
  for (const b of bundles) for (const m of b.members) bundleOf.set(m.id, b);
  const layoutId = (id: string) => bundleOf.get(id)?.id ?? id;

  const clusterNodes = new Map<string, ElkNode>(
    view.clusters.map((c) => [c.id, { id: c.id, layoutOptions: CLUSTER_OPTIONS, children: [] }]),
  );
  const root: ElkNode = { id: "root", layoutOptions: ROOT_OPTIONS, children: [], edges: [] };
  const addedClusters = new Set<string>();
  const addedBundles = new Set<string>();
  const add = (elkNode: ElkNode, parentId: string | undefined) => {
    const parent = parentId ? clusterNodes.get(parentId) : undefined;
    if (parent && parentId) {
      parent.children?.push(elkNode);
      if (!addedClusters.has(parentId)) {
        addedClusters.add(parentId);
        root.children?.push(parent);
      }
    } else {
      root.children?.push(elkNode);
    }
  };

  const hasIncoming = new Set(view.edges.map((e) => e.to));
  const options = (id: string) => (hasIncoming.has(id) ? NODE_OPTIONS : SOURCE_OPTIONS);
  for (const node of view.nodes) {
    const bundle = bundleOf.get(node.id);
    if (bundle) {
      if (addedBundles.has(bundle.id)) continue;
      addedBundles.add(bundle.id);
      add(
        {
          id: bundle.id,
          width: bundle.width,
          height: bundle.height,
          layoutOptions: options(node.id),
        },
        bundle.parent,
      );
      continue;
    }
    const size = sizes.get(node.id) as Metrics;
    add(
      { id: node.id, width: size.width, height: size.height, layoutOptions: options(node.id) },
      node.parent,
    );
  }

  // Edges between layout boxes, with the node edges each one stands for.
  const grouped = new Map<string, { from: string; to: string; edges: Edge[] }>();
  for (const edge of view.edges) {
    const from = layoutId(edge.from);
    const to = layoutId(edge.to);
    if (from === to) continue;
    const key = `${from}\n${to}`;
    const entry = grouped.get(key) ?? { from, to, edges: [] };
    entry.edges.push(edge);
    grouped.set(key, entry);
  }
  const layoutEdges = [...grouped.values()];
  root.edges = layoutEdges.map((e, i): ElkExtendedEdge => ({
    id: `e${i}`,
    sources: [e.from],
    targets: [e.to],
  }));

  const result = await elk.layout(root);

  const absolute = new Map<string, { x: number; y: number }>([["root", { x: 0, y: 0 }]]);
  const nodes = new Map<string, PlacedNode>();
  const clusters = new Map<string, PlacedCluster>();
  const placedBundles = new Map<string, PlacedBundle>();
  const viewNodes = new Map(view.nodes.map((n) => [n.id, n]));
  const bundleById = new Map(bundles.map((b) => [b.id, b]));

  const walk = (elkNode: ElkNode, offsetX: number, offsetY: number) => {
    for (const child of elkNode.children ?? []) {
      const x = offsetX + (child.x ?? 0);
      const y = offsetY + (child.y ?? 0);
      absolute.set(child.id, { x, y });
      const box = { x, y, width: child.width ?? 0, height: child.height ?? 0 };
      const viewNode = viewNodes.get(child.id);
      const bundle = bundleById.get(child.id);
      if (viewNode) {
        nodes.set(child.id, { ...box, node: viewNode, metrics: sizes.get(child.id) as Metrics });
      } else if (bundle) {
        placedBundles.set(bundle.id, {
          ...box,
          id: bundle.id,
          members: bundle.members.map((m) => m.id),
        });
        for (const member of bundle.members) {
          const offset = bundle.offsets.get(member.id) as Box;
          const metrics = sizes.get(member.id) as Metrics;
          nodes.set(member.id, {
            x: x + offset.x,
            y: y + offset.y,
            width: offset.width,
            height: offset.height,
            node: member,
            metrics: { ...metrics, width: offset.width },
          });
        }
      } else {
        clusters.set(child.id, { ...box, id: child.id });
      }
      walk(child, x, y);
    }
  };
  walk(result, 0, 0);

  const edges: PlacedEdge[] = [];
  const collectEdges = (elkNode: ElkNode) => {
    for (const edge of (elkNode.edges ?? []) as ElkExtendedEdge[]) {
      const source = layoutEdges[Number(edge.id.slice(1))];
      if (!source) continue;
      const container = (edge as ElkExtendedEdge & { container?: string }).container ?? elkNode.id;
      const offset = absolute.get(container) ?? { x: 0, y: 0 };
      const points: { x: number; y: number }[] = [];
      for (const section of edge.sections ?? []) {
        for (const p of [section.startPoint, ...(section.bendPoints ?? []), section.endPoint]) {
          const last = points.at(-1);
          const point = { x: p.x + offset.x, y: p.y + offset.y };
          if (!last || last.x !== point.x || last.y !== point.y) points.push(point);
        }
      }
      if (points.length < 2) continue;
      edges.push({
        from: source.from,
        to: source.to,
        fromIds: [...new Set(source.edges.map((e) => e.from))],
        toIds: [...new Set(source.edges.map((e) => e.to))],
        points,
      });
    }
    for (const child of elkNode.children ?? []) collectEdges(child);
  };
  collectEdges(result);

  return {
    width: result.width ?? 0,
    height: result.height ?? 0,
    nodes,
    clusters,
    bundles: placedBundles,
    edges,
  };
}
