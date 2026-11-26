/**
 * The viewer settings remembered in this browser (localStorage): display
 * mode, palette, transitions and sound. Storage can be blocked (private
 * windows, sandboxed frames); then nothing is remembered and each setting
 * starts at its default, still applying for the session.
 */
import { type TransitionMode, DEFAULT_TRANSITION_MODE, isTransitionMode } from "../player/transitions/mode";
import { type DisplayMode, DEFAULT_DISPLAY_MODE, isDisplayMode } from "../render/displayMode";
import { type PaletteSetting, DEFAULT_PALETTE_SETTING, isPaletteSetting } from "./paletteSetting";

const KEYS = {
  displayMode: "hwv.displayMode",
  palette: "hwv.palette",
  transitions: "hwv.transitions",
  muted: "hwv.soundMuted",
} as const;

function read(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    // Not remembered; the choice still applies for this session.
  }
}

/** Earlier name of the "mono" display mode, still found in stored settings. */
const LEGACY_CGA_MODE = "cga";

export function loadDisplayMode(): DisplayMode {
  const v = read(KEYS.displayMode);
  if (v === LEGACY_CGA_MODE) return "mono";
  return isDisplayMode(v) ? v : DEFAULT_DISPLAY_MODE;
}

export function saveDisplayMode(mode: DisplayMode): void {
  write(KEYS.displayMode, mode);
}

export function loadPaletteSetting(): PaletteSetting {
  const v = read(KEYS.palette);
  return isPaletteSetting(v) ? v : DEFAULT_PALETTE_SETTING;
}

export function savePaletteSetting(setting: PaletteSetting): void {
  write(KEYS.palette, setting);
}

/** Stored transition values of earlier versions → the mode that replaces them. */
const MIGRATED_TRANSITIONS: Readonly<Record<string, TransitionMode>> = {
  // "Guessed from the file" read a guessed byte layout; the file is now decoded.
  guessed: "file",
};

export function loadTransitionMode(): TransitionMode {
  const v = read(KEYS.transitions);
  if (isTransitionMode(v)) return v;
  if (v != null && Object.hasOwn(MIGRATED_TRANSITIONS, v)) {
    saveTransitionMode(MIGRATED_TRANSITIONS[v]);
    return MIGRATED_TRANSITIONS[v];
  }
  return DEFAULT_TRANSITION_MODE;
}

export function saveTransitionMode(mode: TransitionMode): void {
  write(KEYS.transitions, mode);
}

export function loadMuted(): boolean {
  return read(KEYS.muted) === "1";
}

export function saveMuted(muted: boolean): void {
  write(KEYS.muted, muted ? "1" : "0");
}
