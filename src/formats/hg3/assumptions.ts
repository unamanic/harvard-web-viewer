/**
 * Guesses that drive drawing.
 *
 * Every value here comes from a part of docs/SPEC.md marked [I] (inferred) or
 * [?] (unknown), or from a choice the spec leaves open. Keep them all in this
 * file, each with the spec section it comes from, so that reference renders
 * from the original program (SPEC §7.3) mean editing one file.
 *
 * Add a new section per task; don't scatter guesses through the parsers.
 * Earlier guesses documented elsewhere:
 * - style table entry → text role mapping: chart.ts (STYLE_RANGES), task 9
 * - colour for roles above 64: palette.ts (colorForRole), task 6
 * - font style word → CSS weight, look-alike stacks: fonts.ts
 *   (STYLE_WEIGHTS, LOOK_ALIKES), task 7
 * The guessed transition table (SPEC §4.5) is in its own section below.
 */
import { DEFAULT_STROKE_WIDTH } from "../types";

// ---------------------------------------------------------------------------
// Task 7: text size
// ---------------------------------------------------------------------------

/**
 * The shorter side in page units of a 4:3 page (SPEC §6.1 and types.ts LANDSCAPE_VIEW_BOX: landscape
 * 32768 × 24576, portrait the transpose), and of a page without a usable 816.
 * Other page sizes: pageShortSide (task 12b).
 */
export const PAGE_SHORT_SIDE = 24576;

/**
 * Text size unit: percent of the page's shorter side (SPEC §6.4 [I]). A
 * size-9 title on a 7.5 in tall page is then about 0.68 in tall.
 */
export const TEXT_SIZE_PERCENT_OF_SHORT_SIDE = 1 / 100;

/**
 * Convert a stored text size (SPEC §6.4, f32 in record 800 and the text
 * block) to scene units: the CSS font size (em height) of the line.
 */
export function textSizeToUnits(size: number, pageShortSide: number = PAGE_SHORT_SIDE): number {
  return size * TEXT_SIZE_PERCENT_OF_SHORT_SIDE * pageShortSide;
}

// ---------------------------------------------------------------------------
// Task 12: page background and frame
// ---------------------------------------------------------------------------

/**
 * Page frame outline width in scene units. SPEC §5.5 step 1 [I] says "draw
 * the page frame (role Frame) using the frame style", but the frame style's
 * storage is not decoded; draw a plain square outline of the default width.
 */
export const FRAME_STROKE_WIDTH = DEFAULT_STROKE_WIDTH;

/**
 * Whether the 802 page frame is drawn at all (role 14 outline, SPEC §5.5
 * step 1). Not drawn [I, from evidence, not decoded]: the reference renders from HG 3.05
 * (samples-private/renders, VGA ScreenShow) show no frame on any of the 166
 * sample data charts that store an 802 area (XYTUT, PIETUT, ORGTUT, every
 * GALD*): the strips where its sides would be (x 5 and 635 of 640, or x 30
 * and 607 on the shrunk GALBUTN2 slides) hold no grey (role 14 is the DAC's
 * own grey 85 there, so a drawn frame would be solid grey). Either the frame
 * style is stored somewhere undecoded and every sample has "none", or HG
 * never outlines the 802 area on screen; either way the samples draw none.
 * Set to true to see the 802 area outlined in role 14 again.
 */
export const DRAW_PAGE_FRAME = false;

/**
 * Whether drawings (type 0x29) get a page frame (only when DRAW_PAGE_FRAME). SPEC §5.5 [I] describes the
 * frame for data charts only, and drawings have no 802 frame area (§5.2 [C]),
 * so a drawing shows just the background and its objects.
 */
export const DRAW_FRAME_FOR_DRAWINGS = false;

/** Background when the palette yields no FrameBkg colour (cannot happen today: role 15 is never "none"). */
export const FALLBACK_BACKGROUND = "#000000";

// ---------------------------------------------------------------------------
// Task 13: object layer drawing
// ---------------------------------------------------------------------------

/**
 * Outline width per value of byte 1 of a 0x1100 line attribute, as a
 * multiple of DEFAULT_STROKE_WIDTH (SPEC §5.6 [I]: "likely line width or
 * style"). In the samples byte 1 is 1 (about 8,000 shapes), 0 (about 2,300),
 * 2 (about 500), 255 (about 120) and a scatter of other values (16, 50, 88,
 * 92...) that look like junk, so the meaning is unknown [?]. Guess: 0 and 1
 * thin, 2 medium, 3 thick; 255 and anything else the default. 255 is NOT
 * read as "no outline": that would hide box and polyline outlines with no
 * evidence either way.
 */
export const LINE_WIDTH_FACTORS: ReadonlyMap<number, number> = new Map([
  [0, 1],
  [1, 1],
  [2, 2],
  [3, 3],
]);

/**
 * 0x1120 attribute: u16 line width in page units [I, from the HG 3.05
 * reference renders]. Values in the samples: 0 and 1 (most shapes), 25
 * (table cell boxes), and 74 to 369 on data lines (polylines, 0x10A0
 * curves): 294 on GALA1's line chart picture, 369 on every GALD36x/41x
 * line series, 344 on GALA1/GALB* gallery pictures. The references draw
 * those lines about 6 px (294: 5.7 px at 51.2 units per pixel; measured 6
 * px on GALA1) and 7 to 8 px (369, GALD411) thick, where our 30-unit
 * default gave 1 px. An outline is drawn at the larger of this width and
 * the 0x1100 byte 1 width (so 0, 1 and 25 change nothing).
 */
