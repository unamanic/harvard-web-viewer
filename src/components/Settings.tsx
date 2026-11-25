import { DISPLAY_MODES, type DisplayMode, isDisplayMode } from "../render/displayMode";
import { TRANSITION_MODES, type TransitionMode, isTransitionMode } from "../player/transitions/mode";
import { PALETTE_SETTINGS, type PaletteSetting, isPaletteSetting } from "./paletteSetting";

export interface SettingsValues {
  displayMode: DisplayMode;
  transitionMode: TransitionMode;
  muted: boolean;
  /** Absent: the palette option is not offered. */
  palette?: PaletteSetting;
}

export interface SettingsProps extends SettingsValues {
  onDisplayModeChange: (mode: DisplayMode) => void;
  onTransitionModeChange: (mode: TransitionMode) => void;
  onMutedChange: (muted: boolean) => void;
  onPaletteChange?: (palette: PaletteSetting) => void;
}

/** Display, palette, transitions and sound, in a small drop-down panel. Remembered in this browser. */
export function Settings({
  displayMode,
  transitionMode,
  muted,
  palette,
  onDisplayModeChange,
  onTransitionModeChange,
  onMutedChange,
  onPaletteChange,
}: SettingsProps) {
  return (
    <details className="settings">
      <summary className="button">Settings</summary>
      <div className="settings-panel" role="group" aria-label="Settings">
        <label>
          <span>Display</span>
          <select
            value={displayMode}
            onChange={(e) => {
              if (isDisplayMode(e.target.value)) onDisplayModeChange(e.target.value);
            }}
          >
            {DISPLAY_MODES.map(({ mode, label }) => (
              <option key={mode} value={mode}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {palette !== undefined && (
          <label>
            <span>Palette</span>
            <select
              value={palette}
              onChange={(e) => {
                if (isPaletteSetting(e.target.value)) onPaletteChange?.(e.target.value);
              }}
            >
              {PALETTE_SETTINGS.map(({ setting, label }) => (
                <option key={setting} value={setting}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          <span>Transitions</span>
          <select
            value={transitionMode}
            onChange={(e) => {
              if (isTransitionMode(e.target.value)) onTransitionModeChange(e.target.value);
            }}
          >
            {TRANSITION_MODES.map(({ mode, label }) => (
              <option key={mode} value={mode}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="settings-check">
          <input type="checkbox" checked={muted} onChange={(e) => onMutedChange(e.target.checked)} />
          <span>Mute show sounds</span>
        </label>
        <p className="muted settings-note">Remembered in this browser.</p>
      </div>
    </details>
  );
}
