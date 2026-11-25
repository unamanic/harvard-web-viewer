/**
 * Number format of XY axis labels (1402 offsets 2, 63 to 101; SPEC §5.4),
 * matched against the drawn copies of the 3.05 test charts in
 * samples/option-tests/xy:
 *
 * - Scale factor (f64 at 2): labels show value / factor; the axis itself
 *   is unchanged (XSCALE: 0, 2.5, 5 .. 17.5 on a 0..35 axis) [C].
 * - Percent (63): value × 100 followed by "%" (XPCT: 5 → "500%") [C].
 * - Currency (64): "$" before the number (XCUR: "$35") [C].
 * - Scientific (65): mantissa, "E", sign and two exponent digits, three
 *   decimals when the decimals field is blank (XSCI: "3.500E+01") [C].
 * - Decimals (f64 at 66): fixed decimals (XDEC2: "35.00") [C]; blank =
 *   as many as the value needs ("2.5" next to "5" in XSCALE) [C].
 * - Thousands separator (74): "," every three digits of the whole part
 *   (XPCT: "1,000%") [C].
 * - Leading / trailing text (75, 88): written before / after everything
 *   else (XLEAD: "AB35", XTRAIL: "35CD") [C].
 *
 * The order of currency, sign and leading text for negative values, and
 * the decimals of a scientific label with the decimals field set, are not
 * shown by any copy [?]; this follows the natural reading (sign first).
 */
import type { XyAxis } from "../../data/xy";

export type XyNumberFormat = Pick<XyAxis, "scaleFactor" | "percent" | "currency" | "scientific" | "decimals" | "thousands" | "leading" | "trailing">;

/** Decimals of the scientific mantissa when the decimals field is blank (XSCI) [C]. */
export const XY_SCIENTIFIC_DECIMALS = 3;

function group(whole: string): string {
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** The shortest decimal string of v (at most 6 decimals). */
function shortest(v: number): string {
  return String(Number(v.toFixed(6)));
}

/**
 * The label of value v under a number format (null = plain, the same as a
 * blank 1402 record).
 */
export function formatXyNumber(v: number, f: XyNumberFormat | null): string {
  if (!f) return shortest(v);
  let x = v;
  if (f.scaleFactor !== null && f.scaleFactor !== 0 && Number.isFinite(f.scaleFactor)) x /= f.scaleFactor;
  if (f.percent) x *= 100;
  const dec = f.decimals !== null && Number.isFinite(f.decimals) ? Math.max(0, Math.min(10, Math.round(f.decimals))) : null;
  let body: string;
  let negative = x < 0;
  if (f.scientific) {
    const s = Math.abs(x).toExponential(dec ?? XY_SCIENTIFIC_DECIMALS);
    const [m, e] = s.split("e");
    const exp = Number(e);
    body = `${m}E${exp < 0 ? "-" : "+"}${String(Math.abs(exp)).padStart(2, "0")}`;
  } else {
    const s = dec !== null ? Math.abs(x).toFixed(dec) : shortest(Math.abs(x));
    if (Number(s) === 0) negative = false;
    const [whole, frac] = s.split(".");
    body = (f.thousands ? group(whole!) : whole!) + (frac !== undefined ? `.${frac}` : "");
  }
  return `${f.leading}${negative ? "-" : ""}${f.currency ? "$" : ""}${body}${f.percent ? "%" : ""}${f.trailing}`;
}
