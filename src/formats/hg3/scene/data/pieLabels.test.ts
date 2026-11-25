import { describe, expect, it } from "vitest";
import { LabelPlace } from "../../data/pie";
import { DEFAULT_PERCENTS, DEFAULT_VALUES, formatNumber, outsideLineCount, percentOf, sliceLabelTexts, valueText } from "./pieLabels";

const opts = (o: { labels?: boolean; v?: Partial<typeof DEFAULT_VALUES>; p?: Partial<typeof DEFAULT_PERCENTS> } = {}) => ({
  showLabels: o.labels ?? true,
  values: { ...DEFAULT_VALUES, ...o.v },
  percents: { ...DEFAULT_PERCENTS, ...o.p },
});

describe("pie label text", () => {
  it("formats numbers: automatic decimals, fixed decimals, thousands", () => {
    expect(formatNumber(40, null)).toBe("40");
    expect(formatNumber(12.345, null)).toBe("12.35");
    expect(formatNumber(12.5, null)).toBe("12.5");
    expect(formatNumber(40, 2)).toBe("40.00");
    expect(formatNumber(1234567.5, 1, true)).toBe("1,234,567.5");
    expect(formatNumber(-1234, 0, true)).toBe("-1,234");
  });

  it("writes values with currency, scale and affixes (PVCURR, PVSCALE, PVLEAD, PVTRAIL)", () => {
    expect(valueText(40, { ...DEFAULT_VALUES, currency: true })).toBe("$40");
    expect(valueText(40, { ...DEFAULT_VALUES, scale: 10 })).toBe("4");
    expect(valueText(40, { ...DEFAULT_VALUES, scale: 0 })).toBe("40");
    expect(valueText(40, { ...DEFAULT_VALUES, leading: "AB", trailing: "XY" })).toBe("AB40XY");
  });

  it("writes percents with decimals and affixes before the % (PPCTD1, PPCTL, PPCTT)", () => {
    expect(percentOf(0.4, DEFAULT_PERCENTS)).toBe("40%");
    expect(percentOf(2 / 7, DEFAULT_PERCENTS)).toBe("29%");
    expect(percentOf(0.4, { ...DEFAULT_PERCENTS, decimals: 1 })).toBe("40.0%");
    expect(percentOf(0.4, { ...DEFAULT_PERCENTS, leading: "AB", trailing: "XY" })).toBe("AB40XY%");
  });

  it("puts Below items on a second line, Adjacent ones after the name, Inside ones apart", () => {
    expect(sliceLabelTexts("Alpha", 40, 0.4, opts())).toEqual({ outside: ["Alpha", "40"], inside: null });
    expect(sliceLabelTexts("Alpha", 40, 0.4, opts({ p: { show: true } }))).toEqual({ outside: ["Alpha", "40  40%"], inside: null });
    expect(sliceLabelTexts("Alpha", 40, 0.4, opts({ v: { place: LabelPlace.Adjacent } }))).toEqual({ outside: ["Alpha  40"], inside: null });
    expect(sliceLabelTexts("Alpha", 40, 0.4, opts({ v: { place: LabelPlace.Inside } }))).toEqual({ outside: ["Alpha"], inside: "40" });
    expect(sliceLabelTexts("Alpha", 40, 0.4, opts({ labels: false }))).toEqual({ outside: ["40"], inside: null });
    expect(sliceLabelTexts("Alpha", 40, 0.4, opts({ labels: false, v: { show: false } }))).toEqual({ outside: [], inside: null });
  });

  it("counts the outside lines that size the pie", () => {
    expect(outsideLineCount(opts())).toBe(2);
    expect(outsideLineCount(opts({ labels: false }))).toBe(1);
    expect(outsideLineCount(opts({ v: { show: false } }))).toBe(1);
    expect(outsideLineCount(opts({ v: { place: LabelPlace.Adjacent } }))).toBe(1);
    expect(outsideLineCount(opts({ v: { place: LabelPlace.Inside } }))).toBe(1);
    expect(outsideLineCount(opts({ v: { place: LabelPlace.Inside }, p: { show: true } }))).toBe(2);
    expect(outsideLineCount(opts({ labels: false, v: { show: false } }))).toBe(0);
  });
});
