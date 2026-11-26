/**
 * Object layer → scene elements (task 13; SPEC §5.6, §6.3, §6.4, §6.5).
 *
 * Coordinates. A shape's points are in object coordinates (y up); the
 * object's 616 transform M maps them to page coordinates (y up, SPEC §5.6),
 * and `toScene` flips page y for the scene (y down). A group's 616 is
 * composed in front of its members' transforms.
 *
 * Each shape is emitted in plain scene coordinates whenever that is exact,
 * so that the scene stays simple to inspect and stroke widths stay as set:
 *
 * - Point lists (polyline, polygon, curves): every point is transformed.
 *   Exact for any M.
 * - Boxes and ellipses: when M keeps the axes (b = c = 0, or a = d = 0 for
 *   the 90° rotations of about 375 sample objects) they stay a `rect` or
 *   `ellipse` with transformed corners / centre and swapped radii as needed.
 *   A rotated square box becomes a 4-point closed path.
 * - Arcs and bands: folded when M is a positive axis-aligned scale (angles
 *   unchanged).
 * - Text: positioned directly when M is a uniform positive scale (the size
 *   scales with it: text block boxes are in object units, so the original
 *   scales text with its object).
 *
 * Otherwise (rotation, mirroring, shear, unequal scale where it matters) the
 * element is wrapped in a group whose matrix is G = F·M·F, F being the y
 * flip, and the element is written in "flipped object coordinates" (x, −y).
 * Then G·F·p = F·M·p, i.e. exactly the page mapping followed by the scene
 * flip. Because the child space is y-down like the scene, text is not
 * mirrored, and the page-CCW angle convention of types.ts holds for arcs
 * and bands in the child space: their point at angle t, (cx + rx cos t,
 * −cy − ry sin t), is the flipped object point (cx + rx cos t, cy + ry sin t).
 * Stroke widths are divided by √|det M| so that they look the same.
 *
 * Colours follow the interim rule of SPEC §5.6 (closed shapes filled with
 * the current 0x110B colour, else the 0x1100 colour; outlined with 0x1100;
 * open shapes stroke only); a 0x1110 gradient fills with a Scene gradient
 * (chartColors.ts, assumptions.ts GRADIENT_SUBTAG), and closed shapes whose sub-tag ends in 0 or 2 are outlined only
 * (assumptions.ts OUTLINE_ONLY_SUBTAG_DIGITS). A 0x112A percentage darkens
 * the fill (SHADE_SUBTAG). 0x1031 arcs of style 1 are pie slices: closed
 * through the centre and filled (PIE_SLICE_ARC_STYLE).
 * Objects with a 0x1140 attribute draw their 404 kind 5 bitmap stretched to
 * the object's bounding box (SPEC §6.3) instead of their shapes.
 *
 * Text is already decoded in the HG3 character set (../charset.ts); runs
 * also keep their byte codes, and each line is drawn by code as one
 * `glyphs` path in the original font, else our clone, else as a CSS text
 * element (task 7f; textFaces.ts chooses, assumptions.ts
 * GLYPH_PAIR_KERNING describes the layout).
 *
 * A group preceded by a 404 kind 4 reference embeds another chart (task
 * 13c): its scene is drawn inside the group, mapped by the group's 616.
 */
import type { GlyphsElement, GroupElement, ImageElement, Matrix, Point, RectElement, SceneElement, TextAnchor, TextElement } from "../../../model/scene";
import { EM_UNITS, type GlyphSource, glyphLineElement as drawGlyphLine } from "../../../fonts/glyphRun";
import { type PcxImage, decodePcx, indexPixels } from "../../pcx/pcx";
import { pcxToDataUrl } from "../../pcx/toDataUrl";
import {
  BOX_3D_SIDE_SHADE,
  BOX_3D_STYLE,
  BOX_SHADOW_BOTTOM_SHADE,
  BOX_SHADOW_SIDE_SHADE,
  BOX_3D_TOP_SHADE,
  BOX_CORNER_RADIUS_FACTOR,
  BUTTON_HIT_AREAS,
  EMBEDDED_CHART_DRAWS_BACKGROUND,
  EMBEDDED_CHART_MAX_DEPTH,
  GLYPH_ADVANCE_PIXELS,
  BITMAP_FIT_OFFSET,
  BITMAP_FIT_TO_BOX,
  BITMAP_HOTSPOT_OFFSET,
  BITMAP_INK_SUBTAG,
  BITMAP_MONO_COLORS,
  BITMAP_NATIVE_TILED,
  BITMAP_PAPER_SUBTAG,
  DRAW_GRADIENTS,
  GRADIENT_AS_FIRST_COLOR,
  OBJECT_TEXT_ASCENT,
  OBJECT_TEXT_BASELINE_AT_ASCENT,
  OBJECT_TEXT_USES_LINE_ENTRIES,
  OUTLINE_ONLY_SUBTAG_DIGITS,
  PIE_SLICE_ARC_STYLE,
  SHADE_FILLS_BY_PERCENT,
  CURVE_A_AFTER_POLYLINE_DRAWN,
  CURVE_A_STRAIGHT_OFFSET,
  CURVE_MARKERS,
  CURVE_MARKER_SHAPE_OFFSET,
  CURVE_MARKER_SIZE_OFFSET,
  DOUBLE_BOX_STYLE,
  LINE_STYLE_DASHES,
  LINE_STYLE_SUBTAG,
  LINE_WIDTH_MIN_PIXELS,
  LINE_WIDTH_SUBTAG,
  SHADE_SUBTAG,
  SHADOW_BOX_STYLE,
  SQUARE_BOX_STYLE,
  STROKE_FONT_DEFAULT_PEN_EM,
  TEXT_COLOR_ROLE_MASK,
  lineWidthFor,
  textAscent,
  textSizeToUnits,
} from "../assumptions";
import { type Chart, parseChart } from "../chart";
import { type LeafRecord, readContainer, readFileReference } from "../container";
import {
  AttributeSubTag,
  type ArcShape,
  type Attribute,
  type Box,
  type BoxShape,
  type CurveAShape,
  DIRECT_COLOR,
  type DrawnObject,
  IDENTITY_TRANSFORM,
  type LayerItem,
  type ObjectGroup,
  type Rgb,
  type Shape,
  type ShapeEntry,
  type TextBlockShape,
  type TextLayoutLine,
  type TextRun,
  type Transform,
  applyTransform,
  directRgb,
  isClosedShape,
  parseObjectLayer,
} from "../objects";
import { shadeCss } from "../../../model/color";
import { ROLE, rgbToCss } from "../palette";
import { Justification } from "../text";
import { gradientAttributeFill } from "./chartColors";
import { type ChartSceneContext, createEmbeddedContext } from "./context";
import { legacyLineBoxHeight, stackTops } from "./data/text";
import { areaToRect, toScene } from "./page";

