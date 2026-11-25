import { DISPLAY_MODES, type DisplayMode, isDisplayMode } from "../render/displayMode";
import { TRANSITION_MODES, type TransitionMode, isTransitionMode } from "../player/transitions/mode";

export interface SettingsValues {
  displayMode: DisplayMode;
  transitionMode: TransitionMode;
  muted: boolean;
}

export interface SettingsProps extends SettingsValues {
  onDisplayModeChange: (mode: DisplayMode) => void;
  onTransitionModeChange: (mode: TransitionMode) => void;
  onMutedChange: (muted: boolean) => void;
}

/** Display, transitions and sound, in a small drop-down panel. Remembered in this browser. */
export function Settings({
  displayMode,
  transitionMode,
  muted,
  onDisplayModeChange,
  onTransitionModeChange,
  onMutedChange,
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
