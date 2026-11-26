/**
 * Harvard Graphics 1.0 / 2.x show → format-independent presentation
 * (docs/SPEC-HG1-HG2.md §5).
 *
 * Slide 0 is an empty placeholder so that slide indices are the show's play
 * positions, which HyperShow "Go To" numbers use; playing starts at slide 1.
 * Files are looked up when the show opens (so missing ones are listed at
 * once) and drawn only when the player first asks for a slide.
 */
import { decodePcx } from "../pcx/pcx";
import { pcxToDataUrl } from "../pcx/toDataUrl";
import { placeholderScene } from "../hg3/presentation";
import type {
  KeyBinding,
  ParseContext,
  Presentation,
  PresentationSlide,
  ResolvedFile,
  Scene,
  SlideEffect,
  SlideEffects,
  SlideTransitionEffect,
} from "../types";
import { LANDSCAPE_VIEW_BOX } from "../types";
import { NotClassicChartError, isClassicChart, readClassicChart } from "./read";
import { chartToScene } from "./scene";
import {
  type ClassicEffect,
  type ClassicEffectName,
  type ClassicShow,
  type ClassicShowSlide,
  isClassicShow,
  readClassicShow,
  slideFileKind,
} from "./show";

/** Deepest nesting of shows followed (the self-inclusion guard catches loops first). */
export const MAX_NESTING_DEPTH = 8;

/**
 * [I] The viewer has no Weave or Rain transition; these are the nearest it
 * has. Weave (lines from alternate sides) is drawn as Blinds; Rain (dots
 * falling) as Fade.
 */
const EFFECT_MAP: Record<ClassicEffectName, SlideTransitionEffect> = {
  replace: "replace",
  overlay: "overlay",
  wipe: "wipe",
  scroll: "scroll",
  fade: "fade",
  weave: "blinds",
  open: "open",
  close: "close",
  blinds: "blinds",
  iris: "iris",
  rain: "fade",
};

function toEffect(e: ClassicEffect): SlideEffect {
  const out: SlideEffect = { effect: EFFECT_MAP[e.effect] };
  if (e.direction) out.direction = e.direction;
  return out;
}

/**
 * A slide's effects: a blank Draw uses the show's default, then Replace; a
 * blank Erase uses the default Erase, else none (the next slide is drawn
 * over the old one) [I].
 */
export function classicSlideEffects(slide: Pick<ClassicShowSlide, "draw" | "erase">, show: Pick<ClassicShow, "defaultDraw" | "defaultErase">): SlideEffects {
  const draw = slide.draw ?? show.defaultDraw;
  const erase = slide.erase ?? show.defaultErase;
  const out: SlideEffects = { draw: draw ? toEffect(draw) : { effect: "replace" } };
  if (erase) out.erase = toEffect(erase);
  return out;
}

/**
 * HyperShow keys. The program stores the character as typed; a letter is
 * bound in both cases since the player tries the exact case first [I].
 */
function keyBindings(slide: ClassicShowSlide, slideCount: number, warnings: string[]): KeyBinding[] {
  const out: KeyBinding[] = [];
  for (const k of slide.keys) {
    if (k.goTo > slideCount) {
      warnings.push(`Slide ${slide.position}: HyperShow key ${k.key} goes to slide ${k.goTo}, which the show does not have; ignored`);
      continue;
    }
    out.push({ key: k.key, destination: { kind: "slide", index: k.goTo } });
  }
  return out;
}

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

function emptySlide(label: string): PresentationSlide {
  return {
    label,
    kind: "empty",
    fileName: null,
    scene: () => null,
    warnings: () => [],
    keys: [],
    buttons: [],
    waitForKey: true,
  };
}

/** A whole-page picture of a PCX bitmap slide. */
function bitmapScene(file: ResolvedFile): { scene: Scene; warnings: string[] } {
  const image = decodePcx(file.bytes);
  const box = LANDSCAPE_VIEW_BOX;
  return {
    scene: {
      viewBox: box,
      background: "#000000",
      elements: [
        { kind: "image", href: pcxToDataUrl(image), x: box.minX, y: box.minY, width: box.width, height: box.height },
      ],
    },
    warnings: image.warnings,
  };
}

interface BuildOptions {
  ancestors: ReadonlySet<string>;
  depth: number;
}

function contextAt(context: ParseContext, path: string): ParseContext {
  const out: ParseContext = { path, resolve: (n, p) => context.resolve(n, p) };
  const { find } = context;
  if (find) out.find = (n) => find.call(context, n);
  return out;
}

