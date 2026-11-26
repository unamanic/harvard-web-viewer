import { readFileSync, readdirSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadEntry, openEntry } from "../loadFile";
import { openFiles } from "./openFiles";
import { makeZip } from "./testing/makeZip";

const SHOW = "HGB1 show";
const CHART = "HGB3 chart";

describe("openFiles", () => {
  it("unpacks an archive under its own path and starts from its one show", async () => {
    const zip = await makeZip([
      { name: "SALES/SALES.SH3", data: SHOW },
      { name: "SALES/Q1.CH3", data: CHART },
      { name: "SALES/Q2.CH3", data: CHART },
      { name: "SALES/HG3.PL3", data: "palette" },
    ]);
    const { fileSet, choices } = await openFiles([{ path: "Sales.zip", bytes: zip }]);
    expect(fileSet.entries().map((e) => e.path)).toEqual([
      "Sales.zip/SALES/HG3.PL3",
      "Sales.zip/SALES/Q1.CH3",
      "Sales.zip/SALES/Q2.CH3",
      "Sales.zip/SALES/SALES.SH3",
    ]);
    expect(choices.map((c) => c.path)).toEqual(["Sales.zip/SALES/SALES.SH3"]);
    // References resolve inside the archive by name, whatever folder or drive the file gives.
    expect(fileSet.contextFor(choices[0]!.path).resolve("C:\\HG3\\DATA\\q1.ch3")?.path).toBe("Sales.zip/SALES/Q1.CH3");
    expect(fileSet.notes).toEqual([]);
  });

  it("offers every show when an archive holds several, else every chart", async () => {
    const shows = await makeZip([
      { name: "A.SH3", data: SHOW },
      { name: "B/B.SH3", data: SHOW },
      { name: "C.CH3", data: CHART },
    ]);
    expect((await openFiles([{ path: "shows.zip", bytes: shows }])).choices.map((c) => c.name)).toEqual(["A.SH3", "B.SH3"]);
    const charts = await makeZip([
      { name: "X.CH3", data: CHART },
      { name: "Y.CH3", data: CHART },
      { name: "LOGO.PCX", data: "pcx" },
    ]);
    expect((await openFiles([{ path: "charts.zip", bytes: charts }])).choices.map((c) => c.name)).toEqual(["X.CH3", "Y.CH3"]);
  });

  it("recognises shows and charts by signature as the file list does", async () => {
    const zip = await makeZip([
      { name: "SHOW.BAK", data: SHOW },
      { name: "README.TXT", data: "words" },
    ]);
    expect((await openFiles([{ path: "a.zip", bytes: zip }])).choices.map((c) => c.name)).toEqual(["SHOW.BAK"]);
  });

  it("offers nothing for an archive without shows or charts, or for files opened directly", async () => {
    const zip = await makeZip([{ name: "HG3.PL3", data: "palette" }]);
    expect((await openFiles([{ path: "pal.zip", bytes: zip }])).choices).toEqual([]);
    const loose = await openFiles([
      { path: "A.SH3", bytes: new TextEncoder().encode(SHOW) },
      { path: "B.SH3", bytes: new TextEncoder().encode(SHOW) },
    ]);
    expect(loose.choices).toEqual([]);
    expect(loose.fileSet.size).toBe(2);
  });

  it("unpacks an archive found by its contents, without a .zip name", async () => {
    const zip = await makeZip([{ name: "A.CH3", data: CHART }]);
    const { fileSet } = await openFiles([{ path: "download", bytes: zip }]);
    expect(fileSet.entries().map((e) => e.path)).toEqual(["download/A.CH3"]);
  });

  it("notes unreadable entries and archives, keeps a broken archive as a file, and shows the notes as warnings", async () => {
    const zip = await makeZip([
      { name: "LOCKED.CH3", data: "a", flags: 1, method: 0 },
      { name: "A.CH3", data: CHART },
    ]);
    const broken = new TextEncoder().encode("PK\u0003\u0004 and then nothing useful");
    const { fileSet } = await openFiles([
      { path: "set.zip", bytes: zip },
      { path: "broken.zip", bytes: broken },
    ]);
    expect(fileSet.notes).toEqual([
      "set.zip: LOCKED.CH3: encrypted; skipped",
      "broken.zip could not be opened: not a ZIP archive, or it is incomplete.",
    ]);
    expect(fileSet.get("broken.zip")).not.toBeNull();
    expect(openEntry(fileSet, fileSet.get("broken.zip")!).warnings).toEqual(fileSet.notes);
    expect(fileSet.withFiles([]).notes).toEqual(fileSet.notes);
  });
});

describe("a zipped show (samples/claude-vs-codex)", () => {
  it("opens the show from one archive and finds every chart and picture it names", async () => {
    const dir = new URL("../../samples/claude-vs-codex/", import.meta.url);
    const names = readdirSync(dir, { recursive: true }).filter((n) => !/[\\/]/.test(n) && /\.(SH3|CH3|PCX)$/i.test(n) && statSync(new URL(n, dir)).isFile());
    expect(names.length).toBeGreaterThan(20);
    const zip = await makeZip(names.map((n) => ({ name: `claude-vs-codex/${n}`, data: new Uint8Array(readFileSync(new URL(n, dir))) })));
    const { fileSet, choices } = await openFiles([{ path: "claude-vs-codex.zip", bytes: zip }]);
    expect(choices.map((c) => c.name)).toEqual(["CLAUDEVX.SH3"]);

    const loaded = await loadEntry(fileSet, choices[0]!);
    expect(loaded.error).toBeNull();
    const presentation = loaded.document?.presentation;
    expect(presentation?.slides.length).toBeGreaterThanOrEqual(20);
    for (const slide of presentation!.slides) slide.scene();
    // Only Harvard Graphics' own files (HG3.PL3, the fonts; not shipped with the sample) may be missing.
    expect(fileSet.missing().map((m) => m.name).filter((n) => /\.(ch3|pcx)$/i.test(n))).toEqual([]);
  });
});
