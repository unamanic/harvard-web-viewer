/**
 * The asynchronous half of drawing text with clone fonts (task 7f).
 *
 * Problem: the outline clone faces (src/fonts/outline) are loaded by dynamic
 * import, but FormatParser.parse and the lazily built slides of a show draw
 * synchronously.
 *
 * Solution: `prepareHg3Fonts` runs before `parse` (hg3Parser.prepare, called
 * by loadFile). It reads the document just far enough to list the font keys
 * its text uses (the chart, its embedded charts and button chart; for a
 * show, every chart slide and nested show), resolves them like the scene
 * builder will, and awaits outlineCloneFor for each Speedo key the user's
 * files cannot draw. Loaded faces stay in the outline module's cache, which
 * the scene builder reads synchronously (loadedOutlineClone, see
 * textFaces.ts). So the first render already uses the clones; when `parse`
 * runs without preparation (tests, or a load that failed) text falls back
 * to the CSS look-alikes, as before. Stroke clones are built in and need no
 * preparation; original .SPD files are parsed synchronously (and cached).
 */
import { outlineCloneFor } from "../../../fonts/outline";
import type { ParseContext } from "../../parser";
import { parseChart } from "../chart";
import { type Container, readContainer } from "../container";
import { type FontKey, fontKeyString, isEmptyFontKey } from "../../../fonts/fontKey";
import { createFontResolver } from "../fonts";
import { type LayerItem, parseObjectLayer } from "../objects";
import { MAX_NESTING_DEPTH } from "../presentation";
import { parseShow } from "../show";
import { hasUsableOriginal } from "./textFaces";

/** Most charts and shows read while listing keys (a guard against huge or looping sets). */
const MAX_FILES = 2000;

interface Walk {
  ctx: ParseContext | undefined;
  keys: Map<string, FontKey>;
  /** Upper-case paths already read. */
  seen: Set<string>;
}

function addKey(w: Walk, key: FontKey): void {
  if (!isEmptyFontKey(key)) w.keys.set(fontKeyString(key), key);
}

function itemKeys(w: Walk, items: readonly LayerItem[]): void {
  for (const item of items) {
    if (item.kind === "group") {
      itemKeys(w, item.items);
      continue;
    }
    for (const entry of item.shapes) {
      if (entry.shape.kind === "text") for (const run of entry.shape.runs) addKey(w, run.fontKey);
    }
  }
}

function tryContainer(bytes: Uint8Array): Container | null {
  try {
    return readContainer(bytes);
  } catch {
    return null;
  }
}

/** Open a referenced file once; null when missing, already read or over the limit. */
function open(w: Walk, name: string, purpose: string): Container | null {
  if (w.seen.size >= MAX_FILES) return null;
  const file = w.ctx?.resolve(name, purpose) ?? null;
  if (!file) return null;
  const key = file.path.toUpperCase();
  if (w.seen.has(key)) return null;
  w.seen.add(key);
  return tryContainer(file.bytes);
}

function chartKeys(w: Walk, container: Container, depth: number): void {
  const { chart } = parseChart(container);
  for (const line of chart.textLines) addKey(w, line.fontKey);
  for (const table of chart.styleTables.values()) for (const s of table) addKey(w, s.fontKey);
  if (chart.objectLayer) itemKeys(w, parseObjectLayer(chart.objectLayer).layer.items);
  if (depth >= MAX_NESTING_DEPTH) return;
  const refs: [name: string, purpose: string][] = chart.fileRefs.embeddedChartNames.map((name) => [name, "embedded chart"]);
  // The button chart's objects are drawn too (task 20); same purpose as the scene builder's resolve.
  if (chart.fileRefs.buttonChartName) refs.push([chart.fileRefs.buttonChartName, "button chart"]);
  for (const [name, purpose] of refs) {
    const c = open(w, name, purpose);
    if (c?.kind === "chart") chartKeys(w, c, depth + 1);
  }
}

function showKeys(w: Walk, container: Container, depth: number): void {
  const { show } = parseShow(container);
  for (const slide of show.slides) {
    if (slide.fileName === null || slide.number === 0) continue;
    if (slide.kindName === "chart") {
      const c = open(w, slide.fileName, "slide");
      if (c?.kind === "chart") chartKeys(w, c, 0);
    } else if (slide.kindName === "show" && depth < MAX_NESTING_DEPTH) {
      const c = open(w, slide.fileName, "nested show");
      if (c?.kind === "show") showKeys(w, c, depth + 1);
    }
  }
}

/**
 * Font keys the document's text uses, as far as they can be found (damaged
 * parts are skipped silently: `parse` reports them).
 */
export function documentFontKeys(bytes: Uint8Array, context: ParseContext | undefined): FontKey[] {
  const w: Walk = { ctx: context, keys: new Map(), seen: new Set() };
  if (context) w.seen.add(context.path.toUpperCase());
  const container = tryContainer(bytes);
  try {
    if (container?.kind === "chart") chartKeys(w, container, 0);
    else if (container?.kind === "show") showKeys(w, container, 0);
  } catch {
    // Keep the keys found so far.
  }
  return [...w.keys.values()];
}

/**
 * Load the outline clone faces the document needs (Speedo keys whose
 * original font is not usable). Never rejects; a face that fails to load is
 * simply not used (text falls back to CSS).
 */
export async function prepareHg3Fonts(bytes: Uint8Array, context: ParseContext | undefined): Promise<void> {
  const keys = documentFontKeys(bytes, context);
  if (keys.length === 0) return;
  const fonts = createFontResolver(context);
  const loads = keys.filter((k) => !hasUsableOriginal(fonts.resolve(k))).map((k) => outlineCloneFor(k));
  await Promise.allSettled(loads);
}
