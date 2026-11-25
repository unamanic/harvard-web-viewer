import { useId, type ReactNode } from "react";
import {
  DEFAULT_STROKE_WIDTH,
  GRADIENT_FILL_PREFIX,
  PATTERN_FILL_PREFIX,
  type FillGradient,
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
  gradientSpan,
  gradientStripPoints,
  normalizeBox,
  polylinePath,
  roundedRectPath,
  shapeBounds,
  smoothPath,
  spanPoint,
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
  const defs: ReactNode[] = [];
  const ctx: RenderContext = {
    onButtonClick,
    patternUrl: (fill) => resolveFill(fill, scene, idPrefix),
    gradient: (fill) => {
      if (!fill.startsWith(GRADIENT_FILL_PREFIX)) return undefined;
      const id = fill.slice(GRADIENT_FILL_PREFIX.length);
      return scene.gradients && Object.hasOwn(scene.gradients, id) ? scene.gradients[id] : undefined;
    },
    defs,
    newId: () => `${idPrefix}d${defs.length}`,
  };
  const background: RectElement = { kind: "rect", x: minX, y: minY, width, height, fill: scene.background, stroke: null };
  const body = [renderElement(background, -1, ctx), ...renderElements(scene.elements, ctx)];
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
      {(patterns.length > 0 || defs.length > 0) && (
        <defs>
          {patterns.map(([id, p]) => renderPattern(idPrefix + id, p))}
          {defs}
        </defs>
      )}
      {body}
    </svg>
  );
}

interface RenderContext {
  onButtonClick: ((name: string) => void) | undefined;
  /** SVG paint value for a fill or stroke (resolves "pattern:<id>"). */
  patternUrl: (paint: string) => string;
  /** The gradient a "gradient:<id>" paint names, or undefined. */
  gradient: (paint: string) => FillGradient | undefined;
  /** Definitions (gradients, clip paths) added while rendering; written to <defs>. */
  defs: ReactNode[];
  /** A fresh DOM id for a definition (call once per pushed definition, before pushing). */
  newId: () => string;
}

/** A "pattern:<id>" fill as url(#...) ("none" if the scene lacks it); colours unchanged. */
function resolveFill(fill: string, scene: Scene, idPrefix: string): string {
  if (!fill.startsWith(PATTERN_FILL_PREFIX)) return fill;
  const id = fill.slice(PATTERN_FILL_PREFIX.length);
  return scene.patterns && Object.hasOwn(scene.patterns, id) ? `url(#${idPrefix}${id})` : "none";
}

/**
 * A FillPattern as an SVG <pattern>: a paper rect plus one rect per run of
 * ink pixels (two colours), or per run of each other colour (`colors`).
 */
function renderPattern(domId: string, p: FillPattern): ReactNode {
  const cols = Math.max(1, ...p.rows.map((r) => r.length));
  // Colour of each tile character; the paper colour is painted underneath.
  const multi = p.colors && p.colors.length > 0 ? p.colors : null;
  const paper = multi ? multi[0] : p.paper;
  const colorOf = (ch: string): string | null => {
    if (!multi) return ch === "1" ? p.ink : null;
    const c = multi[parseInt(ch, 16)];
    return c === undefined || c === paper ? null : c;
  };
  const runs: ReactNode[] = [];
  p.rows.forEach((row, y) => {
    for (let x = 0; x < row.length; ) {
      const color = colorOf(row[x]);
      if (color === null) {
        x++;
        continue;
      }
      const start = x;
      while (x < row.length && row[x] === row[start]) x++;
      runs.push(
        <rect
          key={`${y}-${start}`}
          x={start * p.pixelWidth}
          y={y * p.pixelHeight}
          width={(x - start) * p.pixelWidth}
          height={p.pixelHeight}
          fill={color}
        />,
      );
    }
  });
  return (
    <pattern
      key={domId}
      id={domId}
      patternUnits="userSpaceOnUse"
      patternTransform={p.transform ? `matrix(${p.transform.join(" ")})` : undefined}
      width={cols * p.pixelWidth}
      height={p.rows.length * p.pixelHeight}
      shapeRendering="crispEdges"
    >
      <rect width={cols * p.pixelWidth} height={p.rows.length * p.pixelHeight} fill={paper} />
      {runs}
    </pattern>
  );
}

function renderElements(elements: SceneElement[], ctx: RenderContext): ReactNode[] {
  return elements.map((el, i) => renderElement(el, i, ctx));
}

