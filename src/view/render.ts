import { isActive, STATUS_LABEL } from "../github/status";
import {
  attentionJobs,
  headerText,
  type PlacedBundle,
  type PlacedCluster,
  type PlacedEdge,
  type PlacedNode,
  urgentJobs,
} from "../layout/layout";
import { h, s } from "../lib/dom";
import { formatDuration } from "../lib/duration";
import type { Job, Status } from "../model/types";
import type { ViewCluster, ViewNode } from "../model/view";
import { icon, statusIcon } from "./icons";

/** Order of statuses in summaries and progress bars. */
export const STATUS_ORDER: Status[] = [
  "success",
  "failure",
  "cancelled",
  "running",
  "waiting",
  "queued",
  "pending",
  "neutral",
  "skipped",
  "unknown",
];

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function durationEl(job: Job): HTMLElement | null {
  if (job.startedAt !== undefined) {
    return h(
      "span",
      { class: "dur live", "data-started": job.startedAt },
      formatDuration((Date.now() - job.startedAt) / 1000),
    );
  }
  if (job.durationText) return h("span", { class: "dur" }, job.durationText);
  return null;
}

export function jobTitle(job: Job): string {
  const name = [...job.path, job.name].join(" / ");
  const duration =
    job.startedAt !== undefined
      ? `running for ${formatDuration((Date.now() - job.startedAt) / 1000)}`
      : (job.durationText ?? "");
  return [name, STATUS_LABEL[job.status], duration].filter(Boolean).join(" · ");
}

function jobLink(job: Job, className: string, label: HTMLElement): HTMLElement {
  const attrs = {
    class: `${className} s-${job.status}`,
    title: jobTitle(job),
    "data-job": job.key,
    draggable: "false",
  };
  const children = [statusIcon(job.status), label, durationEl(job)];
  return job.href
    ? h("a", { ...attrs, href: job.href }, ...children)
    : h("div", attrs, ...children);
}

export function pill(job: Job): HTMLElement {
  return jobLink(job, "pill", h("span", { class: "name" }, job.name));
}

export function summaryText(counts: Partial<Record<Status, number>>): string {
  return STATUS_ORDER.filter((st) => (counts[st] ?? 0) > 0)
    .map((st) => `${counts[st]} ${STATUS_LABEL[st].toLowerCase()}`)
    .join(", ");
}

function statusBar(counts: Partial<Record<Status, number>>): HTMLElement {
  const present = STATUS_ORDER.filter((st) => (counts[st] ?? 0) > 0);
  return h(
    "div",
    { class: "bar", role: "img", "aria-label": summaryText(counts) || "No jobs yet" },
    ...present.map((st) => h("span", { class: `seg s-${st}`, style: `flex-grow:${counts[st]}` })),
    present.length === 0 ? h("span", { class: "seg s-pending", style: "flex-grow:1" }) : null,
  );
}

function countsLine(counts: Partial<Record<Status, number>>): HTMLElement {
  return h(
    "div",
    { class: "counts" },
    ...STATUS_ORDER.filter((st) => (counts[st] ?? 0) > 0).map((st) =>
      h(
        "span",
        { class: `count s-${st}`, title: STATUS_LABEL[st] },
        statusIcon(st, 12),
        String(counts[st]),
      ),
    ),
  );
}

function doneCount(node: ViewNode): string {
  const total = node.jobs.length;
  const done = node.jobs.filter((j) => !isActive(j.status)).length;
  return done === total ? plural(total, "job") : `${done}/${total}`;
}

function header(node: ViewNode): HTMLElement {
  const text = headerText(node);
  const summaryHeader = node.collapsed || node.kind === "cluster";
  return h(
    "div",
    { class: summaryHeader ? "head" : "head light" },
    node.collapsible
      ? h(
          "button",
          {
            class: "toggle",
            type: "button",
            "aria-expanded": String(!node.collapsed),
            "aria-label": `${node.collapsed ? "Expand" : "Collapse"} ${text}`,
            title: node.collapsed ? "Expand" : "Collapse",
            "data-toggle": node.id,
          },
          icon(node.collapsed ? "chevron-right" : "chevron-down", "", 14),
        )
      : null,
    summaryHeader
      ? node.kind === "cluster"
        ? icon("workflow", "kind-icon", 14)
        : statusIcon(node.status, 14)
      : null,
    h("span", { class: "title", title: text }, text),
    node.kind === "cluster"
      ? h("span", { class: "meta" }, plural(node.cardCount ?? 0, "card"))
      : null,
    // An untitled group's title is already its job count.
    node.jobs.length > 1 && doneCount(node) !== text
      ? h("span", { class: "meta" }, doneCount(node))
      : null,
  );
}

function matrixBody(node: ViewNode): HTMLElement {
  const state = node.matrixState ?? "loading";
  const text =
    state === "waiting"
      ? "Waiting for pending jobs"
      : state === "not-run"
        ? "Did not run"
        : state === "error"
          ? `${node.matrixSummary ?? "Matrix"} (could not load jobs)`
          : (node.matrixSummary ?? "Loading jobs");
  return h(
    "div",
    { class: `empty-body m-${state}` },
    state === "loading"
      ? h("span", { class: "loader", "aria-hidden": "true" })
      : statusIcon(node.status, 14),
    h("span", {}, text),
  );
}

