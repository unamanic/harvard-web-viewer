import { describe, expect, it } from "vitest";
import { DocumentType } from "../container";
import { leaf } from "../testing/bytes";
import { parseChartData } from "./index";
import { chartWith } from "./testing";

describe("parseChartData", () => {
  it.each([
    [DocumentType.Pie, "pie"],
    [DocumentType.XY, "xy"],
    [DocumentType.Organization, "org"],
    [DocumentType.Title, "title"],
    [DocumentType.Bullet, "bullet"],
    [DocumentType.Table, "table"],
    [DocumentType.Drawing, "none"],
  ])("dispatches type %i to %s", (type, kind) => {
    const { data, warnings } = parseChartData(chartWith(type, []));
    expect(data.kind).toBe(kind);
    expect(warnings).toEqual([]);
  });

  it("keeps data records of a drawing raw", () => {
    const { data } = parseChartData(chartWith(DocumentType.Drawing, [leaf(1500, [1, 2])]));
    expect(data.kind).toBe("none");
    if (data.kind === "none") expect(data.otherRecords.map((r) => r.tag)).toEqual([1500]);
  });

  it("never throws on garbage records", () => {
    for (const type of [DocumentType.Pie, DocumentType.XY, DocumentType.Organization, DocumentType.Bullet, DocumentType.Table]) {
      const recs = [1304, 1310, 1316, 1402, 1406, 1420, 1422, 1424, 914, 1106, 1108, 1208, 1212, 1214].map((t) => leaf(t, [7]));
      expect(() => parseChartData(chartWith(type, recs))).not.toThrow();
    }
  });
});
