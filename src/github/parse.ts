import { parseDuration } from "../lib/duration";
import type { Card, CardKind, Edge, Job, MatrixInfo, RunGraph, Status } from "../model/types";
import { statusFromIcon } from "./status";

/** The element GitHub renders the run graph in. It is replaced on live updates. */
export const GRAPH_REGION_SELECTOR = '[role="region"][aria-label="Workflow run graph"]';

const clean = (text: string | null | undefined): string => (text ?? "").replace(/\s+/g, " ").trim();

/** The "Status" value in the run summary next to the graph, such as `Success` or `In progress`. */
export function findRunStatusElement(root: ParentNode = document): Element | null {
  for (const label of root.querySelectorAll("span.color-fg-muted")) {
    if (clean(label.textContent) === "Status") return label.nextElementSibling;
  }
  return null;
}

/** The run's own status, or undefined when the summary is missing or unfamiliar. */
export function readRunStatus(root: ParentNode = document): Status | undefined {
  const text = clean(findRunStatusElement(root)?.textContent);
  if (!text) return undefined;
  const status = statusFromIcon(text, null);
  return status === "unknown" ? undefined : status;
}

export function findGraphRegion(root: ParentNode = document): Element | null {
  return (
    root.querySelector(GRAPH_REGION_SELECTOR) ??
    root.querySelector("action-graph")?.closest("[role=region]") ??
    null
  );
}

/** Reads a `<streaming-graph-job>` element. `fallbackKey` makes the key unique when GitHub gives no job link. */
export function parseJob(el: Element, fallbackKey: string): Job {
  const link = el.querySelector("a.WorkflowJob-title") ?? el.querySelector("a");
  const href = link?.getAttribute("href") ?? undefined;
  const jobNumber = href?.match(/\/job\/(\d+)/)?.[1];
  const externalId = el.getAttribute("data-external-id");
  const key = jobNumber ? `job:${jobNumber}` : externalId ? `ext:${externalId}` : fallbackKey;

  const segments = [...(link ?? el).querySelectorAll("span.css-truncate")]
    .map((span) => clean(span.textContent))
    .filter(Boolean);
  if (segments.length === 0) {
    const tooltip = clean(el.querySelector("tool-tip")?.textContent);
    segments.push(...(tooltip ? tooltip.split(" / ") : [el.getAttribute("data-job-id") ?? "job"]));
  }
  const name = segments.at(-1) ?? "job";
  const path = segments.slice(0, -1);

  const icon = (link ?? el).querySelector("svg");
  const status = statusFromIcon(
    icon?.getAttribute("aria-label") ?? null,
    icon?.getAttribute("class") ?? null,
  );

  const job: Job = {
    key,
    jobId: el.getAttribute("data-job-id") ?? name,
    name,
    path,
    status,
  };
  if (href) job.href = href;

  const time = el.querySelector("relative-time[datetime]");
  const started = time ? Date.parse(time.getAttribute("datetime") ?? "") : Number.NaN;
  if (!Number.isNaN(started)) {
    job.startedAt = started;
  } else {
    const durationEl = (link ?? el).querySelector(
      ".text-small.color-fg-muted, .flex-self-baseline.text-small",
    );
    const text = clean(durationEl?.textContent);
    const seconds = text ? parseDuration(text) : undefined;
    if (text && seconds !== undefined) {
      job.durationText = text;
      job.durationSec = seconds;
    }
  }
  return job;
}

function commonPath(paths: string[][]): string[] {
  const [first, ...rest] = paths;
  if (!first) return [];
  let length = first.length;
  for (const p of rest) {
    let i = 0;
    while (i < length && i < p.length && p[i] === first[i]) i++;
    length = i;
  }
  return first.slice(0, length);
}

function parseMatrix(el: Element): MatrixInfo | undefined {
  const raw = el.getAttribute("data-url");
  if (!raw) return undefined;
  const url = new URL(raw, location.origin);
  url.searchParams.delete("expanded");
  const icon = el.querySelector("svg");
  const summary =
    clean(el.querySelector(".MatrixComponent-collapse--title")?.textContent) ||
    clean(el.querySelector("span.text-semibold")?.textContent) ||
    clean(el.textContent);
  return {
    url: url.pathname + url.search,
    summary: summary.replace(/\s*Show all jobs\s*$/i, ""),
    summaryStatus: statusFromIcon(
      icon?.getAttribute("aria-label") ?? null,
      icon?.getAttribute("class") ?? null,
    ),
  };
}

export function parseCard(el: Element, stage: number, order: number): Card {
  const id = el.id || `card-${stage}-${order}`;
  const matrixEl = el.querySelector(".js-graph-matrix");
  const jobs = [...el.querySelectorAll("streaming-graph-job")].map((jobEl, i) =>
    parseJob(jobEl, `${id}#${i}`),
  );

  let kind: CardKind = jobs.length > 1 ? "group" : "job";
  let title = "";
  let path = commonPath(jobs.map((j) => j.path));
  let matrix: MatrixInfo | undefined;

  if (matrixEl) {
    kind = "matrix";
    matrix = parseMatrix(matrixEl);
    const heading = clean(
      el.querySelector(".WorkflowCard-heading--content, .WorkflowCard-heading")?.textContent,
    );
    const segments = heading
      .replace(/^Matrix:\s*/i, "")
      .split(" / ")
      .map(clean)
      .filter(Boolean);
    title = segments.at(-1) ?? "Matrix";
    path = segments.slice(0, -1);
  } else if (kind === "group") {
    title = path.join(" / ");
  } else {
    title = jobs[0]?.name ?? "";
  }

  const card: Card = { id, kind, title, path, jobs, stage, order };
  if (matrix) card.matrix = matrix;
  return card;
}

export function parseEdges(region: Element, cardIds: Set<string>): Edge[] {
  const seen = new Set<string>();
  const edges: Edge[] = [];
  for (const path of region.querySelectorAll("path[data-from][data-to]")) {
    const from = path.getAttribute("data-from") ?? "";
    const to = path.getAttribute("data-to") ?? "";
    const key = `${from}\n${to}`;
    if (from === to || seen.has(key) || !cardIds.has(from) || !cardIds.has(to)) continue;
    seen.add(key);
    edges.push({ from, to });
  }
  return edges;
}

/** Reads GitHub's rendered run graph into a model. */
export function parseGraph(region: Element): RunGraph {
  const cards: Card[] = [];
  const usedIds = new Set<string>();
  region.querySelectorAll(".WorkflowStage").forEach((stageEl, stage) => {
    [...stageEl.children]
      .filter((child) => child.classList.contains("WorkflowCard"))
      .forEach((cardEl, order) => {
        const card = parseCard(cardEl, stage, order);
        if (usedIds.has(card.id)) return;
        usedIds.add(card.id);
        cards.push(card);
      });
  });

  const graph: RunGraph = { cards, edges: parseEdges(region, usedIds) };
  const workflowLink = region.querySelector('h2 a[href*="/workflow"], h2 a');
  if (workflowLink) {
    graph.workflowName = clean(workflowLink.textContent);
    const href = workflowLink.getAttribute("href");
    if (href) graph.workflowHref = href;
  }
  const trigger = clean(workflowLink?.closest("h2")?.nextElementSibling?.textContent);
  if (trigger) graph.trigger = trigger;
  return graph;
}

/** Reads the jobs from GitHub's expanded matrix partial HTML. */
export function parseMatrixJobs(html: string, cardId: string): Job[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return [...doc.querySelectorAll("streaming-graph-job")].map((el, i) =>
    parseJob(el, `${cardId}#${i}`),
  );
}
