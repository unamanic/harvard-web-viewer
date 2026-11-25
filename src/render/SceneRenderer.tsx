import { useId, type ReactNode } from "react";
import {
  DEFAULT_STROKE_WIDTH,
  PATTERN_FILL_PREFIX,
  type FillPattern,
  type GlyphsElement,
  type RectElement,
  type Scene,
  type SceneElement,
  type ShapeStyle,
} from "../formats/types";
import {
  arcPath,
  bandPath,
  normalizeBox,
  polylinePath,
  roundedRectPath,
  smoothPath,
} from "./geometry";

export interface SceneRendererProps {
  scene: Scene;
  /** Called with a group's `buttonName` when that group is clicked. */
  onButtonClick?: (name: string) => void;
}

/**
 * Draws a format-independent `Scene` as SVG. The SVG fills its container and
 * letterboxes the scene's viewBox (xMidYMid meet), keeping the page shape.
 * Its CSS aspect-ratio is the viewBox's, so where only the width is set (the
 * viewer) the SVG takes the page's own shape (4:3, Letter 11:8.5, portrait).
 */
export function SceneRenderer({ scene, onButtonClick }: SceneRendererProps) {
  const { minX, minY, width, height } = scene.viewBox;
  // Pattern ids must be unique in the page (several scenes may be shown).
  const idPrefix = "p" + useId().replace(/[^A-Za-z0-9_-]/g, "") + "-";
  const patterns = Object.entries(scene.patterns ?? {});
  const ctx: RenderContext = { onButtonClick, patternUrl: (fill) => resolveFill(fill, scene, idPrefix) };
  return (
    <svg
      viewBox={`${minX} ${minY} ${width} ${height}`}
      preserveAspectRatio="xMidYMid meet"
      width="100%"
      height="100%"
      className="scene"
      style={{ aspectRatio: `${width} / ${height}` }}
      role="img"
      aria-label="Rendered slide"
    >
      {patterns.length > 0 && (
        <defs>{patterns.map(([id, p]) => renderPattern(idPrefix + id, p))}</defs>
      )}
      <rect x={minX} y={minY} width={width} height={height} fill={scene.background} />
      {renderElements(scene.elements, ctx)}
    </svg>
  );
}

interface RenderContext {
  onButtonClick: ((name: string) => void) | undefined;
  /** SVG fill value for a ShapeStyle fill (resolves "pattern:<id>"). */
  patternUrl: (fill: string) => string;
}

/** A "pattern:<id>" fill as url(#...) ("none" if the scene lacks it); colours unchanged. */
function resolveFill(fill: string, scene: Scene, idPrefix: string): string {
  if (!fill.startsWith(PATTERN_FILL_PREFIX)) return fill;
  const id = fill.slice(PATTERN_FILL_PREFIX.length);
  return scene.patterns && Object.hasOwn(scene.patterns, id) ? `url(#${idPrefix}${id})` : "none";
}

/** A FillPattern as an SVG <pattern>: paper rect plus one rect per run of ink pixels. */
function renderPattern(domId: string, p: FillPattern): ReactNode {
  const cols = Math.max(1, ...p.rows.map((r) => r.length));
  const runs: ReactNode[] = [];
  p.rows.forEach((row, y) => {
    for (let x = 0; x < row.length; ) {
      if (row[x] !== "1") {
        x++;
        continue;
      }
      const start = x;
      while (x < row.length && row[x] === "1") x++;
      runs.push(
        <rect
          key={`${y}-${start}`}
          x={start * p.pixelWidth}
          y={y * p.pixelHeight}
          width={(x - start) * p.pixelWidth}
          height={p.pixelHeight}
          fill={p.ink}
        />,
      );
    }
  });
  return (
    <pattern
      key={domId}
      id={domId}
      patternUnits="userSpaceOnUse"
      width={cols * p.pixelWidth}
      height={p.rows.length * p.pixelHeight}
      shapeRendering="crispEdges"
    >
      <rect width={cols * p.pixelWidth} height={p.rows.length * p.pixelHeight} fill={p.paper} />
      {runs}
    </pattern>
  );
}

function renderElements(elements: SceneElement[], ctx: RenderContext): ReactNode[] {
  return elements.map((el, i) => renderElement(el, i, ctx));
}

