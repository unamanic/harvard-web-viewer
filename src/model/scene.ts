/**
 * The scene model: what every format's parser produces and what the
 * renderer, the display modes, the show player and the video export draw.
 *
 *   bytes --(FormatParser)--> Document of Scenes --(SceneRenderer)--> pixels
 *
 * Parsers know nothing about React; the renderer knows nothing about file
 * formats.
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

/** A viewBox of the given size centred on (0, 0). */
export function centredViewBox(width: number, height: number): ViewBox {
  return { minX: -width / 2, minY: -height / 2, width, height };
}

/**
 * Default landscape page: x -16384..16384, y -12288..12288 (4:3). Formats
 * may use other page sizes (an HG3 Letter page is 32768 × 25320; see
 * hg3/scene/page.ts); the renderer letterboxes whatever viewBox a scene has.
 */
export const LANDSCAPE_VIEW_BOX: ViewBox = centredViewBox(32768, 24576);

/** Default portrait page: the transpose of the landscape page (3:4). */
export const PORTRAIT_VIEW_BOX: ViewBox = centredViewBox(24576, 32768);

/** Stroke width used when a shape gives none: ~1px on a 1000px-wide page. */
export const DEFAULT_STROKE_WIDTH = 30;

/** Prefix of a `ShapeStyle.fill` that names an entry of `Scene.patterns`. */
export const PATTERN_FILL_PREFIX = "pattern:";

/** Prefix of a `ShapeStyle.fill` (or `Scene.background`) that names an entry of `Scene.gradients`. */
export const GRADIENT_FILL_PREFIX = "gradient:";

