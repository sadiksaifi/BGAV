import { describe, expect, it } from "vitest";
import { isRunPage } from "./route";

describe("isRunPage", () => {
  it.each([
    "/sadiksaifi/bgav/actions/runs/123",
    "/sadiksaifi/bgav/actions/runs/123/",
    "/sadiksaifi/bgav/actions/runs/123/attempts/2",
  ])("matches run summary page %s", (path) => {
    expect(isRunPage(path)).toBe(true);
  });

  it.each([
    "/sadiksaifi/bgav",
    "/sadiksaifi/bgav/actions",
    "/sadiksaifi/bgav/actions/runs/123/job/456",
    "/sadiksaifi/bgav/actions/runs/123/workflow",
    "/sadiksaifi/bgav/actions/workflows/ci.yml",
  ])("ignores %s", (path) => {
    expect(isRunPage(path)).toBe(false);
  });
});
