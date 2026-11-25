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
import { DEFAULT_STROKE_WIDTH } from "../types";

// ---------------------------------------------------------------------------
// Task 7: text size
// ---------------------------------------------------------------------------

/**
 * The page's shorter side in page units (SPEC §6.1 and types.ts LANDSCAPE_VIEW_BOX: landscape 32768 × 24576,
 * portrait the transpose; both have 24576 as the shorter side).
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
 * Whether drawings (type 0x29) get a page frame. SPEC §5.5 [I] describes the
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

/** Outline width in scene units for 0x1100 byte 1 (see LINE_WIDTH_FACTORS). */
export function lineWidthFor(lineStyle: number | undefined): number {
  return DEFAULT_STROKE_WIDTH * ((lineStyle === undefined ? undefined : LINE_WIDTH_FACTORS.get(lineStyle)) ?? 1);
}

/**
 * Corner radius of a box (0x1070 to 0x1078) whose style is not 1: the
 * stored corner size, in object units (SPEC §5.6 [I]). Style 1 is square
 * even when a corner size is stored (it often is). Styles 5 and 6 "extend
 * beyond the rectangle" and may be shadowed rather than rounded [?]; they
 * are drawn rounded too.
 */
export const SQUARE_BOX_STYLE = 1;
export const BOX_CORNER_RADIUS_FACTOR = 1;

/**
 * Gradient fill 0x1110 (two direct colours and an angle; SPEC §5.6 [I]).
 * The scene model has no gradient element, so a gradient is drawn as a solid
 * fill in its first colour. In the samples 0x1110 never shares a display
 * list state with 0x110B.
 */
export const GRADIENT_AS_FIRST_COLOR = true;

/**
 * Text blocks (0x10B0, SPEC §5.6 [I]): line pitch as a multiple of the text
 * size. The box at header offset 62 is the laid-out text extent; for
 * one-line blocks its height is 1.27 to 1.32 times textSizeToUnits(size)
 * in the samples (e.g. 2,800 units for size 9, 2,200 for size 7).
 */
export const OBJECT_TEXT_LINE_SPACING = 1.28;

/**
 * Text blocks: baseline of the first line below the top of the text extent,
 * as a multiple of the size (the rest of the 1.28 pitch is the descent) [I].
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
 * §6.5) is drawn on top of the slide, after the slide's object layer [I]:
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
