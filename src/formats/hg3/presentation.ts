/**
 * Harvard Graphics 3 show → format-independent presentation (SPEC §4, §7.1).
 *
 * Slide 0 (the show itself) is kept as an empty placeholder so that slide
 * indices match the destinations of key and button tables; playing starts at
 * slide 1 (§4.7). Chart files are looked up at once (so missing files are
 * reported when the show is opened) but parsed and drawn only when the
 * player first asks for the slide's scene. Nested shows are parsed on first
 * use, with a guard against a show that includes itself (§7.1).
 */
import type {
  ButtonBinding,
  Destination,
  KeyBinding,
  ParseContext,
  Presentation,
  PresentationSlide,
  PresentationSlideKind,
  ResolvedFile,
  Scene,
} from "../types";
import { LANDSCAPE_VIEW_BOX } from "../types";
import { chartScene } from "./chartScene";
import { type Container, readContainer } from "./container";
import { HG3_CHARSET } from "./charset";
import { type ResolvedPalette, resolvePaletteOverride } from "./palette";
import {
  type ButtonEntry,
  type Destination as ShowDestination,
  type KeyEntry,
  type Show,
  type Slide,
  parseShow,
} from "./show";

/**
 * Deepest nesting followed. The original allows one level (§7.1); a viewer
 * allows more but must stop somewhere.
 */
export const MAX_NESTING_DEPTH = 8;

/** The 702 fields that may hold the transition (§4.5), kept raw for the transitions task. */
export interface Hg3Transition {
  /** Offset 5 [I: speed 0..2]. */
  speed: number;
  /** Offset 11. */
  transitionA: number;
  /** Offset 12 [I: the more likely transition field]. */
  transitionB: number;
}

/** PC scan codes of extended keys (§4.3) → `KeyboardEvent.key` names. */
const SCAN_CODE_KEYS: ReadonlyMap<number, string> = new Map([
  [0x3b, "F1"],
  [0x3c, "F2"],
  [0x3d, "F3"],
  [0x3e, "F4"],
  [0x3f, "F5"],
  [0x40, "F6"],
  [0x41, "F7"],
  [0x42, "F8"],
  [0x43, "F9"],
  [0x44, "F10"],
  [0x85, "F11"],
  [0x86, "F12"],
  [0x47, "Home"],
  [0x48, "ArrowUp"],
  [0x49, "PageUp"],
  [0x4b, "ArrowLeft"],
  [0x4d, "ArrowRight"],
  [0x4f, "End"],
  [0x50, "ArrowDown"],
  [0x51, "PageDown"],
  [0x52, "Insert"],
  [0x53, "Delete"],
]);

/** Control characters → `KeyboardEvent.key` names. */
const CONTROL_KEYS: ReadonlyMap<number, string> = new Map([
  [8, "Backspace"],
  [9, "Tab"],
  [13, "Enter"],
  [27, "Escape"],
]);

/** The key name of a 704 entry, or null if it names no key we can map. */
export function keyName(entry: Pick<KeyEntry, "char" | "scanCode">): string | null {
  if (entry.char === 0) return SCAN_CODE_KEYS.get(entry.scanCode) ?? null;
  const control = CONTROL_KEYS.get(entry.char);
  if (control) return control;
  if (entry.char < 32 || entry.char === 0x7f) return null;
  return HG3_CHARSET[entry.char] ?? null;
}

export function convertDestination(d: ShowDestination): Destination {
  switch (d.kind) {
    case "slide":
      return { kind: "slide", index: d.index };
    case "unknown":
      return { kind: "none" };
    default:
      return { kind: d.kind };
  }
}

function convertKeys(entries: KeyEntry[], where: string, warnings: string[]): KeyBinding[] {
  const out: KeyBinding[] = [];
  for (const e of entries) {
    if (e.unused) continue;
    const key = keyName(e);
    if (key === null) {
      warnings.push(`${where}: key with character ${e.char} and scan code ${e.scanCode} is not understood; ignored`);
      continue;
    }
    out.push({ key, destination: convertDestination(e.destination) });
  }
  return out;
}

