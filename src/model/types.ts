export type Status =
  | "failure"
  | "running"
  | "waiting"
  | "queued"
  | "pending"
  | "cancelled"
  | "success"
  | "neutral"
  | "skipped"
  | "unknown";

export interface Job {
  /** Unique within a run: the job page id when GitHub links one. */
  key: string;
  /** The workflow job id GitHub uses, such as `build-dev-binaries.build-binary-linux-libc`. */
  jobId: string;
  /** The job's own name, without the reusable-workflow caller prefix. */
  name: string;
  /** Caller segments for jobs from reusable workflows, outermost first. */
  path: string[];
  status: Status;
  /** Duration as GitHub prints it, such as `1m 5s`, for finished jobs. */
  durationText?: string;
  durationSec?: number;
  /** Start time in epoch milliseconds, for running jobs. */
  startedAt?: number;
  href?: string;
}

export type CardKind = "job" | "group" | "matrix";

export interface MatrixInfo {
  /** URL of GitHub's matrix partial, without the `expanded` parameter. */
  url: string;
  /** GitHub's collapsed summary, such as `3 jobs completed`. */
  summary: string;
  summaryStatus: Status;
}

/**
 * One box in GitHub's graph. GitHub puts jobs that share the same upstream and
 * downstream jobs into one card, and gives each matrix its own card.
 */
export interface Card {
  id: string;
  kind: CardKind;
  /** Name for the card: the matrix name, or the caller of a reusable-workflow group. */
  title: string;
  /** Caller segments shared by every job in the card. */
  path: string[];
  jobs: Job[];
  matrix?: MatrixInfo;
  /** Column index in GitHub's left-to-right graph. */
  stage: number;
  order: number;
}

export interface Edge {
  from: string;
  to: string;
}

export interface RunGraph {
  workflowName?: string;
  workflowHref?: string;
  trigger?: string;
  cards: Card[];
  edges: Edge[];
}