/** 404 kind of a bitmap reference (SPEC §5.6) and of an embedded chart. */
const REF_KIND_BITMAP = 5;
const REF_KIND_CHART = 4;
const TAG_FILE_REFERENCE = 404;
/** Gradient attribute (SPEC §5.6). */
const SUB_GRADIENT = 0x1110;

// ---------------------------------------------------------------------------
// Transforms
// ---------------------------------------------------------------------------

/** outer ∘ inner: apply `inner` first. */
export function composeTransforms(outer: Readonly<Transform>, inner: Readonly<Transform>): Transform {
  const [a, b, c, d, e, f] = outer;
  const [A, B, C, D, E, F] = inner;
  return [a * A + c * B, b * A + d * B, a * C + c * D, b * C + d * D, a * E + c * F + e, b * E + d * F + f];
}

/** G = F·M·F (F = y flip): maps flipped object coordinates to scene coordinates. */
export function flippedMatrix(m: Readonly<Transform>): Matrix {
  const [a, b, c, d, e, f] = m;
  return [a, -b, -c, d, e, -f];
}

function tolerance(m: Readonly<Transform>): number {
  return 1e-6 * Math.max(Math.abs(m[0]), Math.abs(m[1]), Math.abs(m[2]), Math.abs(m[3]), 1e-9);
}

/** b = c = 0: the axes stay where they are (any scale, mirroring included). */
function keepsAxes(m: Readonly<Transform>): boolean {
  const eps = tolerance(m);
  return Math.abs(m[1]) <= eps && Math.abs(m[2]) <= eps;
}

/** a = d = 0: x and y swap (90° rotations, possibly mirrored). */
function swapsAxes(m: Readonly<Transform>): boolean {
  const eps = tolerance(m);
  return Math.abs(m[0]) <= eps && Math.abs(m[3]) <= eps;
}

/** Axis-aligned scale with both factors positive (no mirroring). */
function isPositiveScale(m: Readonly<Transform>): boolean {
  return keepsAxes(m) && m[0] > 0 && m[3] > 0;
}

/** Positive scale with equal factors. */
function isUniformPositiveScale(m: Readonly<Transform>): boolean {
  return isPositiveScale(m) && Math.abs(m[0] - m[3]) <= 1e-4 * Math.max(m[0], m[3]);
}

/** √|det|: the transform's average linear scale. */
function linearScale(m: Readonly<Transform>): number {
  const s = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
  return s > 0 ? s : 1;
}

/** Object point → scene point. */
function sceneOf(m: Readonly<Transform>, x: number, y: number): Point {
  const p = applyTransform(m, { x, y });
  return toScene(p.x, p.y);
}

/** Wrap elements written in flipped object coordinates. */
function inObjectFrame(m: Readonly<Transform>, children: SceneElement[]): GroupElement {
  return { kind: "group", transform: flippedMatrix(m), children };
}

/** Axis-aligned scene rect covering the transformed corners of an object-space box. */
function sceneRectOf(m: Readonly<Transform>, x1: number, y1: number, x2: number, y2: number) {
  const corners = [sceneOf(m, x1, y1), sceneOf(m, x2, y2)];
  const xs = corners.map((p) => p.x);
  const ys = corners.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

// ---------------------------------------------------------------------------
// Colours
// ---------------------------------------------------------------------------

type LineAttr = Extract<Attribute, { kind: "line" }>;
type FillAttr = Extract<Attribute, { kind: "fill" }>;

function cssOf(ctx: ChartSceneContext, role: number, rgb: Rgb | null): string | null {
  if (role === DIRECT_COLOR) return rgb ? rgbToCss(rgb) : null;
  return ctx.color(role);
}

export interface Paint {
  fill: string | null;
  stroke: string | null;
  strokeWidth: number;
}

/** A 0x1031 arc that is a pie slice: closed through the centre (assumptions.ts PIE_SLICE_ARC_STYLE). */
export function isPieSlice(shape: Shape): boolean {
  return shape.kind === "arc" && shape.raw8 === PIE_SLICE_ARC_STYLE;
}


/** The 0x112A brightness in the state as a factor 0..1, or null for none or 100 % (assumptions.ts SHADE_SUBTAG). */
function shadeFactor(state: readonly Attribute[]): number | null {
  if (!SHADE_FILLS_BY_PERCENT) return null;
  const a = state.find((x) => x.subTag === SHADE_SUBTAG);
  if (!a || a.raw.length < 2) return null;
  const percent = a.raw[0]! | (a.raw[1]! << 8);
  return percent < 100 ? percent / 100 : null;
}

/** The 0x1120 line width in page units, or 0 when the state has none (assumptions.ts LINE_WIDTH_SUBTAG). */
function lineWidthAttr(state: readonly Attribute[]): number {
  const a = state.find((x) => x.subTag === LINE_WIDTH_SUBTAG);
  return a && a.raw.length >= 2 ? a.raw[0]! | (a.raw[1]! << 8) : 0;
}

/**
 * A 0x1120 width as drawn: one of more than half a screen pixel but under
 * LINE_WIDTH_MIN_PIXELS pixels is drawn LINE_WIDTH_MIN_PIXELS wide
 * (assumptions.ts LINE_WIDTH_MIN_PIXELS); others unchanged.
 */
export function screenLineWidth(ctx: ChartSceneContext, width: number): number {
  const px = ctx.page.screenPixel;
  return width > px / 2 ? Math.max(width, LINE_WIDTH_MIN_PIXELS * px) : width;
}

/**
 * Dash and gap lengths (scene units) of the state's line style, or null for
 * a solid line (assumptions.ts LINE_STYLE_SUBTAG, LINE_STYLE_DASHES).
 */
export function lineDash(ctx: ChartSceneContext, state: readonly Attribute[]): [number, number] | null {
  const a = state.find((x) => x.subTag === LINE_STYLE_SUBTAG);
  if (!a || a.raw.length < 2) return null;
  const pattern = LINE_STYLE_DASHES.get(a.raw[0]! | (a.raw[1]! << 8));
  return pattern ? [pattern[0] * ctx.page.screenPixel, pattern[1] * ctx.page.screenPixel] : null;
}

/**
 * The dashes of a polyline (closed: back to its first point): pieces `on`
 * long separated by gaps `off` long, the pattern running on across corners.
 */
export function dashedParts(points: readonly Point[], closed: boolean, on: number, off: number): Point[][] {
  if (!(on > 0) || !(off >= 0)) return [points.slice()];
  const path = closed && points.length > 1 ? [...points, points[0]!] : points;
  const out: Point[][] = [];
  let current: Point[] | null = [path[0]!];
  let phase = 0; // distance into the current dash (current !== null) or gap
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!;
    const b = path[i]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    let t = 0;
    while (t < len) {
      const left = (current ? on : off) - phase;
      if (t + left > len) {
        phase += len - t;
        t = len;
        break;
      }
      t += left;
      const p = { x: a.x + ((b.x - a.x) * t) / len, y: a.y + ((b.y - a.y) * t) / len };
      if (current) {
        current.push(p);
        out.push(current);
        current = null;
      } else current = [p];
      phase = 0;
    }
    if (current) {
      const last = current[current.length - 1]!;
      if (last.x !== b.x || last.y !== b.y) current.push(b);
    }
  }
  if (current && current.length > 1) out.push(current);
  return out;
}

