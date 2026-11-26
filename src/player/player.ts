/**
 * Slide show player as a pure state machine (SPEC §4.6, §4.7). No React, no
 * timers: the component feeds it key names, button names and "advance"
 * requests, and draws whatever slide the state points at.
 *
 * - Playing starts at the presentation's `firstSlide` (slide 1 in HG3).
 * - Empty and sound slides are passed over. Sound slides passed while moving
 *   forward are reported in `PlayerState.sounds` so the component can start
 *   them (§4.7: "start playing and continue at once"); moving back plays
 *   nothing.
 * - A nested slide plays its presentation from its first slide, then goes on
 *   with the next slide of the parent. Destinations inside a nested show
 *   refer to its own slides; "top" goes back to the outermost show.
 * - A nested presentation whose id is already playing (a show including
 *   itself), or nesting deeper than MAX_DEPTH, is skipped.
 */
import type { Destination, Presentation, PresentationSlide } from "../model/presentation";

/** Deepest stack of nested presentations the player enters. */
export const MAX_DEPTH = 8;
/** Positions remembered for "lastView". */
export const MAX_HISTORY = 100;

/** One level of the stack: a presentation and the slide index shown in it. */
export interface Frame {
  readonly presentation: Presentation;
  readonly index: number;
}

/** Where the player is: outermost presentation first. Never empty. */
export type Position = readonly Frame[];

export interface PlayerState {
  readonly position: Position;
  /** Positions shown before, oldest first (for "lastView"). */
  readonly history: readonly Position[];
  /** The show has run past its last slide (or Escape was pressed). `position` keeps the last slide shown. */
  readonly ended: boolean;
  /** Nothing to show at all (no picture slide reachable from the start). */
  readonly empty: boolean;
  /**
   * Side effect of the move that produced this state: the sound slides it
   * passed over moving forward, in order (several in a row are all listed).
   * Empty after any other change; the UI plays these once per state.
   */
  readonly sounds: readonly PresentationSlide[];
}

const NO_SOUNDS: readonly PresentationSlide[] = Object.freeze([]);

/** Destinations plus ending the show (Escape). */
export type PlayerAction = Destination | { kind: "end" };

/** Default keys when no table binds the key (§4.7 step 3) [I]. */
export const DEFAULT_KEYS: ReadonlyMap<string, PlayerAction> = new Map<string, PlayerAction>([
  ["Enter", { kind: "next" }],
  [" ", { kind: "next" }],
  ["ArrowRight", { kind: "next" }],
  ["PageDown", { kind: "next" }],
  ["Backspace", { kind: "previous" }],
  ["ArrowLeft", { kind: "previous" }],
  ["PageUp", { kind: "previous" }],
  ["Escape", { kind: "end" }],
]);

type Direction = 1 | -1;

function top(position: Position): Frame {
  return position[position.length - 1];
}

function withIndex(position: Position, index: number): Frame[] {
  const out = position.slice();
  out[out.length - 1] = { presentation: top(position).presentation, index };
  return out;
}

/** The nested presentation of `slide` if the player may enter it from `stack`. */
function enterable(slide: PresentationSlide, stack: readonly Frame[]): Presentation | null {
  if (stack.length >= MAX_DEPTH) return null;
  const child = slide.nested?.() ?? null;
  if (!child) return null;
  if (stack.some((f) => f.presentation.id === child.id)) return null;
  return child;
}

/**
 * Starting at `start` (whose top index may be out of range), walk in
 * `direction` to the first picture slide, entering nested presentations and
 * leaving finished ones. Null if the walk runs off the outermost presentation.
 * Sound slides passed are appended to `sounds` when given.
 */
function seek(start: Position, direction: Direction, sounds?: PresentationSlide[]): Frame[] | null {
  const stack = start.slice();
  // Each step moves the top index or changes the depth, both bounded; this
  // limit only protects against a presentation that changes under us.
  for (let guard = 0; guard < 1_000_000; guard++) {
    const frame = top(stack);
    const { slides } = frame.presentation;
    const first = Math.max(frame.presentation.firstSlide, 0);
    if (frame.index >= slides.length || frame.index < first) {
      if (stack.length === 1) return null;
      stack.pop();
      stack.splice(stack.length - 1, 1, { ...top(stack), index: top(stack).index + direction });
      continue;
    }
    const slide = slides[frame.index];
    if (slide.kind === "picture") return stack;
    if (slide.kind === "sound") sounds?.push(slide);
    if (slide.kind === "nested") {
      const child = enterable(slide, stack);
      if (child) {
        const childFirst = Math.max(child.firstSlide, 0);
        stack.push({ presentation: child, index: direction === 1 ? childFirst : child.slides.length - 1 });
        continue;
      }
    }
    stack.splice(stack.length - 1, 1, { ...frame, index: frame.index + direction });
  }
  return null;
}

