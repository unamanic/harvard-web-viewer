/**
 * Drawing one chart container as a scene, shared by chart files and the
 * chart slides of shows.
 */
import type { ParseContext, Scene } from "../types";
import { parseChart } from "./chart";
import type { Container } from "./container";
import { buildChartScene, notYetDrawn } from "./scene/buildChartScene";

/** Parse and draw a chart container; its warnings are appended to `warnings`. */
export function chartScene(container: Container, context: ParseContext | undefined, warnings: string[]): Scene {
  const parsed = parseChart(container);
  warnings.push(...parsed.warnings);
  const { scene, warnings: sceneWarnings } = buildChartScene(parsed.chart, context);
  warnings.push(...sceneWarnings);
  const missing = notYetDrawn(parsed.chart);
  if (missing.length > 0) warnings.push(`Not drawn yet: ${missing.join(", ")}.`);
  return scene;
}
