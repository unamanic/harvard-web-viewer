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
 */
import { DEFAULT_STROKE_WIDTH } from "../../model/scene";

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
 * A 0x1120 width of more than half a screen pixel is drawn at least this
 * many screen pixels wide [I, from the screenshots of samples/claude-vs-codex]:
 * CVC06's three line series store 51 units (0.97 px at 52.75 units per
 * pixel; 1406 byte 12 = 2, the 0x1120 width ≈ 25 × byte 12 as in GALD411's
 * 15 → 369) and are 2 px thick on screen (white series: 2 px in 291 of 300
 * columns; cyan: 2 px in 235, 3 in 15), where a 51-unit band covers 1 px.
 * The 25-unit table-cell boxes (0.49 px) stay thin; no disk sample has a
 * width between 26 and 73 units. Wider lines are unchanged: adding one
 * pixel to every width over half a pixel helped the 369-unit lines (GALD411,
 * GALD414, GALD944: −0.02 to −0.05 points) but hurt GALA1 (294) and
 * REDLEFT (74, 246), so the rule for them is not known.
 */
export const LINE_WIDTH_MIN_PIXELS = 2;

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
 * - 2 (two page frames, bbox = rect): a double outline, see DOUBLE_BOX_STYLE.
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
 * Superseded by DRAW_GRADIENTS (a real gradient, see "Colour rules from the
 * reference renders" below); with DRAW_GRADIENTS off, true draws it as a
 * solid fill in its first colour. In the samples 0x1110 never shares a
 * display list state with 0x110B.
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
// Transitions (SPEC §4.5): show defaults
// ---------------------------------------------------------------------------

/**
 * Confirmed: slide 0's Draw effect (702 offset 5) is the show's default for
 * slides whose own Draw effect is blank. Inferred [I]: slide 0's Draw
 * direction and speed (offsets 6, 7) come with that default, and its Erase
 * setting (offsets 8 to 10) is the default for slides with a blank Erase
 * effect. Slide 0's offsets 6 to 10 are 0 in every sample, so this changes
 * no sample show.
 */
export const SHOW_DEFAULT_INCLUDES_DIRECTION_SPEED_AND_ERASE = true;

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
 * Text metrics Harvard Graphics 3.05 uses when it lays a chart out (SPEC
 * §5.5, "Layout rules measured in 3.05"; test charts in
 * samples/option-tests/page-size): the em is size % of the page's short
 * side rounded down [C]; the ascent is the em rounded up to a multiple of
 * 100 and the line box (1.25 × em + 50) rounded up to a multiple of 100
 * [I, fitted to every Swiss 721 test line from em 614 to 3038]. They hold
 * on Letter and 10 × 7.5 in pages alike. The sample copies (DATA_TEXT_BOX_FACTOR,
 * textAscent) were laid out by an older build and round differently, so
 * these are used only for charts drawn from their data.
 */
export const LAYOUT_305_BOX_EMS = 1.25;
export const LAYOUT_305_BOX_PAD = 50;
export const LAYOUT_305_STEP = 100;

/** 3.05 layout em (page units) of a text size: size % of the short side, rounded down [C]. */
export function layoutEm305(size: number, pageShortSide: number): number {
  return Math.floor(textSizeToUnits(size, pageShortSide) + 1e-6);
}

/** 3.05 line box height for an em: (1.25 × em + 50) rounded up to a multiple of 100 [I]. */
export function lineBox305(em: number): number {
  return Math.ceil((LAYOUT_305_BOX_EMS * em + LAYOUT_305_BOX_PAD) / LAYOUT_305_STEP - 1e-9) * LAYOUT_305_STEP;
}

/** 3.05 ascent (baseline below the box top) for an em: the em rounded up to a multiple of 100 [I]. */
export function ascent305(em: number): number {
  return Math.ceil(em / LAYOUT_305_STEP - 1e-9) * LAYOUT_305_STEP;
}

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
// (GALD211-291, PIETUT) and the 7 org charts (GALD711-761, ORGTUT). The pie
// sizes PIE_RADIUS, PIE_3D_RADIUS_OF_HEIGHT and PIE_EXPLODED_SCALE describe
// those older-build copies only; the fallback now sizes pies by the 3.05
// shares (scene/data/pie.ts pieSizing, SPEC §5.5). Page
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

/** Box placement is PIE_LABEL_SECTORS in scene/data/pie.ts; within this many degrees of horizontal, 3-D front leaders still start at the rim, not the edge bottom [I]. */
export const PIE_LABEL_SIDE_DEGREES = 22.5;
export const PIE_LABEL_SIDE_GAP_EM = 0.25;

/** Slice labels use 1308 entry 13 + pie number (size 4, role XLabel in every sample) [I]. */
export const PIE_LABEL_STYLE_INDEX = 13;

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

// ---------------------------------------------------------------------------
// Task 20 follow-up: geometry from the HG 3.05 reference renders
// ---------------------------------------------------------------------------
//
// Fitted to samples-private/renders (VGA ScreenShow, 640 × 480; private).
// One screen pixel is 51.2 page units on a 4:3 page.

/**
 * Paper sizes (816 byte 1) in inches, long × short side [I, from the
 * reference renders]. The screen shows the PAPER's page area, with the page
 * units of the stated page size (816 width × height): the tutorial charts
 * PIETUT, XYTUT and ORGTUT say paper 1 (Letter) but 10 × 7.5 in, and HG
 * draws them at 0.971 of the size of the 10 × 7.5 in gallery charts,
 * centred, which is 480 px / (25321 units / 51.2 units per px): a Letter
 * shaped 32768 × 25321 area letterboxed into 640 × 480 (scaling ours by
 * 0.971 took XYTUT 8.2 % → 1.6 %, ORGTUT 6.0 % → 1.7 %, PIETUT 5.8 % →
 * 2.0 % different pixels). Their text stays in 10 × 7.5 in units: the
 * stored em of a size 9 title is 2211 = 9 % of 24576, as on the gallery
 * charts. Every other sample's paper matches its stated size (14 with
 * 10 × 7.5 in: 217 charts; 1 with 11 × 8.5 or 8.5 × 11 in: 18). Other
 * paper codes do not occur; they fall back to the stated size. Layout
 * (text sizes, table percentages, embedding, button-bar fit) keeps the
 * stated page; only the scene's viewBox (PageGeometry.screenViewBox)
 * follows the paper.
 */
export const PAPER_SIZES_IN: ReadonlyMap<number, readonly [number, number]> = new Map([
  [1, [11, 8.5]],
  [14, [10, 7.5]],
]);

/** The VGA ScreenShow screen the references were drawn on: 640 × 480 (one pixel 51.2 page units on a 4:3 page). */
export const SCREEN_WIDTH_PX = 640;
export const SCREEN_HEIGHT_PX = 480;

/**
 * Refines BUTTON_CHART_FITS_DATA_CHART [I, from the reference renders]: the
 * button bar's height is rounded to a multiple of 40 screen rows (2048 page
 * units on a 4:3 page) before the free part is measured, and the shrunk
 * slide's left edge is moved left onto a whole screen pixel.
 *
 * Evidence: the non-text edges of all 164 GALBUTN2 slides, ours against the
 * reference in 40 px bands. Fitted to GALBUTN2's real bar bottom (10170,
 * 41.4 rows down, scale 0.9138), the reference was 2.0 px higher at row
 * 100 falling to 0.9 px at row 420 and 1.9 to 0.4 px further left from
 * x 100 to 600: it is drawn at 0.917 = 440 / 480 rows, i.e. the free part
 * starts 2048 units (row 40) below the top. With that scale every y band
 * agrees within 0.33 px (mean −0.2) and every x band was exactly 1.0 px left
 * of a centred page (left edge 26.67 px); flooring the left edge to 26 px
 * leaves −0.33 px. Only GALBUTN2's 2118-unit bar occurs, so "nearest
 * multiple of 2048" cannot be told from "40 rows" or from the buttons'
 * own bottom (10216, 40.5 rows) rounded down.
 */
export const BUTTON_BAND_SNAP_ROWS = 40;
export const BUTTON_FIT_LEFT_ON_PIXEL = true;

/**
 * Glyph advances are rounded to whole screen pixels, each glyph on its own
 * (scene/objectLayer.ts advanceRounder), as the original lays text out on
 * its 640 × 480 screen [I]. Evidence: the copies' text boxes are wider than
 * the sum of the .SPD advances by about 24 page units (0.47 px) per
 * character at every size (DATA_TEXT_CHAR_EXTRA), and in the references
 * the same lines are wider than ours by 0.33 to 0.5 px per character
 * (HELP1's 50-character lines by 17 to 20 px; GALBUTN2's key labels by 3 to
 * 8 px). With ceil rounding those differences fall to −4 to +2 px (HELP1)
 * and −3 to 0 px (key labels); rounding to nearest made 24 charts worse.
 * The pixel is the one the text is drawn at: on a slide shrunk under a
 * button bar 1 / 0.917 page units larger (the six GALD1x1 bullet slides
 * 2.4 % → 1.3 % different pixels against the unshrunk pixel), but in an
 * embedded chart (task 13c) the embedded page's own pixel, not the host's
 * (all four embedding samples closer: PDOUBLEL 0.70 % → 0.28 %). null: no
 * rounding.
 */
export const GLYPH_ADVANCE_PIXELS: ((pixels: number) => number) | null = (px) => Math.ceil(px - 1e-6);

/**
 * A text line's baseline is its box top minus the line entry's stored
 * ascent (0x10B0 line entry i16 at 20, negated), not minus the em
 * (OBJECT_TEXT_ASCENT) [I, from the reference renders]. The ascent is a
 * multiple of 100 at or just below the em in almost every entry (900 for em
 * 982, 800 for 860, 1200 for 1228, 2200 for 2211), and box height = ascent
 * + descent. Evidence: with the baseline one em down, small text sat 1 px
 * (often 2) lower than in the references: of 5,592 measured lines the best
 * vertical shift was −1 px for 3,716, −2 for 637 and 0 for 1,103, all in
 * text under 16 px tall, while lines over 22 px tall matched (206 of 234 at
 * 0); em − ascent is 82 units (1.6 px) at size 4 but 11 units at size 9.
 * Lines without a usable entry, and charts laid out from data, use
 * textAscent: the em rounded down to TEXT_ASCENT_STEP (that rule gives the
 * stored ascent for all but 51 of 3,800 sample line entries).
 */
export const OBJECT_TEXT_BASELINE_AT_ASCENT = true;
export const TEXT_ASCENT_STEP = 100;

/** Baseline below a line box's top for glyph size `em` (page or object units), see OBJECT_TEXT_BASELINE_AT_ASCENT. */
export function textAscent(em: number): number {
  if (!OBJECT_TEXT_BASELINE_AT_ASCENT || !(TEXT_ASCENT_STEP > 0)) return OBJECT_TEXT_ASCENT * em;
  const a = Math.floor(em / TEXT_ASCENT_STEP + 1e-9) * TEXT_ASCENT_STEP;
  return a > 0 ? a : OBJECT_TEXT_ASCENT * em;
}

/**
 * 0x112B attribute: u16 line style, 0 solid, 1 dotted [I, from the
 * reference renders]. In the samples 1 marks the grid lines of 142 XY
 * charts (one multi-part 0x1050 polyline each: 170 shapes) and 7 polygons
 * of GALD492, 26 texts and one curve; everything else has 0. The
 * references draw those grid lines dotted where ours were solid (GALD852,
 * GALD842, GALD812 on their 3-D walls; GALD311's 2-D grid over the plot
 * fill). Pattern, in screen pixels at the drawn scale (so on a shrunk
 * GALBUTN2 slide 1 / 0.917 longer in page units): dashes 2 px long, 4.5 px
 * apart: GALD852's wall line is lit on rows 136-137 and 142-143, GALD311's
 * horizontal grid line shows a lit pixel every 6, 6, 8, 6, 6, 6, 8 px (a
 * 6.5 px period) through the plot's dither. Not explained: PALVIEW's
 * dotted lines (0x1100 byte 1 = 0, a drawing at full size) repeat every
 * 3.4 px (2 lit, 1 or 2 dark). Text, boxes and smooth curves stay solid.
 */
export const LINE_STYLE_SUBTAG = 0x112b;
export const LINE_STYLE_DASHES: ReadonlyMap<number, readonly [on: number, off: number]> = new Map([[1, [2, 4.5]]]);

// ---------------------------------------------------------------------------
// Colour rules from the reference renders (palette 1554/1555, gradients)
// ---------------------------------------------------------------------------
// Evidence: the HG 3.05 renders in samples-private/renders (VGA ScreenShow,
// 640 × 480), read pixel by pixel; see also src/render/vgaScreenShow.ts for
// how the screen dithers what these rules produce.

/**
 * The page background comes from the palette's record 1554 [I, from the
 * reference renders], not from role 15 (FrameBkg): u16 mode (1 plain,
 * 2 shaded), colour 1, colour 2 (0xFF R G B each), u16 angle, u16 12
 * (palette.ts `paletteBackground`). Evidence: 7.PL3 (FrameBkg black, 1554
 * colour 1 (65,65,65)): ROCKTOP, SHADE1-3 and CYLINDER show a grey
 * background (16/64 black + 48/64 grey 85); 1HDW (FrameBkg (22,22,22),
 * colour 1 (255,0,255)): LOGOBKG1 and WORLD show slot 12, the palette's
 * dark blue; 2.PL3 (37,36,68): PLAY_ALL shows black + 8/64 blue; 1SHD
 * (shaded, (0,0,64) to (0,0,5)): LOGOBKG2, PLANET, REDLEFT and SHADE4 show
 * 16/64 blue at the top falling to 2/64 at the bottom; 12HDW (shaded,
 * (128,0,255) to black): FLOOR goes from solid slot 11 at the top to black.
 * HG3.PL3 and most palettes have black there (as FrameBkg "Gry DD" shows on
 * screen), so most charts do not change. A palette without 1554 (.PC3)
 * falls back to FrameBkg.
 */
export const BACKGROUND_FROM_PALETTE_1554 = true;

/**
 * Shading direction of a mode 2 (shaded) 1554 background: colour 1 at the
 * top and colour 2 at the bottom in all four shaded palettes the samples
 * use (1SHD, 7SHD, 9SHD, 12HDW), all with angle 90. Read as: the angle
 * points from colour 2 towards colour 1, degrees counter-clockwise from +x
 * [I: only 90 is seen in a shaded palette], so the gradient (colour 1 →
 * colour 2) runs at angle + 180.
 */
export const BACKGROUND_SHADE_ANGLE_OFFSET = 180;

/**
 * Gradient fill 0x1110 [I, from the reference renders]: bytes 0-3 colour 1,
 * bytes 4-7 colour 2 (0xFF R G B, as every sample has; another byte 0 is
 * read as a colour role), u16 at 8 the direction in tenths of a degree
 * (0 to 1800 in the samples), counter-clockwise from "up": colour 1 → colour
 * 2 runs towards page angle 90 + value / 10. Evidence: SHADE1 (0: colour 1
 * at the bottom of each half), SHADE2 (its four quadrants: 0 up, 900 to the
 * left, 1800 down), CYLINDER (900, two boxes), REDLEFT (240: the strip is
 * yellow at the top left, dark red at the bottom right). The gradient spans
 * the shape's bounding box.
 */
export const GRADIENT_SUBTAG = 0x1110;
export const GRADIENT_ANGLE_UNIT = 0.1;
export const GRADIENT_ANGLE_ZERO = 90;
/** Draw 0x1110 as a gradient (true) or, as before, flat in colour 1 (GRADIENT_AS_FIRST_COLOR). */
export const DRAW_GRADIENTS = true;

/*
 * Not reproduced, and not a setting: an ellipse with a gradient (PLANET's sphere, 240, (0,0,2)
 * to (81,81,114)) is not linear in the reference: the light colour hugs
 * the rim on the colour 2 side as a crescent and most of the disc stays
 * near colour 1 (8x8 tiles stay at 10/64 blue from 40 px inside the rim),
 * as if HG drew shrinking ellipses towards that side. Polygons (SHADE2's
 * quadrants) are linear. Drawn linear here.
 */

/**
 * Point markers of 0x10A0/0x10A1 data curves [I, from the reference
 * renders]: trailer u16 at 2 = marker shape, u16 at 0 = marker size in
 * object units (500 to 630 in the samples; markers scale with the object,
 * so GALC44's pictures at 0.31 show 4 px markers). Drawn at every point of
 * the curve, also when the curve itself is not drawn because the polyline
 * before it is the line (CURVE_A_AFTER_POLYLINE_DRAWN); one-point curves are
 * the legend's samples. Shapes, measured on GALD443 (all four, size 630 =
 * 11.3 px on its 0.917 slide) and GALD413:
 * - 0: none (GALD411 "Single Line", GALD421, ...);
 * - 1: a small square, 4 px across: size / 4;
 * - 2: an upright cross, 11 px: 5/6 of the size;
 * - 3: an asterisk (upright cross plus diagonals to the corners of the
 *   size square), 13 px;
 * - 4: a square of side size, 13 × 12 px.
 * Squares are outlined in the 0x1100 line colour and filled with the
 * current 0x110B fill (role 15 on the plot = the plot's own fill, so the
 * line does not show inside, as in the references; the legend's samples
 * fill with the legend background). 1 px outlines. 0x10A1 goes with
 * shapes 1 and 4, 0x10A0 with 0, 2 and 3: the sub-tag's low digit is the
 * usual "filled" flag, it seems.
 */
export const CURVE_MARKER_SIZE_OFFSET = 0;
export const CURVE_MARKER_SHAPE_OFFSET = 2;
export const CURVE_MARKERS: ReadonlyMap<number, { form: "square" | "cross" | "asterisk"; size: number }> = new Map([
  [1, { form: "square", size: 1 / 4 }],
  [2, { form: "cross", size: 5 / 6 }],
  [3, { form: "asterisk", size: 1 }],
  [4, { form: "square", size: 1 }],
] as const);

/**
 * Box style 2 (0x1070 u16 style; corner size c): a double outline, the
 * outer one on the rectangle and an inner one c inside it [I, from the
 * reference renders]. Only FRAME2 and FRAME2-P use it (c 172 and 177, the
 * page frames of the 0x1070 template drawings; FRAME1 and FRAME1-P are the
 * same boxes with style 1). FRAME2's reference shows two 1 px lines 3 px
 * apart on every side (rows 29 and 32, 445 and 448; columns 49 and 52, 584
 * and 587): 172 units is 3.3 px at its 52.75 units per pixel.
 */
export const DOUBLE_BOX_STYLE = 2;

/**
 * A button chart is drawn on the slide's screen, not in the slide's page
 * units [I, from the reference renders]: its page is mapped onto the same
 * 640 × 480 screen (scene/page.ts screenMapping), scaled about the centre
 * by the ratio of the two pages' screen pixels. Only GALD181 (Letter
 * 11 × 8.5 in, screen pixel 52.75 units) names a 10 × 7.5 in button chart
 * (GALBUTN2, 51.2): its bar was drawn 9 px right and 5 px low, at 0.971
 * of the size, where the reference shows it exactly as on the 4:3 slides
 * (F1-Help at x 3). Its free part for the shrunk slide is measured after
 * the mapping.
 */
export const BUTTON_CHART_ON_SCREEN = true;

/**
 * Monochrome bitmaps (1 bit, 1 plane: 65 of the 69 sample PCX files) are
 * drawn in the object's colours [I, from the reference renders]: black
 * pixels in the 0x110C colour, white pixels in the 0x110B colour (0xFF R G
 * B, or a colour role; role 0 leaves them transparent). Evidence:
 * LOGOBKG1 (0x110C (0,255,255), 0x110B (0,0,128)): the logo's letters are
 * solid cyan and the rest of its box is the half blue / half black dither
 * of (0,0,128), not white; PATTVIEW (0x110C (85,85,85), 0x110B
 * (170,170,170)): the pattern swatches are light grey on dark grey, not
 * white on black. 16-colour bitmaps (FLOOR, ROCKTOP) keep their own colours.
 */
export const BITMAP_MONO_COLORS = true;
export const BITMAP_INK_SUBTAG = 0x110c;
export const BITMAP_PAPER_SUBTAG = 0x110b;

/**
 * Bitmaps are drawn at their own pixel size (one bitmap pixel per screen
 * pixel, in every display mode), repeated in both directions to fill the
 * object's 612 box and clipped to it; the tiling is anchored so that the
 * 0x1140 hot spot (u16 x, u16 y at BITMAP_HOTSPOT_OFFSET, in bitmap pixels
 * from the top left) lies on the box centre: the bitmap starts at screen
 * pixel floor(centre − hot spot) [I, from the reference renders].
 * Evidence (VGA): FLOOR (640 × 153, hot spot 320, 78; box rows 266–479,
 * centre 373.0): bitmap row 0 on screen row 295 and again on 448 (the
 * mostly black rows 0–30 below it, rows 123–152 above it), column 0 on
 * screen column −1; 99.8 % of its box pixels match. ROCKTOP (640 × 32,
 * 320, 16; box rows 0–35): row 0 on screen row 2 (rows 30–31 above).
 * LOGOBKG1 (121 × 33, 60, 16; box 117.5 × 31.2 px): clipped on every
 * side, origin (511, 434). PATTVIEW's 64 8 × 8 swatches (hot spot 0, 0):
 * floor(centre) is the best phase rule (88 % of swatches exact on VGA,
 * 97 % on Hercules; the rest are 1 px off, as are some origins on EGA and
 * Hercules, where our page-to-pixel mapping is itself 1–2 px off).
 * The hot spot is about half the bitmap size (LOGOBKG1 60, 16 of 121 × 33;
 * ROCKTOP 320, 16 of 640 × 32) but FLOOR's 78 is not 153 / 2: it is read,
 * not derived. Bytes 0–2 of the 8-byte 0x1140 are 0 in every sample; byte
 * 3 is the fit mode (BITMAP_FIT_OFFSET): 0 in the disk samples (this
 * rule), 2 in samples/claude-vs-codex (BITMAP_FIT_TO_BOX).
 * With BITMAP_NATIVE_TILED false, bitmaps are stretched to the box.
 */
export const BITMAP_NATIVE_TILED = true;
export const BITMAP_HOTSPOT_OFFSET = 4;

/**
 * 0x1140 byte 3 (BITMAP_FIT_OFFSET) = 2 (BITMAP_FIT_TO_BOX): the bitmap is
 * drawn ONCE, stretched to the object's 612 box (both axes independently),
 * not tiled at its own pixel size [I, from the screenshots of
 * samples/claude-vs-codex, real HG 3.05, VGA ScreenShow]. Each screen pixel
 * whose centre is inside the box shows the bitmap pixel under that centre
 * (nearest neighbour: column floor((sx + 0.5 − left) / boxWidth × width),
 * all in screen pixels; rows the same), in the colour that pixel's colour
 * shows as in a fill there (screenImage.ts). The hot spot (here 265, 145 =
 * half of 530 × 290) is not used. Evidence: CVCP01–10, each a 530 × 290
 * 16-colour PCX in a ±14894 × ±11170 box (identity transform) on a Letter
 * page (screen pixel 52.75 units, so the box is 564.7 × 423.5 px from
 * (37.65, 28.25)); the picture's non-black extent on all 10 screenshots
 * scales by 1.064 × 1.46 = 564.7 / 530 × 423.5 / 290 and lands where the
 * box mapping puts it (CVCP01's PCX columns 123–405 on screen 169–469,
 * rows 52–236 on 104–373). HG made that box at import ("fits the bitmap to
 * the page width and keeps EGA pixel aspect": 22340 / 290 ÷ 29788 / 530 =
 * 1.371 = 480 / 350); whether a resized box keeps that aspect (fit) or
 * not (stretch) is not shown by any sample: stretch is assumed. Other
 * byte-3 values are unknown (warned, drawn tiled).
 */
export const BITMAP_FIT_OFFSET = 3;
export const BITMAP_FIT_TO_BOX = 2;

/**
 * Box style 5 (SHADOW_BOX_STYLE) is drawn as a box extruded c right and c
 * down, not as a flat shadow in role 19 [I, from the reference renders]:
 * a bottom face (the box's bottom edge moved by (c, −c)) and a right face,
 * filled with the box's own colour at BOX_SHADOW_BOTTOM_SHADE and
 * BOX_SHADOW_SIDE_SHADE. Evidence: the horizontal 3-D bars of GALD812,
 * GALD822, GALD842, GALD852, GALD872 (12 style 5 boxes each): under the
 * white segment the face is 12/16 grey 85 (25 % of white), its right face
 * the grey 85 / grey 170 checker (50 %), and under the pale yellow
 * (255,255,128) segment 2/16 yellow on black ((64,64,32)). Harness score
 * GALD852 5.70 % → 0.90 %; the org charts with style 5 (GALD721, GALD751,
 * GALB7, ORGTUT) do not change measurably. SHADOW_BOX_ROLE is no longer
 * used for object boxes.
 */
export const BOX_SHADOW_BOTTOM_SHADE = 0.25;
export const BOX_SHADOW_SIDE_SHADE = 0.5;