function buildSlide(
  slide: ClassicShowSlide,
  show: ClassicShow,
  lastPosition: number,
  context: ParseContext,
  options: BuildOptions,
  warnings: string[],
): PresentationSlide {
  const where = `Slide ${slide.position}`;
  const fileKind = slideFileKind(slide);
  const kind = fileKind === "show" ? "nested" : "picture";
  const { fileName } = slide;
  const slideWarnings: string[] = [];

  const resolved = context.resolve(fileName, kind === "nested" ? "nested show" : "slide");
  if (!resolved) warnings.push(`${where}: file ${fileName} was not opened; shown as a note naming it`);

  const scene = once((): Scene | null => {
    if (kind !== "picture") return null;
    if (!resolved) return placeholderScene(fileName, "This file was not opened.");
    const bytes = resolved.bytes;
    try {
      if (isClassicChart(bytes)) {
        const chartWarnings: string[] = [];
        const chart = readClassicChart(bytes, chartWarnings);
        const result = chartToScene(chart, chartWarnings, {
          context: contextAt(context, resolved.path),
          open: new Set([resolved.name.toUpperCase()]),
        });
        slideWarnings.push(...[...new Set(chartWarnings)].map((w) => `${fileName}: ${w}`));
        return result;
      }
      if (bytes[0] === 0x0a) {
        const { scene: picture, warnings: w } = bitmapScene(resolved);
        slideWarnings.push(...w.map((x) => `${fileName}: ${x}`));
        return picture;
      }
      slideWarnings.push(`${where}: ${fileName} is not a chart or PCX bitmap this viewer can draw`);
      return placeholderScene(fileName, "This file cannot be drawn.");
    } catch (e) {
      const why = e instanceof NotClassicChartError || e instanceof Error ? e.message : String(e);
      slideWarnings.push(`${where}: drawing ${fileName} failed: ${why}`);
      return placeholderScene(fileName, "This file cannot be drawn.");
    }
  });

  const nested = once((): Presentation | null => {
    if (kind !== "nested" || !resolved) return null;
    if (options.ancestors.has(resolved.path)) {
      slideWarnings.push(`${where}: nested show ${fileName} includes itself; skipped`);
      return null;
    }
    if (options.depth >= MAX_NESTING_DEPTH) {
      slideWarnings.push(`${where}: nested show ${fileName} is nested more than ${MAX_NESTING_DEPTH} deep; skipped`);
      return null;
    }
    if (!isClassicShow(resolved.bytes)) {
      slideWarnings.push(`${where}: ${fileName} is not a Harvard Graphics 1.x or 2.x show; skipped`);
      return null;
    }
    const nestedWarnings: string[] = [];
    const inner = readClassicShow(resolved.bytes, nestedWarnings);
    const result = classicShowToPresentation(inner, contextAt(context, resolved.path), nestedWarnings, {
      ancestors: new Set([...options.ancestors, resolved.path]),
      depth: options.depth + 1,
    });
    slideWarnings.push(...nestedWarnings.map((w) => `${fileName}: ${w}`));
    return result;
  });

  const seconds = slide.displaySeconds ?? show.defaultSeconds;
  const out: PresentationSlide = {
    label: slide.description || fileName,
    kind,
    fileName,
    scene,
    warnings: () => slideWarnings,
    keys: keyBindings(slide, lastPosition, warnings),
    buttons: [],
    waitForKey: seconds === null,
  };
  if (seconds !== null) out.displaySeconds = seconds;
  if (show.version === "2.x") out.effects = classicSlideEffects(slide, show);
  if (kind === "nested") out.nested = nested;
  return out;
}

/** Convert a read show. `context.path` is the show's own path. */
export function classicShowToPresentation(
  show: ClassicShow,
  context: ParseContext,
  warnings: string[],
  options: BuildOptions = { ancestors: new Set([context.path]), depth: 0 },
): Presentation {
  const last = show.slides.length ? show.slides[show.slides.length - 1].position : 0;
  const slides: PresentationSlide[] = [emptySlide("Show")];
  for (let position = 1; position <= last; position++) slides.push(emptySlide(`Slide ${position}`));
  for (const s of show.slides) slides[s.position] = buildSlide(s, show, last, context, options, warnings);
  return {
    id: context.path,
    title: show.description || context.path.replace(/^.*\//, ""),
    slides,
    firstSlide: 1,
    globalKeys: [],
  };
}