function convertButtons(entries: ButtonEntry[]): ButtonBinding[] {
  return entries.map((b) => ({ name: b.name, destination: convertDestination(b.destination) }));
}

/** The picture of a slide whose file cannot be shown (§7.1): the file name on a blank page. */
export function placeholderScene(fileName: string, reason: string): Scene {
  const font = { fontFamily: "Helvetica, Arial, sans-serif", fontWeight: 400, italic: false } as const;
  return {
    viewBox: LANDSCAPE_VIEW_BOX,
    background: "#000000",
    elements: [
      { kind: "text", x: 0, y: -600, text: fileName, size: 2400, fill: "#ffffff", anchor: "middle", ...font },
      { kind: "text", x: 0, y: 2000, text: reason, size: 1200, fill: "#aaaaaa", anchor: "middle", ...font },
    ],
  };
}

function slideKind(slide: Slide): PresentationSlideKind {
  switch (slide.kindName) {
    case "chart":
      return "picture";
    case "show":
      return slide.number === 0 ? "empty" : "nested";
    case "sound":
    case "midi":
      return "sound";
    default:
      return "empty";
  }
}

/** Run `build` once and cache its result. */
function once<T>(build: () => T): () => T {
  let done = false;
  let value: T;
  return () => {
    if (!done) {
      value = build();
      done = true;
    }
    return value;
  };
}

function tryReadContainer(file: ResolvedFile): { container: Container | null; error: string | null } {
  try {
    return { container: readContainer(file.bytes), error: null };
  } catch (e) {
    return { container: null, error: e instanceof Error ? e.message : String(e) };
  }
}

interface BuildOptions {
  /** Set paths of the shows being played around this one (including it), for the self-inclusion guard. */
  ancestors: ReadonlySet<string>;
  depth: number;
  /**
   * The viewer's palette option (ParseContext.paletteOverride), resolved
   * once for the outermost show and shared by every slide and nested show,
   * so its warnings are reported once: a palette to use in place of each
   * chart's, or null for the charts' own. Absent: resolved by
   * showToPresentation.
   */
  paletteOverride?: ResolvedPalette | null;
}

/** A context for a file of the show: same file set and palette option, own path. */
function contextAt(context: ParseContext, path: string): ParseContext {
  const out: ParseContext = { path, resolve: (n, p) => context.resolve(n, p) };
  if (context.paletteOverride !== undefined) out.paletteOverride = context.paletteOverride;
  return out;
}

