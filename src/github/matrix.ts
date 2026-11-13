import { isActive } from "./status";
import type { Job } from "../model/types";
import { parseMatrixJobs } from "./parse";

interface Entry {
  /** The partial's URL, including `attempt`; a re-run changes it. */
  url: string;
  jobs?: Job[];
  /** GitHub's collapsed summary when the jobs were fetched; a change means new data. */
  signature?: string;
  fetchedAt: number;
  inFlight: boolean;
  failed: boolean;
  /** Failed fetches in a row. */
  failures: number;
  /** False after an error that a retry cannot fix, such as a 404. */
  retryable: boolean;
}

const MAX_CONCURRENT = 4;
/** How often to refetch a matrix that still has unfinished jobs. */
const ACTIVE_REFRESH_MS = 15_000;
/** Retries after a failed fetch wait 15 s, 30 s, 60 s and 120 s, then stop. */
const MAX_FAILURES = 5;

class HttpError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
  }
}

/**
 * Fetches the full job list of matrix cards. GitHub's own graph only shows a
 * collapsed summary until you click "Show all jobs", so BGAV requests the same
 * partial with `expanded=true`. Requests go to github.com with the user's session.
 */
export class MatrixLoader {
  private entries = new Map<string, Entry>();
  private queue: { cardId: string; url: string; entry: Entry }[] = [];
  private running = 0;

  constructor(private readonly onLoad: () => void) {}

  jobs(cardId: string): Job[] | undefined {
    return this.entries.get(cardId)?.jobs;
  }

  failed(cardId: string): boolean {
    return this.entries.get(cardId)?.failed ?? false;
  }

  /**
   * Requests a fetch when the matrix is new, its summary changed, or it is still
   * running. `running` is true while GitHub's summary says jobs are running,
   * queued or waiting, which also covers a matrix whose jobs do not exist yet.
   */
  sync(cardId: string, url: string, signature: string, running = false): void {
    const key = normalizeUrl(url);
    const entry = this.entries.get(cardId);
    // A different URL is a different matrix (such as a re-run attempt): start over.
    if (!entry || entry.url !== key) {
      this.entries.set(cardId, {
        url: key,
        fetchedAt: 0,
        inFlight: false,
        failed: false,
        failures: 0,
        retryable: true,
      });
      this.enqueue(cardId, url, signature);
      return;
    }
    if (entry.inFlight) return;
    const age = Date.now() - entry.fetchedAt;
    // GitHub re-renders the collapsed summary when a matrix job finishes, which
    // changes the signature. Job starts do not change it, so poll while jobs run.
    const changed = entry.signature !== signature;
    // After a failure, every retry waits out the backoff, even when the summary changed.
    const due = entry.failed
      ? entry.retryable &&
        entry.failures < MAX_FAILURES &&
        age > ACTIVE_REFRESH_MS * 2 ** (entry.failures - 1)
      : changed ||
        (age > ACTIVE_REFRESH_MS &&
          (running || (entry.jobs?.some((j) => isActive(j.status)) ?? false)));
    if (due) this.enqueue(cardId, url, signature);
  }

  clear(): void {
    this.entries.clear();
    this.queue = [];
  }

  private enqueue(cardId: string, url: string, signature?: string): void {
    const entry = this.entries.get(cardId);
    if (!entry) return;
    entry.inFlight = true;
    if (signature !== undefined) entry.signature = signature;
    this.queue.push({ cardId, url, entry });
    this.pump();
  }

  private pump(): void {
    while (this.running < MAX_CONCURRENT && this.queue.length > 0) {
      const next = this.queue.shift();
      if (!next) break;
      this.running++;
      void this.load(next.cardId, next.url, next.entry).finally(() => {
        this.running--;
        this.pump();
      });
    }
  }

  private async load(cardId: string, url: string, entry: Entry): Promise<void> {
    // The entry was replaced or cleared while this request waited in the queue.
    if (this.entries.get(cardId) !== entry) return;
    try {
      const target = new URL(url, location.origin);
      target.searchParams.set("expanded", "true");
      const response = await fetch(target, {
        credentials: "same-origin",
        headers: { "X-Requested-With": "XMLHttpRequest", Accept: "text/html" },
      });
      if (!response.ok) throw new HttpError(response.status);
      const html = await response.text();
      if (this.entries.get(cardId) !== entry) return;
      entry.jobs = parseMatrixJobs(html, cardId);
      entry.failed = false;
      entry.failures = 0;
    } catch (error) {
      if (this.entries.get(cardId) !== entry) return;
      entry.failed = true;
      entry.failures++;
      // Client errors other than rate limits will fail the same way again.
      if (error instanceof HttpError && error.status >= 400 && error.status < 500)
        entry.retryable = error.status === 429;
      console.warn("[BGAV] Could not load matrix jobs", url, error);
    } finally {
      entry.fetchedAt = Date.now();
      entry.inFlight = false;
    }
    if (this.entries.get(cardId) === entry) this.onLoad();
  }
}

function normalizeUrl(url: string): string {
  const parsed = new URL(url, location.origin);
  parsed.searchParams.delete("expanded");
  parsed.searchParams.sort();
  return parsed.pathname + parsed.search;
}
