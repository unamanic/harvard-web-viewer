import type { Scene } from "./scene";

/**
 * The presentation model (slide shows).
 *
 * Format-independent: a parser converts its own show structure into this, and
 * the player (src/player) only knows these types. Slides build their pictures
 * lazily, so opening a large show does not draw every chart up front.
 */

/** Where a key press or button click goes. Slide indices count from 0. */
export type Destination =
  | { kind: "slide"; index: number }
  /** The next slide of the current show. */
  | { kind: "next" }
  /** The previous slide of the current show. */
  | { kind: "previous" }
  /** The slide viewed before the current one. */
  | { kind: "lastView" }
  /** The first slide of the outermost show. */
  | { kind: "top" }
  /** Nothing happens (e.g. an unused table entry). */
  | { kind: "none" }
  /** "Leave for the editor" in the original program; a viewer ignores it. */
  | { kind: "edit" };

/** A key bound to a destination. */
export interface KeyBinding {
  /**
   * The key as `KeyboardEvent.key` names it: one character ("1", "a", " ")
   * or a named key ("F3", "Enter", "Escape", "ArrowLeft", "PageDown" ...).
   */
  key: string;
  destination: Destination;
}

/** A named button (a `GroupElement.buttonName` in the slide's scene) bound to a destination. */
export interface ButtonBinding {
  /** As stored; the player compares names ignoring case and trailing spaces. */
  name: string;
  destination: Destination;
}

/**
 * - picture: shows a scene;
 * - empty: nothing to show, the player skips it;
 * - sound: plays sound (not yet) and continues at once;
 * - nested: plays another presentation, then continues with the next slide.
 */
export type PresentationSlideKind = "picture" | "empty" | "sound" | "nested";

export interface PresentationSlide {
  /** Short text for slide lists and counters (description or file name). */
  label: string;
  kind: PresentationSlideKind;
  /** File the slide names (chart, nested show or sound), if any. */
  fileName: string | null;
  /**
   * The slide's picture, built on first call and cached. Null for slides
   * without one. A picture slide whose file is missing returns a placeholder
   * scene naming the file.
   */
  scene(): Scene | null;
  /** For nested slides: the nested presentation (built on first call, cached), or null if unavailable. */
  nested?(): Presentation | null;
  /** Problems met so far while building `scene()` / `nested()` (grows lazily). */
  warnings(): readonly string[];
  /** Keys active while this slide shows; checked before the presentation's `globalKeys`. */
  keys: KeyBinding[];
  /** Buttons of this slide, matched against clicked `buttonName`s. */
  buttons: ButtonBinding[];
  /** True: stay until a key or click. False: continue on by itself. */
  waitForKey: boolean;
  /** For slides that do not wait: seconds before moving on (0 = at once), if known. */
  displaySeconds?: number;
  /**
   * How the slide is drawn and erased, as the file sets it (defaults already
   * filled in), or absent if the format stores none (drawn with Replace).
   */
  effects?: SlideEffects;
}

/** Slide transition speeds (SPEC §4.5); the player turns them into durations. */
export type SlideTransitionSpeed = "slow" | "medium" | "fast";

/** One Draw or Erase effect of a slide. A missing direction or speed is the effect's default. */
export interface SlideEffect {
  effect: SlideTransitionEffect;
  direction?: SlideTransitionDirection;
  speed?: SlideTransitionSpeed;
}

/**
 * A slide's effects (SPEC §4.5): when the show moves on from a slide, the
 * slide is erased with its `erase` effect (to the black screen; `keep`
 * leaves it, as does an absent `erase`), then the next slide is drawn with
 * its own `draw` effect.
 */
export interface SlideEffects {
  draw: SlideEffect;
  erase?: SlideEffect;
}

/**
 * Format-independent slide transition effects (SPEC §4.5). `keep` (an
 * erase effect) leaves the old picture for the next slide to be drawn over.
 */
export type SlideTransitionEffect =
  | "replace"
  | "overlay"
  | "wipe"
  | "scroll"
  | "fade"
  | "open"
  | "close"
  | "blinds"
  | "iris"
  | "keep";

/**
 * Geometry per effect (src/player/transitions/frames.ts; the default is the
 * first one listed):
 * - wipe: left/right/up/down = the direction the edge moves; out = from the
 *   vertical centre line to both sides; in = from both sides to the centre.
 * - scroll: left/right/up/down = the direction the pictures move; in/out
 *   are drawn as the default (left).
 * - open, close: up/down (default, in, out) = horizontal centre line;
 *   left/right = vertical centre line.
 * - blinds: down (default, in, out) / up = horizontal stripes growing
 *   downwards / upwards; right / left = vertical stripes growing rightwards
 *   / leftwards.
 * - iris: out (default, and left/right/up/down) = growing rectangle,
 *   in = shrinking.
 * - fade, replace, overlay, keep: no direction.
 */
export type SlideTransitionDirection = "left" | "right" | "up" | "down" | "in" | "out";

/** One effect as the player draws it (src/player/transitions): the old picture changing into the new one. */
export interface SlideTransition {
  effect: SlideTransitionEffect;
  direction?: SlideTransitionDirection;
  /** Overall duration; ignored by the instant effects (replace, overlay, keep). */
  durationMs: number;
}

export interface Presentation {
  /**
   * Identifies the source (e.g. the file path). The player refuses to enter
   * a nested presentation whose id is already being played.
   */
  id: string;
  title: string;
  /**
   * Slides in order. Index 0 may be a placeholder (in Harvard Graphics it is
   * the show itself); playing starts at `firstSlide`.
   */
  slides: PresentationSlide[];
  /** Index of the slide playing starts at. */
  firstSlide: number;
  /** Keys active on every slide of this presentation (after the slide's own). */
  globalKeys: KeyBinding[];
}
