/**
 * Core types shared by every file-format parser and the renderer.
 *
 * The design goal is a strict separation of concerns:
 *   bytes --(FormatParser)--> Scene --(SceneRenderer)--> pixels
 * Parsers know nothing about React; the renderer knows nothing about file
 * formats. Adding a format means adding one parser module and registering it.
 */

/*
 * ---------------------------------------------------------------------------
 * Scene model
 * ---------------------------------------------------------------------------
 *
 * Coordinates are "scene units": page units with the y axis already flipped
 * by whoever builds the scene (scene y = -page y). Scene y therefore grows
 * downwards, exactly like SVG, so text needs no counter-flip and the viewBox
 * maps straight onto the page.
 *
 * Angles (arc, band) are degrees measured counter-clockwise from +x as seen
 * on the PAGE (0 = 3 o'clock, 90 = 12 o'clock), i.e. the convention of the
 * source file, not of SVG. In the element's local coordinates the point at
 * angle t is (cx + rx*cos t, cy - ry*sin t): the minus sign undoes the y flip.
 * Inside a group whose transform mirrors y, "counter-clockwise" mirrors too.
 */

/** A rectangle in scene units, in the order of the SVG viewBox attribute. */
export interface ViewBox {
  minX: number;
  minY: number;
  width: number;
  height: number;
}

/** Landscape page: x -16384..16384, y -12288..12288 (4:3). */
export const LANDSCAPE_VIEW_BOX: ViewBox = {
  minX: -16384,
  minY: -12288,
  width: 32768,
  height: 24576,
};

/** Portrait page: the transpose of the landscape page (3:4). */
export const PORTRAIT_VIEW_BOX: ViewBox = {
  minX: -12288,
  minY: -16384,
  width: 24576,
  height: 32768,
};

/** Stroke width used when a shape gives none: ~1px on a 1000px-wide page. */
export const DEFAULT_STROKE_WIDTH = 30;

/** Prefix of a `ShapeStyle.fill` that names an entry of `Scene.patterns`. */
export const PATTERN_FILL_PREFIX = "pattern:";

/** Fill and outline of a shape. `null` means "do not paint". */
export interface ShapeStyle {
  /**
   * CSS colour, or null for no fill. May instead be "pattern:<id>" naming an
   * entry of `Scene.patterns` (PATTERN_FILL_PREFIX); parsers do not use
   * this, render-side transforms (e.g. the mono display mode) do.
   */
  fill: string | null;
  /** CSS colour, or null for no outline. */
  stroke: string | null;
  /** Outline width in scene units. Defaults to DEFAULT_STROKE_WIDTH. */
  strokeWidth?: number;
}

export interface Point {
  x: number;
  y: number;
}

/** Polyline, polygon, or smooth curve through the points. */
export interface PathElement extends ShapeStyle {
  kind: "path";
  points: Point[];
  /** Join the last point back to the first. */
  closed: boolean;
  /** Draw a smooth curve passing through every point instead of straight segments. */
  smooth?: boolean;
}