export const LINE_WIDTH_SUBTAG = 0x1120;

/**
 * 0x10A0/0x10A1 data line curves (SPEC §5.6: u16 n, n points, 6 bytes)
 * [I, from the HG 3.05 reference renders]:
 *
 * - The u16 at trailer offset 4 is 1 for a straight line through the points
 *   and 0 for a smooth curve. 118 of the 137 sample curves are 1; the
 *   references draw them with straight segments (GALD411 and GALD413
 *   "Single Line", GALC41's pictures 3 and 6), and the 0 ones smooth
 *   (GALD421 and GALD423 "Curve", GALC42's pictures 3 and 6).
 * - A curve right after a 0x1050 polyline in the same object is not drawn:
 *   the polyline is the line HG draws. When straight it holds the same
 *   points (100 samples); when smooth it holds HG's own flattened curve
 *   (13 samples, e.g. GALD421's 59-point polyline for 8 data points), which
 *   the references match and our spline through the points does not
 *   exactly (two lines showed). Only the 25 curves with no polyline before
 *   them (GALB4, GALC41, GALC42, GALC44, GALC49 pictures) are drawn.
 * - Not decoded: trailer u16 at 2 (0 to 4) looks like the point marker
 *   (the references show markers on GALD413, GALD423 and GALC44 picture 3:
 *   squares, crosses), u16 at 0 (500 to 630) perhaps its size. Markers are
 *   not drawn.
 */
export const CURVE_A_STRAIGHT_OFFSET = 4;
export const CURVE_A_AFTER_POLYLINE_DRAWN = false;

/** Outline width in scene units for 0x1100 byte 1 (see LINE_WIDTH_FACTORS). */
export function lineWidthFor(lineStyle: number | undefined): number {
  return DEFAULT_STROKE_WIDTH * ((lineStyle === undefined ? undefined : LINE_WIDTH_FACTORS.get(lineStyle)) ?? 1);
}

/**
 * Box styles (0x1070 to 0x1078 u16 style, u16 corner size c; SPEC §5.6),
 * read from the stored copies' 612 bounding boxes against the rectangle
 * (task 13d):
 * - 1 square, even when a corner size is stored (it often is);
 * - 3 rounded corners of radius c × BOX_CORNER_RADIUS_FACTOR (bbox = rect;
 *   910 org style 4 is drawn as 0x1070 style 3);
 * - 5 drop shadow: the bbox reaches c further right and c further down
 *   (30 single-shape objects, object units through the 616), and 910 org
 *   style 6 is drawn as style 5 with the shadow outside the box. The copy
 *   has no separate shadow shape, so its colour is implied: role Shadow
 *   (19), as for org charts from data; square box and shadow [I];
 * - 6 3-D box: the bbox reaches c further right and c further UP (39
 *   single-shape objects); used for the bars of 3-D bar charts (GALD312 to
 *   374, GALC35, GALC37, GALA1) whose floor and back wall are offset up and
 *   right the same way. Drawn as the front rectangle with a top and a right
 *   face c deep, shaded by BOX_3D_TOP_SHADE and BOX_3D_SIDE_SHADE [I];
 * - 2 (two page frames, bbox = rect): unknown, drawn rounded like 3 [?].
 */
export const SQUARE_BOX_STYLE = 1;
export const BOX_CORNER_RADIUS_FACTOR = 1;
export const SHADOW_BOX_STYLE = 5;
export const SHADOW_BOX_ROLE = 19;
export const BOX_3D_STYLE = 6;
/** Face brightness of a 3-D box, as the 3-D stacked column (PIE_COLUMN_3D_SHADES: front 1, top 0.75, right 0.5) [I]. */
export const BOX_3D_TOP_SHADE = 0.75;
export const BOX_3D_SIDE_SHADE = 0.5;

/**
 * Gradient fill 0x1110 (two direct colours and an angle; SPEC §5.6 [I]).
 * The scene model has no gradient element, so a gradient is drawn as a solid
 * fill in its first colour. In the samples 0x1110 never shares a display
 * list state with 0x110B.
 */
export const GRADIENT_AS_FIRST_COLOR = true;

/**
 * Text block lines (0x10B0, SPEC §5.6, task 13d). Each 28-byte line entry
 * of the header stores the copy's layout of that line, relative to the top
 * of the text extent (box at 62), in object units [I]:
 *   i16 at 14: top of the line's box (0 for the first line),
 *   i16 at 18: bottom of the line's box,
 *   i16 at 20 / u16 at 22: ascent (negated) / descent, multiples of 50,
 *   u16 at 26: em, the glyph size (= textSizeToUnits(size) within 1 unit for
 *   3,542 of 3,814 sample lines; HELP1's 27 lines store 8/9 of it, which
 *   is why its blocks, 680 apart, overlap when drawn at the run's size).
 * The boxes follow the stacking rule of data charts (DATA_TEXT_BOX_FACTOR,
 * DATA_ROW_OVERLAP: 74 of 80 second-and-later lines), and their extent is
 * the box at 62 for 3,730 lines. OBJECT_TEXT_USES_LINE_ENTRIES: draw at the
 * stored tops and em; lines without a usable entry (em 0, or no entries)
 * are stacked by the rule from their run sizes.
 */
export const OBJECT_TEXT_USES_LINE_ENTRIES = true;

/**
 * Text blocks: baseline of a line below the top of its box, as a multiple
 * of the em (the stored ascents are 0.9 to 1.0 em) [I].
 */
export const OBJECT_TEXT_ASCENT = 1.0;

