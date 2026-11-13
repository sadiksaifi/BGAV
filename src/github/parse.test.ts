import { describe, expect, it } from "vitest";
import { fixture, graphFixture } from "../test/fixtures";
import { parseMatrixJobs } from "./parse";

describe("parseGraph", () => {
  it("reads every card, job and edge of a large completed run", () => {
    const graph = graphFixture("uv-graph.html");
    expect(graph.workflowName).toBe("ci.yml");
    expect(graph.trigger).toBe("on: push");
    expect(graph.cards).toHaveLength(47);
    expect(graph.edges).toHaveLength(83);
    expect(graph.cards.filter((c) => c.kind === "matrix")).toHaveLength(20);
  });

  it("reads a reusable-workflow group with its caller path", () => {
    const graph = graphFixture("uv-graph.html");
    const group = graph.cards.find((c) => c.jobs.some((j) => j.name === "linux libc"));
    expect(group?.kind).toBe("group");
    expect(group?.title).toBe("build-dev-binaries");
    expect(group?.jobs).toHaveLength(11);
    expect(group?.jobs[0]).toMatchObject({
      name: "linux libc",
      path: ["build-dev-binaries"],
      status: "success",
      durationText: "1m 5s",
      durationSec: 65,
      href: "/astral-sh/uv/actions/runs/43323057949/job/131548716476",
    });
  });

  it("reads matrix cards with their partial URL and summary", () => {
    const graph = graphFixture("uv-graph.html");
    const matrix = graph.cards.find((c) => c.kind === "matrix" && c.title === "cargo-test-windows");
    expect(matrix?.path).toEqual(["test"]);
    expect(matrix?.matrix?.summary).toBe("3 jobs completed");
    expect(matrix?.matrix?.summaryStatus).toBe("success");
    expect(matrix?.matrix?.url).toMatch(/\/graph\/matrix\/.+\?attempt=1$/);
  });

  it("reads failed, skipped and pending jobs", () => {
    const statuses = new Set(
      graphFixture("uv-graph.html").cards.flatMap((c) => c.jobs.map((j) => j.status)),
    );
    expect(statuses).toEqual(new Set(["success", "failure", "skipped", "pending"]));
  });

  it("reads a running matrix summary", () => {
    const graph = graphFixture("rust-running-graph.html");
    const matrix = graph.cards.find((c) => c.kind === "matrix");
    expect(matrix?.matrix?.summary).toBe("0/11 jobs completed");
    expect(matrix?.matrix?.summaryStatus).toBe("running");
    expect(graph.edges).toHaveLength(3);
  });
});

describe("parseMatrixJobs", () => {
  it("reads running jobs with their start time", () => {
    const jobs = parseMatrixJobs(fixture("rust-running-matrix.html"), "m");
    expect(jobs.length).toBeGreaterThan(0);
    expect(jobs[0]).toMatchObject({ status: "running", name: "PR - test-aarch64-gnu-llvm-22-1" });
    expect(jobs[0]?.startedAt).toBe(Date.parse("2026-11-13T08:51:28Z"));
    expect(new Set(jobs.map((j) => j.key)).size).toBe(jobs.length);
  });

  it("reads finished matrix jobs", () => {
    const jobs = parseMatrixJobs(fixture("uv-matrix-expanded.html"), "m");
    expect(jobs.map((j) => j.name)).toEqual([
      "cargo test on windows 1 of 3",
      "cargo test on windows 2 of 3",
      "cargo test on windows 3 of 3",
    ]);
    expect(jobs.every((j) => j.status === "success" && j.path[0] === "test")).toBe(true);
  });
});
