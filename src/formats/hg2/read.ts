/** Reads a 1.0 (PCOK) or 2.x (Falc) chart file into the shared model. */
import { hasSignature } from "./bytes";
import { readFalc } from "./falc";
import type { ClassicChart } from "./model";
import { readPcok } from "./pcok";

export class NotClassicChartError extends Error {}

export const PCOK = "PCOK";
export const FALC = "Falc";

export function isClassicChart(bytes: Uint8Array): boolean {
  return hasSignature(bytes, PCOK) || hasSignature(bytes, FALC);
}

export function readClassicChart(bytes: Uint8Array, warnings: string[]): ClassicChart {
  if (hasSignature(bytes, PCOK)) return readPcok(bytes, warnings);
  if (hasSignature(bytes, FALC)) return readFalc(bytes, warnings);
  throw new NotClassicChartError("not a Harvard Graphics 1.x or 2.x chart (it does not start with PCOK or Falc).");
}
