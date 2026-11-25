import { type ReactNode, useEffect, useState } from "react";
import { type Frame, frameAt, layerCss } from "./frames";
import { isInstant, type Transition } from "./types";

export interface TransitionLayers {
  /** The new slide. */
  current: ReactNode;
  /** The new slide without its background (Overlay, Keep). */
  currentTransparent: ReactNode;
  /** The old slide, or null at the start of a show. */
  previous: ReactNode | null;
}

export interface TransitionStageProps {
  transition: Transition;
  /** Changes on every slide change: restarts the animation. */
  runId: number;
  /** Draw the end state (the run ended or was interrupted). */
  finished: boolean;
  /**
   * Layer contents. Pass the same nodes on every render of a run (memoise
   * them): React then skips the scenes and only the layer styles change
   * from frame to frame.
   */
  layers: TransitionLayers;
  /** The animation of run `runId` reached its end. */
  onFinished?: (runId: number) => void;
  /** Draw this progress (0..1) instead of animating; for tests and static frames. */
  progress?: number;
}

/** Renders the layers of a frame as stacked, absolutely positioned boxes. */
export function renderFrame(frame: Frame, layers: TransitionLayers): ReactNode {
  return frame.map((l) => {
    const content = l.which === "previous" ? layers.previous : l.transparent ? layers.currentTransparent : layers.current;
    return (
      <div key={l.which} className={`transition-layer transition-${l.which}`} style={layerCss(l)}>
        {content}
      </div>
    );
  });
}

/**
 * Draws the change from the previous slide to the current one (SPEC §4.5)
 * as two stacked layers whose CSS clip-path and transform follow `frameAt`,
 * updated once per animation frame.
 */
export function TransitionStage({ transition, runId, finished, layers, onFinished, progress }: TransitionStageProps) {
  const hasPrevious = layers.previous !== null;
  const [animated, setAnimated] = useState({ runId, p: 0 });
  const animating = progress === undefined && !finished && hasPrevious && !isInstant(transition);

  useEffect(() => {
    if (!animating) return;
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / transition.durationMs);
      setAnimated({ runId, p });
      if (p >= 1) onFinished?.(runId);
      else frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [animating, runId, transition.durationMs, onFinished]);

  const shown = progress ?? (finished ? 1 : animated.runId === runId ? animated.p : 0);
  return <div className="transition-stage">{renderFrame(frameAt(transition, shown, hasPrevious), layers)}</div>;
}
