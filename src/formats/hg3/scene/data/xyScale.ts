/**
 * Value axes of XY charts: automatic and logarithmic scales, tick values and
 * tick labels.
 */
import { XY_Y_MARGIN } from "../../assumptions";
import { formatXyNumber, type XyNumberFormat } from "./xyFormat";

export interface AxisScale {
  min: number;
  max: number;
  step: number;
  percent: boolean;
  /** Logarithmic (1402 byte 1 = 2): min and max are powers of ten, ticks at each decade [I]. */
  log?: boolean;
}

/** A log axis over whole decades covering the data (GALD481: 3 to 44 gives 1 to 100) [I]. */
export function logScale(dataMin: number, dataMax: number): AxisScale {
  const lo = dataMin > 0 && Number.isFinite(dataMin) ? 10 ** Math.floor(Math.log10(dataMin)) : 1;
  let hi = dataMax > 0 && Number.isFinite(dataMax) ? 10 ** Math.ceil(Math.log10(dataMax)) : lo * 10;
  if (hi <= lo) hi = lo * 10;
  return { min: lo, max: hi, step: 10, percent: false, log: true };
}

/** Grid positions of a log axis: 1 to 9 times each decade. */
export function logGrid(s: AxisScale): number[] {
  const out: number[] = [];
  for (let d = s.min; d < s.max * 0.999; d *= 10) for (let k = 1; k < 10; k++) out.push(d * k);
  out.push(s.max);
  return out;
}

/** Tick step: range / 5 rounded to the nearest (geometrically) of 1, 2 or 5 × 10^k [I]. */
export function niceStep(range: number): number {
  if (!(range > 0) || !Number.isFinite(range)) return 1;
  const raw = range / 5;
  const k = Math.floor(Math.log10(raw));
  const base = 10 ** k;
  const f = raw / base;
  const m = f < Math.SQRT2 ? 1 : f < Math.sqrt(10) ? 2 : f < Math.sqrt(50) ? 5 : 10;
  return m * base;
}

/**
 * Axis range from the data [I]: from the set minimum (1402 offset 10), else
 * 0 (or the next step below a negative minimum), to the first step above
 * max + (XY_Y_MARGIN − 1) × range; a set maximum (1402 offset 18 [?]) is
 * used as it is.
 */
export function autoScale(dataMin: number, dataMax: number, setMin: number | null, setMax: number | null): AxisScale {
  const finiteMin = Number.isFinite(dataMin) ? dataMin : 0;
  let lo = setMin ?? Math.min(0, finiteMin);
  const hi = Number.isFinite(dataMax) ? Math.max(dataMax, lo) : lo + 1;
  if (setMax !== null && setMax > lo) return { min: lo, max: setMax, step: niceStep(setMax - lo), percent: false };
  const step = niceStep(hi - lo);
  if (setMin === null && lo < 0) lo = Math.floor((hi - (hi - lo) * XY_Y_MARGIN) / step + 1e-9) * step;
  let top = Math.ceil((lo + (hi - lo) * XY_Y_MARGIN) / step - 1e-9) * step;
  if (top <= lo) top = lo + step;
  return { min: lo, max: top, step, percent: false };
}

export function tickValues(s: AxisScale): number[] {
  const out: number[] = [];
  if (s.log) {
    for (let d = s.min; d <= s.max * 1.001; d *= 10) out.push(d);
    return out;
  }
  const n = Math.floor((s.max - s.min) / s.step + 1e-6);
  for (let i = 0; i <= n; i++) out.push(s.min + i * s.step);
  return out;
}

function decimalsOf(step: number): number {
  for (let d = 0; d < 6; d++) if (Math.abs(Math.round(step * 10 ** d) - step * 10 ** d) < 1e-6) return d;
  return 6;
}

/** A tick label: plain, "N%" on a 100 % axis, else in the axis' number format (xyFormat.ts). */
export function tickLabel(v: number, s: AxisScale, fmt: XyNumberFormat | null = null): string {
  const t = s.log ? Number(v.toPrecision(6)) : Number(v.toFixed(decimalsOf(s.step)));
  if (s.percent) return `${t}%`;
  return fmt ? formatXyNumber(t, fmt) : String(t);
}
