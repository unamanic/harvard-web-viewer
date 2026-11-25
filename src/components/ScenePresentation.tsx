import { type KeyboardEvent, useRef, useState } from "react";
import type { Scene } from "../formats/types";
import { SceneRenderer } from "../render/SceneRenderer";
import { useAutoHide, useFullscreenWhile } from "../ui/hooks";

export interface ScenePresentationProps {
  /** Pages to present (a chart has one). */
  scenes: readonly Scene[];
  /** Page to start at. */
  start?: number;
  title: string;
  /** Leave presentation mode. */
  onExit: () => void;
}

const NEXT_KEYS = new Set(["ArrowRight", "ArrowDown", "PageDown", " ", "Enter"]);
const PREVIOUS_KEYS = new Set(["ArrowLeft", "ArrowUp", "PageUp", "Backspace"]);

/**
 * A chart alone, full screen and letterboxed on black. Keys and clicks step
 * through the pages when there are several; Esc leaves; the controls hide
 * when the mouse rests.
 */
export function ScenePresentation({ scenes, title, start = 0, onExit }: ScenePresentationProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(start);
  useFullscreenWhile(ref, true, onExit);
  const controls = useAutoHide(true);
  const count = scenes.length;
  const at = Math.min(index, Math.max(count - 1, 0));
  const step = (by: number) => setIndex(Math.max(0, Math.min(count - 1, at + by)));

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.target instanceof HTMLButtonElement && (e.key === "Enter" || e.key === " ")) return;
    if (e.key === "Escape") {
      e.preventDefault();
      onExit();
    } else if (NEXT_KEYS.has(e.key)) {
      e.preventDefault();
      step(1);
    } else if (PREVIOUS_KEYS.has(e.key)) {
      e.preventDefault();
      step(-1);
    } else if (e.key === "Home") setIndex(0);
    else if (e.key === "End") setIndex(count - 1);
  };

  return (
    <div
      ref={ref}
      className={`presentation${controls.visible ? "" : " controls-hidden"}`}
      tabIndex={0}
      role="dialog"
      aria-modal="true"
      aria-label={`Presenting ${title}`}
      onKeyDown={onKeyDown}
      onMouseMove={controls.poke}
      onFocus={controls.poke}
    >
      <p className="present-label">{count > 1 ? `${title} · Page ${at + 1} of ${count}` : title}</p>
      <div className="presentation-stage" onClick={() => step(1)}>
        {scenes[at] && <SceneRenderer scene={scenes[at]} />}
      </div>
      <div className="presentation-controls">
        {count > 1 && (
          <>
            <button type="button" className="arrow-button" onClick={() => step(-1)} disabled={at === 0} aria-label="Previous page">
              <span aria-hidden="true">←</span>
            </button>
            <span className="player-counter" aria-live="polite">
              {at + 1} / {count}
            </span>
            <button
              type="button"
              className="arrow-button"
              onClick={() => step(1)}
              disabled={at >= count - 1}
              aria-label="Next page"
            >
              <span aria-hidden="true">→</span>
            </button>
            <span className="control-divider" aria-hidden="true" />
          </>
        )}
        <button type="button" onClick={onExit}>
          Exit (Esc)
        </button>
      </div>
    </div>
  );
}
