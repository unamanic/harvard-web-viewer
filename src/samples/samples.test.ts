/**
 * Sample regression suite (RENDERER_TASKS task 26).
 *
 * Runs against the real files in samples-private/ (git-ignored, never copied
 * into the repo) and skips when that folder is missing or empty, so CI passes
 * without them. Assertions are counts and booleans only. Override the folder
 * with HWV_SAMPLES_DIR.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OPL_RATE } from "../audio/fm/opl";
import { readMidi } from "../audio/midiFile";
import { channelPlan, renderMidi } from "../audio/synth";
import type { FileEntry, FileSet } from "../files/FileSet";
import { NO_GLYPH, parseFgf } from "../formats/hg3/fgf";
import { readContainer } from "../formats/hg3/container";
import { hg3Parser } from "../formats/hg3/index";
import { parsePalette } from "../formats/hg3/palette";
import { parseShow } from "../formats/hg3/show";
import { decodePcx } from "../formats/pcx/pcx";
import { parseSpeedo } from "../formats/speedo/speedo";
import type { Document } from "../model/document";
import type { Presentation } from "../model/presentation";
import { MAX_DEPTH, currentSlide, navigate, startPlayer } from "../player/player";
import { SceneRenderer } from "../render/SceneRenderer";
import { sampleFiles, samplesWithExtension } from "./loadSamples";

const files = sampleFiles();
const hasSamples = files !== null;

/** Generous: the whole suite takes a few seconds, but parsing is CPU-bound. */
const TIMEOUT = 60_000;

/** Recorded in docs/formats.md "Verified findings". */
const EXPECTED = { charts: 238, shows: 13, palettes: 36, bitmaps: 69, speedoFonts: 15, slides: 430 };

/** Warnings that mean something the sample set used to get right is now broken. */
const REGRESSION_PATTERNS: readonly RegExp[] = [
  /palette file .* not found/i,
  /palette .* (could not be read|is empty)/i,
  /built-in copy of HG3\.PL3/i,
  /bitmap .* not found/i,
  /bitmap .* could not be read/i,
  /names no bitmap/i,
  /unknown shape sub-tag/i,
  /damaged/i,
];

function set(): FileSet {
  if (!files) throw new Error("no samples");
  return files;
}

const charts = () => samplesWithExtension(set(), ".ch3");
const shows = () => samplesWithExtension(set(), ".sh3");
const palettes = () => samplesWithExtension(set(), ".pl3", ".pc3");
const bitmaps = () => samplesWithExtension(set(), ".pcx", ".pcc");
const speedoFonts = () => samplesWithExtension(set(), ".spd");

/** Fails with every problem listed, one per line. */
function expectNoProblems(problems: string[], what: string): void {
  expect(problems, `${problems.length} ${what}:\n${problems.join("\n")}`).toEqual([]);
}

type Parsed = { doc: Document } | { error: string };
const parsedCache = new Map<string, Parsed>();

/** Parse a sample through hg3Parser with the sample set as context, once. */
function parseHg3(entry: FileEntry): Parsed {
  let p = parsedCache.get(entry.path);
  if (!p) {
    try {
      p = { doc: hg3Parser.parse(entry.bytes, entry.name, set().contextFor(entry.path)) };
    } catch (e) {
      p = { error: e instanceof Error ? (e.stack ?? e.message) : String(e) };
    }
    parsedCache.set(entry.path, p);
  }
  return p;
}

/** Slides of a presentation plus, recursively, those of the shows it nests. */
function reachableSlideCount(p: Presentation, chain: readonly string[] = []): number {
  if (chain.includes(p.id) || chain.length >= MAX_DEPTH) return 0;
  let n = p.slides.length;
  for (const s of p.slides) {
    const child = s.kind === "nested" ? (s.nested?.() ?? null) : null;
    if (child) n += reachableSlideCount(child, [...chain, p.id]);
  }
  return n;
}