function collapsedBody(node: ViewNode): HTMLElement[] {
  const attention = attentionJobs(node);
  const urgent = urgentJobs(node).length;
  const parts: HTMLElement[] = [
    h("div", { class: "summary" }, statusBar(node.counts), countsLine(node.counts)),
  ];
  if (attention.length > 0) parts.push(h("div", { class: "attention" }, ...attention.map(pill)));
  if (urgent > attention.length)
    parts.push(h("div", { class: "more" }, `+${urgent - attention.length} more`));
  return parts;
}

export function nodeElement(placed: PlacedNode): HTMLElement {
  const { node, metrics } = placed;
  const style = `left:${placed.x}px;top:${placed.y}px;width:${placed.width}px;height:${placed.height}px`;

  if (node.kind === "job") {
    const job = node.jobs[0];
    if (!job) return h("div", { class: "node job", style, "data-id": node.id });
    const label = h(
      "span",
      { class: "name" },
      node.subtitle ? h("span", { class: "sub" }, `${node.subtitle} / `) : null,
      job.name,
    );
    const el = jobLink(job, "node job", label);
    el.setAttribute("style", style);
    el.dataset.id = node.id;
    return el;
  }

  const children: (HTMLElement | null)[] = [metrics.header ? header(node) : null];
  if (node.kind === "cluster" || node.collapsed) {
    children.push(...collapsedBody(node));
  } else if (node.jobs.length === 0) {
    children.push(matrixBody(node));
  } else {
    children.push(
      h(
        "div",
        {
          class: metrics.header ? "jobs" : "jobs no-head",
          style: `grid-template-columns:repeat(${metrics.columns}, ${metrics.pillWidth}px)`,
        },
        ...node.jobs.map(pill),
      ),
    );
  }

  return h(
    "div",
    {
      class: `node ${node.kind} s-${node.status}${node.collapsed ? " collapsed" : ""}`,
      style,
      "data-id": node.id,
    },
    ...children,
  );
}

export function clusterElement(placed: PlacedCluster, cluster: ViewCluster): HTMLElement {
  return h(
    "div",
    {
      class: `cluster s-${cluster.status}`,
      style: `left:${placed.x}px;top:${placed.y}px;width:${placed.width}px;height:${placed.height}px`,
      "data-cluster": cluster.id,
    },
    h(
      "div",
      {
        class: "cluster-head",
        title: `${cluster.title}: ${summaryText(cluster.counts) || "no jobs yet"}`,
      },
      h(
        "button",
        {
          class: "toggle",
          type: "button",
          "aria-expanded": "true",
          "aria-label": `Collapse ${cluster.title}`,
          title: "Collapse",
          "data-toggle": cluster.id,
        },
        icon("chevron-down", "", 14),
      ),
      h("span", { class: "title" }, cluster.title),
      statusIcon(cluster.status, 12),
    ),
  );
}

export function bundleElement(placed: PlacedBundle): HTMLElement {
  return h("div", {
    class: "bundle",
    style: `left:${placed.x}px;top:${placed.y}px;width:${placed.width}px;height:${placed.height}px`,
    title: "These jobs run in parallel and share the same dependencies",
  });
}

/**
 * Smooth path through the route points (a uniform cubic B-spline, as in d3's
 * curveBasis). It starts and ends exactly at the node ports.
 */
const r = (n: number) => Math.round(n * 10) / 10;

export function smoothPath(points: { x: number; y: number }[]): string {
  const [first, second] = points;
  if (!first || !second) return "";
  if (points.length === 2) return `M${first.x},${first.y}L${second.x},${second.y}`;
  let d = `M${r(first.x)},${r(first.y)}`;
  let x0 = first.x;
  let y0 = first.y;
  let x1 = second.x;
  let y1 = second.y;
  d += `L${r((5 * x0 + x1) / 6)},${r((5 * y0 + y1) / 6)}`;
  const curve = (x: number, y: number) => {
    d += `C${r((2 * x0 + x1) / 3)},${r((2 * y0 + y1) / 3)} ${r((x0 + 2 * x1) / 3)},${r((y0 + 2 * y1) / 3)} ${r((x0 + 4 * x1 + x) / 6)},${r((y0 + 4 * y1 + y) / 6)}`;
    x0 = x1;
    y0 = y1;
    x1 = x;
    y1 = y;
  };
  for (const p of points.slice(2)) curve(p.x, p.y);
  curve(x1, y1);
  d += `L${r(x1)},${r(y1)}`;
  return d;
}

export function edgeElement(edge: PlacedEdge): SVGPathElement {
  return s("path", {
    class: "edge",
    d: smoothPath(edge.points),
    "data-from": edge.from,
    "data-to": edge.to,
  });
}