function buildSlide(slide: Slide, context: ParseContext, options: BuildOptions, warnings: string[]): PresentationSlide {
  const kind = slideKind(slide);
  const where = `slide ${slide.number}`;
  const slideWarnings: string[] = [];
  const label = slide.description || slide.fileName || (slide.number === 0 ? "Show" : `Slide ${slide.number}`);
  const fileName = slide.fileName;

  // Look the file up now (cheap) so missing files show when the show opens.
  let resolved: ResolvedFile | null = null;
  if (fileName !== null && (kind === "picture" || kind === "nested")) {
    resolved = context.resolve(fileName, kind === "picture" ? "slide" : "nested show");
    if (!resolved) warnings.push(`${where}: file ${fileName} was not opened; shown as an empty slide`);
  }

  const scene = once((): Scene | null => {
    if (kind !== "picture") return null;
    if (fileName === null) return placeholderScene(`Slide ${slide.number}`, "This slide names no file.");
    if (!resolved) return placeholderScene(fileName, "This file was not opened.");
    const { container, error } = tryReadContainer(resolved);
    if (!container || container.kind !== "chart") {
      const why = error ?? `it is a ${container?.kind}, not a chart`;
      slideWarnings.push(`${where}: ${fileName} cannot be drawn: ${why}`);
      return placeholderScene(fileName, "This file cannot be drawn.");
    }
    if (container.damaged) slideWarnings.push(`${where}: ${fileName} is damaged; only the part before the damage was read`);
    slideWarnings.push(...container.warnings.map((w) => `${fileName}: ${w}`));
    const chartWarnings: string[] = [];
    try {
      const result = chartScene(container, contextAt(context, resolved.path), chartWarnings, {
        paletteOverride: options.paletteOverride ?? null,
      });
      slideWarnings.push(...chartWarnings.map((w) => `${fileName}: ${w}`));
      return result;
    } catch (e) {
      slideWarnings.push(`${where}: drawing ${fileName} failed: ${e instanceof Error ? e.message : String(e)}`);
      return placeholderScene(fileName, "This file cannot be drawn.");
    }
  });

  const nested = once((): Presentation | null => {
    if (kind !== "nested" || !resolved || fileName === null) return null;
    if (options.ancestors.has(resolved.path)) {
      slideWarnings.push(`${where}: nested show ${fileName} includes itself; skipped`);
      return null;
    }
    if (options.depth >= MAX_NESTING_DEPTH) {
      slideWarnings.push(`${where}: nested show ${fileName} is nested more than ${MAX_NESTING_DEPTH} deep; skipped`);
      return null;
    }
    const { container, error } = tryReadContainer(resolved);
    if (!container || container.kind !== "show") {
      slideWarnings.push(`${where}: ${fileName} cannot be played: ${error ?? `it is a ${container?.kind}, not a show`}`);
      return null;
    }
    const parsed = parseShow(container);
    const nestedWarnings = [...container.warnings, ...parsed.warnings];
    const result = showToPresentation(parsed.show, contextAt(context, resolved.path), nestedWarnings, {
      ancestors: new Set([...options.ancestors, resolved.path]),
      depth: options.depth + 1,
      paletteOverride: options.paletteOverride ?? null,
    });
    slideWarnings.push(...nestedWarnings.map((w) => `${fileName}: ${w}`));
    return result;
  });

  const out: PresentationSlide = {
    label,
    kind,
    fileName,
    scene,
    warnings: () => slideWarnings,
    keys: slide.number === 0 ? [] : convertKeys(slide.keys, where, warnings),
    buttons: convertButtons(slide.buttons),
    // 702 offset 14: 0xFFFF waits for a key, 0 continues at once (§4.2) [I].
    waitForKey: slide.displayTime === null,
    transition: { speed: slide.speed, transitionA: slide.transitionA, transitionB: slide.transitionB } satisfies Hg3Transition,
  };
  if (kind === "nested") out.nested = nested;
  // Units of other display times are unknown; only 0 ("at once") is understood.
  if (slide.displayTime === 0) out.displaySeconds = 0;
  return out;
}

/**
 * Convert a parsed show. `context.path` is the show's own path (its id).
 * Problems found now go to `warnings`; problems found while building slides
 * later go to each slide's `warnings()`. The viewer's palette option
 * (`context.paletteOverride`, task 6c) is resolved here, once, and applies
 * to every slide; its warnings go to `warnings`.
 */
export function showToPresentation(
  show: Show,
  context: ParseContext,
  warnings: string[],
  buildOptions: BuildOptions = { ancestors: new Set([context.path]), depth: 0 },
): Presentation {
  let options = buildOptions;
  if (options.paletteOverride === undefined) {
    let paletteOverride: ResolvedPalette | null = null;
    if (context.paletteOverride) {
      const resolved = resolvePaletteOverride(context.paletteOverride, context);
      warnings.push(...resolved.warnings);
      paletteOverride = resolved.palette;
    }
    options = { ...options, paletteOverride };
  }
  return {
    id: context.path,
    title: show.description,
    slides: show.slides.map((s) => buildSlide(s, context, options, warnings)),
    firstSlide: 1,
    globalKeys: convertKeys(show.globalKeys, "show-wide key table", warnings),
  };
}
