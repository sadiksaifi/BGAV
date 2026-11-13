import { isActive } from "./status";
import type { Job } from "../model/types";
import { parseMatrixJobs } from "./parse";

interface Entry {
  jobs?: Job[];
  /** GitHub's collapsed summary when the jobs were fetched; a change means new data. */
  signature?: string;
  fetchedAt: number;
  inFlight: boolean;
  failed: boolean;
}

const MAX_CONCURRENT = 4;
/** How often to refetch a matrix that still has unfinished jobs. */
const ACTIVE_REFRESH_MS = 15_000;

/**
 * Fetches the full job list of matrix cards. GitHub's own graph only shows a
 * collapsed summary until you click "Show all jobs", so BGAV requests the same
 * partial with `expanded=true`. Requests go to github.com with the user's session.
 */
export class MatrixLoader {
  private entries = new Map<string, Entry>();
  private queue: { cardId: string; url: string }[] = [];
  private running = 0;

  constructor(private readonly onLoad: () => void) {}

  jobs(cardId: string): Job[] | undefined {
    return this.entries.get(cardId)?.jobs;
  }

  failed(cardId: string): boolean {
    return this.entries.get(cardId)?.failed ?? false;
  }

  /** Requests a fetch when the matrix is new, its summary changed, or it is still running. */
  sync(cardId: string, url: string, signature: string): void {
    const entry = this.entries.get(cardId);
    if (!entry) {
      this.entries.set(cardId, { fetchedAt: 0, inFlight: false, failed: false });
      this.enqueue(cardId, url, signature);
      return;
    }
    if (entry.inFlight) return;
    const changed = entry.signature !== signature;
    // GitHub re-renders the collapsed summary when a matrix job finishes, which
    // changes the signature. Job starts do not change it, so poll while jobs run.
    const stale =
      Date.now() - entry.fetchedAt > ACTIVE_REFRESH_MS &&
      (entry.failed || (entry.jobs?.some((j) => isActive(j.status)) ?? false));
    if (changed || stale) this.enqueue(cardId, url, signature);
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
    this.queue.push({ cardId, url });
    this.pump();
  }

  private pump(): void {
    while (this.running < MAX_CONCURRENT && this.queue.length > 0) {
      const next = this.queue.shift();
      if (!next) break;
      this.running++;
      void this.load(next.cardId, next.url).finally(() => {
        this.running--;
        this.pump();
      });
    }
  }

  private async load(cardId: string, url: string): Promise<void> {
    const entry = this.entries.get(cardId);
    if (!entry) return;
    try {
      const target = new URL(url, location.origin);
      target.searchParams.set("expanded", "true");
      const response = await fetch(target, {
        credentials: "same-origin",
        headers: { "X-Requested-With": "XMLHttpRequest", Accept: "text/html" },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      entry.jobs = parseMatrixJobs(await response.text(), cardId);
      entry.failed = false;
    } catch (error) {
      entry.failed = true;
      console.warn("[BGAV] Could not load matrix jobs", url, error);
    } finally {
      entry.fetchedAt = Date.now();
      entry.inFlight = false;
    }
    if (this.entries.get(cardId) === entry) this.onLoad();
  }
}