/**
 * Text block colour: the tail's u16 colour and the u16 after it form the
 * 4-byte colour of SPEC §5.6 [I]. In the samples most colours are a role
 * below 256, but 0x00FF, 0xAAFF and 0xFFFF occur (byte 0 = 0xFF: a direct
 * colour with red in byte 1 and green, blue in the next u16), as do values
 * such as 0xFF04 and 0x760C whose low byte matches the second colour role
 * (stale high byte). So: byte 0 = 0xFF → direct RGB, else the role is byte 0.
 */
export const TEXT_COLOR_ROLE_MASK = 0xff;

/**
 * Low hex digits of a closed shape's sub-tag that mean "outline only"
 * (SPEC §5.6 [I]: the digit "most likely selects outline, fill or both").
 * In the samples every 0x1072 box has a meaningless fill colour (bytes such
 * as C4 00 33 01, 6 of 6) and no 0x1070 box has a fill attribute, while
 * 0x1071 and 0x1061 carry real fills. Digit 8 (0x1028, 0x1068, 0x1078,
 * 0x1098) goes with a 0x1110 gradient (all 50 gradient shapes), and 7 with
 * a direct fill and no line; both are filled by the interim rule.
 */
export const OUTLINE_ONLY_SUBTAG_DIGITS: ReadonlySet<number> = new Set([0, 2]);

// ---------------------------------------------------------------------------
// Task 13b: object drawing fixes
// ---------------------------------------------------------------------------

/**
 * Value of the u16 between the radii and the angles of an 0x1031 arc that
 * makes it a pie slice: the arc closed through the centre (SPEC §5.6 [I]).
 * All 115 sample arcs have 1 here, all sit in pie charts or pie-like
 * drawings, all have a fill colour set (0x110B, one per slice) and the low
 * digit 1 ("filled") of the painting rule. Other values (never seen) are
 * drawn as an open arc.
 */
export const PIE_SLICE_ARC_STYLE = 1;

/**
 * Attribute 0x112A (u16, never above 100) is the brightness of the fill in
 * percent [I]: 100 on flat faces and pie tops, lower values only on the
 * faces of 3-D drawings (3-D bars, cylinder sides and tops, 3-D pie walls
 * and edges), varying with the face's direction as a lighting model would
 * (e.g. 90, 15, 86, 56, 88, 19 on the radial walls of one 3-D pie, 50 on
 * its edge bands). The fill is drawn as its colour scaled towards black by
 * percent / 100. Outlines and text are left as they are.
 */
export const SHADE_SUBTAG = 0x112a;
export const SHADE_FILLS_BY_PERCENT = true;

// ---------------------------------------------------------------------------
// Task 13c: embedded charts
// ---------------------------------------------------------------------------

/**
 * Embedded charts (616 + 404 kind 4 + an empty 608 group; SPEC §3, §5.6) [I]:
 * the named chart is drawn inside the group with the group's 616 mapping
 * its page onto the host page. What the original shows is not confirmed;
 * the guess is that the embedded chart is drawn like a chart of its own
 * (frame, data chart and object layer) but without its page background,
 * so that the host page shows through, and with the HOST's palette (the
 * original shows one palette at a time). Line widths and text scale with
 * the group transform. The four sample embedding charts embed LANDSCAP.CH3
 * or PORTRAIT.CH3 (title charts drawn as a frame box and three texts) two
 * or four times at a scale of 0.5 to 0.65.
 */
export const EMBEDDED_CHART_DRAWS_BACKGROUND = false;

/**
 * How deep embedded charts may nest. The samples nest one level; the limit
 * only guards against cycles the file-name check misses.
 */
export const EMBEDDED_CHART_MAX_DEPTH = 4;

// ---------------------------------------------------------------------------
// Task 7f: text drawn with glyphs
// ---------------------------------------------------------------------------

/**
 * A text line is laid out by summing the glyph advances of its byte codes
 * (original .SPD through the HG3.FGF character map, else our clone, whose
 * advances are the originals'), with no pair kerning, no track kerning and
 * no letter spacing [I]. The .SPD files carry kerning tables (SPEC §7.5);
 * whether Harvard Graphics applied them is not known. Centred and right
 * justified lines are moved left by half or all of that sum (SPEC §6.4).
 * A code the character map gives no glyph draws nothing and advances
 * nothing [I] (stroke clones advance by a space, as their Hershey source).
 */
export const GLYPH_PAIR_KERNING = false;

/**
 * Pen width, as a fraction of the em, for a stroke-font glyph source that
 * gives none [I]. The stroke clones set their own (0.04 to 0.06 em,
 * src/fonts/stroke/clones.ts); the original .FN3 pen is unknown (task 7c).
 */
export const STROKE_FONT_DEFAULT_PEN_EM = 0.05;

// ---------------------------------------------------------------------------
// Task 20: button chart overlay
// ---------------------------------------------------------------------------

/**
 * The chart named by a 404 kind 1 reference (the "button chart", SPEC §4.4,
 * §6.5) is drawn on top of the slide, after the slide's object layer [I]
 * (the slide is shrunk under it first when it is a data chart: see
 * BUTTON_CHART_FITS_DATA_CHART):
 *
 * - Objects only: its frame, background, title/footnote text and data chart
 *   are not drawn (SPEC §4.4: "draw that chart's objects"). The two sample
 *   button charts (GALBUTN1.CH3, GALBUTN2.CH3) are drawings with no page
 *   areas and no text lines, so only the background would differ, and that
 *   would hide the slide.
 * - Placement: identity. Both are full pages in the same page coordinates;
 *   every sample host and both button charts are 10 × 7.5 in landscape, and
 *   GALBUTN1's nine outlined squares frame GALA1's nine pictures exactly.
 *   (A portrait button chart over a landscape slide is not seen; it is drawn
 *   unscaled too.)
 * - Palette: the HOST's, as for embedded charts (one palette on screen at a
 *   time). No sample button chart and none of the 199 charts naming one
 *   has a 404 kind 0 palette, so the samples cannot tell.
 * - Only the slide's own button chart is drawn: a button chart's own 404
 *   kind 1 is ignored (no chains). A button chart that is the slide itself
 *   (or a chart already being drawn) is not drawn, with a warning.
 */
