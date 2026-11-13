import { aggregateStatus, isActive } from "../github/status";
import type { Card, Edge, Job, RunGraph, Status } from "./types";

/** Groups and matrices with more jobs than this start collapsed. */
export const COLLAPSE_THRESHOLD = 12;

export type MatrixState = "loading" | "waiting" | "not-run" | "loaded" | "error";

export interface ViewNode {
  id: string;
  kind: "job" | "group" | "matrix" | "cluster";
  title: string;
  /** Caller path shown above the title, when no cluster already shows it. */
  subtitle: string;
  jobs: Job[];
  status: Status;
  counts: Partial<Record<Status, number>>;
  collapsible: boolean;
  collapsed: boolean;
  /** Id of the expanded cluster that contains this node. */
  parent?: string;
  matrixState?: MatrixState;
  /** GitHub's collapsed matrix summary, used until the jobs load. */
  matrixSummary?: string;
  /** Number of cards inside a collapsed cluster. */
  cardCount?: number;
}

export interface ViewCluster {
  id: string;
  title: string;
  jobs: Job[];
  status: Status;
  counts: Partial<Record<Status, number>>;
  children: string[];
}

export interface ViewGraph {
  nodes: ViewNode[];
  clusters: ViewCluster[];
  /** Edges drawn, after transitive reduction when it is on. */
  edges: Edge[];
  /** Every dependency between displayed nodes. */
  allEdges: Edge[];
  /**
   * Jobs and dependencies per GitHub card, with the displayed node each card is
   * part of. Timing uses these, so collapsing a cluster does not change it.
   */
  timing: { jobs: Map<string, Job[]>; edges: Edge[]; owner: Map<string, string> };
}

export interface ViewOptions {
  /** Explicit expand (false) or collapse (true) choices, by node or cluster id. */
  collapsed: ReadonlyMap<string, boolean>;
  simplifyEdges: boolean;
  /** Jobs of matrix cards loaded from GitHub's expanded matrix partial. */
  matrixJobs: (cardId: string) => Job[] | undefined;
  matrixFailed: (cardId: string) => boolean;
}

export function countStatuses(jobs: readonly Job[]): Partial<Record<Status, number>> {
  const counts: Partial<Record<Status, number>> = {};
  for (const job of jobs) counts[job.status] = (counts[job.status] ?? 0) + 1;
  return counts;
}

const notRun = (job: Job): Job => (job.status === "pending" ? { ...job, status: "skipped" } : job);

export const clusterId = (caller: string): string => `cluster:${caller}`;

/**
 * Turns GitHub's cards into the nodes BGAV draws. Cards from the same reusable
 * workflow call are grouped into a cluster when there are at least two of them.
 */
