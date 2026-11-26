/**
 * The video's timeline (pure, no DOM): the show walked as if nobody pressed
 * a key (`startPlayer`, then "next" until it ends; nested shows play inline,
 * empty slides are passed over, sound slides start their sound at that
 * point), turned into segments of fixed length:
 *
 * - "hold": a picture shown for its display time (slides that wait for a
 *   key get `waitSeconds`);
 * - "erase" / "draw": the two phases of a slide change, as the player draws
 *   them (transitions/run.ts, TransitionStage.phaseLayers): the old picture
 *   erased to black with its Erase effect, then the new one drawn with its
 *   Draw effect over the old picture or the black.
 *
 * Every segment draws `frameAt(transition, progress, hasPrevious)` (holds at
 * progress 1, which keeps Overlay/Keep's old picture under the new one), so
 * a frame is fully described by the segment and the time in it.
 */
import type { Presentation, PresentationSlide } from "../model/presentation";
import { currentSlide, navigate, startPlayer } from "../player/player";
import { type TransitionMode, transitionPlan } from "../player/transitions/mode";
import { type Layer, frameAt } from "../player/transitions/frames";
import { REPLACE, isInstant, type Transition } from "../player/transitions/types";

/** What a layer shows: a picture slide (index into `Timeline.pictures`) or the black screen. */
export type Source = { picture: number } | "blank";

export type SegmentKind = "hold" | "erase" | "draw";

export interface Segment {
  kind: SegmentKind;
  startMs: number;
  durationMs: number;
  transition: Transition;
  /** The layer called "previous" by frameAt; null at the very start (nothing to draw over). */
  previous: Source | null;
  current: Source;
  /** The picture this segment belongs to (being drawn or held; for "erase", the one coming next). */
  picture: number;
}

/** A sound slide passed at `atMs` (its sound starts there, as in the player). */
export interface AudioCue {
  atMs: number;
  slide: PresentationSlide;
  /** Several sound slides passed by one move share an `atMs` and a `move`; the player starts only the last playable one. */
  move: number;
}

export interface Timeline {
  /** Picture slides in the order shown (a slide shown twice is listed twice). */
  pictures: PresentationSlide[];
  segments: Segment[];
  cues: AudioCue[];
  durationMs: number;
  /** Sound slides passed after the last picture (the video ends there; not included). */
  trailingSounds: PresentationSlide[];
}

export interface TimelineOptions {
  /** Seconds a slide that waits for a key is shown. */
  waitSeconds: number;
  /** How slide changes are drawn ("off" = Replace). */
  transitionMode: TransitionMode;
}

/** Seconds a slide that does not wait for a key stays when its time is unknown (as the player). */
export const DEFAULT_DISPLAY_SECONDS = 5;
/**
 * A slide stored with 0 seconds ("continue at once") and drawn at once
 * would never be seen; it is shown this long (about three frames), as the
 * original program took a moment to draw it. After an animated Draw it is
 * not held at all: it was seen while it came in.
 */
export const MIN_HOLD_MS = 100;
/** Stops a broken show from producing an endless video. */
export const MAX_PICTURES = 5000;

/** How long `slide` is held after its Draw effect. */
export function holdMs(slide: PresentationSlide, waitSeconds: number, drawAnimated: boolean): number {
  const seconds = slide.waitForKey ? waitSeconds : (slide.displaySeconds ?? DEFAULT_DISPLAY_SECONDS);
  const ms = Math.max(0, Math.round(seconds * 1000));
  if (ms > 0) return ms;
  return drawAnimated ? 0 : MIN_HOLD_MS;
}