export const BUTTON_CHART_OBJECTS_ONLY = true;

/**
 * A data chart (any type but a drawing) with a button chart is drawn shrunk
 * into the part of the page the button chart leaves free, the button chart
 * itself unscaled on top [I, from the HG 3.05 reference renders]:
 *
 * - Free part: the button chart's objects (their union box, as for click
 *   areas) form a band across the top (box entirely above the page centre)
 *   or the bottom (entirely below it); the free part is the rest of the
 *   page's height. GALBUTN2's objects span y 10170 to 12194, so its slides
 *   get y −12288 to 10170. A box crossing the centre (GALBUTN1's nine
 *   squares reach the bottom) leaves no band and nothing is shrunk.
 * - Fit: one uniform scale s = free height / page height (0.9138 for
 *   GALBUTN2) about the page centre, then moved so the page's centre lands
 *   on the free part's centre: x stays centred, the whole slide (title,
 *   chart, background objects) fits below the bar.
 * - Evidence: all 164 GALBUTN2 slides (every data chart naming a button
 *   chart) in samples-private/renders. Comparing each against our render of
 *   the same slide without the button chart, the bounding box of the drawn
 *   content maps by x' = 0.916 x + 25.4, y' = 0.912 y + 40.3 (pixels,
 *   least squares over 656 box edges). Drawn with this rule, 652 of the
 *   656 edges land within 3 px of the reference's (median 1 px, worst 7). GALD111's title, hidden under the
 *   bar when the slide was drawn full size, sits fully below it, as in the
 *   reference. The 35 drawings using GALBUTN1 are drawn at full size there
 *   (GALA1's pictures sit exactly in GALBUTN1's squares).
 * - Not separable from the samples: GALBUTN1 serves only drawings and
 *   GALBUTN2 only data charts, so "data charts only" and "only when the
 *   button chart is a band" both explain every reference. Both conditions
 *   are required here. Drawings are authored around their button chart;
 *   data charts are laid out on the whole page and could not be.
 * - Drawing order: with the slide out of the way it does not matter. Its
 *   bar box (0x1071 with 0x110B fill FF 00 00 00, direct black) is filled,
 *   so drawing it under the slide or outline-only would not have shown
 *   GALD111's title either; the button chart stays on top, and the click
 *   areas (BUTTON_HIT_AREAS) above everything, the slide's own ones mapped
 *   by the same fit.
 */
export const BUTTON_CHART_FITS_DATA_CHART = true;

/**
 * Click area of a show button (an object or group with a 618 name) [I]:
 * its 612 / 608 bounding box (mapped by any group transforms), not only its
 * painted pixels. The scene ends with one transparent rect per button, in
 * drawing order, above everything else, so that a click anywhere in the box
 * reaches the button, even where the box is outline-only (GALBUTN1's nine
 * squares are outlines over the gallery pictures) or where its label is a
 * separate, later object (each GALBUTN label such as "F1-Help" is an
 * unnamed text object drawn after the named box). The visible groups keep their
 * `buttonName` too. Buttons inside embedded charts (404 kind 4) get no rect.
 */
export const BUTTON_HIT_AREAS = true;

// ---------------------------------------------------------------------------
// Transitions (SPEC §4.5) [I]
// ---------------------------------------------------------------------------

/** Effects of the Projector menu that the guessed numbering covers (Keep is not in it). */
export type Hg3TransitionEffect =
  | "replace"
  | "overlay"
  | "wipe"
  | "scroll"
  | "fade"
  | "open"
  | "close"
  | "blinds"
  | "iris";

export interface TransitionGuess {
  effect: Hg3TransitionEffect;
  /** Direction where the menu offers one; null for Open/Close/Blinds, whose two variants are unnamed. */
  direction: "left" | "right" | "up" | "down" | "in" | "out" | null;
  /** 1 or 2 for the two unnamed variants of Open, Close and Blinds; 0 otherwise. */
  variant: number;
}

/**
 * GUESS, NOT CONFIRMED (SPEC §4.5 [I, needs checking]): how a slide entry
 * (702) encodes its transition is not known. The earlier reading, kept
 * here: one number per effect and direction in Projector menu order,
 * starting at 0. The samples argue against it (offsets 11 and 12 do not
 * vary together; the most common chart-slide value, 9, reads as Scroll
 * Down). Used only by the viewer's "Guessed" transitions setting.
 */
export const TRANSITION_MENU_ORDER: readonly TransitionGuess[] = [
  { effect: "replace", direction: null, variant: 0 },
  { effect: "overlay", direction: null, variant: 0 },
  { effect: "wipe", direction: "left", variant: 0 },
  { effect: "wipe", direction: "right", variant: 0 },
  { effect: "wipe", direction: "up", variant: 0 },
  { effect: "wipe", direction: "down", variant: 0 },
  { effect: "scroll", direction: "left", variant: 0 },
  { effect: "scroll", direction: "right", variant: 0 },
  { effect: "scroll", direction: "up", variant: 0 },
  { effect: "scroll", direction: "down", variant: 0 },
  { effect: "fade", direction: null, variant: 0 },
  { effect: "open", direction: null, variant: 1 },
  { effect: "open", direction: null, variant: 2 },
  { effect: "close", direction: null, variant: 1 },
  { effect: "close", direction: null, variant: 2 },
  { effect: "blinds", direction: null, variant: 1 },
  { effect: "blinds", direction: null, variant: 2 },
  { effect: "iris", direction: "in", variant: 0 },
  { effect: "iris", direction: "out", variant: 0 },
];