export function buildView(run: RunGraph, options: ViewOptions): ViewGraph {
  const byCaller = new Map<string, Card[]>();
  for (const card of run.cards) {
    const caller = card.path[0];
    if (caller === undefined) continue;
    const list = byCaller.get(caller) ?? [];
    list.push(card);
    byCaller.set(caller, list);
  }
  const clusterOf = new Map<string, string>();
  for (const [caller, cards] of byCaller) {
    if (cards.length < 2) continue;
    for (const card of cards) clusterOf.set(card.id, caller);
  }

  const rawJobs = (card: Card): Job[] =>
    card.kind === "matrix" ? (options.matrixJobs(card.id) ?? card.jobs) : card.jobs;
  // Once the run has finished, jobs still marked pending will never start.
  // GitHub's job list shows them as skipped, so BGAV does too. Without the run's
  // own status, a run with nothing running, queued or waiting counts as finished.
  const settled =
    run.runStatus !== undefined
      ? !isActive(run.runStatus)
      : !run.cards.some(
          (card) =>
            rawJobs(card).some(
              (j) => j.status === "running" || j.status === "queued" || j.status === "waiting",
            ) ||
            (card.matrix !== undefined &&
              ["running", "queued", "waiting"].includes(card.matrix.summaryStatus)),
        );
  const cardJobs = (card: Card): Job[] => (settled ? rawJobs(card).map(notRun) : rawJobs(card));

  const nodes: ViewNode[] = [];
  const clusters = new Map<string, ViewCluster>();
  const collapsedClusterNodes = new Map<string, ViewNode>();
  const remap = new Map<string, string>();

  const timingJobs = new Map<string, Job[]>();
  for (const card of run.cards) {
    const jobs = cardJobs(card);
    timingJobs.set(card.id, jobs);
    const caller = clusterOf.get(card.id);
    if (caller === undefined) {
      remap.set(card.id, card.id);
      nodes.push(cardNode(card, jobs, card.path, options, settled));
      continue;
    }

    const id = clusterId(caller);
    let cluster = clusters.get(id);
    if (!cluster) {
      cluster = { id, title: caller, jobs: [], status: "pending", counts: {}, children: [] };
      clusters.set(id, cluster);
    }
    cluster.jobs.push(...jobs);
    cluster.children.push(card.id);

    if (options.collapsed.get(id) ?? false) {
      // A collapsed cluster takes the place of its first card.
      remap.set(card.id, id);
      if (!collapsedClusterNodes.has(id)) {
        const node: ViewNode = {
          id,
          kind: "cluster",
          title: caller,
          subtitle: "",
          jobs: cluster.jobs,
          status: "pending",
          counts: {},
          collapsible: true,
          collapsed: true,
          cardCount: 0,
        };
        collapsedClusterNodes.set(id, node);
        nodes.push(node);
      }
      continue;
    }

    const node = cardNode(card, jobs, card.path.slice(1), options, settled);
    node.parent = id;
    remap.set(card.id, card.id);
    nodes.push(node);
  }

  const expandedClusters: ViewCluster[] = [];
  for (const cluster of clusters.values()) {
    cluster.status = aggregateStatus(cluster.jobs.map((j) => j.status));
    cluster.counts = countStatuses(cluster.jobs);
    const node = collapsedClusterNodes.get(cluster.id);
    if (node) {
      node.status = cluster.status;
      node.counts = cluster.counts;
      node.cardCount = cluster.children.length;
    } else {
      expandedClusters.push(cluster);
    }
  }

  const seen = new Set<string>();
  const allEdges: Edge[] = [];
  for (const edge of run.edges) {
    const from = remap.get(edge.from);
    const to = remap.get(edge.to);
    if (!from || !to || from === to) continue;
    const key = `${from}\n${to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    allEdges.push({ from, to });
  }

  return {
    nodes,
    clusters: expandedClusters,
    allEdges,
    edges: options.simplifyEdges ? transitiveReduction(allEdges) : allEdges,
    timing: {
      jobs: timingJobs,
      edges: run.edges.filter((e) => timingJobs.has(e.from) && timingJobs.has(e.to)),
      owner: remap,
    },
  };
}

function cardNode(
  card: Card,
  jobs: Job[],
  shownPath: string[],
  options: ViewOptions,
  settled: boolean,
): ViewNode {
  const matrixStatus = card.matrix?.summaryStatus ?? "pending";
  const status =
    card.kind === "matrix" && jobs.length === 0
      ? settled && matrixStatus === "pending"
        ? "skipped"
        : matrixStatus
      : aggregateStatus(jobs.map((j) => j.status));
  const collapsible = card.kind !== "job" && jobs.length > 1;
  const node: ViewNode = {
    id: card.id,
    kind: card.kind,
    title: card.title,
    subtitle: "",
    jobs,
    status,
    counts: countStatuses(jobs),
    collapsible,
    collapsed: collapsible && (options.collapsed.get(card.id) ?? jobs.length > COLLAPSE_THRESHOLD),
  };

  if (card.kind === "group") {
    // A group's title is its jobs' shared caller path; inside a cluster, the
    // cluster header already shows the first segment.
    node.title = shownPath.join(" / ");
  } else {
    node.subtitle = shownPath.join(" / ");
  }

  if (card.kind === "matrix") {
    const loaded = options.matrixJobs(card.id);
    if (card.matrix) node.matrixSummary = card.matrix.summary;
    if (loaded !== undefined && loaded.length > 0) node.matrixState = "loaded";
    else if (jobs.length > 0) node.matrixState = "loaded";
    else if (options.matrixFailed(card.id)) node.matrixState = "error";
    else if (settled && (loaded !== undefined || /waiting/i.test(card.matrix?.summary ?? "")))
      node.matrixState = "not-run";
    else if (loaded !== undefined) node.matrixState = "waiting";
    else node.matrixState = /waiting/i.test(card.matrix?.summary ?? "") ? "waiting" : "loading";
  }
  return node;
}

/**
 * Removes edges implied by longer paths. If A needs B and C, and B needs C, the
 * edge from C to A adds no ordering information, so it is dropped.
 */
export function transitiveReduction(edges: readonly Edge[]): Edge[] {
  const out = new Map<string, string[]>();
  for (const { from, to } of edges) {
    const list = out.get(from) ?? [];
    list.push(to);
    out.set(from, list);
  }
  const reachableWithoutDirect = (from: string, target: string): boolean => {
    const stack = (out.get(from) ?? []).filter((n) => n !== target);
    const visited = new Set<string>(stack);
    while (stack.length > 0) {
      const node = stack.pop() as string;
      if (node === target) return true;
      for (const next of out.get(node) ?? []) {
        if (!visited.has(next)) {
          visited.add(next);
          stack.push(next);
        }
      }
    }
    return false;
  };
  return edges.filter((e) => !reachableWithoutDirect(e.from, e.to));
}

/** Every node upstream and downstream of `id`, including `id`. */
export function lineage(id: string, edges: readonly Edge[]): Set<string> {
  const up = new Map<string, string[]>();
  const down = new Map<string, string[]>();
  for (const { from, to } of edges) {
    (down.get(from) ?? down.set(from, []).get(from))?.push(to);
    (up.get(to) ?? up.set(to, []).get(to))?.push(from);
  }
  const result = new Set<string>([id]);
  for (const map of [up, down]) {
    const stack = [id];
    while (stack.length > 0) {
      const node = stack.pop() as string;
      for (const next of map.get(node) ?? []) {
        if (!result.has(next)) {
          result.add(next);
          stack.push(next);
        }
      }
    }
  }
  return result;
}

/** Seconds a set of parallel jobs took: the longest one, counting running jobs up to `now`. */
function jobsSeconds(jobs: readonly Job[], now: number): number {
  let longest = 0;
  for (const job of jobs) {
    const sec = job.durationSec ?? (job.startedAt !== undefined ? (now - job.startedAt) / 1000 : 0);
    if (sec > longest) longest = sec;
  }
  return longest;
}

/** Seconds a node took: its longest job, counting running jobs up to `now`. */
export function nodeSeconds(node: ViewNode, now: number): number {
  return jobsSeconds(node.jobs, now);
}

/**
 * The chain of dependent jobs with the largest total duration: the jobs that
 * decided how long the run took. It is found over GitHub's cards, so a
 * collapsed cluster keeps the chain inside it, and then mapped onto the
 * displayed nodes. `seconds` is the chain's total.
 */
export function criticalPath(
  view: ViewGraph,
  now: number,
): { nodes: Set<string>; edges: Set<string>; seconds: number } {
  const { jobs, edges: cardEdges, owner } = view.timing;
  const weight = new Map([...jobs].map(([id, list]) => [id, jobsSeconds(list, now)]));
  const preds = new Map<string, string[]>();
  const indegree = new Map<string, number>([...weight.keys()].map((id) => [id, 0]));
  const succs = new Map<string, string[]>();
  for (const { from, to } of cardEdges) {
    (preds.get(to) ?? preds.set(to, []).get(to))?.push(from);
    (succs.get(from) ?? succs.set(from, []).get(from))?.push(to);
    indegree.set(to, (indegree.get(to) ?? 0) + 1);
  }

  const order: string[] = [];
  const queue = [...indegree].filter(([, d]) => d === 0).map(([id]) => id);
  while (queue.length > 0) {
    const id = queue.shift() as string;
    order.push(id);
    for (const next of succs.get(id) ?? []) {
      const d = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, d);
      if (d === 0) queue.push(next);
    }
  }

  const best = new Map<string, { total: number; hops: number; prev?: string }>();
  for (const id of order) {
    let total = 0;
    let hops = 0;
    let prev: string | undefined;
    for (const p of preds.get(id) ?? []) {
      const candidate = best.get(p);
      if (!candidate) continue;
      if (candidate.total > total || (candidate.total === total && candidate.hops + 1 > hops)) {
        total = candidate.total;
        hops = candidate.hops + 1;
        prev = p;
      }
    }
    const entry: { total: number; hops: number; prev?: string } = {
      total: total + (weight.get(id) ?? 0),
      hops,
    };
    if (prev !== undefined) entry.prev = prev;
    best.set(id, entry);
  }

  let end: string | undefined;
  let endTotal = -1;
  for (const [id, entry] of best) {
    if (entry.total > endTotal) {
      endTotal = entry.total;
      end = id;
    }
  }

  const nodes = new Set<string>();
  const edges = new Set<string>();
  if (endTotal <= 0) return { nodes, edges, seconds: 0 };
  let cursor = end;
  while (cursor !== undefined) {
    const node = owner.get(cursor);
    if (node !== undefined) nodes.add(node);
    const prev: string | undefined = best.get(cursor)?.prev;
    const prevNode = prev === undefined ? undefined : owner.get(prev);
    if (prevNode !== undefined && node !== undefined && prevNode !== node)
      edges.add(`${prevNode}\n${node}`);
    cursor = prev;
  }
  return { nodes, edges, seconds: endTotal };
}