function shapeProps(s: ShapeStyle, ctx: RenderContext) {
  return {
    fill: s.fill === null ? "none" : ctx.patternUrl(s.fill),
    stroke: s.stroke ?? "none",
    strokeWidth: s.stroke ? (s.strokeWidth ?? DEFAULT_STROKE_WIDTH) : undefined,
  };
}

function renderRect(el: RectElement, key: number, ctx: RenderContext): ReactNode {
  const box = normalizeBox(el);
  const corners = el.corners ?? { kind: "square" };
  switch (corners.kind) {
    case "square":
      return <rect key={key} {...box} {...shapeProps(el, ctx)} />;
    case "rounded":
      return <path key={key} d={roundedRectPath(box, corners.radius)} {...shapeProps(el, ctx)} />;
  }
}

/**
 * A line drawn as glyph paths, with its text laid invisibly on top (stretched
 * to the line's width) so it can still be selected, searched and read aloud.
 */
function renderGlyphs(el: GlyphsElement, key: number, ctx: RenderContext): ReactNode {
  return (
    <g key={key} transform={el.transform ? `matrix(${el.transform.join(" ")})` : undefined}>
      {el.halo && (
        <path
          d={el.d}
          fill={el.fill === null ? "none" : el.halo.color}
          stroke={el.halo.color}
          strokeWidth={(el.stroke ? (el.strokeWidth ?? DEFAULT_STROKE_WIDTH) : 0) + 2 * el.halo.width}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        />
      )}
      <path
        d={el.d}
        strokeLinecap={el.stroke ? "round" : undefined}
        strokeLinejoin={el.stroke ? "round" : undefined}
        aria-hidden="true"
        {...shapeProps(el, ctx)}
      />
      <text
        x={0}
        y={0}
        fontSize={el.em}
        fill="transparent"
        textLength={el.advance > 0 ? el.advance : undefined}
        lengthAdjust={el.advance > 0 ? "spacingAndGlyphs" : undefined}
        style={{ whiteSpace: "pre" }}
      >
        {el.text}
      </text>
    </g>
  );
}

function renderElement(
  el: SceneElement,
  key: number,
  ctx: RenderContext,
): ReactNode {
  switch (el.kind) {
    case "path": {
      const d = el.smooth ? smoothPath(el.points, el.closed) : polylinePath(el.points, el.closed);
      return <path key={key} d={d} strokeLinejoin="round" {...shapeProps(el, ctx)} />;
    }
    case "ellipse":
      return <ellipse key={key} cx={el.cx} cy={el.cy} rx={el.rx} ry={el.ry} {...shapeProps(el, ctx)} />;
    case "arc":
      return (
        <path key={key} d={arcPath(el, el.startAngle, el.endAngle)} {...shapeProps(el, ctx)} />
      );
    case "band":
      return (
        <path
          key={key}
          d={bandPath(el, el.startAngle, el.endAngle, el.depth)}
          strokeLinejoin="round"
          {...shapeProps(el, ctx)}
        />
      );
    case "rect":
      return renderRect(el, key, ctx);
    case "text":
      return (
        <text
          key={key}
          x={el.x}
          y={el.y}
          fontSize={el.size}
          fill={el.fill}
          fontFamily={el.fontFamily}
          fontWeight={el.fontWeight}
          fontStyle={el.italic ? "italic" : "normal"}
          textAnchor={el.anchor}
          stroke={el.halo?.color}
          strokeWidth={el.halo ? 2 * el.halo.width : undefined}
          strokeLinejoin={el.halo ? "round" : undefined}
          paintOrder={el.halo ? "stroke" : undefined}
          style={{ whiteSpace: "pre" }}
        >
          {el.text}
        </text>
      );
    case "glyphs":
      return renderGlyphs(el, key, ctx);
    case "image":
      return (
        <image
          key={key}
          href={el.href}
          {...normalizeBox(el)}
          preserveAspectRatio="none"
        />
      );
    case "group": {
      const name = el.buttonName;
      const { onButtonClick } = ctx;
      const onClick = name !== undefined && onButtonClick ? () => onButtonClick(name) : undefined;
      return (
        <g
          key={key}
          transform={el.transform ? `matrix(${el.transform.join(" ")})` : undefined}
          data-button={name}
          onClick={onClick}
          style={onClick ? { cursor: "pointer" } : undefined}
        >
          {renderElements(el.children, ctx)}
        </g>
      );
    }
  }
}