/**
 * The 702 field the guess reads: offset 12 (`Slide.transitionB`), "the more
 * likely field" (SPEC §4.5). Offset 11 is not used.
 */
export const TRANSITION_GUESS_FIELD = "transitionB" as const;

/**
 * Open, Close and Blinds: variant 1 read as horizontal (centre line or
 * stripes, direction "up"), variant 2 as vertical ("left") [I].
 */
export const TRANSITION_VARIANT_DIRECTIONS: Readonly<Record<number, "up" | "left">> = { 1: "up", 2: "left" };

/**
 * 702 offset 5 read as the speed: 0 Slow, 1 Medium, 2 Fast, as overall
 * durations in ms (SPEC §4.2 [I]; §4.5: "about 1.5 s, 0.75 s and 0.3 s").
 */
export const TRANSITION_SPEED_MS: readonly number[] = [1500, 750, 300];

/** Duration for any other offset 5 value: Medium [I]. */
export const TRANSITION_DEFAULT_MS = 750;

// ---------------------------------------------------------------------------
// Tasks 14, 15, 19: charts laid out from their data (fallback, SPEC §5.5)
// ---------------------------------------------------------------------------
//
// Every sample data chart stores a drawn copy of itself (SPEC §5.1), so the
// layout from data is only drawn for charts without one (scene/dataLayout.ts).
// The values below were fitted to the copies of the 13 sample title, bullet
// and table charts (GALD111-191, HELP1/2, LANDSCAP, PORTRAIT): the copies'
// text boxes (0x10B0 header offset 62) give each line's box, and the scene
// comparison (stored copy vs layout from data) gives the offsets reported
// with task 14/15/19. Page units throughout.

/**
 * Height of a text line's box: floor(DATA_TEXT_BOX_FACTOR × em / 100) × 100,
 * em = size / 100 × the short side of a page 32768 long with the 816 aspect
 * (24576 on 10 × 7.5 in, 25321 on Letter). Every box height in the copies is
 * a multiple of 100 (2200 for size 7, 2800 for 9, 3700 for 12, 1200 for 4,
 * and on Letter 2600 for 8, 2000 for 6.19, 900 for 3); a factor in
 * [1.2835, 1.2885) reproduces all of them, the Letter ones only with the
 * 25321 base [I]. Glyph sizes use the same base (task 12b, pageShortSide).
 */
export const DATA_TEXT_BOX_FACTOR = 1.285;
export const DATA_TEXT_BOX_STEP = 100;

/**
 * Stacked rows overlap: each row's box starts DATA_ROW_OVERLAP of its OWN
 * height above the previous row's box bottom, i.e. top(next) = top(prev) −
 * height(prev) + 0.15 × height(next) [I]. Equal rows then step by 0.85 ×
 * their height (1870 for size 7 boxes of 2200 in GALD111-191, 765 for the
 * 900 boxes of HELP2), and a size 9 title over a size 5 subtitle (box
 * 1600) by 2560 (2530 in ORGTUT, PIETUT, XYTUT; 0.85 × 2800 = 2380 would be
 * 150 off).
 */
export const DATA_ROW_OVERLAP = 0.15;

/**
 * Height of a blank row in a stack, in ems of its style's size [I]: with
 * DATA_ROW_OVERLAP this reproduces text, blank, text steps of 3331 for size
 * 7 (GALD111, GALD191) and 1408 for size 3 on Letter (HELP2) to 3 units.
 */
export const DATA_BLANK_ROW_HEIGHT = 1;

/** Baseline below the top of a line's box, as a multiple of the glyph size (as OBJECT_TEXT_ASCENT). */
export const DATA_TEXT_ASCENT = OBJECT_TEXT_ASCENT;

/**
 * The copies' text boxes are wider than our glyph advances (from the
 * original .SPD fonts) by about 24 page units per character, at every size
 * (median of (box − advance) / characters over the 10 × 7.5 in sample
 * copies: 18 to 30 for sizes 2.5 to 12; perhaps a device-pixel rounding of
 * each advance). On Letter pages the boxes also scale with the 25321 base
 * (DATA_TEXT_BOX_FACTOR). Used to centre bullet blocks [I].
 */
export const DATA_TEXT_CHAR_EXTRA = 24;

/** Advance per character, in ems, of text drawn with a CSS look-alike (only used to centre blocks) [I]. */
export const DATA_TEXT_CSS_ADVANCE_EM = 0.5;

/**
 * Line along the bottom of the title area, across the frame, in role Lines:
 * every sample copy of a data chart other than a title chart has one (184
 * of 184), with 0x1100 byte 1 = 1 in almost all [I].
 */
export const TITLE_SEPARATOR_LINE_STYLE = 1;

/** Bullet characters for 1108 shapes 1 and 4 (SPEC §5.4): HG3 codes 0xFA and 0xF9. */
export const BULLET_MARKER_TEXT = { bullet: "•", triangle: "►" } as const;

