import { describe, expect, it } from "vitest";
import { type OpenedFiles, openFiles } from "../files/openFiles";
import { makeZip } from "../files/testing/makeZip";
import { DocumentLoader, type LoaderState } from "./documentLoader";

type Files = { path: string; bytes: Uint8Array }[];

const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0));
const u16 = (v: number) => [v & 0xff, v >> 8];

/** A minimal Harvard Graphics 2.x title chart whose description is `name`. */
function chart(name: string): Uint8Array {
  const rec = (tag: number, data: number[]) => [...u16(tag), ...u16(data.length), ...data];
  return new Uint8Array([
    ...ascii("Falc"),
    ...rec(0, [0, 2, 2, 1]),
    ...rec(30, [...u16(1), ...u16(0)]),
    ...rec(2, [name.length, ...ascii(name)]),
    ...rec(1, []),
  ]);
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

function loader(read: (files: Files) => Promise<OpenedFiles> = openFiles) {
  const states: LoaderState[] = [];
  const l = new DocumentLoader<Files>(read, () => ({}), (s) => states.push(s));
  return { l, states };
}

describe("DocumentLoader", () => {
  it("opens a file, showing Opening… until it is done", async () => {
    const { l, states } = loader();
    await l.open([{ path: "A.CHT", bytes: chart("Alpha") }]);
    expect(states.some((s) => s.loading)).toBe(true);
    expect(l.current).toMatchObject({ loading: false, error: null, picking: null });
    expect(l.current.file?.document?.formatName).toContain("Alpha");
  });

  it("shows only the latest request when an earlier one finishes later", async () => {
    const slow = deferred<OpenedFiles>();
    const { l } = loader((files) => (files[0]!.path === "SLOW.CHT" ? slow.promise : openFiles(files)));
    const first = l.open([{ path: "SLOW.CHT", bytes: chart("Slow") }]);
    await l.open([{ path: "B.CHT", bytes: chart("Beta") }]);
    slow.resolve(await openFiles([{ path: "SLOW.CHT", bytes: chart("Slow") }]));
    await first;
    expect(l.current.file?.document?.formatName).toContain("Beta");
    expect(l.current.loading).toBe(false);
  });

  it("says so when nothing could be read", async () => {
    const { l } = loader();
    await l.open([{ path: "NOTES.TXT", bytes: new Uint8Array([1, 2, 3]) }]);
    expect(l.current.error).toBeNull();
    await l.open([]);
    expect(l.current.error).toBe("None of the chosen files could be read.");
  });

  it("asks which chart to open from an archive holding several, keeping the file shown meanwhile", async () => {
    const { l } = loader();
    await l.open([{ path: "A.CHT", bytes: chart("Alpha") }]);
    const shown = l.current.file;
    const zip = await makeZip([
      { name: "ONE.CHT", data: chart("One") },
      { name: "TWO.CHT", data: chart("Two") },
    ]);
    await l.open([{ path: "BOTH.ZIP", bytes: zip }]);
    expect(l.current.picking?.choices.map((c) => c.name)).toEqual(["ONE.CHT", "TWO.CHT"]);
    expect(l.current.file).toBe(shown);
    expect(l.current.loading).toBe(false);

    await l.pick(l.current.picking!.choices[1]!);
    expect(l.current.picking).toBeNull();
    expect(l.current.file?.document?.formatName).toContain("Two");
    expect(l.current.file?.fileSet.entries()).toHaveLength(2);
  });

  it("repeats the latest request on reload, and switches files within the set", async () => {
    const { l } = loader();
    await l.open([
      { path: "A.CHT", bytes: chart("Alpha") },
      { path: "B.CHT", bytes: chart("Beta") },
    ]);
    const before = l.current.file!;
    await l.select("B.CHT");
    expect(l.current.file?.path).toBe("B.CHT");
    await l.reload({ paletteOverride: "MONOCHRW.PL3" });
    expect(l.current.file?.path).toBe("B.CHT");
    expect(l.current.file).not.toBe(before);
  });

  it("adds files beside the file shown and reopens it", async () => {
    const { l } = loader();
    await l.open([{ path: "D/A.CHT", bytes: chart("Alpha") }]);
    await l.add([{ path: "B.CHT", bytes: chart("Beta") }]);
    expect(l.current.file?.path).toBe("D/A.CHT");
    expect(l.current.file?.fileSet.get("D/B.CHT")).toBeTruthy();
    expect(l.current.addNote).not.toBeNull();
  });
});
