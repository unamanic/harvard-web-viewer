/**
 * Slice label text for pies laid out from their data (task 16): which items
 * a label shows and how values and percents are written, from 1310 byte 17
 * and records 1312 / 1314 (SPEC §5.4). Every rule is read off the drawn copy
 * of the Harvard Graphics 3.05 test chart named with it
 * (samples/option-tests/pie) [C unless marked].
 *
 * - The label block holds the slice name (when Show slice labels is Yes),
 *   then a line with the items placed Below: value, then percent, joined by
 *   two spaces ("Alpha" / "40  40%", PPCT). With labels off only that line
 *   remains (PNOLAB).
 * - Items placed Adjacent follow the name on its line after two spaces
 *   ("Alpha  40", PVALADJ; percents: GALD231's column, 1312 byte 2 = 2,
 *   "North  15%").
 * - Items placed Inside form a block of their own inside the slice (PVALIN,
 *   PPCTPI); see pie.ts for where it goes.
 * - Value: leading text, "$" when Currency is Yes, the value divided by the
 *   scale factor (PVSCALE: 40 / 10 → "4"), trailing text ("AB40", "40XY",
 *   "$40", "40.00" with 2 decimals).
 * - Percent: leading text, the share × 100 with the stored decimals
 *   ("40.0%"), trailing text, then "%" ("AB40%", "40XY%").
 */
import { LabelPlace, type PiePercentOptions, type PieValueOptions } from "../../data/pie";

/** Two spaces between items on one line (PPCT "40  40%", PVALADJ "Alpha  40"). [C] */
export const PIE_ITEM_SEPARATOR = "  ";

/** Currency symbol written before the number (PVCURR "$40"). [C] Its place relative to leading text is not tested [?]. */
export const PIE_CURRENCY_SYMBOL = "$";

/** Thousands separator (PVTHOU only has values under 1000, so the character is not shown by any copy) [?]. */
export const PIE_THOUSANDS_SEPARATOR = ",";

/**
 * Decimal places when 1314's are blank ("automatic"): whole numbers get
 * none (PBASE "40"); for others the copies show nothing, so at most
 * PIE_AUTO_DECIMALS are written, without trailing zeros [?].
 */
export const PIE_AUTO_DECIMALS = 2;

/** Value options when 1314 is missing: the 3.05 defaults (show, Below, no currency, automatic decimals, scale 1). */
export const DEFAULT_VALUES: Omit<PieValueOptions, "raw"> = {
  pie: 0,
  show: true,
  place: LabelPlace.Below,
  currency: false,
  decimals: null,
  thousands: false,
  scale: null,
  leading: "",
  trailing: "",
};

/** Percent options when 1312 is missing: the 3.05 defaults (hidden, Below, 0 decimals). */
export const DEFAULT_PERCENTS: Omit<PiePercentOptions, "raw"> = {
  pie: 0,
  show: false,
  place: LabelPlace.Below,
  decimals: 0,
  leading: "",
  trailing: "",
};

function withThousands(digits: string): string {
  const [int, frac] = digits.split(".");
  const grouped = int!.replace(/\B(?=(\d{3})+(?!\d))/g, PIE_THOUSANDS_SEPARATOR);
  return frac === undefined ? grouped : `${grouped}.${frac}`;
}

/** `x` with `decimals` places, or automatic (null): whole numbers bare, others up to PIE_AUTO_DECIMALS places. */
export function formatNumber(x: number, decimals: number | null, thousands = false): string {
  let s: string;
  if (decimals === null) {
    s = Number.isInteger(x) ? String(x) : String(Number(x.toFixed(PIE_AUTO_DECIMALS)));
  } else {
    s = x.toFixed(Math.max(0, Math.min(20, Math.round(decimals))));
  }
  const negative = s.startsWith("-");
  const body = negative ? s.slice(1) : s;
  const out = thousands ? withThousands(body) : body;
  return negative ? `-${out}` : out;
}

/** A slice value as 1314 writes it: leading, currency, value / scale, trailing. */
export function valueText(value: number, o: Pick<PieValueOptions, "currency" | "decimals" | "thousands" | "scale" | "leading" | "trailing">): string {
  const scale = o.scale && Number.isFinite(o.scale) && o.scale !== 0 ? o.scale : 1;
  return `${o.leading}${o.currency ? PIE_CURRENCY_SYMBOL : ""}${formatNumber(value / scale, o.decimals, o.thousands)}${o.trailing}`;
}

/** A slice share (0 to 1) as 1312 writes it: leading, share × 100 with the decimals, trailing, "%". */
export function percentOf(fraction: number, o: Pick<PiePercentOptions, "decimals" | "leading" | "trailing">): string {
  const pct = fraction * 100;
  const n = o.decimals > 0 ? pct.toFixed(Math.min(20, o.decimals)) : String(Math.round(pct));
  return `${o.leading}${n}${o.trailing}%`;
}

export interface LabelOptions {
  /** 1310 byte 17. */
  showLabels: boolean;
  values: Pick<PieValueOptions, "show" | "place" | "currency" | "decimals" | "thousands" | "scale" | "leading" | "trailing">;
  percents: Pick<PiePercentOptions, "show" | "place" | "decimals" | "leading" | "trailing">;
}

export interface SliceLabelTexts {
  /** Lines of the block outside the slice (may be empty). */
  outside: string[];
  /** The block inside the slice, or null. */
  inside: string | null;
}

/** What a slice's labels say (see the header comment). */
export function sliceLabelTexts(label: string, value: number, fraction: number, o: LabelOptions): SliceLabelTexts {
  const items: Record<number, string[]> = { [LabelPlace.Below]: [], [LabelPlace.Adjacent]: [], [LabelPlace.Inside]: [] };
  const put = (place: number, text: string) => (items[place] ?? items[LabelPlace.Below]!).push(text);
  if (o.values.show) put(o.values.place, valueText(value, o.values));
  if (o.percents.show) put(o.percents.place, percentOf(fraction, o.percents));
  const name = o.showLabels ? label.trim() : "";
  const first = [name, ...items[LabelPlace.Adjacent]!].filter((s) => s).join(PIE_ITEM_SEPARATOR);
  const below = items[LabelPlace.Below]!.join(PIE_ITEM_SEPARATOR);
  const inside = items[LabelPlace.Inside]!.join(PIE_ITEM_SEPARATOR);
  return { outside: [first, below].filter((s) => s), inside: inside || null };
}

/** Number of lines the outside label block has for these options (0 to 2), whatever the slice. */
export function outsideLineCount(o: LabelOptions): number {
  const shown = (place: number) => (o.values.show && o.values.place === place) || (o.percents.show && o.percents.place === place);
  const below = shown(LabelPlace.Below) || (o.values.show && !isPlace(o.values.place)) || (o.percents.show && !isPlace(o.percents.place));
  return (o.showLabels || shown(LabelPlace.Adjacent) ? 1 : 0) + (below ? 1 : 0);
}

function isPlace(p: number): boolean {
  return p === LabelPlace.Below || p === LabelPlace.Adjacent || p === LabelPlace.Inside;
}