/**
 * Space between a bullet marker's right edge and its line, in ems of the
 * line's glyph size, per 1108 shape [I]. The copies centre marker column,
 * gap and widest line as one block in the plot area; the gap is 246 for
 * size 7 (0.143 em) for numbers, roman numbers, triangles and "none"
 * (shape 9, which still indents by the gap), while the round bullet's
 * marker box ends right at its line.
 */
export const BULLET_MARKER_GAP_EM = {
  bullet: 0,
  triangle: 0.143,
  number: 0.143,
  roman: 0.143,
  none: 0.143,
} as const;

/**
 * Inset of left- and right-aligned table cell text from its column edge, in
 * ems of the cell's glyph size: 172 for size 7 in GALD171 (0.1 em); GALD181
 * insets by 223 at its drawn size 6.19 [I]. The header rule is inset the same.
 */
export const TABLE_CELL_MARGIN_EM = 0.1;

/**
 * Numeric table cells are right-aligned whatever their justification: every
 * number in both sample copies is (justification 3), the text cells keep
 * theirs [I].
 */
export const TABLE_NUMBERS_RIGHT_ALIGNED = true;

/** Rule under the first row band (the header), role Lines, 0x1100 byte 1 = 2 in both sample copies [I]. */
export const TABLE_HEADER_RULE_STYLE = 2;

/** Value-range cell backgrounds (1212) are outlined in role Outlines, 0x1100 byte 1 = 1 (GALD181) [I]. */
export const TABLE_CELL_OUTLINE_STYLE = 1;

/**
 * Text that would overflow its area is shrunk by one factor for the whole
 * list or table, down to this factor at most [I]. HELP1's 33 rows of size 3
 * would run past its plot area; its copy's boxes are 8/9 of HELP2's (800 vs
 * 900 high, widths about 0.88), as if drawn at size 2.67, although the runs
 * still say 3. GALD181's cells (size 10) are drawn at 6.19 in its copy,
 * more than fitting needs; that rule is not known.
 */
export const DATA_FIT_MIN_SCALE = 0.25;

// ---------------------------------------------------------------------------
// Task 12b: page size from 816
// ---------------------------------------------------------------------------

/** Page units along the page's longer side, whatever the paper (SPEC §6.1). */
export const PAGE_LONG_SIDE = 32768;

/**
 * Shortest short / long side ratio of a 816 page size that is used; a
 * narrower one (or a missing, zero or non-finite size) is treated as odd and
 * the page is drawn 4:3 (PAGE_SHORT_SIDE). The samples have 0.75 and 0.773.
 */
export const PAGE_MIN_ASPECT = 0.5;

/**
 * Page units along the shorter side, from 816's width and height in inches
 * (SPEC §5.2, §6.1, §6.4) [I]: units are square, so the short side is
 * PAGE_LONG_SIDE × short / long inches: 24576 for a 10 × 7.5 in page,
 * 25320.7 for Letter (11 × 8.5 or 8.5 × 11). SPEC §6.1 guessed instead that
 * the same −12287..12287 range is stretched over a Letter page; the samples
 * say otherwise:
 * - the stored copies of the Letter data charts (GALD181, HELP1/2,
 *   LANDSCAP, PORTRAIT) draw out to y ±12406 (frames) and −12659 (LANDSCAP's
 *   box), beyond ±12288;
 * - their text box heights fit sizes as a percentage of 25321, not 24576
 *   (DATA_TEXT_BOX_FACTOR), as do the table row percentages
 *   (data/table.ts tablePercentHeight);
 * - the median text box width per character on Letter copies, minus our
 *   glyph advance at the 25321 base, is 25 units, as on 4:3 pages (24) at
 *   24576 (DATA_TEXT_CHAR_EXTRA); a least-squares fit dominated by long lines
 *   prefers 24576, so widths alone are not conclusive.
 * The page viewBox (scene/page.ts) is PAGE_LONG_SIDE by this, rounded to an
 * even number of units; text sizes (textSizeToUnits) use the unrounded value.
 */
export function pageShortSide(widthIn: number | undefined, heightIn: number | undefined): number {
  if (widthIn === undefined || heightIn === undefined) return PAGE_SHORT_SIDE;
  if (!Number.isFinite(widthIn) || !Number.isFinite(heightIn) || !(widthIn > 0) || !(heightIn > 0)) return PAGE_SHORT_SIDE;
  const aspect = Math.min(widthIn, heightIn) / Math.max(widthIn, heightIn);
  return aspect >= PAGE_MIN_ASPECT ? PAGE_LONG_SIDE * aspect : PAGE_SHORT_SIDE;
}

// ---------------------------------------------------------------------------
// Tasks 16, 18: pie and organization charts laid out from their data
// ---------------------------------------------------------------------------
//
// Fallback layout (scene/data/pie.ts, scene/data/org.ts) for charts without
// a drawn copy; fitted to the copies of the 10 sample pie charts
// (GALD211-291, PIETUT) and the 7 org charts (GALD711-761, ORGTUT). Page
// units throughout; "h" is the plot height left over by the pie titles and
// "column" the plot width divided by the number of pies.

/** First slice starts here, degrees counter-clockwise from 3 o'clock (SPEC §5.4; every sample arc) [C]. */
export const PIE_START_DEGREES = 0;

/** Flat pie radius: PIE_RADIUS × min(h, column) (6574 of 20544 in GALD211; 5163 of a 16137 column in GALD271) [I]. */
export const PIE_RADIUS = 0.32;

/**
 * 3-D pie: rx = min(0.42 h, 0.28 column) (8628 in GALD241, 4518 in
 * GALD281), ry = 0.6 rx, edge depth 0.15 rx, all truncated [I].
 */