/** The interim colour rule of SPEC §5.6 for one shape and its drawing state. */
export function paintFor(ctx: ChartSceneContext, shape: Shape, state: readonly Attribute[]): Paint {
  let line: LineAttr | undefined;
  let fill: FillAttr | undefined;
  let gradient: string | null = null;
  for (const a of state) {
    if (a.kind === "line") line = a;
    else if (a.kind === "fill") fill = a;
    else if (a.subTag === SUB_GRADIENT && DRAW_GRADIENTS) gradient = gradientAttributeFill(ctx, a.raw);
    else if (a.subTag === SUB_GRADIENT && GRADIENT_AS_FIRST_COLOR) {
      const first = directRgb(a.raw, 0);
      gradient = first ? rgbToCss(first) : null;
    }
  }
  const stroke = line ? cssOf(ctx, line.lineColor, line.rgb) : null;
  const strokeWidth = Math.max(lineWidthFor(line && !line.rgb ? line.lineStyle : undefined), screenLineWidth(ctx, lineWidthAttr(state)));
  const closed = isClosedShape(shape) || isPieSlice(shape);
  if (!closed || OUTLINE_ONLY_SUBTAG_DIGITS.has(shape.subTag & 0xf)) return { fill: null, stroke, strokeWidth };
  let fillCss: string | null;
  if (gradient) fillCss = gradient;
  else if (fill) fillCss = cssOf(ctx, fill.fillColor, fill.rgb);
  else fillCss = stroke;
  const shade = shadeFactor(state);
  if (fillCss && shade !== null) fillCss = shadeCss(fillCss, shade);
  return { fill: fillCss, stroke, strokeWidth };
}

/**
 * CSS colour of a text run: the u16 colour and the u16 after it form a
 * 4-byte colour (assumptions.ts TEXT_COLOR_ROLE_MASK).
 */
export function textRunColor(ctx: ChartSceneContext, run: Pick<TextRun, "color" | "raw4">): string | null {
  const b0 = run.color & 0xff;
  if (b0 === DIRECT_COLOR) return rgbToCss([(run.color >> 8) & 0xff, run.raw4 & 0xff, (run.raw4 >> 8) & 0xff]);
  return ctx.color(run.color & TEXT_COLOR_ROLE_MASK);
}

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

interface Builder {
  ctx: ChartSceneContext;
  /** Decoded bitmaps by upper-case file name; null when missing or unreadable. */
  bitmaps: Map<string, PcxImage | null>;
}

function pointParts(points: readonly Point[], partCounts: readonly number[]): Point[][] {
  const parts: Point[][] = [];
  let at = 0;
  for (const n of partCounts) {
    parts.push(points.slice(at, at + n));
    at += n;
  }
  return parts;
}

/** Straight segments per cubic Bézier piece when flattening curves. */
export const BEZIER_SEGMENTS = 16;

/** 1 + 3k points: P0, C1, C2, P1, C1, C2, P2, ... */
function isBezierControlList(points: readonly Point[]): boolean {
  return points.length >= 4 && points.length % 3 === 1;
}

/**
 * Flatten a cubic Bézier control list into points along the curve. The
 * sample curves (0x1080, 0x1091, 0x1098) all have 3k + 1 points, and pie
 * slices drawn with them have the control points of circular arcs (handle
 * length 0.552 × radius) and straight edges with coincident controls, so
 * they are Bézier control points rather than points the curve passes
 * through (SPEC §5.6 marks them [I]).
 */
export function bezierPoints(points: readonly Point[]): Point[] {
  const out: Point[] = [points[0]!];
  for (let i = 0; i + 3 < points.length; i += 3) {
    const [p0, p1, p2, p3] = [points[i]!, points[i + 1]!, points[i + 2]!, points[i + 3]!];
    for (let k = 1; k <= BEZIER_SEGMENTS; k++) {
      const t = k / BEZIER_SEGMENTS;
      const u = 1 - t;
      const w0 = u * u * u;
      const w1 = 3 * u * u * t;
      const w2 = 3 * u * t * t;
      const w3 = t * t * t;
      out.push({ x: w0 * p0.x + w1 * p1.x + w2 * p2.x + w3 * p3.x, y: w0 * p0.y + w1 * p1.y + w2 * p2.y + w3 * p3.y });
    }
  }
  return out;
}

/** Largest angle step, in degrees, when flattening a pie slice's arc. */
export const PIE_SLICE_STEP_DEGREES = 2;

/**
 * Outline of a pie slice in object coordinates: the centre, then the arc
 * from the start to the end angle counter-clockwise (tenths of a degree,
 * SPEC §5.6). Equal angles give nothing; a full turn gives the ellipse
 * without the centre.
 */
export function pieSlicePoints(shape: Pick<ArcShape, "cx" | "cy" | "rx" | "ry" | "start" | "end">): Point[] {
  const from = shape.start.tenths;
  let sweep = (((shape.end.tenths - from) % 3600) + 3600) % 3600;
  if (sweep === 0) {
    if (shape.end.tenths === from) return [];
    sweep = 3600;
  }
  const full = sweep === 3600;
  const steps = Math.max(2, Math.ceil(sweep / 10 / PIE_SLICE_STEP_DEGREES));
  const points: Point[] = full ? [] : [{ x: shape.cx, y: shape.cy }];
  for (let i = 0; i <= (full ? steps - 1 : steps); i++) {
    const t = (((from + (sweep * i) / steps) / 10) * Math.PI) / 180;
    points.push({ x: shape.cx + shape.rx * Math.cos(t), y: shape.cy + shape.ry * Math.sin(t) });
  }
  return points;
}

/** A rectangle given by object-space corners, plain or with rounded corners of `radius` (object units). */
function boxElement(m: Readonly<Transform>, x1: number, y1: number, x2: number, y2: number, paint: Paint, radius: number): SceneElement {
  const { fill, stroke, strokeWidth } = paint;
  const rounded = radius > 0;
  if (keepsAxes(m) || swapsAxes(m)) {
    const rect = sceneRectOf(m, x1, y1, x2, y2);
    return {
      kind: "rect",
      ...rect,
      ...(rounded ? { corners: { kind: "rounded" as const, radius: radius * linearScale(m) } } : {}),
      fill,
      stroke,
      strokeWidth,
    };
  }
  if (!rounded) {
    const points = [sceneOf(m, x1, y1), sceneOf(m, x2, y1), sceneOf(m, x2, y2), sceneOf(m, x1, y2)];
    return { kind: "path", points, closed: true, fill, stroke, strokeWidth };
  }
  return inObjectFrame(m, [
    {
      kind: "rect",
      x: Math.min(x1, x2),
      y: -Math.max(y1, y2),
      width: Math.abs(x2 - x1),
      height: Math.abs(y2 - y1),
      corners: { kind: "rounded", radius },
      fill,
      stroke,
      strokeWidth: strokeWidth / linearScale(m),
    },
  ]);
}

