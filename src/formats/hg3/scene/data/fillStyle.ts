/**
 * Fill styles of pie slices (1304 byte 4, pattern 1316 byte 4) and XY
 * series (1406 bytes 7 and 8) for charts drawn from their data (SPEC §5.5,
 * "Fill styles"; test charts in samples/option-tests/styles and pie).
 *
 * - Color (1): the slice or series colour, the usual outline.
 * - Pattern (2): the pattern colour is FF, which draws white; the outline
 *   is white too and the slice or series colour is ignored (PPATC) [C].
 * - Both (3): the pattern colour is the slice or series colour and the
 *   outline is the usual one (PBCOL, XFSBC) [C].
 *
 * Pattern number 0 (the first; XY menus show it as 1) is a solid fill in the
 * pattern colour [C]. Any other number is the pattern drawn in the pattern
 * colour over role 0, which leaves the background showing (0x110B = 0) [C];
 * the pattern itself (1 thin diagonal lines, 2 dots, 3 dense diagonal lines,
 * 5 vertical lines, the rest unseen) is not drawn yet, so such a shape is
 * left unfilled with its outline [?].
 */

/** 1304 byte 4 / 1406 byte 7 values. */
export const FillStyle = { Color: 1, Pattern: 2, Both: 3 } as const;

/** What fill style Pattern draws its patterns and outlines in (pattern colour FF) [C, PPATC]. */
export const PATTERN_STYLE_COLOR = "#ffffff";

/** Pattern number that is a solid fill [C, PFILLP, XFSP]. */
export const SOLID_PATTERN = 0;

export interface FillLook {
  fill: string | null;
  outline: string | null;
}

/**
 * Fill and outline of a slice or series shape.
 *
 * @param style   fill style byte (anything but 2 and 3 counts as Color)
 * @param pattern pattern number
 * @param colour  the slice or series colour (CSS, or null for none)
 * @param outline the usual outline colour
 */
export function fillLook(style: number, pattern: number, colour: string | null, outline: string | null): FillLook {
  if (style !== FillStyle.Pattern && style !== FillStyle.Both) return { fill: colour, outline };
  const patternColour = style === FillStyle.Pattern ? PATTERN_STYLE_COLOR : colour;
  const edge = style === FillStyle.Pattern ? PATTERN_STYLE_COLOR : outline;
  return { fill: pattern === SOLID_PATTERN ? patternColour : null, outline: edge };
}