export const PIE_3D_RADIUS_OF_HEIGHT = 0.42;
export const PIE_3D_RADIUS_OF_WIDTH = 0.28;
export const PIE_3D_TILT = 0.6;
export const PIE_3D_DEPTH = 0.15;

/** A pie with an exploded slice is drawn smaller: 0.85 flat (GALD221, GALD231), 0.7 in 3-D (GALD251, GALD261) [I]. */
export const PIE_EXPLODED_SCALE = 0.85;
export const PIE_EXPLODED_SCALE_3D = 0.7;

/** An exploded slice moves out by this fraction of the radius (of rx and ry in 3-D) along its middle [I]. */
export const PIE_EXPLODE_DISTANCE = 0.5;

/**
 * 3-D wall brightness (0x112A, percent): trunc(90 × |cos a|) for a radial
 * wall at angle a, × 0.75 (truncated) when 0° < a < 180° as placed (11 of 11
 * walls in GALD241, 261, 281); front bands 50 [I]. Only the visible wall of
 * each slice edge is drawn (start walls on the right half, end walls on the
 * left).
 */
export const PIE_3D_WALL_SHADE = 90;
export const PIE_3D_BACK_WALL_SHADE = 0.75;
export const PIE_3D_BAND_SHADE = 0.5;

/** Outline width style (0x1100 byte 1) of slices, leaders, walls and column faces. */
export const PIE_LINE_STYLE = 1;

/** Leader lines run from the rim to PIE_LABEL_LEADER × the radius along the slice middle (front ones from the edge bottom in 3-D) [I]. */
export const PIE_LABEL_LEADER = 1.1;

/**
 * Label box placement by the slice middle's direction [I]:
 * - within PIE_LABEL_SIDE_DEGREES of horizontal: beside the leader end,
 *   PIE_LABEL_SIDE_GAP_EM ems away (245 for size 4), centred vertically
 *   (8.6° and 20.65° are, 25.7° and 26.8° are not);
 * - within PIE_LABEL_ABOVE_DEGREES of straight up / PIE_LABEL_BELOW_DEGREES
 *   of straight down: centred over / under the leader end (13.2° up and 6.4°
 *   down are, 12.8° down is not);
 * - otherwise the box's nearest corner at the leader end.
 * Then moved into the plot area (GALD231, GALD271 hit its left edge).
 */
export const PIE_LABEL_SIDE_DEGREES = 22.5;
export const PIE_LABEL_ABOVE_DEGREES = 15;
export const PIE_LABEL_BELOW_DEGREES = 10;
export const PIE_LABEL_SIDE_GAP_EM = 0.25;

/** Slice labels use 1308 entry 13 + pie number (size 4, role XLabel in every sample) [I]. */
export const PIE_LABEL_STYLE_INDEX = 13;

/** 1310 byte 17 = 2: labels show only the percentage (GALD291's first pie; 1 elsewhere) [I]. */
export const PIE_LABEL_NAMES_OFF = 2;

/**
 * Stacked column (1310 byte 2 = 2, GALD231 and GALD261): from a quarter of
 * its column left of the column centre to the centre, 0.75 h tall centred
 * on the pie centre; in 3-D 0.85 as wide, front 0.5954 h tall from 0.25 h
 * below the centre, with a top and right face 0.15 × its width deep,
 * brightness 100, 75, 50. Labels "name  NN%" right of each segment [I].
 */
export const PIE_COLUMN_WIDTH = 0.25;
export const PIE_COLUMN_HEIGHT = 0.75;
export const PIE_COLUMN_3D_WIDTH = 0.85;
export const PIE_COLUMN_3D_HEIGHT = 0.5954;
export const PIE_COLUMN_3D_BOTTOM = 0.25;
export const PIE_COLUMN_3D_DEPTH = 0.15;
export const PIE_COLUMN_3D_SHADES = [1, 0.75, 0.5] as const;
/** Label box left = column right (+ its depth in 3-D) + this many ems: 648 flat (GALD231), 588 in 3-D (GALD261) for size 4 [I]. */
export const PIE_COLUMN_LABEL_GAP_EM = 0.66;
export const PIE_COLUMN_3D_LABEL_GAP_EM = 0.6;
export const PIE_COLUMN_LABEL_SEPARATOR = "  ";

/**
 * 910 byte 0, org box style: 2 square (GALD711, 741), 4 rounded corners
 * (0x1070 style 3: GALD731, 761), 6 shadowed (style 5: GALD721, 751,
 * ORGTUT) [I]. The corner or shadow size is 0.1 × the box height (354, 342,
 * 482 in the copies). A shadowed box's copy is that much narrower and
 * lower, shifted up-left by half of it from the stored centre (formats.md:
 * the (−d, +d) shift), and the connectors meet the middle of the freed
 * strip: read as a drop shadow down-right of size d, drawn in role Shadow.
 */
export const ORG_BOX_STYLE_ROUNDED = 4;
export const ORG_BOX_STYLE_SHADOW = 6;
export const ORG_CORNER_OF_HEIGHT = 0.1;

/** 904 u16 at 2 = 3: last level drawn as boxes (GALD741-761); 1 or 2: as a list (GALD711-731, ORGTUT) [I]. */
export const ORG_LAST_LEVEL_BOXES = 3;

/** List ticks are 1/16 of the box width long (507, 523) [I]. */
export const ORG_LIST_TICK_OF_WIDTH = 1 / 16;

/** List text starts after the box text margin plus this fraction of the tick (0.575 to 0.6 in the copies) [I]. */
export const ORG_LIST_TEXT_OF_TICK = 0.59;