function startPosition(presentation: Presentation): Position {
  return [{ presentation, index: presentation.firstSlide }];
}

/** Start playing at the first picture slide (§4.7 step 2). */
export function startPlayer(presentation: Presentation): PlayerState {
  const sounds: PresentationSlide[] = [];
  const position = seek(startPosition(presentation), 1, sounds);
  if (!position) return { position: startPosition(presentation), history: [], ended: true, empty: true, sounds: NO_SOUNDS };
  return { position, history: [], ended: false, empty: false, sounds: soundList(sounds) };
}

function soundList(sounds: PresentationSlide[]): readonly PresentationSlide[] {
  return sounds.length > 0 ? sounds : NO_SOUNDS;
}

function moveTo(state: PlayerState, position: Position, sounds: readonly PresentationSlide[] = NO_SOUNDS): PlayerState {
  const history = [...state.history, state.position].slice(-MAX_HISTORY);
  return { position, history, ended: false, empty: false, sounds };
}

/** The show ends, keeping the last slide shown; `sounds` passed on the way out. */
function end(state: PlayerState, sounds: readonly PresentationSlide[] = NO_SOUNDS): PlayerState {
  return { ...state, ended: true, sounds };
}

/** Apply an action. Returns `state` itself when nothing changes. */
export function navigate(state: PlayerState, action: PlayerAction): PlayerState {
  if (state.empty) return state;
  if (state.ended) {
    // After the end, going back shows the last slide again and "top" restarts.
    if (action.kind === "previous" || action.kind === "lastView") return { ...state, ended: false, sounds: NO_SOUNDS };
    if (action.kind !== "top") return state;
  }
  const { position } = state;
  switch (action.kind) {
    case "none":
    case "edit":
      return state;
    case "end":
      return end(state);
    case "next": {
      const sounds: PresentationSlide[] = [];
      const next = seek(withIndex(position, top(position).index + 1), 1, sounds);
      return next ? moveTo(state, next, soundList(sounds)) : end(state, soundList(sounds));
    }
    case "previous": {
      const prev = seek(withIndex(position, top(position).index - 1), -1);
      return prev ? moveTo(state, prev) : state;
    }
    case "slide": {
      const { slides, firstSlide } = top(position).presentation;
      if (action.index < Math.max(firstSlide, 0) || action.index >= slides.length) return state;
      // An empty or sound target goes on to the next slide that shows something.
      const sounds: PresentationSlide[] = [];
      const target = seek(withIndex(position, action.index), 1, sounds);
      if (!target) return end(state, soundList(sounds));
      return moveTo(state, target, soundList(sounds));
    }
    case "lastView": {
      const last = state.history[state.history.length - 1];
      return last ? moveTo(state, last) : state;
    }
    case "top": {
      const sounds: PresentationSlide[] = [];
      const first = seek(startPosition(position[0].presentation), 1, sounds);
      return first ? moveTo(state, first, soundList(sounds)) : state;
    }
  }
}

/** The slide currently shown, or null when the show has ended or is empty. */
export function currentSlide(state: PlayerState): PresentationSlide | null {
  if (state.ended) return null;
  const frame = top(state.position);
  return frame.presentation.slides[frame.index] ?? null;
}

/**
 * What a key does on the current slide: the slide's key table, then the
 * current presentation's show-wide keys, then the defaults (§4.7 step 3).
 * A binding to "none" matches and does nothing: the gallery's help slides
 * bind F3/F4/F5 to destination 0 to switch off the show-wide F3/F4/F5.
 * Keys are compared exactly, then ignoring case (DOS stores "a" and "A" as
 * different keys).
 */
export function resolveKey(state: PlayerState, key: string): PlayerAction | null {
  const frame = top(state.position);
  const slide = frame.presentation.slides[frame.index];
  const tables = [slide?.keys ?? [], frame.presentation.globalKeys];
  for (const sameCase of [true, false]) {
    for (const table of tables) {
      const hit = table.find(
        (b) => (sameCase ? b.key === key : b.key.toLowerCase() === key.toLowerCase()),
      );
      if (hit) return hit.destination;
    }
  }
  return DEFAULT_KEYS.get(key) ?? null;
}

