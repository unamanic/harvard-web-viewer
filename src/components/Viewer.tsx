import { useCallback, useMemo, useState } from "react";
import type { PresentationSlide } from "../formats/types";
import type { LoadedFile } from "../loadFile";
import { DEFAULT_DISPLAY_MODE, applyDisplayMode, type DisplayMode } from "../render/displayMode";
import { SceneRenderer } from "../render/SceneRenderer";
import type { SavedPosition } from "../player/player";
import { ShowPlayer } from "../player/ShowPlayer";
import { DEFAULT_TRANSITION_MODE, type TransitionMode } from "../player/transitions/mode";
import { collectDiagnostics } from "../ui/diagnostics";
import { DiagnosticsPanel } from "./DiagnosticsPanel";
import { Inspector } from "./Inspector";
import { ScenePresentation } from "./ScenePresentation";

export interface ViewerProps {
  file: LoadedFile;
  /** Display the slides imitate (colours only). Defaults to VGA. */
  displayMode?: DisplayMode;
  transitionMode?: TransitionMode;
  /** Show sounds muted (the app's setting); the player keeps its own when absent. */
  muted?: boolean;
  onMutedChange?: (muted: boolean) => void;
}

/** One-line description of what was detected. */
export function detectedText(file: LoadedFile): string {
  if (file.document) return file.document.formatName;
  if (file.formatName && !file.error) return file.formatName;
  if (file.formatName) return `Could not open as ${file.formatName}`;
  return "Format not recognised";
}

/** `next` is `previous` opened again (same path in the same file set), e.g. with other load options. */
export function isReload(previous: LoadedFile, next: LoadedFile): boolean {
  return previous.path === next.path && previous.fileSet === next.fileSet;
}

/**
 * The file shown: a show player (with slide strip) or the chart's pages,
 * a Present button, then the diagnostics and file structure panels.
 */
export function Viewer({
  file,
  displayMode = DEFAULT_DISPLAY_MODE,
  transitionMode = DEFAULT_TRANSITION_MODE,
  muted,
  onMutedChange,
}: ViewerProps) {
  // Recolouring is a pure transform of the parsed scenes: no re-parse.
  const scenes = useMemo(
    () => file.document?.scenes.map((s) => applyDisplayMode(s, displayMode)) ?? [],
    [file.document, displayMode],
  );
  const presentation = file.document?.presentation;
  const [presenting, setPresenting] = useState(false);

  // The slide shown, and a counter bumped whenever building pictures may
  // have found more missing files: the diagnostics are read on each render.
  const [slide, setSlide] = useState<PresentationSlide | null>(null);
  const [, setBuilds] = useState(0);
  const onSlideChange = useCallback((s: PresentationSlide | null) => {
    setSlide(s);
    setBuilds((n) => n + 1);
  }, []);
  const onThumbnailBuilt = useCallback(() => setBuilds((n) => n + 1), []);

  // Where the show is, so that a reload of the same file (the palette
  // option re-parses it) carries on from there if the show still fits.
  const [position, setPosition] = useState<SavedPosition | null>(null);

  // A new file starts outside presentation mode with no slide; the same
  // file loaded again from the same set keeps both.
  const [shownFile, setShownFile] = useState(file);
  if (shownFile !== file) {
    setShownFile(file);
    if (!isReload(shownFile, file)) {
      setPresenting(false);
      setPosition(null);
    }
    setSlide(null);
  }

  // Sound slides name files beside the show; look them up in the opened set.
  const resolveFile = useCallback(
    (name: string) => file.fileSet.resolve(name, file.path, "sound")?.bytes ?? null,
    [file],
  );
  const diagnostics = collectDiagnostics(file, presentation ? slide : null);
  const canPresent = !!presentation || scenes.length > 0;
  const title = file.name;

  return (
    <article className="viewer" aria-labelledby="viewer-title">
      <header className="viewer-header">
        <div className="viewer-title">
          <h2 id="viewer-title">{file.name}</h2>
          <p className="muted">
            {detectedText(file)}
            {file.path !== file.name ? ` · ${file.path}` : ""}
          </p>
        </div>
        {canPresent && (
          <button type="button" className="button button-primary" onClick={() => setPresenting(true)}>
            Present
          </button>
        )}
      </header>
      {file.error && (
        <p className="error" role="alert">
          {file.error}
        </p>
      )}
      {!file.document && !file.error && (
        <p className="notice">
          This viewer cannot draw this file. Its bytes are shown under “File structure and bytes”.
        </p>
      )}
      {presentation ? (
        <ShowPlayer
          key={file.path}
          presentation={presentation}
          displayMode={displayMode}
          transitionMode={transitionMode}
          resolveFile={resolveFile}
          muted={muted}
          onMutedChange={onMutedChange}
          presenting={presenting}
          onPresentingChange={setPresenting}
          onSlideChange={onSlideChange}
          initialPosition={position}
          onPositionChange={setPosition}
          onThumbnailBuilt={onThumbnailBuilt}
        />
      ) : (
        <>
          {file.document && scenes.length === 0 && <p className="notice">This file has no pages to draw.</p>}
          {scenes.map((scene, i) => (
            <figure key={i} className="page" aria-label={scenes.length > 1 ? `${title}, page ${i + 1}` : title}>
              <SceneRenderer scene={scene} />
            </figure>
          ))}
          {presenting && scenes.length > 0 && (
            <ScenePresentation scenes={scenes} title={title} onExit={() => setPresenting(false)} />
          )}
        </>
      )}
      <DiagnosticsPanel diagnostics={diagnostics} path={file.path} />
      <Inspector bytes={file.bytes} />
    </article>
  );
}