describe.skipIf(!hasSamples)("sample regression suite (samples-private/)", () => {
  it("every .CH3/.SH3/.PL3/.PC3 reads to its last byte, undamaged and without warnings", () => {
    const problems: string[] = [];
    const docs = samplesWithExtension(set(), ".ch3", ".sh3", ".pl3", ".pc3");
    for (const e of docs) {
      try {
        const c = readContainer(e.bytes);
        if (c.damaged) problems.push(`${e.path}: damaged`);
        if (c.endOffset !== e.bytes.length) problems.push(`${e.path}: stops at ${c.endOffset} of ${e.bytes.length} bytes`);
        for (const w of c.warnings) problems.push(`${e.path}: ${w}`);
      } catch (err) {
        problems.push(`${e.path}: threw ${String(err)}`);
      }
    }
    expectNoProblems(problems, "container problems");
  }, TIMEOUT);

  it("every chart builds exactly one scene with the sample set as context", () => {
    const problems: string[] = [];
    for (const e of charts()) {
      const p = parseHg3(e);
      if ("error" in p) problems.push(`${e.path}: threw ${p.error}`);
      else if (p.doc.scenes.length !== 1) problems.push(`${e.path}: ${p.doc.scenes.length} scenes`);
    }
    expectNoProblems(problems, "charts without exactly one scene");
  }, TIMEOUT);

  it("every chart scene renders to static markup", () => {
    const problems: string[] = [];
    for (const e of charts()) {
      const p = parseHg3(e);
      if ("error" in p) continue; // reported by the test above
      for (const scene of p.doc.scenes) {
        try {
          const html = renderToStaticMarkup(createElement(SceneRenderer, { scene }));
          if (!html.startsWith("<svg")) problems.push(`${e.path}: markup does not start with <svg`);
        } catch (err) {
          problems.push(`${e.path}: render threw ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
        }
      }
    }
    expectNoProblems(problems, "charts that failed to render");
  }, TIMEOUT);

  it("no chart warning indicates a regression (missing palette or bitmap, unknown shape sub-tag, damage)", () => {
    const problems: string[] = [];
    for (const e of charts()) {
      const p = parseHg3(e);
      if ("error" in p) continue;
      for (const w of p.doc.warnings) {
        if (REGRESSION_PATTERNS.some((re) => re.test(w))) problems.push(`${e.path}: ${w}`);
      }
    }
    expectNoProblems(problems, "regression warnings");
  }, TIMEOUT);

  it("every palette parses without warnings", () => {
    const problems: string[] = [];
    for (const e of palettes()) {
      try {
        const { palette, warnings } = parsePalette(e.bytes);
        if (palette.entries.length === 0) problems.push(`${e.path}: no entries`);
        for (const w of warnings) problems.push(`${e.path}: ${w}`);
      } catch (err) {
        problems.push(`${e.path}: threw ${String(err)}`);
      }
    }
    expectNoProblems(problems, "palette problems");
  }, TIMEOUT);

  it("HG3.FGF parses with 22 entries and no warnings", () => {
    const fgf = set().resolve("HG3.FGF");
    expect(fgf, "HG3.FGF is in the sample set").not.toBeNull();
    const { entries, warnings } = parseFgf(fgf!.bytes);
    expect(warnings).toEqual([]);
    expect(entries).toHaveLength(22);
  });

  it("every .SPD parses, and every glyph the HG3.FGF character maps reference decodes", () => {
    const problems: string[] = [];
    const fonts = new Map<string, ReturnType<typeof parseSpeedo>>();
    for (const e of speedoFonts()) {
      try {
        const font = parseSpeedo(e.bytes);
        fonts.set(e.name.toLowerCase(), font);
        for (const w of font.warnings) problems.push(`${e.path}: ${w}`);
      } catch (err) {
        problems.push(`${e.path}: threw ${String(err)}`);
      }
    }
    const fgf = set().resolve("HG3.FGF");
    expect(fgf, "HG3.FGF is in the sample set").not.toBeNull();
    for (const entry of parseFgf(fgf!.bytes).entries) {
      if (!entry.fileName.toLowerCase().endsWith(".spd")) continue;
      const font = fonts.get(entry.fileName.toLowerCase());
      if (!font) {
        problems.push(`${entry.name}: font file ${entry.fileName} not in the sample set or unreadable`);
        continue;
      }
      const bad: string[] = [];
      for (let code = 0; code < 256; code++) {
        const id = entry.charMap[code];
        if (id === NO_GLYPH) continue;
        try {
          if (font.glyph(id) === null) bad.push(`${code}→${id}`);
        } catch (err) {
          bad.push(`${code}→${id} threw ${String(err)}`);
        }
      }
      if (bad.length > 0) problems.push(`${entry.name} (${entry.fileName}): ${bad.length} glyphs failed: ${bad.join(", ")}`);
      // Glyph decoding may add per-glyph warnings after parsing.
      for (const w of font.warnings) problems.push(`${entry.fileName} after decoding: ${w}`);
    }
    expectNoProblems(problems, "Speedo problems");
  }, TIMEOUT);

  it("every .PCX/.PCC decodes without warnings", () => {
    const problems: string[] = [];
    for (const e of bitmaps()) {
      try {
        const img = decodePcx(e.bytes);
        if (img.width <= 0 || img.height <= 0) problems.push(`${e.path}: ${img.width}×${img.height}`);
        for (const w of img.warnings) problems.push(`${e.path}: ${w}`);
      } catch (err) {
        problems.push(`${e.path}: threw ${String(err)}`);
      }
    }
    expectNoProblems(problems, "bitmap problems");
  }, TIMEOUT);

  it("every show produces a presentation", () => {
    const problems: string[] = [];
    for (const e of shows()) {
      const p = parseHg3(e);
      if ("error" in p) problems.push(`${e.path}: threw ${p.error}`);
      else if (!p.doc.presentation) problems.push(`${e.path}: no presentation`);
      else if (p.doc.presentation.slides.length === 0) problems.push(`${e.path}: no slides`);
    }
    expectNoProblems(problems, "shows without a presentation");
  }, TIMEOUT);

  it("every chart slide's kind equals its chart file's document type", () => {
    const problems: string[] = [];
    let checked = 0;
    for (const e of shows()) {
      const { show } = parseShow(readContainer(e.bytes));
      for (const slide of show.slides) {
        if (slide.chartType === null) continue;
        const label = `${e.path} slide ${slide.number}`;
        if (slide.fileName === null) {
          problems.push(`${label}: chart slide without a file name`);
          continue;
        }
        const file = set().resolve(slide.fileName, e.path, "slide");
        if (!file) {
          problems.push(`${label}: ${slide.fileName} not found`);
          continue;
        }
        const type = readContainer(file.bytes).version.documentType;
        if (type !== slide.chartType) {
          problems.push(`${label}: kind 0x${slide.chartType.toString(16)} but ${file.path} is type 0x${type.toString(16)}`);
        }
        checked++;
      }
    }
    expectNoProblems(problems, "slide kind mismatches");
    expect(checked).toBeGreaterThan(0);
  }, TIMEOUT);

  it("playing every show with 'next' ends within slides × 4 steps, and every picture slide builds a scene", () => {
    const problems: string[] = [];
    for (const e of shows()) {
      const p = parseHg3(e);
      if ("error" in p || !p.doc.presentation) continue; // reported above
      const presentation = p.doc.presentation;
      const limit = reachableSlideCount(presentation) * 4;
      let state = startPlayer(presentation);
      let steps = 0;
      while (!state.ended && steps <= limit) {
        const slide = currentSlide(state);
        if (slide?.kind === "picture") {
          try {
            if (slide.scene() === null) problems.push(`${e.path}: picture slide "${slide.label}" has no scene`);
          } catch (err) {
            problems.push(`${e.path}: slide "${slide.label}" threw ${String(err)}`);
          }
        }
        state = navigate(state, { kind: "next" });
        steps++;
      }
      if (!state.ended) problems.push(`${e.path}: not ended after ${limit} steps`);
    }
    expectNoProblems(problems, "show playback problems");
  }, TIMEOUT);

  it("every .MID reads; the six songs are dual-format (base level on channels 13-16) and the shortest renders", () => {
    const midis = samplesWithExtension(files!, ".mid");
    expect(midis).toHaveLength(7);
    const songs = midis.map((e) => ({ name: e.name, song: readMidi(e.bytes) }));
    const withNotes = songs.filter((s) => s.song.events.some((ev) => ev.type === 0x90 && ev.b > 0));
    expect(withNotes).toHaveLength(6); // EMPTY.MID has none
    expect(withNotes.every((s) => channelPlan(s.song).level === "base")).toBe(true);
    const shortest = withNotes.reduce((a, b) => (b.song.duration < a.song.duration ? b : a));
    const pcm = renderMidi(shortest.song).channels[0];
    expect(pcm.length / OPL_RATE).toBeGreaterThan(shortest.song.duration);
    expect(pcm.some((v) => Math.abs(v) > 0.1)).toBe(true);
  }, TIMEOUT);

  it("sample counts match docs/formats.md", () => {
    let slides = 0;
    for (const e of shows()) slides += parseShow(readContainer(e.bytes)).show.slides.length;
    const actual = {
      charts: charts().length,
      shows: shows().length,
      palettes: palettes().length,
      bitmaps: bitmaps().length,
      speedoFonts: speedoFonts().length,
      slides,
    };
    expect(actual, "sample set changed; update formats.md").toEqual(EXPECTED);
  }, TIMEOUT);
});
