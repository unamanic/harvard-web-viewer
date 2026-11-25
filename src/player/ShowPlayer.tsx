import { type KeyboardEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SlideStrip } from "../components/SlideStrip";
import type { Presentation, PresentationSlide, Scene } from "../formats/types";
import { DEFAULT_DISPLAY_MODE, type DisplayMode, applyDisplayMode } from "../render/displayMode";
import { SceneRenderer } from "../render/SceneRenderer";
import {
  type PlayerAction,
  type PlayerState,
  clickButton,
  currentSlide,
  describePosition,
  jumpTo,
  navigate,
  pressKey,
  startPlayer,
} from "./player";
import type { ResolveFile } from "./sound/controller";
import { useShowSound } from "./sound/useShowSound";
import { DEFAULT_TRANSITION_MODE, type TransitionMode, transitionForSlide } from "./transitions/mode";
import { INITIAL_RUN, type TransitionRun, finishRun, interruptRun, startRun } from "./transitions/run";
import { TransitionStage } from "./transitions/TransitionStage";
import { REPLACE, effectiveTransition, prefersReducedMotion } from "./transitions/types";
import { useAutoHide, useFullscreenWhile } from "../ui/hooks";

/** Seconds a slide that does not wait for a key stays when its time is unknown. */
const DEFAULT_DISPLAY_SECONDS = 5;

export interface ShowPlayerProps {
  presentation: Presentation;
  /** Display the slides imitate (colours only). Defaults to VGA. */
  displayMode?: DisplayMode;
  /** How slide changes are drawn (SPEC §4.5). Defaults to "off": the new slide replaces the old. */
  transitionMode?: TransitionMode;
  /** Skip animated transitions. Defaults to the browser's prefers-reduced-motion. */
  reducedMotion?: boolean;
  /**
   * Bytes of a file the show names (sound slides: .WAV, .MID), or null if it
   * was not opened. Without it every sound counts as missing.
   */
  resolveFile?: ResolveFile;
  /** Sound muted, when the setting lives in the parent (with `onMutedChange`). Else the player keeps its own. */
  muted?: boolean;
  onMutedChange?: (muted: boolean) => void;
  /** Presentation mode (full screen, letterboxed on black), when controlled by the parent. */
  presenting?: boolean;
  onPresentingChange?: (presenting: boolean) => void;
  /** Called after the shown slide changes (null when ended or empty). */
  onSlideChange?: (slide: PresentationSlide | null) => void;
  /** Show the slide strip under the controls. Defaults to true. */
  showStrip?: boolean;
  /** Called when the slide strip builds a thumbnail (it may find missing files). */
  onThumbnailBuilt?: () => void;
}

interface State {
  player: PlayerState;
  /** Scene shown before the current one (raw, display mode not applied). */
  previous: Scene | null;
  /** The transition into the current slide. */
  run: TransitionRun;
}

function initialState(presentation: Presentation): State {
  return { player: startPlayer(presentation), previous: null, run: INITIAL_RUN };
}

function sceneOf(player: PlayerState): Scene | null {
  return currentSlide(player)?.scene() ?? null;
}

/**
 * Plays a presentation: one slide at a time, keyboard (arrows, Enter, Space,
 * Page Up/Down, Backspace, Escape, and the show's own keys), clicks on named
 * buttons, prev/next buttons, a slide strip to jump with, and presentation
 * mode (full screen, letterboxed on black, click for the next slide,
 * controls hide when the mouse rests, Esc leaves).
 */
