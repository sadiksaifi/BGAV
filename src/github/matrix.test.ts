import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MatrixLoader } from "./matrix";

const URL = "/o/r/actions/runs/1/graph/matrix/abc?attempt=1&expanded=false";
const EMPTY = "<div></div>";
const RUNNING_JOB = `<streaming-graph-job data-job-id="1" data-external-id="x">
  <a class="WorkflowJob-title" href="/o/r/actions/runs/1/job/1">
    <svg aria-label="currently running: " class="anim-rotate"></svg>
    <span class="css-truncate">build</span>
  </a>
</streaming-graph-job>`;

/** Lets the loader's fetch and its handlers run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

let now = 0;
const fetchMock = vi.fn<typeof fetch>();

function respond(status: number, body = EMPTY): void {
  fetchMock.mockResolvedValueOnce(new Response(body, { status }));
}

beforeEach(() => {
  now = 1_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function sync(
  loader: MatrixLoader,
  running: boolean,
  signature = "running|0/2",
): Promise<void> {
  loader.sync("card", URL, signature, running);
  await settle();
  await settle();
}

describe("MatrixLoader", () => {
  it("polls a running matrix whose jobs do not exist yet", async () => {
    const loader = new MatrixLoader(() => {});
    respond(200);
    await sync(loader, true);
    expect(loader.jobs("card")).toEqual([]);

    respond(200, RUNNING_JOB);
    now += 16_000;
    await sync(loader, true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(loader.jobs("card")?.[0]?.status).toBe("running");
  });

  it("stops polling once the matrix has finished", async () => {
    const loader = new MatrixLoader(() => {});
    respond(200);
    await sync(loader, false, "success|2 jobs completed");
    now += 60_000;
    await sync(loader, false, "success|2 jobs completed");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("backs off after server errors and gives up after five tries", async () => {
    const loader = new MatrixLoader(() => {});
    const waits = [15_000, 30_000, 60_000, 120_000];
    respond(500);
    await sync(loader, false);
    for (const [i, wait] of waits.entries()) {
      now += wait - 1_000;
      await sync(loader, false);
      expect(fetchMock).toHaveBeenCalledTimes(i + 1);
      now += 2_000;
      respond(500);
      await sync(loader, false);
      expect(fetchMock).toHaveBeenCalledTimes(i + 2);
    }
    expect(loader.failed("card")).toBe(true);
    now += 3_600_000;
    await sync(loader, false);
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("does not retry a matrix that is not found", async () => {
    const loader = new MatrixLoader(() => {});
    respond(404);
    await sync(loader, true);
    now += 3_600_000;
    await sync(loader, true, "running|1/2");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
