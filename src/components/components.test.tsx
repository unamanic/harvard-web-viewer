import { describe, expect, it, vi } from "vitest";
import { isValidElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { App } from "../App";
import { FileSet } from "../files/FileSet";
import { DocumentType } from "../formats/hg3/container";
import { block, buildDocument, concat, cstr, leaf, u16 } from "../formats/hg3/testing/bytes";
import { type Presentation, type PresentationSlide } from "../model/presentation";
import { LANDSCAPE_VIEW_BOX, type Scene } from "../model/scene";
import { openEntry, type LoadedFile } from "../files/loadFile";
import { collectDiagnostics } from "../ui/diagnostics";
import { aboutRows } from "../ui/fileFacts";
import { recordTreeOf } from "../ui/recordTree";
import { AboutPanel, AboutRows, NoticeBox } from "./AboutPanel";
import { AppHeader } from "./AppHeader";
import { DiagnosticsPanel } from "./DiagnosticsPanel";
import { ExportMenu } from "./ExportMenu";
import { EmptyState } from "./FileDropzone";
import { FileSwitcher } from "./FileSwitcher";
import { HexInspector } from "./HexInspector";
import { Inspector, RawBytesDrawer } from "./Inspector";
import { RecordTree } from "./RecordTree";
import { PageCards, SlideCards } from "./SlidesColumn";
import { Viewer, isReload } from "./Viewer";
import { VideoExportDialog } from "./VideoExportDialog";
import { show as videoShow, wavBytes } from "../video/testing";

const empty = new Uint8Array();
const chartBytes = (description = "Hello", palette?: string) =>
  buildDocument("HGB3", DocumentType.Title, [
    block(500, [leaf(400, cstr(description)), ...(palette ? [leaf(404, concat(u16(2), u16(0), cstr(palette)))] : [])]),
    block(504, [block(516, [], new Uint8Array(16))]),
  ]);

describe("App", () => {
  it("explains what it opens and that nothing is uploaded when empty", () => {
    const html = renderToStaticMarkup(<App />);
    expect(html).toContain("Harvard Web Viewer");
    expect(html).toContain("Open a chart<br/>from 1986 to 1992.");
    expect(html).toContain("Harvard Graphics 3 (checked against 3.05)");
    expect(html).toContain("Harvard Presentation Graphics A.00 and Harvard Graphics 2.10, 2.12 and 2.30");
    for (const ext of [".SH3", ".CH3", ".CHT", ".PL3", ".PC3", ".SPD", ".FN3", ".PCX", ".PCC", ".WAV", ".ZIP"]) expect(html).toContain(ext);
    expect(html).toContain("whole folder");
    expect(html).toContain("Nothing is uploaded.");
    expect(html).toContain("Choose files…");
    expect(html).toContain("Choose a folder…");
    expect(html).toContain("Drop files or a folder here");
    expect(html).toContain("Supported files");
    // No sample files are bundled, so there is no "Try a sample".
    expect(html).not.toContain("Try a sample");
    expect(html).not.toContain("About this file");
  });

  it("lays out the open file: header buttons, slides, stage and About column", () => {
    const set = new FileSet([
      { path: "D/A.CH3", bytes: chartBytes("Quarterly Sales") },
      { path: "D/S.SH3", bytes: empty },
      { path: "D/HG3.PL3", bytes: empty },
    ]);
    const file = openEntry(set, set.get("D/A.CH3")!);
    const html = renderToStaticMarkup(<App initialFile={file} />);
    expect(html).toContain('<h1 class="app-name">Harvard Web Viewer</h1>');
    expect(html).toContain("Old Harvard Graphics files, readable again.");
    expect(html).toContain(">Present</button>");
    expect(html).toContain("Export PNG / SVG");
    expect(html).toContain("Open a file");
    expect(html).toContain("Open a folder…");
    // The file switcher, grouped.
    expect(html).toContain('id="file-switcher"');
    const shows = html.indexOf('label="Shows (1)"');
    const charts = html.indexOf('label="Charts (1)"');
    const other = html.indexOf('label="Other files (1)"');
    expect(shows).toBeGreaterThan(-1);
    expect(shows).toBeLessThan(charts);
    expect(charts).toBeLessThan(other);
    expect(html).toMatch(/<option value="D\/A.CH3" selected="">/);
    // Slides column, stage, About column, Display settings.
    expect(html).toContain(">Slides</h2>");
    expect(html).toContain('class="slide-card-title"');
    expect(html).toContain("Quarterly Sales");
    expect(html).toContain("A.CH3 · Rendered from the original file, not a screenshot");
    expect(html).toContain("About this file");
    expect(html).toContain("Display");
    expect(html).toContain("Greyscale, white background (MONOCHRW.PL3)");
    expect(html).toContain("Show raw bytes");
    // The phone tab bar.
    expect(html).toContain('aria-label="Sections"');
  });
});

describe("AppHeader", () => {
  it("names the app with its tagline and holds the actions", () => {
    const html = renderToStaticMarkup(
      <AppHeader>
        <button type="button">Present</button>
      </AppHeader>,
    );
    expect(html).toBe(
      '<header class="app-header"><h1 class="app-name">Harvard Web Viewer</h1><p class="app-tagline">Old Harvard Graphics files, readable again.</p><div class="app-actions"><button type="button">Present</button></div></header>',
    );
    const bare = renderToStaticMarkup(<AppHeader tagline={false} heading={false} />);
    expect(bare).toContain('<p class="app-name">');
    expect(bare).not.toContain("readable again");
  });
});

describe("ExportMenu", () => {
  it("offers SVG and two PNG sizes for the page shape", () => {
    const html = renderToStaticMarkup(<ExportMenu viewBox={LANDSCAPE_VIEW_BOX} onExport={() => {}} />);
    expect(html).toContain("Export PNG / SVG</summary>");
    expect(html).toContain('role="group" aria-label="Export the slide shown"');
    expect(html).toContain("SVG (vector, any size)");
    expect(html).toContain("PNG, 1280 × 960");
    expect(html).toContain("PNG, 640 × 480 (original screen size)");
  });

  it("is a disabled button when there is nothing to export", () => {
    const html = renderToStaticMarkup(<ExportMenu viewBox={null} onExport={() => {}} />);
    expect(html).toMatch(/^<button[^>]*disabled=""/);
  });

  it("offers Video… for a show, even on a slide without a picture", () => {
    const html = renderToStaticMarkup(<ExportMenu viewBox={LANDSCAPE_VIEW_BOX} onExport={() => {}} onExportVideo={() => {}} />);
    expect(html).toContain("Export</summary>");
    expect(html).toContain("PNG, 640 × 480");
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain("Video…");
    const noPicture = renderToStaticMarkup(<ExportMenu viewBox={null} onExport={() => {}} onExportVideo={() => {}} />);
    expect(noPicture).toContain("<details");
    expect(noPicture).toContain("No picture on this slide");
    expect(noPicture).toContain("Video…");
  });
});

describe("VideoExportDialog", () => {
  const presentation = videoShow("S", [
    { label: "s", kind: "sound", fileName: "HELLO.WAV" },
    { label: "m", kind: "sound", fileName: "TUNE.MID" },
    { label: "a" },
    { label: "b", waitForKey: false, displaySeconds: 2, effects: { draw: { effect: "wipe", speed: "fast" } } },
  ]);
  const resolveFile = (name: string) => (name === "HELLO.WAV" ? wavBytes([[0, 0.5]], 8000) : null);

  it("is a modal dialog with the options, defaults and the estimate", () => {
    const html = renderToStaticMarkup(
      <VideoExportDialog presentation={presentation} fileName="S.SH3" displayMode="vga" transitionMode="file" resolveFile={resolveFile} onClose={() => {}} />,
    );
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain("Export the show as a video");
    expect(html).toMatch(/type="number"[^>]*value="5"/);
    expect(html).toContain("Include transitions <span class=\"muted\">(From the file)</span>");
    expect(html).toContain("1 WAV sound");
    expect(html).toContain("640 × 480");
    expect(html).toContain("1280 × 960");
    expect(html).toContain("WebM");
    // MP4 only once the browser says it can encode H.264.
    expect(html).not.toContain("MP4 <span");
    expect(html).toContain("About 0:07 · 2 slides · 219 frames at 30 fps");
    expect(html).toContain("Missing sound: TUNE.MID.");
    expect(html).toContain("Checking what this browser can encode");
    expect(html).toMatch(/<button type="submit"[^>]*disabled=""[^>]*>Make video/);
  });

  it("leaves sound off when the show plays none", () => {
    const silent = videoShow("Q", [{ label: "a" }]);
    const html = renderToStaticMarkup(
      <VideoExportDialog presentation={silent} fileName="Q.SH3" displayMode="vga" transitionMode="off" onClose={() => {}} />,
    );
    expect(html).toContain("the show plays no WAV sound");
    expect(html).toMatch(/type="checkbox" disabled=""/);
    expect(html).toContain("About 0:05 · 1 slide · 150 frames");
  });
});

describe("EmptyState", () => {
  it("styles the drop target while something is dragged over", () => {
    expect(renderToStaticMarkup(<EmptyState onFiles={() => {}} over />)).toContain('class="dropzone over"');
  });
});

describe("FileSwitcher", () => {
  it("groups files and selects the current one", () => {
    const set = new FileSet([
      { path: "B.CH3", bytes: empty },
      { path: "A.SH3", bytes: empty },
      { path: "sub/HG3.PL3", bytes: empty },
    ]);
    const html = renderToStaticMarkup(<FileSwitcher entries={set.entries()} current="B.CH3" onSelect={() => {}} />);
    expect(html.match(/<optgroup/g)).toHaveLength(3);
    expect(html).toContain('<option value="B.CH3" selected="">B.CH3</option>');
    expect(html).toContain(">sub/HG3.PL3</option>");
    expect(html).toContain("(3 opened)");
  });
});

/** A chart file with a missing bitmap and font, a decoding note and a font report. */
function chartWithProblems(): LoadedFile {
  const set = new FileSet([{ path: "D/SALES93.CH3", bytes: chartBytes("Quarterly Sales") }]);
  const base = openEntry(set, set.get("D/SALES93.CH3")!);
  set.resolve("LOGO.PCX", "D/SALES93.CH3", "bitmap");
  return {
    ...base,
    warnings: [
      "object layer: odd run length",
      "bitmap LOGO.PCX not found; not drawn",
      "Fonts: Swiss 721 Roman — original BX000003.SPD; Dutch 801 Bold — clone HWV Serif Bold",
    ],
  };
}

describe("AboutRows / aboutRows", () => {
  it("lists what was detected, the chart type, palette, fonts and size", () => {
    const file = chartWithProblems();
    const html = renderToStaticMarkup(<AboutRows rows={aboutRows(file, null)} />);
    expect(html).toContain("<dt>Detected as</dt><dd><span class=\"about-line\">Harvard Graphics 3 chart</span></dd>");
    expect(html).toContain("<dt>Chart type</dt><dd><span class=\"about-line\">Title chart</span></dd>");
    expect(html).toContain("<dt>Palette</dt><dd><span class=\"about-line\">HG3.PL3, built-in copy</span></dd>");
    expect(html).toContain("Swiss 721 Roman — original</span><span class=\"about-line\">Dutch 801 Bold — clone");
    expect(html).toContain(`<dt>Size</dt><dd><span class="about-line">${file.bytes.length} bytes</span></dd>`);
  });

  it("says whether a named palette was found, or the viewer's choice", () => {
    const set = new FileSet([
      { path: "A.CH3", bytes: chartBytes("A", "STANDARD.PL3") },
      { path: "B.CH3", bytes: chartBytes("B", "OTHER.PL3") },
      { path: "standard.pl3", bytes: empty },
    ]);
    const palette = (path: string, override?: string) =>
      aboutRows(openEntry(set, set.get(path)!), null, override).find((r) => r.label === "Palette")?.value[0];
    expect(palette("A.CH3")).toBe("standard.pl3, found");
    expect(palette("B.CH3")).toBe("OTHER.PL3 missing, built-in HG3.PL3 used");
    expect(palette("B.CH3", "MONOCHRW.PL3")).toBe("MONOCHRW.PL3, chosen in Display");
  });
});

describe("NoticeBox", () => {
  it("says things to know in plain words, singular or plural, with every detail behind Show all", () => {
    const file = chartWithProblems();
    const html = renderToStaticMarkup(<NoticeBox diagnostics={collectDiagnostics(file, null)} path={file.path} />);
    expect(html).toContain(">2 things to know</h3>");
    expect(html).toContain("<li>Bitmap LOGO.PCX was not provided, so it is not drawn.</li>");
    expect(html).toContain("<li>1 small problem in the file was worked around.</li>");
    // The repeat of the missing bitmap and the font report are not listed again.
    expect(html).not.toContain("<li>Bitmap LOGO.PCX not found");
    expect(html).toContain("<summary>Show all");
    expect(html).toContain("object layer: odd run length");

    const one = { ...file, warnings: ["object layer: odd run length"] };
    const single = renderToStaticMarkup(<NoticeBox diagnostics={collectDiagnostics(one, null)} path={one.path} />);
    expect(single).toContain(">2 things to know</h3>"); // the missing bitmap is still recorded in the set
    const set = new FileSet([{ path: "X.CH3", bytes: chartBytes() }]);
    const clean = { ...openEntry(set, set.get("X.CH3")!), warnings: ["object layer: odd"] };
    expect(renderToStaticMarkup(<NoticeBox diagnostics={collectDiagnostics(clean, null)} path="X.CH3" />)).toContain(
      ">1 thing to know</h3><p class=\"notice-text\">1 small problem in the file was worked around.</p>",
    );
  });

  it("is only a quiet toggle when nothing needs saying, and absent when there is nothing at all", () => {
    const set = new FileSet([{ path: "X.CH3", bytes: chartBytes() }]);
    const base = openEntry(set, set.get("X.CH3")!);
    const fontsOnly = { ...base, warnings: ["Fonts: Swiss 721 Roman — original BX000003.SPD"] };
    const html = renderToStaticMarkup(<NoticeBox diagnostics={collectDiagnostics(fontsOnly, null)} path="X.CH3" />);
    expect(html).toContain("notice-quiet");
    expect(html).not.toContain("to know");
    expect(renderToStaticMarkup(<NoticeBox diagnostics={collectDiagnostics({ ...base, warnings: [] }, null)} path="X.CH3" />)).toBe("");
  });
});

describe("AboutPanel", () => {
  it("offers Add missing files only when files are missing, and the privacy note with Show raw bytes", () => {
    const file = chartWithProblems();
    const props = { path: file.path, onAddFiles: () => {}, onShowRawBytes: () => {} };
    const html = renderToStaticMarkup(
      <AboutPanel rows={aboutRows(file, null)} diagnostics={collectDiagnostics(file, null)} {...props} />,
    );
    expect(html).toContain("Add missing files…");
    expect(html).toContain('<input type="file" multiple=""');
    expect(html).toContain("Your file is read in this browser tab and never leaves your computer.");
    expect(html).toContain(">Show raw bytes</button>");

    const set = new FileSet([{ path: "X.CH3", bytes: chartBytes() }]);
    const clean = openEntry(set, set.get("X.CH3")!);
    const none = renderToStaticMarkup(
      <AboutPanel rows={aboutRows(clean, null)} diagnostics={collectDiagnostics(clean, null)} {...props} />,
    );
    expect(none).not.toContain("Add missing files");
  });
});

describe("DiagnosticsPanel", () => {
  it("is closed by default and lists warnings, slide warnings and late missing files", () => {
    const set = new FileSet([{ path: "S.SH3", bytes: empty }]);
    const file = { ...openEntry(set, set.get("S.SH3")!), warnings: ["odd header"] };
    set.resolve("LATE.CH3", "S.SH3", "slide");
    const slide = { label: "Intro", warnings: () => ["slide problem"] } as unknown as PresentationSlide;
    const html = renderToStaticMarkup(<DiagnosticsPanel diagnostics={collectDiagnostics(file, slide)} path="S.SH3" />);
    expect(html).toMatch(/^<details class="diagnostics">/);
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
  it("shows the record tree of an HG3 file next to the hex dump", () => {
    const html = renderToStaticMarkup(<Inspector bytes={chartBytes("Hi")} />);
    expect(html).toMatch(/^<div class="inspector-body">/);
    expect(html).toContain("signature HGB3 (chart)");
    expect(html).toContain("500…501 header block");
    expect(html).toContain("400 description");
    expect(html).toContain("516…517 objectLayer block");
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain("00000000  48 47 42 33");
  });

  it("marks the selected record and highlights its bytes", () => {
    const bytes = chartBytes("Hi");
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

  it("opens in a labelled drawer with a close button", () => {
    const html = renderToStaticMarkup(<RawBytesDrawer bytes={chartBytes()} fileName="A.CH3" onClose={() => {}} />);
    expect(html).toContain('role="dialog"');
    expect(html).toContain("Raw bytes of A.CH3");
    expect(html).toContain(">Close</button>");
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
    { ...picture("inner", "#000"), kind: "nested", scene: () => null },
  ],
};

describe("SlideCards", () => {
  it("draws a card per slide from the first, with thumbnail and title, the current one marked", () => {
    const html = renderToStaticMarkup(<SlideCards presentation={show} current={3} displayMode="vga" onJump={() => {}} />);
    expect(html.match(/<li/g)).toHaveLength(4);
    expect(html).toContain('aria-label="Slide 1: first"');
    expect(html).toContain('aria-label="Slide 2: tune (sound)"');
    expect(html).toMatch(/aria-current="step" aria-label="Slide 3: third"/);
    expect(html).toContain('<span class="slide-card-title" aria-hidden="true">first</span>');
    // Nested shows are indented and marked.
    expect(html).toContain('class="slide-card slide-card-nested"');
    expect(html).toContain("Nested show");
    // Without IntersectionObserver (here) thumbnails build at once.
    expect(html.match(/<svg/g)).toHaveLength(2);
  });

  it("jumps to the slide's index when a card is chosen", () => {
    const onJump = vi.fn();
    const list = SlideCards({ presentation: show, current: 1, displayMode: "vga", onJump }) as ReactElement<{
      children: ReactElement<{ index: number; onSelect: (i: number) => void }>[];
    }>;
    const cards = list.props.children.filter(isValidElement);
    expect(cards.map((t) => t.props.index)).toEqual([1, 2, 3, 4]);
    cards[2].props.onSelect(cards[2].props.index);
    expect(onJump).toHaveBeenCalledWith(3);
  });
});

describe("PageCards", () => {
  it("draws one card for a single chart, titled", () => {
    const scene: Scene = { viewBox: LANDSCAPE_VIEW_BOX, background: "#123456", elements: [] };
    const html = renderToStaticMarkup(<PageCards scenes={[scene]} title="Quarterly Sales" current={0} onSelect={() => {}} />);
    expect(html.match(/<li/g)).toHaveLength(1);
    expect(html).toMatch(/aria-current="step" aria-label="Quarterly Sales"/);
    expect(html.match(/<svg/g)).toHaveLength(1);
  });
});

describe("Viewer", () => {
  it("plays a show with its slide cards and offers presentation mode", () => {
    const set = new FileSet([{ path: "S.SH3", bytes: empty }]);
    const base = openEntry(set, set.get("S.SH3")!);
    const file = { ...base, formatName: "Show", document: { formatName: "Harvard Graphics 3 show", scenes: [], warnings: [], presentation: show } };
    const html = renderToStaticMarkup(<Viewer file={file} />);
    expect(html).toContain("Harvard Graphics 3 show");
    expect(html).toContain('aria-roledescription="slide show"');
    expect(html).toContain('aria-labelledby="slides-heading"');
    expect(html).toContain('class="slide-cards"');
    expect(html).toContain(">Present</button>");
    expect(html).toContain("S.SH3 · Slide 1 of 4 · first");
    expect(html).toContain("<dt>Show</dt><dd><span class=\"about-line\">4 slides</span></dd>");
  });

  it("draws a chart in the stage panel with its caption, keeping the SVG's role and label", () => {
    const set = new FileSet([{ path: "SALES93.CH3", bytes: chartBytes("Quarterly Sales") }]);
    const html = renderToStaticMarkup(<Viewer file={openEntry(set, set.get("SALES93.CH3")!)} />);
    expect(html).toContain('<figure class="stage-panel" aria-label="Quarterly Sales">');
    expect(html).toContain('role="img" aria-label="Rendered slide"');
    expect(html).toContain("SALES93.CH3 · Rendered from the original file, not a screenshot");
  });
});

describe("isReload", () => {
  it("is the same path in the same file set or one made from it", () => {
    const set = new FileSet([
      { path: "A.CH3", bytes: new Uint8Array(4) },
      { path: "B.CH3", bytes: new Uint8Array(4) },
    ]);
    const a = openEntry(set, set.get("A.CH3")!);
    expect(isReload(a, openEntry(set, set.get("A.CH3")!))).toBe(true);
    expect(isReload(a, openEntry(set, set.get("B.CH3")!))).toBe(false);
    const added = set.withFiles([{ path: "LOGO.PCX", bytes: new Uint8Array(1) }]);
    expect(isReload(a, openEntry(added, added.get("A.CH3")!))).toBe(true);
    const other = new FileSet([{ path: "A.CH3", bytes: new Uint8Array(4) }]);
    expect(isReload(a, openEntry(other, other.get("A.CH3")!))).toBe(false);
  });
});