export interface EllipseElement extends ShapeStyle {
  kind: "ellipse";
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

/**
 * Open elliptical arc from `startAngle` to `endAngle`, going counter-clockwise
 * on the page (see the angle convention above). The sweep is
 * (end - start) mod 360; a non-zero multiple of 360 draws the full ellipse.
 */
export interface ArcElement extends ShapeStyle {
  kind: "arc";
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  startAngle: number;
  endAngle: number;
}

/**
 * Side of a cylinder (or 3-D pie edge): the arc from `startAngle` to
 * `endAngle` (as for `arc`) extruded downwards on the page (+y in scene
 * units) by `depth`. Drawn as a closed shape: arc, down, arc back, up.
 */
export interface BandElement extends ShapeStyle {
  kind: "band";
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  startAngle: number;
  endAngle: number;
  depth: number;
}

/** Corner style of a rect. A discriminated union so new styles can be added. */
export type CornerStyle =
  | { kind: "square" }
  | { kind: "rounded"; radius: number };

/** Axis-aligned box. Negative width/height are normalised by the renderer. */
export interface RectElement extends ShapeStyle {
  kind: "rect";
  x: number;
  y: number;
  width: number;
  height: number;
  /** Defaults to square corners. */
  corners?: CornerStyle;
}

export type TextAnchor = "start" | "middle" | "end";

/**
 * An outline painted under text (beneath the glyphs, so they are not
 * narrowed), to keep it readable over busy fills. Parsers do not use it;
 * render-side transforms (e.g. the mono display mode) do.
 */
export interface TextHalo {
  /** CSS colour. */
  color: string;
  /** Width beyond the glyph edge, in the element's own (local) units. */
  width: number;
}

export interface TextElement {
  kind: "text";
  /** Anchor point; `y` is the baseline. */
  x: number;
  y: number;
  text: string;
  /** Font size (em height) in scene units. */
  size: number;
  /** CSS colour. */
  fill: string;
  /** CSS font-family stack, e.g. "Helvetica, Arial, sans-serif". */
  fontFamily: string;
  /** CSS font-weight, e.g. 400 or 700. */
  fontWeight: number;
  italic: boolean;
  anchor: TextAnchor;
  halo?: TextHalo;
}

/**
 * A line of text drawn as glyph outlines (or stroke-font polylines) in the
 * document's own font: one path for the whole line. `d` is in the element's
 * local units, mapped to the parent's by `transform` (typically a uniform
 * scale and the line's start on the baseline). Outline fonts set `fill`
 * (stroke null); stroke fonts set `stroke` and `strokeWidth` (local units,
 * so it scales with the transform) and `fill: null`.
 *
 * `text` is what the line says, for selection, search and screen readers;
 * the renderer lays it invisibly over the glyphs, stretched to `advance`
 * local units at `em` local units per em.
 */
export interface GlyphsElement extends ShapeStyle {
  kind: "glyphs";
  /** SVG path data in local units (y down, baseline at y = 0). */
  d: string;
  /** Local → parent: x' = a x + c y + e, y' = b x + d y + f. Identity when absent. */
  transform?: Matrix;
  text: string;
  /** Width of the line (sum of advances), local units. */
  advance: number;
  /** Em size, local units (font size of the invisible text). */
  em: number;
  halo?: TextHalo;
}

/** Bitmap stretched to its box (no aspect-ratio preservation). */
export interface ImageElement {
  kind: "image";
  /** Usually a data: URL. */
  href: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Affine transform [a, b, c, d, e, f] with the meaning of SVG matrix(). */
export type Matrix = [number, number, number, number, number, number];

export interface GroupElement {
  kind: "group";
  children: SceneElement[];
  /** Maps child coordinates to the parent's: x' = a x + c y + e, y' = b x + d y + f. */
  transform?: Matrix;
  /** Named hit area (a show button). Clicking it reports this name. */
  buttonName?: string;
}

/** A drawable element. Coordinates are in scene units (see above). */
export type SceneElement =
  | PathElement
  | EllipseElement
  | ArcElement
  | BandElement
  | RectElement
  | TextElement
  | GlyphsElement
  | ImageElement
  | GroupElement;

/** A single page/slide/chart in the format-independent model. */
export interface Scene {
  /** Visible area in scene units; the renderer letterboxes it. */
  viewBox: ViewBox;
  /** CSS colour painted over the whole viewBox before any element. */
  background: string;
  /** Drawn in order: later elements on top. */
  elements: SceneElement[];
  /** Fill patterns referenced by "pattern:<id>" fills, keyed by id. Usually absent. */
  patterns?: Record<string, FillPattern>;
}

/**
 * A repeating two-colour bitmap tile (e.g. a 1-bit dither), tiled from the
 * origin of the coordinate system of the element that uses it.
 */
export interface FillPattern {
  /** Tile rows, top first, all the same length: "1" = ink pixel, anything else = paper. */
  rows: string[];
  /** CSS colour of ink pixels. */
  ink: string;
  /** CSS colour of paper pixels. */
  paper: string;
  /** Size of one tile pixel, in the units of the element that uses the pattern. */
  pixelWidth: number;
  pixelHeight: number;
}

/** A parsed file: one or more scenes (slides) plus informational metadata. */
export interface Document {
  formatName: string;
  scenes: Scene[];
  /** Non-fatal problems met while decoding (damaged or partial data). */
  warnings: string[];
  /**
   * Set when the file is a slide show (e.g. a Harvard Graphics .SH3): the
   * viewer then plays it instead of listing `scenes` (which may be empty).
   */
  presentation?: Presentation;
}

/*
 * ---------------------------------------------------------------------------
 * Presentation model (slide shows)
 * ---------------------------------------------------------------------------
 *
 * Format-independent: a parser converts its own show structure into this, and
 * the player (src/player) only knows these types. Slides build their pictures
 * lazily, so opening a large show does not draw every chart up front.
 */

/** Where a key press or button click goes. Slide indices count from 0. */
export type Destination =
  | { kind: "slide"; index: number }
  /** The next slide of the current show. */
  | { kind: "next" }
  /** The previous slide of the current show. */
  | { kind: "previous" }
  /** The slide viewed before the current one. */
  | { kind: "lastView" }
  /** The first slide of the outermost show. */
  | { kind: "top" }
  /** Nothing happens (e.g. an unused table entry). */
  | { kind: "none" }
  /** "Leave for the editor" in the original program; a viewer ignores it. */
  | { kind: "edit" };

/** A key bound to a destination. */
export interface KeyBinding {
  /**
   * The key as `KeyboardEvent.key` names it: one character ("1", "a", " ")
   * or a named key ("F3", "Enter", "Escape", "ArrowLeft", "PageDown" ...).
   */
  key: string;
  destination: Destination;
}

/** A named button (a `GroupElement.buttonName` in the slide's scene) bound to a destination. */
export interface ButtonBinding {
  /** As stored; the player compares names ignoring case and trailing spaces. */
  name: string;
  destination: Destination;
}

/**
 * - picture: shows a scene;
 * - empty: nothing to show, the player skips it;
 * - sound: plays sound (not yet) and continues at once;
 * - nested: plays another presentation, then continues with the next slide.
 */
export type PresentationSlideKind = "picture" | "empty" | "sound" | "nested";

export interface PresentationSlide {
  /** Short text for slide lists and counters (description or file name). */
  label: string;
  kind: PresentationSlideKind;
  /** File the slide names (chart, nested show or sound), if any. */
  fileName: string | null;
  /**
   * The slide's picture, built on first call and cached. Null for slides
   * without one. A picture slide whose file is missing returns a placeholder
   * scene naming the file.
   */
  scene(): Scene | null;
  /** For nested slides: the nested presentation (built on first call, cached), or null if unavailable. */
  nested?(): Presentation | null;
  /** Problems met so far while building `scene()` / `nested()` (grows lazily). */
  warnings(): readonly string[];
  /** Keys active while this slide shows; checked before the presentation's `globalKeys`. */
  keys: KeyBinding[];
  /** Buttons of this slide, matched against clicked `buttonName`s. */
  buttons: ButtonBinding[];
  /** True: stay until a key or click. False: continue on by itself. */
  waitForKey: boolean;
  /** For slides that do not wait: seconds before moving on, if known. */
  displaySeconds?: number;
  /** Raw, format-specific transition information (for the transitions task). */
  transition?: unknown;
}

export interface Presentation {
  /**
   * Identifies the source (e.g. the file path). The player refuses to enter
   * a nested presentation whose id is already being played.
   */
  id: string;
  title: string;
  /**
   * Slides in order. Index 0 may be a placeholder (in Harvard Graphics it is
   * the show itself); playing starts at `firstSlide`.
   */
  slides: PresentationSlide[];
  /** Index of the slide playing starts at. */
  firstSlide: number;
  /** Keys active on every slide of this presentation (after the slide's own). */
  globalKeys: KeyBinding[];
}

/** How sure a parser is that it can handle a file. 0 = no, 1 = certain. */
export type Confidence = number;

export interface FormatParser {
  /** Stable identifier, e.g. "hg3". */
  id: string;
  /** Human-readable name shown in the UI. */
  name: string;
  /** Inspect the file and report how likely this parser can read it. */
  detect(bytes: Uint8Array, filename: string): Confidence;
  /**
   * Decode the file. Throw `UnsupportedFormatError` if not (yet) possible.
   * `context` gives access to the other files the user opened (palettes,
   * fonts, bitmaps); it is absent when the file was opened on its own.
   */
  parse(bytes: Uint8Array, filename: string, context?: ParseContext): Document;
  /**
   * Optional: load, asynchronously, resources that `parse` draws better
   * with (e.g. font outlines fetched on demand) into caches `parse` reads
   * synchronously. Call it before `parse` with the same arguments; `parse`
   * still works without it, falling back (e.g. to CSS fonts). Must not
   * throw or reject for bad input: `parse` reports problems.
   */
  prepare?(bytes: Uint8Array, filename: string, context?: ParseContext): Promise<void>;
}

/** A file from the set the user opened, as seen by a parser. */
export interface ResolvedFile {
  /** Relative path inside the set, folders separated by "/". */
  path: string;
  /** Base name as found on disk. */
  name: string;
  bytes: Uint8Array;
}

/** What a parser may ask about the files around the one it is decoding. */
export interface ParseContext {
  /** Path (inside the file set) of the file being parsed. */
  path: string;
  /**
   * Find a file named inside the document (case-insensitive; any directory
   * or drive prefix is ignored), preferring one beside the file being
   * parsed (SPEC section 2). Returns null and records the name as missing
   * if no such file was opened. `purpose` (e.g. "palette") labels the
   * missing-file list.
   */
  resolve(name: string, purpose?: string): ResolvedFile | null;
  /**
   * Viewer option: the file name of a palette to draw with in place of the
   * document's own (e.g. "MONOCHRW.PL3"); absent to draw as saved. The
   * format decides what it means and reports, once, if it cannot be used.
   */
  paletteOverride?: string;
}

/** Thrown when a file is recognised but cannot be decoded yet. */
export class UnsupportedFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedFormatError";
  }
}
