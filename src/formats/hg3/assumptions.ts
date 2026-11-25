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