/**
 * A 0x1070-family box by its style (assumptions.ts SQUARE_BOX_STYLE and
 * after): square; rounded; a square box extruded c right and c down with
 * darkened bottom and right faces (style 5); or a 3-D box with a top and right face c
 * deep (style 6), c being the corner size in object units.
 */
function drawBox(_ctx: ChartSceneContext, shape: BoxShape, m: Readonly<Transform>, paint: Paint): SceneElement[] {
  const c = shape.cornerSize;
  const left = Math.min(shape.x1, shape.x2);
  const right = Math.max(shape.x1, shape.x2);
  const bottom = Math.min(shape.y1, shape.y2);
  const top = Math.max(shape.y1, shape.y2);
  if (shape.style === SHADOW_BOX_STYLE && c > 0) {
    // Extruded c right and c down: a bottom and a right face in the fill
    // colour, darkened (assumptions.ts SHADOW_BOX_STYLE).
    const face = (points: [number, number][], shadeBy: number): SceneElement => ({
      kind: "path",
      points: points.map(([x, y]) => sceneOf(m, x, y)),
      closed: true,
      fill: paint.fill ? shadeCss(paint.fill, shadeBy) : null,
      stroke: paint.stroke,
      strokeWidth: paint.strokeWidth,
    });
    return [
      face([[left, bottom], [right, bottom], [right + c, bottom - c], [left + c, bottom - c]], BOX_SHADOW_BOTTOM_SHADE),
      face([[right, bottom], [right + c, bottom - c], [right + c, top - c], [right, top]], BOX_SHADOW_SIDE_SHADE),
      boxElement(m, left, bottom, right, top, paint, 0),
    ];
  }
  if (shape.style === BOX_3D_STYLE && c > 0) {
    const face = (points: [number, number][], shadeBy: number): SceneElement => ({
      kind: "path",
      points: points.map(([x, y]) => sceneOf(m, x, y)),
      closed: true,
      fill: paint.fill ? shadeCss(paint.fill, shadeBy) : null,
      stroke: paint.stroke,
      strokeWidth: paint.strokeWidth,
    });
    return [
      face([[left, top], [right, top], [right + c, top + c], [left + c, top + c]], BOX_3D_TOP_SHADE),
      face([[right, bottom], [right + c, bottom + c], [right + c, top + c], [right, top]], BOX_3D_SIDE_SHADE),
      boxElement(m, left, bottom, right, top, paint, 0),
    ];
  }
  if (shape.style === DOUBLE_BOX_STYLE && c > 0) {
    // Two outlines c apart (the fill, if any, inside the outer one).
    const inner = right - left > 2 * c && top - bottom > 2 * c;
    return [
      boxElement(m, left, bottom, right, top, paint, 0),
      ...(inner ? [boxElement(m, left + c, bottom + c, right - c, top - c, { ...paint, fill: null }, 0)] : []),
    ];
  }
  const radius = shape.style !== SQUARE_BOX_STYLE && c > 0 ? c * BOX_CORNER_RADIUS_FACTOR : 0;
  return [boxElement(m, shape.x1, shape.y1, shape.x2, shape.y2, paint, radius)];
}

function drawShape(ctx: ChartSceneContext, entry: ShapeEntry, m: Readonly<Transform>): SceneElement[] {
  const { shape } = entry;
  if (shape.kind === "text") return drawText(ctx, shape, m);
  const paint = paintFor(ctx, shape, entry.state);
  if (!paint.fill && !paint.stroke) return [];
  const { fill, stroke, strokeWidth } = paint;
  /** Style for an element inside inObjectFrame: compensate the stroke for the scale. */
  const framed = { fill, stroke, strokeWidth: strokeWidth / linearScale(m) };

  switch (shape.kind) {
    case "polyline":
    case "polygon":
    case "curve":
    case "closedCurve":
    case "curveA": {
      const closed = shape.kind === "polygon" || shape.kind === "closedCurve";
      const smooth = shape.kind === "curve" || shape.kind === "closedCurve" || (shape.kind === "curveA" && !isStraightCurveA(shape));
      const parts = shape.kind === "curveA" ? [shape.points] : pointParts(shape.points, shape.partCounts);
      const dash = lineDash(ctx, entry.state);
      return parts
        .filter((part) => part.length > 0)
        .flatMap((part): SceneElement[] => {
          // 0x1080/0x1091/0x1098 hold cubic Bézier control points (see bezierPoints);
          // 0x10A0/0x10A1 pass through their points (smoothed data lines).
          const bezier = smooth && shape.kind !== "curveA" && isBezierControlList(part);
          const points = (bezier ? bezierPoints(part) : part).map((p) => sceneOf(m, p.x, p.y));
          const curved = smooth && !bezier;
          if (dash && stroke && !curved) {
            // A dashed outline: the fill on its own, then one open path per dash.
            const out: SceneElement[] = [];
            if (closed && fill) out.push({ kind: "path", points, closed, fill, stroke: null, strokeWidth });
            for (const d of dashedParts(points, closed, dash[0], dash[1])) {
              out.push({ kind: "path", points: d, closed: false, fill: null, stroke, strokeWidth });
            }
            return out;
          }
          return [
            {
              kind: "path",
              points,
              closed,
              ...(curved ? { smooth: true } : {}),
              fill: closed ? fill : null,
              stroke,
              strokeWidth,
            },
          ];
        });
    }
    case "box":
      return drawBox(ctx, shape, m, paint);
    case "ellipse": {
      if (keepsAxes(m) || swapsAxes(m)) {
        const c = sceneOf(m, shape.cx, shape.cy);
        const [a, b, cc, d] = m;
        const rx = keepsAxes(m) ? Math.abs(a) * shape.rx : Math.abs(cc) * shape.ry;
        const ry = keepsAxes(m) ? Math.abs(d) * shape.ry : Math.abs(b) * shape.rx;
        return [{ kind: "ellipse", cx: c.x, cy: c.y, rx, ry, fill, stroke, strokeWidth }];
      }
      return [inObjectFrame(m, [{ kind: "ellipse", cx: shape.cx, cy: -shape.cy, rx: shape.rx, ry: shape.ry, ...framed }])];
    }
    case "arc":
    case "band": {
      if (isPieSlice(shape)) {
        const points = pieSlicePoints(shape).map((p) => sceneOf(m, p.x, p.y));
        return points.length ? [{ kind: "path", points, closed: true, fill, stroke, strokeWidth }] : [];
      }
      const geom = { startAngle: shape.start.degrees, endAngle: shape.end.degrees };
      const extra = shape.kind === "band" ? { kind: "band" as const, depth: shape.depth } : { kind: "arc" as const };
      const style = shape.kind === "arc" ? { fill: null, stroke } : { fill, stroke };
      if (isPositiveScale(m)) {
        const c = sceneOf(m, shape.cx, shape.cy);
        const el = { ...extra, cx: c.x, cy: c.y, rx: m[0] * shape.rx, ry: m[3] * shape.ry, ...geom, ...style, strokeWidth };
        if (el.kind === "band") el.depth *= m[3];
        return [el];
      }
      const el = { ...extra, cx: shape.cx, cy: -shape.cy, rx: shape.rx, ry: shape.ry, ...geom, ...style, strokeWidth: framed.strokeWidth };
      return [inObjectFrame(m, [el])];
    }
  }
}