export function buildTimeline(presentation: Presentation, options: TimelineOptions): Timeline {
  const pictures: PresentationSlide[] = [];
  const segments: Segment[] = [];
  const cues: AudioCue[] = [];
  let trailingSounds: PresentationSlide[] = [];
  let t = 0;
  let move = 0;
  const push = (s: Omit<Segment, "startMs">) => {
    if (s.durationMs <= 0) return;
    segments.push({ ...s, startMs: t });
    t += s.durationMs;
  };

  let state = startPlayer(presentation);
  if (state.empty) return { pictures, segments, cues, durationMs: 0, trailingSounds: [...state.sounds] };
  let previous: { slide: PresentationSlide; picture: number } | null = null;
  for (let step = 0; ; step++) {
    for (const slide of state.sounds) cues.push({ atMs: t, slide, move });
    move++;
    const slide = state.ended ? null : currentSlide(state);
    if (!slide) {
      trailingSounds = [...state.sounds];
      // The sounds of the move that ended the show would start after the last frame.
      if (trailingSounds.length) cues.splice(cues.length - trailingSounds.length);
      break;
    }
    if (pictures.length >= MAX_PICTURES) break;
    const picture = pictures.length;
    pictures.push(slide);
    const current: Source = { picture };
    let draw: Transition = REPLACE;
    let drawAnimated = false;
    if (!previous) {
      // The first slide is drawn alone (frameAt without a previous layer).
      push({ kind: "hold", durationMs: holdMs(slide, options.waitSeconds, false), transition: REPLACE, previous: null, current, picture });
    } else {
      const plan = transitionPlan(previous.slide, slide, options.transitionMode, step);
      const old: Source = { picture: previous.picture };
      if (plan.erase && !isInstant(plan.erase)) {
        push({ kind: "erase", durationMs: plan.erase.durationMs, transition: plan.erase, previous: old, current: "blank", picture });
      }
      const under: Source = plan.erase !== null ? "blank" : old;
      draw = plan.draw;
      drawAnimated = !isInstant(draw);
      if (drawAnimated) push({ kind: "draw", durationMs: draw.durationMs, transition: draw, previous: under, current, picture });
      push({ kind: "hold", durationMs: holdMs(slide, options.waitSeconds, drawAnimated), transition: draw, previous: under, current, picture });
    }
    previous = { slide, picture };
    state = navigate(state, { kind: "next" });
  }
  return { pictures, segments, cues, durationMs: t, trailingSounds };
}

// ---------------------------------------------------------------------------
// Frames
// ---------------------------------------------------------------------------

/** Frames in `ms` at `fps` (at least one frame for anything to show). */
export function frameCount(ms: number, fps: number): number {
  if (ms <= 0) return 0;
  return Math.max(1, Math.round((ms * fps) / 1000));
}

/** Time (ms) at which frame `i` starts. */
export function frameTimeMs(i: number, fps: number): number {
  return (i * 1000) / fps;
}

/** The segment shown at `ms` (the last one past the end), by binary search; null if there are none. */
export function segmentAt(segments: readonly Segment[], ms: number): Segment | null {
  if (segments.length === 0) return null;
  let lo = 0;
  let hi = segments.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (segments[mid].startMs <= ms) lo = mid;
    else hi = mid - 1;
  }
  return segments[lo];
}

/** A layer of a frame with its source resolved. */
export interface FrameLayer extends Layer {
  source: Source;
}

/** The layers (bottom to top) shown at `ms` of `segment`. */
export function segmentLayers(segment: Segment, ms: number): FrameLayer[] {
  const progress = segment.kind === "hold" ? 1 : (ms - segment.startMs) / segment.durationMs;
  return frameAt(segment.transition, progress, segment.previous !== null).map((l) => ({
    ...l,
    source: l.which === "previous" ? segment.previous! : segment.current,
  }));
}

/** The layers of frame `i`; [] when the timeline is empty. */
export function frameLayers(timeline: Timeline, i: number, fps: number): FrameLayer[] {
  const ms = frameTimeMs(i, fps);
  const segment = segmentAt(timeline.segments, ms);
  return segment ? segmentLayers(segment, ms) : [];
}

/**
 * A key for what frame `i` shows: equal keys draw the same picture (a hold,
 * or the instants of a transition that do not move), so the frame need not
 * be drawn again.
 */
export function frameKey(layers: readonly FrameLayer[]): string {
  return layers
    .map((l) => {
      const src = l.source === "blank" ? "b" : `p${l.source.picture}`;
      const clip = l.clip === null ? "*" : l.clip.map((b) => `${b.x},${b.y},${b.w},${b.h}`).join(";");
      return `${src}${l.transparent ? "t" : ""}@${l.dx},${l.dy}[${clip}]`;
    })
    .join("|");
}
