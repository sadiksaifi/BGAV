import type { Status } from "../model/types";

const LABEL_RULES: [RegExp, Status][] = [
  [/success|succeeded/, "success"],
  [/fail|timed out|error/, "failure"],
  [/cancel/, "cancelled"],
  [/skip/, "skipped"],
  [/running|in progress/, "running"],
  [/queued/, "queued"],
  [/waiting|action required|requested/, "waiting"],
  [/pending/, "pending"],
  [/neutral/, "neutral"],
];

const CLASS_RULES: [RegExp, Status][] = [
  [/anim-rotate/, "running"],
  [/octicon-check-circle/, "success"],
  [/octicon-x-circle|octicon-alert/, "failure"],
  [/octicon-stop|octicon-circle-slash/, "cancelled"],
  [/octicon-skip/, "skipped"],
  [/octicon-clock|octicon-hourglass/, "queued"],
  [/octicon-dot-fill/, "running"],
  [/octicon-circle\b/, "pending"],
  [/octicon-square/, "neutral"],
];

/** Reads a status from a GitHub status icon's `aria-label` and `class`. */
export function statusFromIcon(label: string | null, className: string | null): Status {
  const l = (label ?? "").toLowerCase();
  if (l) {
    for (const [re, status] of LABEL_RULES) if (re.test(l)) return status;
  }
  const c = className ?? "";
  for (const [re, status] of CLASS_RULES) if (re.test(c)) return status;
  return "unknown";
}

/** Order used to pick one status for a set of jobs, most urgent first. */
const PRIORITY: Status[] = [
  "failure",
  "running",
  "waiting",
  "queued",
  "pending",
  "cancelled",
  "success",
  "neutral",
  "skipped",
  "unknown",
];

export function statusRank(status: Status): number {
  return PRIORITY.indexOf(status);
}

/**
 * One status for a set of jobs. A failure wins. A mix of finished and unstarted
 * jobs counts as running, because the set as a whole is still in progress.
 */
export function aggregateStatus(statuses: Iterable<Status>): Status {
  const seen = new Set(statuses);
  if (seen.size === 0) return "pending";
  if (seen.has("failure")) return "failure";
  if (seen.has("running")) return "running";
  const active = seen.has("waiting") || seen.has("queued") || seen.has("pending");
  const finished = seen.has("success") || seen.has("cancelled") || seen.has("neutral");
  if (active && finished) return "running";
  if (seen.has("waiting")) return "waiting";
  if (seen.has("queued")) return "queued";
  if (seen.has("pending")) return "pending";
  if (seen.has("cancelled")) return "cancelled";
  if (seen.has("success")) return "success";
  if (seen.has("neutral")) return "neutral";
  if (seen.has("skipped")) return "skipped";
  return "unknown";
}

export function isActive(status: Status): boolean {
  return (
    status === "running" || status === "queued" || status === "waiting" || status === "pending"
  );
}

export const STATUS_LABEL: Record<Status, string> = {
  failure: "Failed",
  running: "Running",
  waiting: "Waiting",
  queued: "Queued",
  pending: "Pending",
  cancelled: "Cancelled",
  success: "Succeeded",
  neutral: "Neutral",
  skipped: "Skipped",
  unknown: "Unknown",
};
