/**
 * Drawing one chart container as a scene, shared by chart files and the
 * chart slides of shows.
 */
import type { ParseContext, Scene } from "../types";
import { parseChart } from "./chart";
import type { Container } from "./container";
import { buildChartScene, notYetDrawn } from "./scene/buildChartScene";
import type { ChartSceneOptions } from "./scene/context";

/**
 * Parse and draw a chart container; its warnings are appended to `warnings`.
 * `options` (e.g. a palette option resolved once for a whole show) go to
 * buildChartScene.
 */
export function chartScene(
  container: Container,
  context: ParseContext | undefined,
  warnings: string[],
  options: ChartSceneOptions = {},
): Scene {
  const parsed = parseChart(container);
  warnings.push(...parsed.warnings);
  const { scene, warnings: sceneWarnings } = buildChartScene(parsed.chart, context, options);
  warnings.push(...sceneWarnings);
  const missing = notYetDrawn(parsed.chart, options.dataLayout ?? context?.layoutFromData);
  if (missing.length > 0) warnings.push(`Not drawn yet: ${missing.join(", ")}.`);
  return scene;
}
