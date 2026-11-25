import {
  type KeyboardEvent,
  type ReactNode,
  type Ref,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Presentation, PresentationSlide, Scene } from "../formats/types";
import { DEFAULT_DISPLAY_MODE, type DisplayMode, applyDisplayMode } from "../render/displayMode";
import { SceneRenderer } from "../render/SceneRenderer";
import {
  type PlayerAction,
  type PlayerState,
  type SavedPosition,
  clickButton,
  currentSlide,
  describePosition,
  jumpTo,
  navigate,
  pressKey,
  restorePlayer,
  savePosition,
} from "./player";
import type { ResolveFile } from "./sound/controller";
import { useShowSound } from "./sound/useShowSound";
import { DEFAULT_TRANSITION_MODE, REPLACE_PLAN, type TransitionMode, transitionPlan } from "./transitions/mode";
import {
  INITIAL_RUN,
  type TransitionRun,
  endRun,
  finishStage,
  interruptRun,
  isAnimating,
  phaseTransition,
  runPhase,
  stageRunId,
  startRun,
} from "./transitions/run";
import { TransitionStage, phaseLayers } from "./transitions/TransitionStage";
import { effectiveTransition, prefersReducedMotion } from "./transitions/types";
import { useAutoHide, useFullscreenWhile } from "../ui/hooks";
import { transitionPlanLabel } from "../ui/transitionLabel";

/** Seconds a slide that does not wait for a key stays when its time is unknown. */
const DEFAULT_DISPLAY_SECONDS = 5;

/** What an erased screen shows while the next slide is drawn: black. */
const BLANK = <div className="transition-blank" style={{ width: "100%", height: "100%", background: "#000000" }} />;

export interface ShowPlayerProps {
  presentation: Presentation;
  /** Display the slides imitate (colours only). Defaults to VGA. */
  displayMode?: DisplayMode;
  /** How slide changes are drawn (SPEC §4.5). Defaults to "file": the show's own Draw and Erase effects. */
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
  /**
   * Where to start when the player mounts or gets a new presentation (e.g.
   * the same file parsed again with another palette): restored if the
   * presentation has the same structure, else playing starts over. Later
   * changes are ignored until the next presentation.
   */
  initialPosition?: SavedPosition | null;
  /** Called after the position changes (null for an empty show), e.g. to pass back as `initialPosition`. */
  onPositionChange?: (position: SavedPosition | null) => void;
  /** File name shown in the counter and in presentation mode (e.g. "SALES93.SH3"). */
  fileLabel?: string;
  /** Lets the parent move the player (its slide list jumps with it). */
  control?: Ref<ShowControl>;
}

/** What the parent may ask the player to do. */
export interface ShowControl {
  /** Jump to the slide at this index of the outermost presentation (player.jumpTo). */
  jumpTo(index: number): void;
}

interface State {
  player: PlayerState;
  /** Scene shown before the current one (raw, display mode not applied). */
  previous: Scene | null;
  /** The slide `previous` belongs to (its Erase effect is drawn first). */
  previousSlide: PresentationSlide | null;
  /** The transition into the current slide. */
  run: TransitionRun;
}

function initialState(presentation: Presentation, position?: SavedPosition | null): State {
  return { player: restorePlayer(presentation, position), previous: null, previousSlide: null, run: INITIAL_RUN };
}

function sceneOf(player: PlayerState): Scene | null {
  return currentSlide(player)?.scene() ?? null;
}

