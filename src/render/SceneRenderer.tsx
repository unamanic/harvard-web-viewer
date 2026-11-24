import type { Scene } from "../formats/types";

/**
 * Draws a format-independent `Scene` as SVG. SVG scales cleanly and keeps
 * text selectable; swap this for canvas if a format needs pixel-exact output.
 */
export function SceneRenderer({ scene }: { scene: Scene }) {
  return (
    <svg
      viewBox={`0 0 ${scene.width} ${scene.height}`}
      className="scene"
      role="img"
      aria-label="Rendered slide"
    >
      <rect width={scene.width} height={scene.height} fill={scene.background} />
      {scene.elements.map((el, i) => {
        switch (el.kind) {
          case "rect":
            return <rect key={i} x={el.x} y={el.y} width={el.width} height={el.height} fill={el.fill} />;
          case "line":
            return <line key={i} x1={el.x1} y1={el.y1} x2={el.x2} y2={el.y2} stroke={el.color} />;
          case "text":
            return <text key={i} x={el.x} y={el.y} fontSize={el.size} fill={el.color}>{el.text}</text>;
        }
      })}
    </svg>
  );
}