export function ShowPlayer({
  presentation,
  displayMode = DEFAULT_DISPLAY_MODE,
  transitionMode = DEFAULT_TRANSITION_MODE,
  reducedMotion: reducedMotionProp,
  resolveFile,
  muted: mutedProp,
  onMutedChange,
  presenting: presentingProp,
  onPresentingChange,
  onSlideChange,
  showStrip = true,
  onThumbnailBuilt,
}: ShowPlayerProps) {
  const [state, setState] = useState<State>(() => initialState(presentation));
  const containerRef = useRef<HTMLDivElement>(null);

  // Restart when another presentation is passed in.
  const [shown, setShown] = useState(presentation);
  if (shown !== presentation) {
    setShown(presentation);
    setState(initialState(presentation));
  }

  const step = useCallback((update: (p: PlayerState) => PlayerState) => {
    setState((s) => {
      const player = update(s.player);
      return player === s.player ? s : { player, previous: sceneOf(s.player) ?? s.previous, run: startRun(s.run) };
    });
  }, []);
  const go = useCallback((action: PlayerAction) => step((p) => navigate(p, action)), [step]);

  const { player, run } = state;
  const slide = currentSlide(player);
  const scene = useMemo(() => {
    const raw = slide?.scene() ?? null;
    return raw && applyDisplayMode(raw, displayMode);
  }, [slide, displayMode]);
  const previous = useMemo(
    () => state.previous && applyDisplayMode(state.previous, displayMode),
    [state.previous, displayMode],
  );

  const [systemReducedMotion] = useState(prefersReducedMotion);
  const reducedMotion = reducedMotionProp ?? systemReducedMotion;
  const transition = useMemo(
    () => effectiveTransition(slide ? transitionForSlide(slide, transitionMode, run.id) : REPLACE, reducedMotion),
    [slide, transitionMode, run.id, reducedMotion],
  );
  const onTransitionFinished = useCallback(
    (id: number) => setState((s) => ({ ...s, run: finishRun(s.run, id) })),
    [],
  );

  // Sound slides passed by the last move start playing (§4.7); ending the
  // show (Escape, or "next" on the last slide) stops the sound, except when
  // the move that ended it passed sound slides: those still play.
  const sound = useShowSound(resolveFile, mutedProp);
  const { play: playSounds, stop: stopSound } = sound;
  useEffect(() => {
    if (player.sounds.length > 0) playSounds(player.sounds);
    else if (player.ended) stopSound();
  }, [player, playSounds, stopSound]);

  // Slides that do not wait for a key move on by themselves.
  useEffect(() => {
    if (!slide || slide.waitForKey) return;
    const ms = (slide.displaySeconds ?? DEFAULT_DISPLAY_SECONDS) * 1000;
    const timer = setTimeout(() => go({ kind: "next" }), ms);
    return () => clearTimeout(timer);
  }, [slide, player, go]);


  // Presentation mode: controlled by the parent when it passes `presenting`.
  const [ownPresenting, setOwnPresenting] = useState(false);
  const presenting = presentingProp ?? ownPresenting;
  const setPresenting = useCallback(
    (p: boolean) => {
      setOwnPresenting(p);
      onPresentingChange?.(p);
    },
    [onPresentingChange],
  );
  const leave = useCallback(() => setPresenting(false), [setPresenting]);
  useFullscreenWhile(containerRef, presenting, leave);
  const controlsShown = useAutoHide(presenting);

  useEffect(() => {
    containerRef.current?.focus({ preventScroll: true });
  }, []);

  // Tell the parent which slide shows (its diagnostics read the slide's
  // warnings and the file set's missing files after the slide is built).
  useEffect(() => {
    onSlideChange?.(slide);
  }, [slide, scene, onSlideChange]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    // Let focused controls handle their own activation keys.
    if (e.target instanceof HTMLButtonElement && (e.key === "Enter" || e.key === " ")) return;
    // Escape leaves presentation mode (before the show's own keys).
    if (presenting && e.key === "Escape") {
      e.preventDefault();
      leave();
      return;
    }
    // A key during a transition only completes it.
    const interrupted = interruptRun(run, transition, previous !== null);
    if (interrupted.consumed) {
      e.preventDefault();
      setState((s) => ({ ...s, run: finishRun(s.run, run.id) }));
      return;
    }
    const next = pressKey(player, e.key);
    if (next !== player) {
      e.preventDefault();
      step(() => next);
    }
  };

  // A click on a named button navigates by the button; while presenting, a
  // click anywhere else on the slide goes to the next slide.
  const buttonClicked = useRef(false);
  const onButtonClick = useCallback(
    (name: string) => {
      buttonClicked.current = true;
      step((p) => clickButton(p, name));
    },
    [step],
  );
  const onStageClick = () => {
    const wasButton = buttonClicked.current;
    buttonClicked.current = false;
    if (!presenting || wasButton || player.ended) return;
    if (interruptRun(run, transition, previous !== null).consumed) {
      setState((s) => ({ ...s, run: finishRun(s.run, run.id) }));
      return;
    }
    go({ kind: "next" });
  };
  const onJump = useCallback((index: number) => step((p) => jumpTo(p, index)), [step]);

  // Memoised so that animation frames only restyle the layers.
  const layers = useMemo(
    () => ({
      current: scene && <SceneRenderer scene={scene} onButtonClick={onButtonClick} />,
      currentTransparent: scene && (
        <SceneRenderer scene={{ ...scene, background: "none" }} onButtonClick={onButtonClick} />
      ),
      previous: previous && <SceneRenderer scene={previous} />,
    }),
    [scene, previous, onButtonClick],
  );

  const levels = describePosition(player);
  const counter = levels
    .map((l, depth) => {
      const first = depth === 0 ? presentation.firstSlide : player.position[depth].presentation.firstSlide;
      return `${depth === 0 ? "Slide" : "nested slide"} ${l.index - first + 1} of ${l.count - first}`;
    })
    .join(" › ");

  let stage: ReactNode;
  if (player.empty) stage = <p className="player-message">This show has no slides to show.</p>;
  else if (player.ended) {
    stage = (
      <div className="player-message">
        <p>End of show.</p>
        <button type="button" onClick={() => go({ kind: "top" })}>
          Start again
        </button>
      </div>
    );
  } else if (slide && scene) {
    stage = (
      <TransitionStage
        transition={transition}
        runId={run.id}
        finished={run.finished}
        layers={layers}
        onFinished={onTransitionFinished}
      />
    );
  } else stage = <p className="player-message">{slide?.label}</p>;

  const muted = mutedProp ?? sound.status.muted;
  const toggleMute = onMutedChange ? () => onMutedChange(!muted) : sound.toggleMute;
  const classes = ["player"];
  if (presenting) classes.push("presenting");
  if (!controlsShown.visible) classes.push("controls-hidden");

  return (
    <div
      ref={containerRef}
      className={classes.join(" ")}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onMouseMove={controlsShown.poke}
      onFocus={controlsShown.poke}
      aria-label={`Slide show: ${presentation.title || presentation.id}`}
      aria-roledescription="slide show"
    >
      <div className="player-stage" onClick={onStageClick}>
        {stage}
        {sound.note && (
          <p className="player-note" role="status">
            {sound.note}
          </p>
        )}
      </div>
      <div className="player-controls">
        <button type="button" onClick={() => go({ kind: "previous" })} disabled={player.empty} aria-label="Previous slide">
          ◀ Previous
        </button>
        <span className="player-counter" aria-live="polite">
          {player.empty ? "No slides" : player.ended ? "Ended" : counter}
          {slide && slide.label ? ` · ${slide.label}` : ""}
        </span>
        <button type="button" onClick={() => go({ kind: "next" })} disabled={player.empty || player.ended} aria-label="Next slide">
          Next ▶
        </button>
        {sound.status.blocked && (
          <button type="button" className="player-enable-sound" onClick={sound.enable}>
            Click to enable sound
          </button>
        )}
        <button
          type="button"
          onClick={toggleMute}
          aria-pressed={muted}
          title={sound.status.playing ? `Playing ${sound.status.playing}` : undefined}
        >
          {muted ? "Sound off" : "Sound on"}
        </button>
        <button type="button" onClick={() => setPresenting(!presenting)} aria-pressed={presenting}>
          {presenting ? "Leave presentation (Esc)" : "Present"}
        </button>
      </div>
      {showStrip && !presenting && !player.empty && (
        <SlideStrip
          presentation={presentation}
          current={player.position[0].index}
          displayMode={displayMode}
          onJump={onJump}
          onBuilt={onThumbnailBuilt}
        />
      )}
    </div>
  );
}
