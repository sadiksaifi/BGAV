import { describe, expect, it } from "vitest";
import { aggregateStatus, statusFromIcon } from "./status";

describe("statusFromIcon", () => {
  it("reads GitHub's aria labels", () => {
    expect(statusFromIcon("completed successfully: ", "octicon")).toBe("success");
    expect(statusFromIcon("failed: ", "octicon")).toBe("failure");
    expect(statusFromIcon("skipped: ", "octicon")).toBe("skipped");
    expect(statusFromIcon("currently running: ", "octicon")).toBe("running");
    expect(statusFromIcon("cancelled: ", "octicon")).toBe("cancelled");
  });

  it("falls back to the icon class", () => {
    expect(statusFromIcon(null, "octicon anim-rotate")).toBe("running");
    expect(statusFromIcon("", "octicon octicon-circle")).toBe("pending");
    expect(statusFromIcon(null, "octicon octicon-check-circle-fill")).toBe("success");
    expect(statusFromIcon(null, null)).toBe("unknown");
  });
});

describe("aggregateStatus", () => {
  it("lets a failure win", () => {
    expect(aggregateStatus(["success", "running", "failure"])).toBe("failure");
  });

  it("treats a mix of finished and unstarted jobs as running", () => {
    expect(aggregateStatus(["success", "pending"])).toBe("running");
  });

  it("ignores skipped jobs next to successes", () => {
    expect(aggregateStatus(["success", "skipped"])).toBe("success");
    expect(aggregateStatus(["skipped"])).toBe("skipped");
  });

  it("is pending for an empty set", () => {
    expect(aggregateStatus([])).toBe("pending");
  });
});