/** Box text inset: 0.05 × the drawn box width, plus 0.263 × the corner size for rounded boxes [I]. */
export const ORG_TEXT_MARGIN_OF_WIDTH = 0.05;
export const ORG_ROUNDED_MARGIN_OF_CORNER = 0.263;

/**
 * The copies draw every org text at one factor of its tail size, a
 * multiple of 0.01 (0.56, 0.50, 0.51, 0.39, 0.36, 0.37): the largest that
 * fits all boxes, it seems [I]. Fit: each line within the inset width and
 * the block within the box height less ORG_TEXT_VMARGIN_OF_HEIGHT top and
 * bottom.
 */
export const ORG_TEXT_SCALE_STEP = 0.01;
export const ORG_TEXT_SCALE_MIN = 0.1;
export const ORG_TEXT_VMARGIN_OF_HEIGHT = 0.1;

/** Outline width style of org boxes and connectors (0x1100 byte 1 = 1 in every copy). */
export const ORG_LINE_STYLE = 1;

/** Box size when 912 is missing: fractions of the smallest column / level spacing (912 gives 0.8 and 0.59 in the samples) [I]. */
export const ORG_DEFAULT_BOX_WIDTH_OF_PITCH = 0.8;
export const ORG_DEFAULT_BOX_HEIGHT_OF_PITCH = 0.588;

// ---------------------------------------------------------------------------
// Task 17: XY charts laid out from their data
// ---------------------------------------------------------------------------

// Fallback layout (scene/data/xy.ts) for charts without a drawn copy;
// fitted to the copies of the 141 sample XY charts (GALD311-946, XYTUT).
// Page units throughout; W, H = plot area (806) size, FW, FH = frame size.

/** Frame margins in the plot area: right and top XY_FRAME_MARGIN × W / H, left the same plus the widest Y1 label (category label when horizontal) [I]. */
export const XY_FRAME_MARGIN = 0.09;
/** Bottom margin: XY_FRAME_BOTTOM_MARGIN × H plus the label box height [I]. */
export const XY_FRAME_BOTTOM_MARGIN = 0.045;
/** Gap between the frame and its tick labels, fraction of the frame width (left labels) or height (bottom labels) [I]. */
export const XY_LABEL_GAP = 0.01;
/** Gap between the frame top and the Y axis title box, fraction of H [I]. */
export const XY_TITLE_GAP = 0.045;
/** Horizontal charts: gap between the value labels and the Y axis title under (Y1) or over (Y2) them, ems of the title (GALD871: 215 units at size 3.5) [I]. */
export const XY_HTITLE_GAP_EM = 0.25;
/** Label box widths: each character's advance rounded up to this many page units (all sample label boxes are multiples of 50) [I]. */
export const XY_TEXT_WIDTH_STEP = 50;
/**
 * Axis top: the first tick step above max + (XY_Y_MARGIN − 1) × range. 157
 * gives 180 (step 20) while 75 gives 80 and 47.74 gives 50, so the margin
 * lies between 1.9 % and 4.7 % [I].
 */
export const XY_Y_MARGIN = 1.03;
/** Line style (0x1100 byte 1) of frame, grid, outlines and data lines [I]. */
export const XY_LINE_STYLE = 1;
/** Curve series (1406 byte 10 = 3): spline samples per segment [I]. */
export const XY_CURVE_STEPS = 8;
/** Curve tangents: XY_CURVE_TENSION × (next − previous) / 2 (1 = Catmull-Rom); fitted to GALD421's overshoot (491 units where Catmull-Rom gives 1094) [I]. */
export const XY_CURVE_TENSION = 0.45;
/** Legend, fractions of the label box height h: left margin, swatch size, swatch-to-text gap (items across: 2 × gap between items), row pitch, swatch top below the text box top [I]. */
export const XY_LEGEND_MARGIN = 491 / 1100;
export const XY_LEGEND_SWATCH = 0.7;
export const XY_LEGEND_GAP = 0.2;
export const XY_LEGEND_PITCH = 1.3;
export const XY_LEGEND_SWATCH_DROP = 30 / 1100;
/** Data table (1410 byte 0 = 2): left edge XY_TABLE_LEFT × row height right of the plot's; names padded by XY_TABLE_NAME_PAD × the widest name each side (GALD317, GALD367) [I]. */
export const XY_TABLE_LEFT = 0.18;
export const XY_TABLE_NAME_PAD = 0.1;
/** 3-D areas: top faces (and the end faces) at 0x112A 63 % (GALD541) [I]. */
export const XY_3D_TOP_SHADE = 0.63;
/** 3-D pyramid face brightness (front, right, left), 0x112A 100, 63, 38 [I]. */
export const XY_3D_PYRAMID_SHADES = [1, 0.63, 0.38] as const;
/**
 * 3-D: bars, line ribbons and areas are 1408 f32 at 15 percent of their
 * depth lane deep, centred in it (bars as 0x1070 style 6 with that corner
 * size; GALD312 40 %, GALD313 25 %, GALD316 20 %, GALD372 80 %, GALD541
 * 100 %). Cylinder tops have radius y = XY_3D_CYLINDER_RY × that depth,
 * shaded 50 % [I].
 */
export const XY_3D_CYLINDER_RY = 0.5;
export const XY_3D_CYLINDER_TOP_SHADE = 0.5;
/** 3-D octagonal bar: depth radius = XY_3D_OCTAGON_Z × bar depth; top face 63 % [I]. */
export const XY_3D_OCTAGON_Z = 0.5;
export const XY_3D_OCTAGON_TOP_SHADE = 0.63;