/** Handle a key (named as `KeyboardEvent.key`). Returns `state` when the key does nothing. */
export function pressKey(state: PlayerState, key: string): PlayerState {
  if (state.ended) {
    const action = DEFAULT_KEYS.get(key);
    return action ? navigate(state, action) : state;
  }
  const action = resolveKey(state, key);
  return action ? navigate(state, action) : state;
}

/** Compare button names as the original does: ignoring case and trailing spaces (§4.4). */
export function normaliseButtonName(name: string): string {
  return name.replace(/[\s\0]+$/, "").toLowerCase();
}

/** What clicking the button named `name` does on the current slide, or null. */
export function resolveButton(state: PlayerState, name: string): Destination | null {
  const slide = currentSlide(state);
  if (!slide) return null;
  const wanted = normaliseButtonName(name);
  return slide.buttons.find((b) => normaliseButtonName(b.name) === wanted)?.destination ?? null;
}

/** Handle a click on a scene group carrying `buttonName`. */
export function clickButton(state: PlayerState, name: string): PlayerState {
  const destination = resolveButton(state, name);
  return destination ? navigate(state, destination) : state;
}

/** Counter information for the UI: slide index and count at each level, outermost first. */
export function describePosition(state: PlayerState): { index: number; count: number; label: string }[] {
  return state.position.map((f) => ({
    index: f.index,
    count: f.presentation.slides.length,
    label: f.presentation.slides[f.index]?.label ?? "",
  }));
}

/**
 * Jump to slide `index` of the outermost presentation (slide strips), as a
 * "slide" destination there: leaves any nested show, and works after the
 * end. Returns `state` when the index is out of range.
 */
export function jumpTo(state: PlayerState, index: number): PlayerState {
  if (state.empty) return state;
  const outer = state.position[0];
  const base: PlayerState =
    state.position.length > 1 || state.ended ? { ...state, position: [outer], ended: false } : state;
  const next = navigate(base, { kind: "slide", index });
  if (next === base) return state;
  // History records where the viewer really was, not the trimmed position.
  return { ...next, history: [...state.history, state.position].slice(-MAX_HISTORY) };
}

/**
 * Where the player is, without the presentation objects, so that it can be
 * restored on another parse of the same file (e.g. after the palette
 * option changes): the slide index and the slide count at each level of
 * the stack, outermost first.
 */
export interface SavedPosition {
  readonly indices: readonly number[];
  readonly counts: readonly number[];
  readonly ended: boolean;
}

/** The player's position, or null for an empty show. */
export function savePosition(state: PlayerState): SavedPosition | null {
  if (state.empty) return null;
  return {
    indices: state.position.map((f) => f.index),
    counts: state.position.map((f) => f.presentation.slides.length),
    ended: state.ended,
  };
}

/**
 * Start playing `presentation` at a saved position when it has the same
 * structure (the same slide count at each level, each level's slide still
 * a nested show that can be entered, and a picture at the end); otherwise,
 * or without one, from the start (`startPlayer`). History is not kept and
 * no sound is reported.
 */
export function restorePlayer(presentation: Presentation, saved?: SavedPosition | null): PlayerState {
  const position = saved ? restoredPosition(presentation, saved) : null;
  if (!position) return startPlayer(presentation);
  return { position, history: [], ended: saved?.ended ?? false, empty: false, sounds: NO_SOUNDS };
}

function restoredPosition(presentation: Presentation, saved: SavedPosition): Frame[] | null {
  const { indices, counts } = saved;
  if (indices.length === 0 || indices.length !== counts.length || indices.length > MAX_DEPTH) return null;
  const stack: Frame[] = [];
  let current: Presentation | null = presentation;
  for (let depth = 0; depth < indices.length; depth++) {
    if (!current || current.slides.length !== counts[depth]) return null;
    const index = indices[depth];
    if (!Number.isInteger(index) || index < Math.max(current.firstSlide, 0) || index >= current.slides.length) return null;
    stack.push({ presentation: current, index });
    const slide = current.slides[index];
    if (depth < indices.length - 1) {
      if (slide.kind !== "nested") return null;
      current = enterable(slide, stack);
    } else if (slide.kind !== "picture") return null;
  }
  return stack;
}
