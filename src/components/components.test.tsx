import { describe, expect, it, vi } from "vitest";
import { isValidElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { App } from "../App";
import { FileSet } from "../files/FileSet";
import { DocumentType } from "../formats/hg3/container";
import { block, buildDocument, cstr, leaf } from "../formats/hg3/testing/bytes";
import { LANDSCAPE_VIEW_BOX, type Presentation, type PresentationSlide, type Scene } from "../formats/types";
import { openEntry } from "../loadFile";
import { collectDiagnostics } from "../ui/diagnostics";
import { recordTreeOf } from "../ui/recordTree";
import { DiagnosticsPanel } from "./DiagnosticsPanel";
import { FileList } from "./FileList";
import { HexInspector } from "./HexInspector";
import { Inspector } from "./Inspector";
import { RecordTree } from "./RecordTree";
import { SlideStrip } from "./SlideStrip";
import { Viewer } from "./Viewer";

const empty = new Uint8Array();
const chartBytes = () =>
  buildDocument("HGB3", DocumentType.Title, [block(500, [leaf(400, cstr("Hello"))]), block(504, [block(516, [], new Uint8Array(16))])]);

describe("App", () => {
  it("explains what it opens and that nothing is uploaded when empty", () => {
    const html = renderToStaticMarkup(<App />);
    expect(html).toContain("Harvard Web Viewer");
    for (const ext of [".SH3", ".CH3", ".PL3", ".PC3"]) expect(html).toContain(ext);
    expect(html).toContain("whole folder");
    expect(html).toContain("never uploaded");
    expect(html).toContain("Choose files");
    expect(html).toContain("Choose folder");
    expect(html).toContain("Settings");
    expect(html).not.toContain("Opened files");
  });

  it("lists the opened files grouped beside the file shown", () => {
    const set = new FileSet([
      { path: "D/A.CH3", bytes: chartBytes() },
      { path: "D/S.SH3", bytes: empty },
      { path: "D/HG3.PL3", bytes: empty },
    ]);
    const file = openEntry(set, set.get("D/A.CH3")!);
    const html = renderToStaticMarkup(<App initialFile={file} />);
    expect(html).toContain('aria-label="Opened files"');
    const shows = html.indexOf("Shows");
    const charts = html.indexOf("Charts");
    const other = html.indexOf("Other files");
    expect(shows).toBeGreaterThan(-1);
    expect(shows).toBeLessThan(charts);
    expect(charts).toBeLessThan(other);
    expect(html).toContain("Open files");
    expect(html).toContain("Present");
    expect(html).toContain("Diagnostics");
    expect(html).toContain("File structure and bytes");
  });
});

describe("FileList", () => {
  it("groups files and marks the current one", () => {
    const set = new FileSet([
      { path: "B.CH3", bytes: empty },
      { path: "A.SH3", bytes: empty },
      { path: "sub/HG3.PL3", bytes: empty },
    ]);
    const html = renderToStaticMarkup(<FileList entries={set.entries()} current="B.CH3" onSelect={() => {}} />);
    expect(html.match(/<h2/g)).toHaveLength(3);
    expect(html).toMatch(/aria-current="page"[^>]*title="B.CH3"/);
    expect(html).toContain('<span class="file-dir">sub</span>');
  });
});

describe("DiagnosticsPanel", () => {
  it("is closed by default and lists warnings, slide warnings and late missing files", () => {
    const set = new FileSet([{ path: "S.SH3", bytes: empty }]);
    const file = { ...openEntry(set, set.get("S.SH3")!), warnings: ["odd header"] };
    set.resolve("LATE.CH3", "S.SH3", "slide");
    const slide = { label: "Intro", warnings: () => ["slide problem"] } as unknown as PresentationSlide;
    const html = renderToStaticMarkup(<DiagnosticsPanel diagnostics={collectDiagnostics(file, slide)} path="S.SH3" />);
    expect(html).toMatch(/^<details class="panel diagnostics">/);
    expect(html).toContain("<code>LATE.CH3</code> (slide)");
    expect(html).toContain("odd header");
    expect(html).toContain("Current slide: Intro");
    expect(html).toContain("slide problem");
    expect(html).toContain(">3<");
  });

  it("says when there is nothing to report", () => {
    const set = new FileSet([{ path: "A.CH3", bytes: empty }]);
    const html = renderToStaticMarkup(
      <DiagnosticsPanel diagnostics={collectDiagnostics(openEntry(set, set.get("A.CH3")!), null)} path="A.CH3" />,
    );
    expect(html).toContain("no problems");
  });
});

describe("Inspector", () => {
  it("shows the record tree of an HG3 file next to the hex dump, closed by default", () => {
    const html = renderToStaticMarkup(<Inspector bytes={chartBytes()} />);
    expect(html).toMatch(/^<details class="panel inspector">/);
    expect(html).toContain("signature HGB3 (chart)");
    expect(html).toContain("500…501 header block");
    expect(html).toContain("400 description");
    expect(html).toContain("516…517 objectLayer block");
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain("00000000  48 47 42 33");
  });

  it("marks the selected record and highlights its bytes", () => {
    const bytes = chartBytes();
    const tree = recordTreeOf(bytes);
    if (!tree.ok) throw new Error(tree.error);
    const row = tree.rows.find((r) => r.tag === 400)!;
    const treeHtml = renderToStaticMarkup(<RecordTree rows={tree.rows} selected={row.key} onSelect={() => {}} />);
    expect(treeHtml.match(/aria-pressed="true"/g)).toHaveLength(1);
    const hex = renderToStaticMarkup(<HexInspector bytes={bytes} highlight={{ start: row.start, end: row.end }} />);
    // Record 400 at offset 16: header 90 01 03 00, then "Hi" text.
    expect(hex).toContain("<mark>90</mark>");
    expect(hex).toContain("<mark>H</mark>");
    expect(hex.match(/<mark>[0-9a-f]{2}<\/mark>/g)).toHaveLength(row.end - row.start);
  });

  it("says why there is no tree for other files", () => {
    expect(renderToStaticMarkup(<Inspector bytes={Uint8Array.of(1, 2, 3)} />)).toContain("No record tree");
  });
});

function picture(label: string, background: string): PresentationSlide {
  const scene: Scene = { viewBox: LANDSCAPE_VIEW_BOX, background, elements: [] };
  return { label, kind: "picture", fileName: null, scene: () => scene, warnings: () => [], keys: [], buttons: [], waitForKey: true };
}

const show: Presentation = {
  id: "S.SH3",
  title: "Demo",
  firstSlide: 1,
  globalKeys: [],
  slides: [
    { ...picture("show", "#000"), kind: "empty", scene: () => null },
    picture("first", "#ff0000"),
    { ...picture("tune", "#000"), kind: "sound", scene: () => null },
    picture("third", "#0000ff"),
  ],
};

describe("SlideStrip", () => {
  it("draws a thumbnail per slide from the first, the current one marked", () => {
    const html = renderToStaticMarkup(
      <SlideStrip presentation={show} current={3} displayMode="vga" onJump={() => {}} />,
    );
    expect(html.match(/<li/g)).toHaveLength(3);
    expect(html).toContain('aria-label="Slide 1: first"');
    expect(html).toContain('aria-label="Slide 2: tune (sound)"');
    expect(html).toMatch(/aria-current="step" aria-label="Slide 3: third"/);
    // Without IntersectionObserver (here) thumbnails build at once.
    expect(html.match(/<svg/g)).toHaveLength(2);
  });

  it("jumps to the slide's index when a thumbnail is chosen", () => {
    const onJump = vi.fn();
    const nav = SlideStrip({ presentation: show, current: 1, displayMode: "vga", onJump }) as ReactElement<{
      children: ReactElement<{ children: ReactElement<{ index: number; onSelect: (i: number) => void }>[] }>;
    }>;
    const thumbs = nav.props.children.props.children.filter(isValidElement);
    expect(thumbs.map((t) => t.props.index)).toEqual([1, 2, 3]);
    thumbs[2].props.onSelect(thumbs[2].props.index);
    expect(onJump).toHaveBeenCalledWith(3);
  });
});

describe("Viewer", () => {
  it("plays a show with its strip and offers presentation mode", () => {
    const set = new FileSet([{ path: "S.SH3", bytes: empty }]);
    const base = openEntry(set, set.get("S.SH3")!);
    const file = { ...base, formatName: "Show", document: { formatName: "Harvard Graphics 3 show", scenes: [], warnings: [], presentation: show } };
    const html = renderToStaticMarkup(<Viewer file={file} />);
    expect(html).toContain("Harvard Graphics 3 show");
    expect(html).toContain('aria-roledescription="slide show"');
    expect(html).toContain('aria-label="Slides"');
    expect(html).toContain(">Present</button>");
  });
});
