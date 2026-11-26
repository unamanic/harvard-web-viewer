import { describe, expect, it } from "vitest";
import { makeZip } from "./testing/makeZip";
import { ZipError, crc32, isZipName, looksLikeZip, readZip } from "./zip";

const text = (b: Uint8Array) => new TextDecoder().decode(b);

describe("readZip", () => {
  it("reads stored and deflated entries, skipping folders and archiver clutter", async () => {
    const zip = await makeZip(
      [
        { name: "SHOW/", method: 0 },
        { name: "SHOW/SALES.SH3", data: "show bytes ".repeat(50) },
        { name: "SHOW/HG3.PL3", data: "palette", method: 0 },
        { name: "__MACOSX/SHOW/._SALES.SH3", data: "resource fork" },
        { name: "SHOW/.DS_Store", data: "x" },
      ],
      "a comment",
    );
    const { entries, warnings } = await readZip(zip);
    expect(warnings).toEqual([]);
    expect(entries.map((e) => e.path)).toEqual(["SHOW/SALES.SH3", "SHOW/HG3.PL3"]);
    expect(text(entries[0]!.bytes)).toBe("show bytes ".repeat(50));
    expect(text(entries[1]!.bytes)).toBe("palette");
  });

  it("decodes names as code page 437 unless the UTF-8 flag is set", async () => {
    const zip = await makeZip([
      { name: "", nameBytes: new Uint8Array([0x52, 0x84, 0x2e, 0x43, 0x48, 0x33]), data: "a" }, // "Rä.CH3" in CP437
      { name: "Grüße.CH3", flags: 0x800, data: "b" },
    ]);
    expect((await readZip(zip)).entries.map((e) => e.path)).toEqual(["Rä.CH3", "Grüße.CH3"]);
  });

  it("keeps paths inside the archive: backslashes, leading slashes and .. are cleaned", async () => {
    const zip = await makeZip([{ name: "..\\..\\DOS\\CHART.CH3", data: "a" }, { name: "/abs/./B.CH3", data: "b" }]);
    expect((await readZip(zip)).entries.map((e) => e.path)).toEqual(["DOS/CHART.CH3", "abs/B.CH3"]);
  });

  it("skips encrypted, unsupported and damaged entries with a warning", async () => {
    const zip = await makeZip([
      { name: "LOCKED.CH3", data: "a", flags: 1, method: 0 },
      { name: "BZIP.CH3", data: "b", method: 12 },
      { name: "BAD.CH3", data: "c", crc: 1234 },
      { name: "GOOD.CH3", data: "d" },
    ]);
    const { entries, warnings } = await readZip(zip);
    expect(entries.map((e) => e.path)).toEqual(["GOOD.CH3"]);
    expect(warnings).toEqual([
      "LOCKED.CH3: encrypted; skipped",
      "BZIP.CH3: compressed with method 12, which is not supported; skipped",
      "BAD.CH3: damaged (checksum does not match); skipped",
    ]);
  });

  it("stops an entry that unpacks to more than its stated size", async () => {
    const zip = await makeZip([{ name: "BOMB.CH3", data: new Uint8Array(100_000), size: 10 }]);
    const { entries, warnings } = await readZip(zip);
    expect(entries).toEqual([]);
    expect(warnings).toEqual(["BOMB.CH3: unpacks to more than its stated size; skipped"]);
  });

  it("refuses an archive over the total size limit", async () => {
    const zip = await makeZip([{ name: "A.CH3", data: new Uint8Array(600) }, { name: "B.CH3", data: new Uint8Array(600) }]);
    await expect(readZip(zip, { maxEntries: 10, maxTotalBytes: 1000 })).rejects.toThrow(ZipError);
    await expect(readZip(zip, { maxEntries: 1, maxTotalBytes: 1e9 })).rejects.toThrow("more than 1 entries");
  });

  it("throws ZipError for something that is not a ZIP archive, or is cut short", async () => {
    await expect(readZip(new TextEncoder().encode("HGB3 not a zip at all, just some bytes"))).rejects.toThrow(ZipError);
    const zip = await makeZip([{ name: "A.CH3", data: "abc" }]);
    await expect(readZip(zip.subarray(0, zip.length - 10))).rejects.toThrow(ZipError);
  });

  it("reads ZIP64 records (as some archivers write even for small files)", async () => {
    const zip = await makeZip(
      [
        { name: "SHOW.SH3", data: "show ".repeat(20) },
        { name: "PAL.PL3", data: "palette", method: 0 },
      ],
      { zip64: true },
    );
    const { entries, warnings } = await readZip(zip);
    expect(warnings).toEqual([]);
    expect(entries.map((e) => [e.path, text(e.bytes)])).toEqual([
      ["SHOW.SH3", "show ".repeat(20)],
      ["PAL.PL3", "palette"],
    ]);
  });

  it("reads an empty archive", async () => {
    expect(await readZip(await makeZip([]))).toEqual({ entries: [], warnings: [] });
  });
});

describe("zip helpers", () => {
  it("computes the standard CRC-32", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });

  it("recognises archives by name and by signature", async () => {
    expect(isZipName("Sales.ZIP")).toBe(true);
    expect(isZipName("SALES.SH3")).toBe(false);
    expect(looksLikeZip(await makeZip([{ name: "A", data: "a" }]))).toBe(true);
    expect(looksLikeZip(await makeZip([]))).toBe(true);
    expect(looksLikeZip(new TextEncoder().encode("HGB3...."))).toBe(false);
  });
});
