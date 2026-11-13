import { describe, expect, it } from "vitest";
import { smoothPath, summaryText } from "./render";

describe("smoothPath", () => {
  it("draws a straight line between two points", () => {
    expect(
      smoothPath([
        { x: 0, y: 0 },
        { x: 0, y: 50 },
      ]),
    ).toBe("M0,0L0,50");
  });

  it("starts and ends exactly at the route ends", () => {
    const d = smoothPath([
      { x: 10, y: 0 },
      { x: 10, y: 30 },
      { x: 80, y: 30 },
      { x: 80, y: 60 },
    ]);
    expect(d.startsWith("M10,0")).toBe(true);
    expect(d.endsWith("L80,60")).toBe(true);
    expect(d).toContain("C");
  });

  it("is empty without a route", () => {
    expect(smoothPath([])).toBe("");
  });
});

describe("summaryText", () => {
  it("lists counts in status order", () => {
    expect(summaryText({ skipped: 1, failure: 2, success: 3 })).toBe(
      "3 succeeded, 2 failed, 1 skipped",
    );
  });
});