// ---------------------------------------------------------------------------
// Text blocks
// ---------------------------------------------------------------------------

export interface TextLinePiece {
  text: string;
  /** Byte codes of `text`, one per character (TextRun.codes). */
  codes: Uint8Array;
  run: TextRun;
  /** The header's line entry for this line, when the block has them. */
  entry?: TextLayoutLine;
}

/** Index after the last character that is not a line end (0x0A "\n" or 0x0D "\r"). */
function endWithoutLineBreaks(text: string, end = text.length): number {
  while (end > 0 && (text[end - 1] === "\n" || text[end - 1] === "\r")) end--;
  return end;
}

/** Lines of a text block: from the layout entries, or the runs split at line breaks. */
export function textBlockLines(shape: TextBlockShape): TextLinePiece[] {
  const out: TextLinePiece[] = [];
  if (shape.lines.length > 0 && shape.runs.length > 0) {
    // Character ranges of the runs in the whole text.
    const starts: number[] = [];
    let at = 0;
    for (const r of shape.runs) {
      starts.push(at);
      at += r.text.length;
    }
    const all = shape.runs.map((r) => r.text).join("");
    const allCodes = new Uint8Array(at);
    shape.runs.forEach((r, i) => allCodes.set(r.codes, starts[i]));
    for (const line of shape.lines) {
      // The run holding the line's first character styles the whole line
      // (sample blocks have one run).
      let i = 0;
      while (i + 1 < shape.runs.length && starts[i + 1]! <= line.start) i++;
      const from = Math.min(line.start, all.length);
      const to = endWithoutLineBreaks(all, Math.min(line.start + line.length, all.length));
      const end = Math.max(from, to);
      out.push({ text: all.slice(from, end), codes: allCodes.subarray(from, end), run: shape.runs[i]!, entry: line });
    }
    return out;
  }
  for (const run of shape.runs) {
    // Lines end at CR LF, CR or LF.
    const re = /\r\n|\r|\n/g;
    let from = 0;
    for (;;) {
      const m = re.exec(run.text);
      const end = m ? m.index : run.text.length;
      out.push({ text: run.text.slice(from, end), codes: run.codes.subarray(from, end), run });
      if (!m) break;
      from = m.index + m[0].length;
    }
  }
  return out;
}

function anchorFor(justification: number): TextAnchor {
  switch (justification) {
    case Justification.Centre:
      return "middle";
    case Justification.Right:
      return "end";
    default:
      return "start";
  }
}

/** Layout a line entry stores, relative to the top of the text extent (assumptions.ts OBJECT_TEXT_USES_LINE_ENTRIES). */
export interface StoredLineLayout {
  /** Top and bottom of the line's box (object y, up; top 0 for the first line). */
  top: number;
  bottom: number;
  /** Glyph size, object units. */
  em: number;
  /** Baseline below the box top, object units (the stored ascent; OBJECT_TEXT_BASELINE_AT_ASCENT). */
  ascent: number;
}

/** The layout stored in a line entry, or null when it holds none (em 0, inverted box, short entry). */
export function storedLineLayout(line: Pick<TextLayoutLine, "raw">): StoredLineLayout | null {
  const r = line.raw;
  if (r.length < 28) return null;
  const i16 = (o: number) => ((r[o]! | (r[o + 1]! << 8)) << 16) >> 16;
  const top = i16(14);
  const bottom = i16(18);
  const em = r[26]! | (r[27]! << 8);
  const storedAscent = -i16(20);
  const ascent = OBJECT_TEXT_BASELINE_AT_ASCENT && storedAscent > 0 && storedAscent <= top - bottom ? storedAscent : OBJECT_TEXT_ASCENT * em;
  return em > 0 && top <= 0 && bottom < top ? { top, bottom, em, ascent } : null;
}

/**
 * Box top (relative to the text extent's top) and glyph size of each line:
 * the stored line entries when every line has one, else the lines stacked
 * by the data-chart rule from their run sizes (data/text.ts stackTops).
 */
function lineLayouts(ctx: ChartSceneContext, lines: readonly TextLinePiece[]): { top: number; size: number; ascent: number }[] {
  const stored = OBJECT_TEXT_USES_LINE_ENTRIES ? lines.map((l) => (l.entry ? storedLineLayout(l.entry) : null)) : [];
  if (lines.length > 0 && stored.length === lines.length && stored.every((s) => s !== null)) {
    return stored.map((s) => ({ top: s!.top, size: s!.em, ascent: s!.ascent }));
  }
  const tops = stackTops(lines.map((l) => legacyLineBoxHeight(ctx, l.run.size)), 0);
  return lines.map((l, i) => {
    const size = textSizeToUnits(l.run.size, ctx.page.shortSide);
    return { top: tops[i]!, size, ascent: textAscent(size) };
  });
}

/** The box text is laid out in: the text extent at header offset 62, else the frame at 38 (SPEC §5.6 [I]). */
function textLayoutBox(shape: TextBlockShape): Box | null {
  const extent = shape.otherBoxes.length >= 2 ? shape.otherBoxes[1]! : null;
  return extent ?? shape.textBox;
}

/**
 * Each glyph advance rounded to whole screen pixels (assumptions.ts
 * GLYPH_ADVANCE_PIXELS), for glyphs `size` units per em on a screen whose
 * pixel is `pixel` units in the same frame; no rounding when `pixel` is 0.
 */
export function advanceRounder(size: number, pixel: number): ((advance: number) => number) | undefined {
  const round = GLYPH_ADVANCE_PIXELS;
  if (!round || !(pixel > 0) || !(size > 0)) return undefined;
  const step = (pixel / size) * EM_UNITS; // one pixel in em units
  return (advance) => round(advance / step) * step;
}

/**
 * A text line drawn with glyphs (task 7f; fonts/glyphRun.ts
 * glyphLineElement) with this format's rules: `pixel` (same units as
 * `size`) rounds each advance to screen pixels (advanceRounder), and
 * stroke fonts without a pen width use STROKE_FONT_DEFAULT_PEN_EM.
 */