/**
 * Plays a presentation: one slide at a time, keyboard (arrows, Enter, Space,
 * Page Up/Down, Backspace, Escape, and the show's own keys), clicks on named
 * buttons, prev/next buttons, jumps asked by the parent (`control`), and presentation
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
  initialPosition,
  onPositionChange,
  fileLabel,
  control,
}: ShowPlayerProps) {
  const [state, setState] = useState<State>(() => initialState(presentation, initialPosition));
  const containerRef = useRef<HTMLDivElement>(null);

  // Restart when another presentation is passed in (at `initialPosition` if it still fits).
  const [shown, setShown] = useState(presentation);
  if (shown !== presentation) {
    setShown(presentation);
    setState(initialState(presentation, initialPosition));
  }

  const step = useCallback((update: (p: PlayerState) => PlayerState) => {
    setState((s) => {
      const player = update(s.player);
      if (player === s.player) return s;
      const shownScene = sceneOf(s.player);
      return shownScene
        ? { player, previous: shownScene, previousSlide: currentSlide(s.player), run: startRun(s.run) }
        : { ...s, player, run: startRun(s.run) };
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
  const previousSlide = state.previousSlide;
  const plan = useMemo(() => {
    const p = slide ? transitionPlan(previousSlide, slide, transitionMode, run.id) : REPLACE_PLAN;
    return {
      erase: p.erase && effectiveTransition(p.erase, reducedMotion),
      draw: effectiveTransition(p.draw, reducedMotion),
    };
  }, [slide, previousSlide, transitionMode, run.id, reducedMotion]);
  const hasPrevious = previous !== null;
  const phase = runPhase(run, plan, hasPrevious);
  const transition = phaseTransition(run, plan, hasPrevious);
  const onTransitionFinished = useCallback(
    (stageId: number) => setState((s) => ({ ...s, run: finishStage(s.run, stageId) })),
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

  // Slides that do not wait for a key move on by themselves, their display
  // time counted from the end of the transition that brings them in. The
  // viewer can pause that: timed slides then wait like key slides (keys,
  // clicks and buttons still navigate); resuming restarts the slide's time.
  const [autoAdvancePaused, setAutoAdvancePaused] = useState(false);
  const toggleAutoAdvance = useCallback(() => setAutoAdvancePaused((p) => !p), []);
  const drawing = !!scene && isAnimating(run, transition, hasPrevious);
  useEffect(() => {
    if (!slide || slide.waitForKey || drawing || autoAdvancePaused) return;
    const ms = (slide.displaySeconds ?? DEFAULT_DISPLAY_SECONDS) * 1000;
    const timer = setTimeout(() => go({ kind: "next" }), ms);
    return () => clearTimeout(timer);
  }, [slide, player, go, drawing, autoAdvancePaused]);
  // Offer the control only for shows that advance by themselves somewhere.
  const hasTimedSlides = useMemo(
    () => presentation.slides.some((s) => s.kind === "nested" || (s.kind === "picture" && !s.waitForKey)),
    [presentation],
  );


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
  useEffect(() => {
    onPositionChange?.(savePosition(player));
  }, [player, onPositionChange]);

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
    // The Pause key pauses or resumes auto-advance (shows can't bind it).
    if (e.key === "Pause" && hasTimedSlides) {
      e.preventDefault();
      toggleAutoAdvance();
      return;
    }
    // A key during a transition only completes it.
    const interrupted = interruptRun(run, transition, hasPrevious);
    if (interrupted.consumed) {
      e.preventDefault();
      setState((s) => (s.run.id === run.id ? { ...s, run: endRun(s.run) } : s));
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
    if (interruptRun(run, transition, hasPrevious).consumed) {
      setState((s) => (s.run.id === run.id ? { ...s, run: endRun(s.run) } : s));
      return;
    }
    go({ kind: "next" });
  };
  const onJump = useCallback((index: number) => step((p) => jumpTo(p, index)), [step]);
  useImperativeHandle(control, () => ({ jumpTo: onJump }), [onJump]);

  // Memoised so that animation frames only restyle the layers.
  const erased = plan.erase !== null;
  const slideNodes = useMemo(
    () => ({
      current: scene && <SceneRenderer scene={scene} onButtonClick={onButtonClick} />,
      currentTransparent: scene && (
        <SceneRenderer scene={{ ...scene, background: "none" }} onButtonClick={onButtonClick} />
      ),
      old: previous && <SceneRenderer scene={previous} />,
    }),
    [scene, previous, onButtonClick],
  );
  const layers = useMemo(() => phaseLayers(phase, erased, slideNodes, BLANK), [phase, erased, slideNodes]);

  const levels = describePosition(player).map((l, depth) => {
    const first = depth === 0 ? presentation.firstSlide : player.position[depth].presentation.firstSlide;
    return { number: l.index - first + 1, count: l.count - first };
  });
  const counter = levels
    .map((l, depth) => `${depth === 0 ? "Slide" : "nested slide"} ${l.number} of ${l.count}`)
    .join(" › ");
  const shortCounter = levels.map((l) => `${l.number} / ${l.count}`).join(" › ");
  // Sound slides may be in this show or in a nested one.
  const mayPlaySound = useMemo(
    () => presentation.slides.some((s) => s.kind === "sound" || s.kind === "nested"),
    [presentation],
  );

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
        runId={stageRunId(run, phase)}
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

  const status = player.empty ? "No slides" : player.ended ? "Ended" : presenting ? shortCounter : counter;
  const where = transitionPlanLabel(slide && hasPrevious ? plan : null);
  const soundButtons = (
    <>
      {sound.status.blocked && (
        <button type="button" className="player-enable-sound" onClick={sound.enable}>
          Click to enable sound
        </button>
      )}
      {(mayPlaySound || mutedProp === undefined) && (
        <button
          type="button"
          className="player-sound"
          onClick={toggleMute}
          aria-pressed={muted}
          title={sound.status.playing ? `Playing ${sound.status.playing}` : undefined}
        >
          {muted ? "Sound off" : "Sound on"}
        </button>
      )}
    </>
  );

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
      {presenting && (
        <p className="present-label">
          {fileLabel ?? presentation.title}
          {where ? ` · Transition: ${where}` : ""}
        </p>
      )}
      <div className="stage-panel">
        <div className="player-stage" onClick={onStageClick}>
          {stage}
          {sound.note && (
            <p className="player-note" role="status">
              {sound.note}
            </p>
          )}
        </div>
      </div>
      <div className="player-controls">
        <button
          type="button"
          className="arrow-button"
          onClick={() => go({ kind: "previous" })}
          disabled={player.empty}
          aria-label="Previous slide"
        >
          <span aria-hidden="true">←</span>
        </button>
        <span className="player-counter" aria-live="polite">
          {!presenting && fileLabel ? `${fileLabel} · ` : ""}
          {status}
          {!presenting && slide && slide.label ? ` · ${slide.label}` : ""}
          {autoAdvancePaused && hasTimedSlides && !player.ended ? " · paused" : ""}
        </span>
        <button
          type="button"
          className="arrow-button"
          onClick={() => go({ kind: "next" })}
          disabled={player.empty || player.ended}
          aria-label="Next slide"
        >
          <span aria-hidden="true">→</span>
        </button>
        {hasTimedSlides && (
          <button
            type="button"
            className="player-autoadvance"
            onClick={toggleAutoAdvance}
            aria-pressed={autoAdvancePaused}
            title="Pause or resume moving on by itself (Pause key)"
          >
            {autoAdvancePaused ? "Resume auto-advance" : "Pause auto-advance"}
          </button>
        )}
        {soundButtons}
        {/* Entering is the header's Present button; this one only leaves. */}
        {presenting && (
          <>
            <span className="control-divider" aria-hidden="true" />
            <button type="button" onClick={() => setPresenting(false)}>
              Exit (Esc)
            </button>
          </>
        )}
      </div>
    </div>
  );
}
