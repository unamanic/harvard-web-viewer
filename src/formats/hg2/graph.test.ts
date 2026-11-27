import { describe, expect, it } from "vitest";
import { formatValue, makeScale, niceStep, ticksOf } from "./graph";

const auto = { min: null, max: null, increment: null, log: false };

describe("1.x/2.x value axes", () => {
  it("steps by 1, 2 or 5 times a power of ten, rounding up", () => {
    expect(niceStep(100, 5)).toBe(20);
    expect(niceStep(30, 5)).toBe(10);
    expect(niceStep(0.7, 5)).toBe(0.2);
    expect(niceStep(0, 5)).toBe(1);
  });

  it("covers the values in eight-ish steps (2.x, as the 2.3 screen shows), or uses the chart's settings", () => {
    expect(makeScale([12, 37], auto, true)).toEqual({ min: 0, max: 40, step: 5, log: false });
    expect(makeScale([12, 37], auto, false)).toEqual({ min: 10, max: 40, step: 5, log: false });
    expect(makeScale([12, 37], { ...auto, min: 5, max: 50, increment: 15 }, true)).toEqual({ min: 5, max: 50, step: 15, log: false });
    expect(makeScale([], auto, false)).toEqual({ min: 0, max: 1, step: 0.2, log: false });
    // The story show's disk chart on 2.3's screen: 0 to 14 in steps of 2.
    expect(makeScale([0.36, 6.5, 12.2], auto, true)).toEqual({ min: 0, max: 14, step: 2, log: false });
  });

  it("1.0 (A.00) always draws eight steps, and ignores a stored range the data runs past", () => {
    // A.00's screen draws the same chart 0 to 16, though the chart stores 0 to 8.
    expect(makeScale([0.36, 6.5, 12.2], { ...auto, min: 0, max: 8 }, true, "1.0")).toEqual({ min: 0, max: 16, step: 2, log: false });
    expect(makeScale([0.36, 6.5, 12.2], auto, true, "1.0")).toEqual({ min: 0, max: 16, step: 2, log: false });
  });

  it("puts a log axis on whole decades", () => {
    const s = makeScale([3, 450], { ...auto, log: true }, true);
    expect(s).toEqual({ min: 1, max: 1000, step: 10, log: true });
    expect(ticksOf(s)).toEqual([1, 10, 100, 1000]);
  });

  it("lists a tick per step", () => {
    expect(ticksOf({ min: 0, max: 40, step: 10, log: false })).toEqual([0, 10, 20, 30, 40]);
  });
});

describe("formatValue", () => {
  it("formats values, currency and percent, and hides them for none", () => {
    expect(formatValue(1234.5, "value")).toBe("1234.5"); // neither program groups thousands
    expect(formatValue(20, "currency")).toBe("$20");
    expect(formatValue(12.345, "percent")).toBe("12.35%");
    expect(formatValue(5, "none")).toBe("");
    expect(formatValue(2e9, "value")).toBe("2.00e+9");
  });
});