export function glyphLineElement(
  glyphs: GlyphSource,
  text: string,
  codes: ArrayLike<number>,
  color: string,
  anchor: TextAnchor,
  x: number,
  y: number,
  size: number,
  pixel = 0,
): GlyphsElement {
  return drawGlyphLine(glyphs, text, codes, color, anchor, x, y, size, {
    roundAdvance: advanceRounder(size, pixel),
    defaultPen: STROKE_FONT_DEFAULT_PEN_EM * EM_UNITS,
  });
}

function drawText(ctx: ChartSceneContext, shape: TextBlockShape, m: Readonly<Transform>): SceneElement[] {
  const box = textLayoutBox(shape);
  if (!box) {
    ctx.warn("text block without a text box; not drawn");
    return [];
  }
  const left = Math.min(box.x1, box.x2);
  const right = Math.max(box.x1, box.x2);
  const direct = isUniformPositiveScale(m);
  const out: SceneElement[] = [];
  const top = Math.max(box.y1, box.y2);
  const lines = textBlockLines(shape);
  const layouts = lineLayouts(ctx, lines);
  for (const [i, { text, codes, run }] of lines.entries()) {
    const { size } = layouts[i]!;
    const baseline = top + layouts[i]!.top - layouts[i]!.ascent;
    if (!text.trim()) continue;
    const fill = textRunColor(ctx, run);
    if (!fill) continue;
    const anchor = anchorFor(run.justification);
    const x = anchor === "middle" ? (left + right) / 2 : anchor === "end" ? right : left;
    const face = ctx.faces.faceFor(run.fontKey);
    const { glyphs } = face;
    if (glyphs) {
      if (direct) {
        const p = sceneOf(m, x, baseline);
        out.push(glyphLineElement(glyphs, text, codes, fill, anchor, p.x, p.y, size * m[0], ctx.page.screenPixel));
      } else {
        const pixel = ctx.page.screenPixel / linearScale(m);
        out.push(inObjectFrame(m, [glyphLineElement(glyphs, text, codes, fill, anchor, x, -baseline, size, pixel)]));
      }
      continue;
    }
    const { font } = face;
    const style = { text, fill, fontFamily: font.cssFamily, fontWeight: font.weight, italic: font.italic, anchor };
    if (direct) {
      const p = sceneOf(m, x, baseline);
      out.push({ kind: "text", x: p.x, y: p.y, size: size * m[0], ...style } satisfies TextElement);
    } else {
      out.push(inObjectFrame(m, [{ kind: "text", x, y: -baseline, size, ...style } satisfies TextElement]));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Bitmaps
// ---------------------------------------------------------------------------

function fileRefs(records: readonly LeafRecord[], kind: number): string[] {
  return records
    .filter((r) => r.tag === TAG_FILE_REFERENCE && r.data.length >= 4)
    .map((r) => readFileReference(r.data))
    .filter((ref) => ref.kind === kind && ref.name !== "")
    .map((ref) => ref.name);
}

/** Data URL of a bitmap named by the chart, decoded once per scene build. */
function bitmapImage(b: Builder, name: string): PcxImage | null {
  // Same file whatever drive or directory the chart names (ParseContext.resolve ignores them too).
  const key = name.replace(/^.*[\\/:]/, "").toUpperCase();
  if (b.bitmaps.has(key)) return b.bitmaps.get(key) ?? null;
  let image: PcxImage | null = null;
  const file = b.ctx.parseContext?.resolve(name, "bitmap") ?? null;
  if (!file) {
    b.ctx.warn(`bitmap ${name} not found; not drawn`);
  } else {
    try {
      image = decodePcx(file.bytes);
      image.warnings.forEach((w) => b.ctx.warn(`bitmap ${file.name}: ${w}`));
    } catch (e) {
      b.ctx.warn(`bitmap ${file.name} could not be read (${e instanceof Error ? e.message : String(e)}); not drawn`);
    }
  }
  b.bitmaps.set(key, image);
  return image;
}

/** RGB of a 4-byte colour attribute: 0xFF R G B, else a colour role (role 0: none). */
function attributeRgb(ctx: ChartSceneContext, raw: Uint8Array | undefined): Rgb | null {
  if (!raw || raw.length < 4) return null;
  const direct = directRgb(raw, 0);
  if (direct) return direct;
  const css = ctx.color(raw[0]!);
  return css ? [parseInt(css.slice(1, 3), 16), parseInt(css.slice(3, 5), 16), parseInt(css.slice(5, 7), 16)] : null;
}

/**
 * A bitmap object (assumptions.ts BITMAP_NATIVE_TILED): its 404 kind 5
 * bitmap at one bitmap pixel per screen pixel, the 0x1140 hot spot on the
 * centre of the 612 bounding box, repeated to fill the box and clipped to
 * it (ImageElement.tile with `screenPixels`, so that each display mode
 * draws it at its own pixel size); or, when 0x1140 byte 3 is 2
 * (assumptions.ts BITMAP_FIT_TO_BOX), once, stretched to the box (an
 * ImageElement without `tile`). A monochrome bitmap is drawn in the
 * object's colours (assumptions.ts BITMAP_MONO_COLORS): its black pixels
 * in the 0x110C colour, its white pixels in the 0x110B colour; a colour
 * that is "none" leaves those pixels transparent. The image carries its
 * pixels as palette indexes (ImageElement.pixels) so that display modes can
 * show each pixel's colour as the screen shows that colour in a fill.
 */
function drawBitmap(b: Builder, obj: DrawnObject, parent: Readonly<Transform>): SceneElement[] {
  const [name] = fileRefs(obj.extraRecords, REF_KIND_BITMAP);
  if (name === undefined) {
    b.ctx.warn(`bitmap object at offset ${obj.offset} names no bitmap (404 kind 5); not drawn`);
    return [];
  }
  const image = bitmapImage(b, name);
  if (!image) return [];
  // The 612 bounding box is already on the page; only a group transform applies on top.
  const { x1, y1, x2, y2 } = obj.bbox;
  const corners = [applyTransform(parent, { x: x1, y: y1 }), applyTransform(parent, { x: x2, y: y2 })];
  const rect = areaToRect({ x1: corners[0]!.x, y1: corners[0]!.y, x2: corners[1]!.x, y2: corners[1]!.y });
  const last = (subTag: number) => obj.attributes.filter((a) => a.subTag === subTag).pop()?.raw;
  const indexed = indexPixels(image);
  let palette: (Rgb | null)[] | null = indexed?.palette ?? null;
  if (image.monochrome && BITMAP_MONO_COLORS) {
    palette = [attributeRgb(b.ctx, last(BITMAP_INK_SUBTAG)), attributeRgb(b.ctx, last(BITMAP_PAPER_SUBTAG))];
    if (palette.every((c) => c === null)) return [];
  }
  const el: ImageElement = { kind: "image", href: "", ...rect };
  if (indexed && palette) {
    const rgba = new Uint8ClampedArray(image.width * image.height * 4);
    indexed.data.forEach((k, i) => {
      const c = palette![k];
      if (!c) return;
      rgba.set([c[0], c[1], c[2], 255], i * 4);
    });
    el.href = pcxToDataUrl({ width: image.width, height: image.height, rgba });
    el.pixels = { width: image.width, height: image.height, data: indexed.data, palette: palette.map((c) => (c ? rgbToCss(c) : null)) };
  } else {
    el.href = pcxToDataUrl(image);
  }
  const hot = last(AttributeSubTag.Bitmap);
  const fit = hot && hot.length > BITMAP_FIT_OFFSET ? hot[BITMAP_FIT_OFFSET]! : 0;
  if (fit !== 0 && fit !== BITMAP_FIT_TO_BOX) {
    b.ctx.warn(`bitmap ${name}: unknown 0x1140 fit mode ${fit} (byte ${BITMAP_FIT_OFFSET}); drawn at its own size, tiled`);
  }
  if (BITMAP_NATIVE_TILED && fit !== BITMAP_FIT_TO_BOX) {
    const u16 = (o: number) => (hot && hot.length >= o + 2 ? hot[o]! | (hot[o + 1]! << 8) : 0);
    const px = b.ctx.page.screenPixel;
    el.tile = {
      pixelWidth: px,
      pixelHeight: px,
      imageWidth: image.width,
      imageHeight: image.height,
      anchorX: rect.x + rect.width / 2,
      anchorY: rect.y + rect.height / 2,
      hotX: u16(BITMAP_HOTSPOT_OFFSET),
      hotY: u16(BITMAP_HOTSPOT_OFFSET + 2),
      screenPixels: true,
    };
  }
  return [el];
}

// ---------------------------------------------------------------------------
// Objects and groups
// ---------------------------------------------------------------------------

/** A 0x10A0/0x10A1 curve whose trailer marks it straight (assumptions.ts CURVE_A_STRAIGHT_OFFSET). */
export function isStraightCurveA(shape: CurveAShape): boolean {
  const t = shape.trailer;
  return t.length >= CURVE_A_STRAIGHT_OFFSET + 2 && (t[CURVE_A_STRAIGHT_OFFSET]! | (t[CURVE_A_STRAIGHT_OFFSET + 1]! << 8)) === 1;
}

/** Marker shape and size (object units) of a 0x10A0/0x10A1 curve (assumptions.ts CURVE_MARKER_SHAPE_OFFSET), or null for none. */
export function curveMarker(shape: CurveAShape): { shape: number; size: number } | null {
  const t = shape.trailer;
  const u16 = (o: number) => (t.length >= o + 2 ? t[o]! | (t[o + 1]! << 8) : 0);
  const marker = u16(CURVE_MARKER_SHAPE_OFFSET);
  const size = u16(CURVE_MARKER_SIZE_OFFSET);
  return CURVE_MARKERS.has(marker) && size > 0 ? { shape: marker, size } : null;
}

/**
 * The point markers of a 0x10A0/0x10A1 curve, one per point, in object
 * units mapped by `m` (they scale with the object): squares outlined in the
 * line colour and filled with the fill colour, crosses stroked
 * (assumptions.ts CURVE_MARKERS).
 */
export function drawCurveMarkers(ctx: ChartSceneContext, shape: CurveAShape, state: readonly Attribute[], m: Readonly<Transform>): SceneElement[] {
  const marker = curveMarker(shape);
  if (!marker) return [];
  const kind = CURVE_MARKERS.get(marker.shape)!;
  let line: LineAttr | undefined;
  let fillAttr: FillAttr | undefined;
  for (const a of state) {
    if (a.kind === "line") line = a;
    else if (a.kind === "fill") fillAttr = a;
  }
  const stroke = line ? cssOf(ctx, line.lineColor, line.rgb) : null;
  if (!stroke) return [];
  const fill = fillAttr ? cssOf(ctx, fillAttr.fillColor, fillAttr.rgb) : null;
  const strokeWidth = lineWidthFor(undefined);
  const h = (marker.size * kind.size) / 2;
  const out: SceneElement[] = [];
  const seg = (x1: number, y1: number, x2: number, y2: number): SceneElement => ({
    kind: "path",
    points: [sceneOf(m, x1, y1), sceneOf(m, x2, y2)],
    closed: false,
    fill: null,
    stroke,
    strokeWidth,
  });
  for (const p of shape.points) {
    if (kind.form === "square") {
      const points = [sceneOf(m, p.x - h, p.y - h), sceneOf(m, p.x + h, p.y - h), sceneOf(m, p.x + h, p.y + h), sceneOf(m, p.x - h, p.y + h)];
      out.push({ kind: "path", points, closed: true, fill, stroke, strokeWidth });
    } else {
      out.push(seg(p.x - h, p.y, p.x + h, p.y), seg(p.x, p.y - h, p.x, p.y + h));
      if (kind.form === "asterisk") out.push(seg(p.x - h, p.y - h, p.x + h, p.y + h), seg(p.x - h, p.y + h, p.x + h, p.y - h));
    }
  }
  return out;
}

/** Whether shape `i` is a 0x10A0/0x10A1 curve right after a polyline, which draws it (CURVE_A_AFTER_POLYLINE_DRAWN). */
function duplicatesPolyline(shapes: readonly ShapeEntry[], i: number): boolean {
  return !CURVE_A_AFTER_POLYLINE_DRAWN && shapes[i]!.shape.kind === "curveA" && shapes[i - 1]?.shape.kind === "polyline";
}

function drawObject(b: Builder, obj: DrawnObject, parent: Readonly<Transform>): SceneElement[] {
  let children: SceneElement[];
  if (obj.attributes.some((a) => a.kind === "bitmap")) {
    children = drawBitmap(b, obj, parent);
  } else {
    const m = composeTransforms(parent, obj.transform);
    children = obj.shapes.flatMap((entry, i) => [
      ...(duplicatesPolyline(obj.shapes, i) ? [] : drawShape(b.ctx, entry, m)),
      ...(entry.shape.kind === "curveA" ? drawCurveMarkers(b.ctx, entry.shape, entry.state, m) : []),
    ]);
  }
  if (obj.buttonName === undefined) return children;
  addHitArea(b.ctx, obj, parent);
  return [{ kind: "group", buttonName: obj.buttonName, children }];
}

/**
 * Resolve, read and parse a chart that `ctx`'s chart refers to (an embedded
 * chart or the button chart). Null, with a warning starting with `label`,
 * when it is missing, not a chart, unreadable, or already being drawn
 * (`ctx.embedChain`: a chart referring to itself, directly or through
 * another). `key` is its upper-case path, for the child context's chain.
 */
export function loadReferencedChart(
  ctx: ChartSceneContext,
  name: string,
  purpose: string,
  label: string,
): { chart: Chart; key: string } | null {
  const file = ctx.parseContext?.resolve(name, purpose) ?? null;
  if (!file) {
    ctx.warn(`${label} not found; not drawn`);
    return null;
  }
  const key = file.path.toUpperCase();
  if (ctx.embedChain.includes(key)) {
    const verb = purpose === "embedded chart" ? "embeds itself" : "refers to itself";
    ctx.warn(`${label} ${verb} (${[...ctx.embedChain, key].join(" → ")}); not drawn again`);
    return null;
  }
  try {
    const container = readContainer(file.bytes);
    if (container.kind !== "chart") {
      ctx.warn(`${label} is a ${container.kind}, not a chart; not drawn`);
      return null;
    }
    const parsed = parseChart(container);
    parsed.warnings.forEach((w) => ctx.warn(`${label}: ${w}`));
    return { chart: parsed.chart, key };
  } catch (e) {
    ctx.warn(`${label} could not be read (${e instanceof Error ? e.message : String(e)}); not drawn`);
    return null;
  }
}

/**
 * The chart a group embeds (404 kind 4 before the 608; task 13c), drawn in
 * a group whose matrix F·M·F maps the embedded chart's scene coordinates
 * through M (the group's 616 after its parents') onto the host's.
 */
function drawEmbeddedChart(ctx: ChartSceneContext, name: string, m: Readonly<Transform>): SceneElement[] {
  const label = `embedded chart ${name}`;
  if (ctx.embedChain.length > EMBEDDED_CHART_MAX_DEPTH) {
    ctx.warn(`${label}: charts nest more than ${EMBEDDED_CHART_MAX_DEPTH} levels deep; not drawn`);
    return [];
  }
  const loaded = loadReferencedChart(ctx, name, "embedded chart", label);
  if (!loaded) return [];
  // Glyph advances are rounded to the embedded page's own screen pixels, not the host's
  // (GLYPH_ADVANCE_PIXELS: closer on all four embedding samples).
  const child = createEmbeddedContext(ctx, loaded.chart, loaded.key);
  const children: SceneElement[] = [];
  if (EMBEDDED_CHART_DRAWS_BACKGROUND) {
    const fill = child.color(ROLE.FrameBkg);
    const { minX, minY, width, height } = child.page.viewBox;
    if (fill) children.push({ kind: "rect", x: minX, y: minY, width, height, fill, stroke: null });
  }
  children.push(...(ctx.drawChart ?? drawObjectLayer)(child));
  return [{ kind: "group", transform: flippedMatrix(m), children }];
}

// ---------------------------------------------------------------------------
// Button click areas (task 20, assumptions.ts BUTTON_HIT_AREAS)
// ---------------------------------------------------------------------------

/** Fill of a click area: painted (so SVG hit-tests it) but invisible. */
export const HIT_AREA_FILL = "transparent";

/** Page box of `box` mapped by `m`, as the axis-aligned box around its corners. */
function mappedBox(m: Readonly<Transform>, box: Readonly<Box>): Box {
  const corners = [
    applyTransform(m, { x: box.x1, y: box.y1 }),
    applyTransform(m, { x: box.x2, y: box.y1 }),
    applyTransform(m, { x: box.x1, y: box.y2 }),
    applyTransform(m, { x: box.x2, y: box.y2 }),
  ];
  const xs = corners.map((p) => p.x);
  const ys = corners.map((p) => p.y);
  return { x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) };
}

function unionBox(boxes: readonly Box[]): Box | null {
  if (boxes.length === 0) return null;
  return {
    x1: Math.min(...boxes.map((b) => Math.min(b.x1, b.x2))),
    y1: Math.min(...boxes.map((b) => Math.min(b.y1, b.y2))),
    x2: Math.max(...boxes.map((b) => Math.max(b.x1, b.x2))),
    y2: Math.max(...boxes.map((b) => Math.max(b.y1, b.y2))),
  };
}

/**
 * Page box of a layer item under `parent`: an object's 612 box (already
 * through its own 616); for a group, its members' boxes through the group's
 * 616 (the 608 box equals their union in the samples; it is used only for
 * a group with no members).
 */
function itemPageBox(item: LayerItem, parent: Readonly<Transform>): Box | null {
  if (item.kind === "object") return mappedBox(parent, item.bbox);
  const t = item.transform ? composeTransforms(parent, item.transform) : parent;
  const members = unionBox(item.items.map((i) => itemPageBox(i, t)).filter((b): b is Box => b !== null));
  return members ?? (item.box ? mappedBox(t, item.box) : null);
}

/**
 * Page box around everything a chart's object layer draws (each top-level
 * item's box as for click areas), or null when it has no objects. Used to
 * find the part of the page a button chart leaves free (task 20,
 * assumptions.ts BUTTON_CHART_FITS_DATA_CHART).
 */
export function objectLayerPageBox(chart: Pick<Chart, "objectLayer">): Box | null {
  if (!chart.objectLayer) return null;
  const { layer } = parseObjectLayer(chart.objectLayer);
  return unionBox(layer.items.map((i) => itemPageBox(i, IDENTITY_TRANSFORM)).filter((b): b is Box => b !== null));
}

function addHitArea(ctx: ChartSceneContext, item: LayerItem, parent: Readonly<Transform>): void {
  if (!BUTTON_HIT_AREAS || !ctx.buttonHitAreas || item.buttonName === undefined) return;
  const box = itemPageBox(item, parent);
  if (!box) return;
  const rect: RectElement = { kind: "rect", ...areaToRect(box), fill: HIT_AREA_FILL, stroke: null };
  ctx.buttonHitAreas.push({ kind: "group", buttonName: item.buttonName, children: [rect] });
}

function drawGroup(b: Builder, group: ObjectGroup, parent: Readonly<Transform>): GroupElement {
  const t = group.transform ? composeTransforms(parent, group.transform) : parent;
  // The group's click area goes before its members' (a named member inside it wins).
  addHitArea(b.ctx, group, parent);
  const embedded = fileRefs(group.extraRecords, REF_KIND_CHART).flatMap((name) => drawEmbeddedChart(b.ctx, name, t));
  const el: GroupElement = { kind: "group", children: [...embedded, ...drawItems(b, group.items, t)] };
  if (group.buttonName !== undefined) el.buttonName = group.buttonName;
  return el;
}

function drawItems(b: Builder, items: readonly LayerItem[], parent: Readonly<Transform>): SceneElement[] {
  return items.flatMap((item) => (item.kind === "object" ? drawObject(b, item, parent) : [drawGroup(b, item, parent)]));
}

/** The 516 objects in file order, later on top (SPEC §6.5). */
export function drawObjectLayer(ctx: ChartSceneContext): SceneElement[] {
  if (!ctx.chart.objectLayer) return [];
  const { layer, warnings } = parseObjectLayer(ctx.chart.objectLayer);
  warnings.forEach((w) => ctx.warn(`object layer: ${w}`));
  return drawItems({ ctx, bitmaps: new Map() }, layer.items, IDENTITY_TRANSFORM);
}