/** Fill and outline of a shape. `null` means "do not paint". */
export interface ShapeStyle {
  /**
   * CSS colour, or null for no fill. May instead be "gradient:<id>" naming
   * an entry of `Scene.gradients` (GRADIENT_FILL_PREFIX), or "pattern:<id>"
   * naming an entry of `Scene.patterns` (PATTERN_FILL_PREFIX); parsers do
   * not use patterns, render-side transforms (e.g. the mono display mode) do.
   */
  fill: string | null;
  /**
   * CSS colour, or null for no outline. Like `fill`, may be "pattern:<id>"
   * (render-side transforms only, e.g. the dithered VGA display mode).
   */
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
  /** CSS colour (or, from render-side transforms, "pattern:<id>"). */
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

/**
 * A bitmap in a box. Without `tile` it is stretched to the box (no
 * aspect-ratio preservation; on an imitated screen nearest-neighbour at
 * screen pixels, src/render/screenImage.ts); with `tile` it is drawn at a
 * fixed pixel size, repeated in both directions and clipped to the box.
 */
export interface ImageElement {
  kind: "image";
  /** Usually a data: URL. */
  href: string;
  x: number;
  y: number;
  width: number;
  height: number;
  tile?: ImageTile;
  /**
   * Optional: the image as indexed pixels, for render-side transforms that
   * need its colours (e.g. a display mode dithering each pixel like a
   * fill). Must show the same picture as `href`.
   */
  pixels?: IndexedPixels;
}

/**
 * How a tiled image is placed: image pixel (hotX, hotY) (a point in image
 * pixels from its top-left corner, fractions allowed) lies on the anchor
 * point (anchorX, anchorY); the image repeats from there in both
 * directions, so the tiling's phase follows from the anchor.
 */
export interface ImageTile {
  /** Size of one image pixel, in the element's units. */
  pixelWidth: number;
  pixelHeight: number;
  /** Image size in pixels. */
  imageWidth: number;
  imageHeight: number;
  anchorX: number;
  anchorY: number;
  hotX: number;
  hotY: number;
  /**
   * The image is drawn at the screen's own pixel size (one image pixel per
   * screen pixel) when a display mode imitates a screen; it then starts at
   * the screen pixel floor(anchor − hot), the anchor measured in screen
   * pixels. `pixelWidth` / `pixelHeight` (one pixel of the reference screen
   * the scene was laid out for) apply elsewhere.
   */
  screenPixels?: boolean;
}

/** An image as palette indexes. */
export interface IndexedPixels {
  width: number;
  height: number;
  /** Row-major palette indexes, top row first (width × height entries). */
  data: Uint8Array;
  /** CSS colour per index; null = transparent. */
  palette: (string | null)[];
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
  /**
   * CSS colour painted over the whole viewBox before any element, or
   * "gradient:<id>" (an entry of `gradients`, spanning the viewBox).
   * Render-side transforms may also set "pattern:<id>".
   */
  background: string;
  /** Drawn in order: later elements on top. */
  elements: SceneElement[];
  /** Fill patterns referenced by "pattern:<id>" fills (and strokes), keyed by id. Usually absent. */
  patterns?: Record<string, FillPattern>;
  /** Gradients referenced by "gradient:<id>" fills (and the background), keyed by id. Usually absent. */
  gradients?: Record<string, FillGradient>;
  /**
   * The document's own 16 screen colours (CSS, as the document stores
   * them), if it defines them: what each of the 16 colours of the original
   * program's 16-colour screen driver was set to for this document (for
   * HG3, the palette's record 1555, which the VGA ScreenShow driver loads
   * into the DAC). Index i is the colour the driver calls i; the document's
   * colours are matched against the driver's standard set, so a colour
   * equal to standard colour i shows as screenColors[i]. Used by the
   * display modes (src/render/displayMode.ts: the VGA screen shows them
   * through its 6-bit DAC; Modern shows each colour's mix with its slots
   * replaced); absent means the standard set.
   */
  screenColors?: string[];
  /**
   * Set by Harvard Graphics 1.0/2.x scenes: each colour is a standard screen
   * slot chosen by the chart's colour number (slot 0 the background; see
   * src/formats/hg2/screen.ts), with screenColors saying what each slot shows.
   * Lets the CGA display mode give each colour number its CGA colour: "cga4"
   * for charts the program shows in the CGA's four-colour mode, "cga2" for
   * A.00 text and org charts, which it shows in the two-colour mode.
   */
  classicSlots?: "cga4" | "cga2";
}

/**
 * A two-colour linear gradient. It spans the bounding box of the element
 * that uses it (in the element's own units; the viewBox for the
 * background): `from` at the box's extreme point against `angle`, `to` at
 * its extreme point along it, colours interpolated linearly between.
 */
export interface FillGradient {
  /** CSS colour at the start. */
  from: string;
  /** CSS colour at the end. */
  to: string;
  /**
   * Direction from `from` to `to`, in degrees counter-clockwise from +x as
   * seen on the page (the angle convention above: 90 = upwards).
   */
  angle: number;
  /**
   * Optional: the gradient as a screen shows it, in bands (render-side
   * transforms only, e.g. the dithered VGA display mode). Band i covers
   * offsets `offset` (0 = start, 1 = end) up to the next band's offset and
   * is painted with `paint`: a CSS colour or "pattern:<id>". Offsets
   * increase; the first is 0. Without bands the gradient is smooth.
   */
  bands?: GradientBand[];
}

export interface GradientBand {
  offset: number;
  paint: string;
}

/**
 * A repeating bitmap tile (e.g. a 1-bit dither), tiled from the origin of
 * the coordinate system of the element that uses it (moved by `transform`
 * when given).
 */
export interface FillPattern {
  /**
   * Tile rows, top first, all the same length: "1" = ink pixel, anything
   * else = paper. With `colors`, each character is instead a hexadecimal
   * digit indexing `colors`.
   */
  rows: string[];
  /** CSS colour of ink pixels. */
  ink: string;
  /** CSS colour of paper pixels. */
  paper: string;
  /**
   * Optional: a tile of more than two colours (up to 16). When present,
   * each row character is a hexadecimal digit selecting a colour from this
   * list, and `ink` / `paper` are ignored.
   */
  colors?: string[];
  /** Size of one tile pixel, in pattern units (the element's own units when there is no `transform`). */
  pixelWidth: number;
  pixelHeight: number;
  /**
   * Optional: maps pattern units to the units of the element that uses the
   * pattern (SVG patternTransform), e.g. to keep a dither aligned to the
   * screen's pixel grid inside transformed groups.
   */
  transform?: Matrix;
}
