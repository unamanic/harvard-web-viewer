import type { ReactNode } from "react";
import {
  DEFAULT_STROKE_WIDTH,
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
 */
export function SceneRenderer({ scene, onButtonClick }: SceneRendererProps) {
  const { minX, minY, width, height } = scene.viewBox;
  return (
    <svg
      viewBox={`${minX} ${minY} ${width} ${height}`}
      preserveAspectRatio="xMidYMid meet"
      width="100%"
      height="100%"
      className="scene"
      role="img"
      aria-label="Rendered slide"
    >
      <rect x={minX} y={minY} width={width} height={height} fill={scene.background} />
      {renderElements(scene.elements, onButtonClick)}
    </svg>
  );
}

function renderElements(
  elements: SceneElement[],
  onButtonClick: ((name: string) => void) | undefined,
): ReactNode[] {
  return elements.map((el, i) => renderElement(el, i, onButtonClick));
}

function shapeProps(s: ShapeStyle) {
  return {
    fill: s.fill ?? "none",
    stroke: s.stroke ?? "none",
    strokeWidth: s.stroke ? (s.strokeWidth ?? DEFAULT_STROKE_WIDTH) : undefined,
  };
}

function renderRect(el: RectElement, key: number): ReactNode {
  const box = normalizeBox(el);
  const corners = el.corners ?? { kind: "square" };
  switch (corners.kind) {
    case "square":
      return <rect key={key} {...box} {...shapeProps(el)} />;
    case "rounded":
      return <path key={key} d={roundedRectPath(box, corners.radius)} {...shapeProps(el)} />;
  }
}

/**
 * A line drawn as glyph paths, with its text laid invisibly on top (stretched
 * to the line's width) so it can still be selected, searched and read aloud.
 */
function renderGlyphs(el: GlyphsElement, key: number): ReactNode {
  return (
    <g key={key} transform={el.transform ? `matrix(${el.transform.join(" ")})` : undefined}>
      <path
        d={el.d}
        strokeLinecap={el.stroke ? "round" : undefined}
        strokeLinejoin={el.stroke ? "round" : undefined}
        aria-hidden="true"
        {...shapeProps(el)}
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
  onButtonClick: ((name: string) => void) | undefined,
): ReactNode {
  switch (el.kind) {
    case "path": {
      const d = el.smooth ? smoothPath(el.points, el.closed) : polylinePath(el.points, el.closed);
      return <path key={key} d={d} strokeLinejoin="round" {...shapeProps(el)} />;
    }
    case "ellipse":
      return <ellipse key={key} cx={el.cx} cy={el.cy} rx={el.rx} ry={el.ry} {...shapeProps(el)} />;
    case "arc":
      return (
        <path key={key} d={arcPath(el, el.startAngle, el.endAngle)} {...shapeProps(el)} />
      );
    case "band":
      return (
        <path
          key={key}
          d={bandPath(el, el.startAngle, el.endAngle, el.depth)}
          strokeLinejoin="round"
          {...shapeProps(el)}
        />
      );
    case "rect":
      return renderRect(el, key);
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
          style={{ whiteSpace: "pre" }}
        >
          {el.text}
        </text>
      );
    case "glyphs":
      return renderGlyphs(el, key);
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
      const onClick = name !== undefined && onButtonClick ? () => onButtonClick(name) : undefined;
      return (
        <g
          key={key}
          transform={el.transform ? `matrix(${el.transform.join(" ")})` : undefined}
          data-button={name}
          onClick={onClick}
          style={onClick ? { cursor: "pointer" } : undefined}
        >
          {renderElements(el.children, onButtonClick)}
        </g>
      );
    }
  }
}
