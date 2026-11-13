import { describe, expect, it } from "vitest";
import {
  centerOn,
  centered,
  clampPan,
  fitScale,
  MAX_SCALE,
  MIN_SCALE,
  zoomAround,
} from "./viewport";

const view = { width: 1000, height: 600 };

describe("fitScale", () => {
  it("never zooms small graphs above 100%", () => {
    expect(fitScale({ width: 200, height: 100 }, view)).toBe(1);
  });

  it("shrinks large graphs to fit inside the margins", () => {
    // (1000 - 48) / 1904 = 0.5
    expect(fitScale({ width: 1904, height: 200 }, view)).toBeCloseTo(0.5);
  });

  it("stays within the scale limits", () => {
    expect(fitScale({ width: 1e6, height: 1e6 }, view)).toBe(MIN_SCALE);
    expect(fitScale({ width: 0, height: 0 }, view)).toBe(1);
  });
});

describe("centered", () => {
  it("puts the content in the middle of the viewport", () => {
    expect(centered({ width: 400, height: 200 }, view, 1)).toEqual({ k: 1, x: 300, y: 200 });
  });
});

describe("zoomAround", () => {
  it("keeps the point under the cursor fixed", () => {
    const t = { x: 50, y: 20, k: 1 };
    const next = zoomAround(t, 2, 250, 120);
    // Content point under (250, 120) before and after the zoom.
    expect((250 - t.x) / t.k).toBeCloseTo((250 - next.x) / next.k);
    expect((120 - t.y) / t.k).toBeCloseTo((120 - next.y) / next.k);
  });

  it("clamps the scale", () => {
    expect(zoomAround({ x: 0, y: 0, k: 1 }, 10, 0, 0).k).toBe(MAX_SCALE);
    expect(zoomAround({ x: 0, y: 0, k: 1 }, 0.01, 0, 0).k).toBe(MIN_SCALE);
  });
});

describe("clampPan", () => {
  const content = { width: 2000, height: 1000 };

  it("leaves a visible pan untouched", () => {
    const t = { x: -100, y: -50, k: 1 };
    expect(clampPan(t, content, view)).toEqual(t);
  });

  it("keeps part of the graph on screen when panned far away", () => {
    expect(clampPan({ x: 5000, y: 5000, k: 1 }, content, view)).toEqual({ k: 1, x: 920, y: 520 });
    expect(clampPan({ x: -5000, y: -5000, k: 1 }, content, view)).toEqual({
      k: 1,
      x: -1920,
      y: -920,
    });
  });
});

describe("centerOn", () => {
  it("moves the box to the center and zooms in to a readable scale", () => {
    const box = { x: 900, y: 400, width: 200, height: 40 };
    const t = centerOn({ x: 0, y: 0, k: 0.3 }, box, view);
    expect(t.k).toBe(0.8);
    expect(t.x + (box.x + box.width / 2) * t.k).toBeCloseTo(view.width / 2);
    expect(t.y + (box.y + box.height / 2) * t.k).toBeCloseTo(view.height / 2);
  });

  it("does not zoom out when already closer", () => {
    const t = centerOn({ x: 0, y: 0, k: 1.5 }, { x: 0, y: 0, width: 100, height: 30 }, view);
    expect(t.k).toBe(1.5);
  });
});
