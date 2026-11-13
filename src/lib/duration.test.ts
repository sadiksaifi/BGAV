import { describe, expect, it } from "vitest";
import { formatDuration, parseDuration } from "./duration";

describe("parseDuration", () => {
  it.each([
    ["0s", 0],
    ["29s", 29],
    ["1m 5s", 65],
    ["1h 2m 5s", 3725],
    ["2d 1h", 176400],
  ])("parses %s", (text, seconds) => expect(parseDuration(text)).toBe(seconds));

  it("rejects other text", () => expect(parseDuration("Waiting")).toBeUndefined());
});

describe("formatDuration", () => {
  it.each([
    [0, "0s"],
    [45, "45s"],
    [65, "1m 5s"],
    [120, "2m"],
    [3725, "1h 2m"],
    [176400, "2d 1h"],
  ])("formats %d", (seconds, text) => expect(formatDuration(seconds)).toBe(text));
});