function shapeProps(s: ShapeStyle, ctx: RenderContext) {
  return {
    fill: s.fill === null || s.fill.startsWith(GRADIENT_FILL_PREFIX) ? "none" : ctx.patternUrl(s.fill),
    stroke: s.stroke === null ? "none" : ctx.patternUrl(s.stroke),
    strokeWidth: s.stroke ? (s.strokeWidth ?? DEFAULT_STROKE_WIDTH) : undefined,
  };
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

/** Shape elements: everything a fill and outline can paint. */
type ShapeElement = Extract<SceneElement, { kind: "path" | "ellipse" | "arc" | "band" | "rect" }>;

type Paint = ReturnType<typeof shapeProps>;

/** The SVG node of a shape with the given paint. */
function shapeNode(el: ShapeElement, key: number | string, paint: Paint): ReactNode {
  switch (el.kind) {
    case "path": {
      const d = el.smooth ? smoothPath(el.points, el.closed) : polylinePath(el.points, el.closed);
      return <path key={key} d={d} strokeLinejoin="round" {...paint} />;
    }
    case "ellipse":
      return <ellipse key={key} cx={el.cx} cy={el.cy} rx={el.rx} ry={el.ry} {...paint} />;
    case "arc":
      return <path key={key} d={arcPath(el, el.startAngle, el.endAngle)} {...paint} />;
    case "band":
      return <path key={key} d={bandPath(el, el.startAngle, el.endAngle, el.depth)} strokeLinejoin="round" {...paint} />;
    case "rect": {
      const box = normalizeBox(el);
      const corners = el.corners ?? { kind: "square" };
      return corners.kind === "rounded" ? (
        <path key={key} d={roundedRectPath(box, corners.radius)} {...paint} />
      ) : (
        <rect key={key} {...box} {...paint} />
      );
    }
  }
}

/**
 * A shape filled with a gradient (Scene.gradients) spanning its bounding
 * box: smooth, as an SVG linearGradient; banded (FillGradient.bands, e.g.
 * dithered display modes), as one strip per band clipped to the shape, each
 * strip running to the end so that no seams show. The outline goes on top.
 */
function renderGradientShape(el: ShapeElement, key: number, gradient: FillGradient, ctx: RenderContext): ReactNode {
  const paint = shapeProps(el, ctx);
  const box = shapeBounds(el);
  if (!box) return shapeNode(el, key, paint);
  const span = gradientSpan(box, gradient.angle);
  const mid = (span.perpMin + span.perpMax) / 2;
  if (!gradient.bands || gradient.bands.length === 0) {
    const id = ctx.newId();
    const p1 = spanPoint(span, span.start, mid);
    const p2 = spanPoint(span, span.end, mid);
    ctx.defs.push(
      <linearGradient key={id} id={id} gradientUnits="userSpaceOnUse" x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y}>
        <stop offset={0} stopColor={gradient.from} />
        <stop offset={1} stopColor={gradient.to} />
      </linearGradient>,
    );
    return shapeNode(el, key, { ...paint, fill: `url(#${id})` });
  }
  const clipId = ctx.newId();
  ctx.defs.push(
    <clipPath key={clipId} id={clipId}>
      {shapeNode(el, "c", { fill: "black", stroke: "none", strokeWidth: undefined })}
    </clipPath>,
  );
  return (
    <g key={key}>
      <g clipPath={`url(#${clipId})`}>
        {gradient.bands.map((band, i) => (
          <path
            key={i}
            d={polylinePath(gradientStripPoints(span, band.offset, 1), true)}
            fill={ctx.patternUrl(band.paint)}
          />
        ))}
      </g>
      {el.stroke !== null && shapeNode(el, "o", { ...paint, fill: "none" })}
    </g>
  );
}

function renderElement(
  el: SceneElement,
  key: number,
  ctx: RenderContext,
): ReactNode {
  switch (el.kind) {
    case "path":
    case "ellipse":
    case "arc":
    case "band":
    case "rect": {
      const gradient = el.fill === null ? undefined : ctx.gradient(el.fill);
      if (gradient) return renderGradientShape(el, key, gradient, ctx);
      return shapeNode(el, key, shapeProps(el, ctx));
    }
    case "text":
      return (
        <text
          key={key}
          x={el.x}
          y={el.y}
          fontSize={el.size}
          fill={ctx.patternUrl(el.fill)}
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
