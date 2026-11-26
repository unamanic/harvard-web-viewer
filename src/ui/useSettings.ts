/** The viewer's settings as React state, each remembered in this browser when changed (settings.ts). */
import { useState } from "react";
import type { TransitionMode } from "../player/transitions/mode";
import type { DisplayMode } from "../render/displayMode";
import type { PaletteSetting } from "./paletteSetting";
import {
  loadDisplayMode,
  loadMuted,
  loadPaletteSetting,
  loadTransitionMode,
  saveDisplayMode,
  saveMuted,
  savePaletteSetting,
  saveTransitionMode,
} from "./settings";

export interface ViewerSettings {
  displayMode: DisplayMode;
  transitionMode: TransitionMode;
  muted: boolean;
  palette: PaletteSetting;
  setDisplayMode: (mode: DisplayMode) => void;
  setTransitionMode: (mode: TransitionMode) => void;
  setMuted: (muted: boolean) => void;
  setPalette: (palette: PaletteSetting) => void;
}

export function useSettings(): ViewerSettings {
  const [displayMode, setDisplayMode] = useState<DisplayMode>(loadDisplayMode);
  const [transitionMode, setTransitionMode] = useState<TransitionMode>(loadTransitionMode);
  const [muted, setMuted] = useState(loadMuted);
  const [palette, setPalette] = useState<PaletteSetting>(loadPaletteSetting);
  const remembered =
    <T,>(set: (v: T) => void, save: (v: T) => void) =>
    (v: T) => {
      set(v);
      save(v);
    };
  return {
    displayMode,
    transitionMode,
    muted,
    palette,
    setDisplayMode: remembered(setDisplayMode, saveDisplayMode),
    setTransitionMode: remembered(setTransitionMode, saveTransitionMode),
    setMuted: remembered(setMuted, saveMuted),
    setPalette: remembered(setPalette, savePaletteSetting),
  };
}
