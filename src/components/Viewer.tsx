import { type ReactNode, Suspense, lazy, useCallback, useMemo, useRef, useState } from "react";
import type { PathedFile } from "../files/fromBrowser";
import type { PresentationSlide, Scene } from "../formats/types";
import type { LoadedFile } from "../loadFile";
import { DEFAULT_DISPLAY_MODE, applyDisplayMode, type DisplayMode } from "../render/displayMode";
import { SceneRenderer } from "../render/SceneRenderer";
import type { SavedPosition } from "../player/player";
import { type ShowControl, ShowPlayer } from "../player/ShowPlayer";
import { DEFAULT_TRANSITION_MODE, type TransitionMode } from "../player/transitions/mode";
import { collectDiagnostics } from "../ui/diagnostics";
import type { ExportChoice } from "../ui/exportImage";
import { aboutRows, chartFacts } from "../ui/fileFacts";
import { AboutPanel } from "./AboutPanel";
import { AppHeader } from "./AppHeader";
import { ExportMenu } from "./ExportMenu";
import { OpenButton } from "./FileDropzone";
import { FileSwitcher } from "./FileSwitcher";
import { RawBytesDrawer } from "./Inspector";
import { ScenePresentation } from "./ScenePresentation";
import { PageCards, SlideCards, SlidesColumn } from "./SlidesColumn";

export { detectedText } from "../ui/fileFacts";

// Loaded on first use, with the encoders behind it: keeps video export out of the first screen.
const VideoExportDialog = lazy(() => import("./VideoExportDialog"));

export interface ViewerProps {
  file: LoadedFile;
  /** Display the slides imitate (colours only). Defaults to VGA. */
  displayMode?: DisplayMode;
  transitionMode?: TransitionMode;
  /** Show sounds muted (the app's setting); the player keeps its own when absent. */
  muted?: boolean;
  onMutedChange?: (muted: boolean) => void;
  /** The palette the viewer draws with in place of the charts' own, if any (for the About rows). */
  paletteOverride?: string;
  /** The Display settings section of the right column. */
  settings?: ReactNode;
  /** Open other files (the header's "Open a file"). */
  onOpenFiles?: (files: PathedFile[]) => void;
  /** Show another file of the set opened. */
  onSelectFile?: (path: string) => void;
  /** Add files to the set and show this file again (“Add missing files…”). */
  onAddFiles?: (files: PathedFile[]) => void;
  /** Note after adding files. */
  addNote?: string | null;
  /** Loading and load errors, shown above the slide. */
  status?: ReactNode;
}

/**
 * `next` is `previous` opened again: the same path in the same file set, or
 * in a set made from it by adding files (FileSet.withFiles), e.g. with other
 * load options or after "Add missing files".
 */
export function isReload(previous: LoadedFile, next: LoadedFile): boolean {
  return previous.path === next.path && previous.fileSet.lineage === next.fileSet.lineage;
}

/** Number of the slide shown counted from the show's first slide, for file names. */
function showSlideNumber(firstSlide: number, position: SavedPosition | null): number | null {
  return position && position.indices.length > 0 ? position.indices[0] - Math.max(firstSlide, 0) + 1 : null;
}

/**
 * The open file, laid out as the light table: header (Present, Export,
 * Open), the slides column (file switcher and slide cards), the slide on
 * its stage and the "About this file" column, plus a tab bar on phones.
 */
export function Viewer({
  file,
  displayMode = DEFAULT_DISPLAY_MODE,
  transitionMode = DEFAULT_TRANSITION_MODE,
  muted,
  onMutedChange,
  paletteOverride,
  settings,
  onOpenFiles,
  onSelectFile,
  onAddFiles,
  addNote,
  status,
}: ViewerProps) {
  // Recolouring is a pure transform of the parsed scenes: no re-parse.
  const scenes = useMemo(
    () => file.document?.scenes.map((s) => applyDisplayMode(s, displayMode)) ?? [],
    [file.document, displayMode],
  );
  const presentation = file.document?.presentation;
  const [presenting, setPresenting] = useState(false);
  const [rawOpen, setRawOpen] = useState(false);
  const [page, setPage] = useState(0);
  const [exportError, setExportError] = useState<string | null>(null);
  const [videoOpen, setVideoOpen] = useState(false);
  const control = useRef<ShowControl>(null);

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
  // file loaded again keeps both.
  const [shownFile, setShownFile] = useState(file);
  if (shownFile !== file) {
    setShownFile(file);
    if (!isReload(shownFile, file)) {
      setPresenting(false);
      setPosition(null);
      setPage(0);
      setRawOpen(false);
    }
    setSlide(null);
    setExportError(null);
    setVideoOpen(false);
  }

  // Sound slides name files beside the show; look them up in the opened set.
  const resolveFile = useCallback(
    (name: string) => file.fileSet.resolve(name, file.path, "sound")?.bytes ?? null,
    [file],
  );
  const diagnostics = collectDiagnostics(file, presentation ? slide : null);
  const rows = aboutRows(file, presentation ? slide : null, paletteOverride);
  const chartTitle = useMemo(
    () => (presentation ? "" : (file.document && chartFacts(file.bytes)?.description) || file.name),
    [file, presentation],
  );
  const shownPage = Math.min(page, Math.max(scenes.length - 1, 0));
  const canPresent = !!presentation || scenes.length > 0;

  // The slide to export: the show's current picture, or the chart page shown.
  const exportScene: Scene | null = useMemo(() => {
    if (presentation) {
      const raw = slide?.scene() ?? null;
      return raw && applyDisplayMode(raw, displayMode);
    }
    return scenes[shownPage] ?? null;
  }, [presentation, slide, displayMode, scenes, shownPage]);
  const onExport = (choice: ExportChoice) => {
    if (!exportScene) return;
    const number = presentation ? showSlideNumber(presentation.firstSlide, position) : shownPage + 1;
    setExportError(null);
    // Loaded on first use: keeps the export code out of the first screen.
    void import("./exportScene")
      .then(({ exportScene: save }) => save(exportScene, choice, file.name, number))
      .catch((e: unknown) => setExportError(e instanceof Error ? e.message : String(e)));
  };

  // Video export: for shows only (a chart is a single still).
  const onExportVideo = presentation ? () => setVideoOpen(true) : undefined;

  const entries = file.fileSet.entries();
  const fileSwitcher =
    entries.length > 1 && onSelectFile ? (
      <FileSwitcher entries={entries} current={file.path} onSelect={onSelectFile} />
    ) : undefined;

  let cards: ReactNode = null;
  if (presentation) {
    const current = position?.indices[0] ?? Math.max(presentation.firstSlide, 0);
    let nestedNote: string | null = null;
    if (position && position.indices.length > 1) {
      const nested = presentation.slides[position.indices[0]]?.nested?.();
      const first = Math.max(nested?.firstSlide ?? 0, 0);
      nestedNote = `Playing slide ${position.indices[1] - first + 1} of ${position.counts[1] - first}`;
    }
    cards = (
      <SlideCards
        presentation={presentation}
        current={current}
        nestedNote={nestedNote}
        displayMode={displayMode}
        onJump={(index) => control.current?.jumpTo(index)}
        onBuilt={onThumbnailBuilt}
      />
    );
  } else if (scenes.length > 0) {
    cards = <PageCards scenes={scenes} title={chartTitle} current={shownPage} onSelect={setPage} />;
  } else {
    cards = <p className="muted column-empty">Nothing to draw in this file.</p>;
  }

  const present = (className = "button") =>
    canPresent ? (
      <button type="button" className={className} onClick={() => setPresenting(true)}>
        Present
      </button>
    ) : (
      <button type="button" className={className} disabled title="Nothing to present in this file">
        Present
      </button>
    );

  const caption = "Rendered from the original file, not a screenshot";

  return (
    <>
      <AppHeader>
        <span className="header-wide">
          {present()}
          <ExportMenu viewBox={exportScene?.viewBox ?? null} onExport={onExport} onExportVideo={onExportVideo} />
        </span>
        {onOpenFiles && <OpenButton onFiles={onOpenFiles} />}
      </AppHeader>
      <div className="workspace">
        <SlidesColumn fileSwitcher={fileSwitcher}>{cards}</SlidesColumn>
        <main id="main" className="stage" tabIndex={-1} aria-label={`${file.name}: the slide`}>
          {status}
          {exportError && (
            <p className="error" role="alert">
              Export failed: {exportError}
            </p>
          )}
          {file.error && (
            <p className="error" role="alert">
              {file.error}
            </p>
          )}
          {!file.document && !file.error && (
            <p className="stage-message">
              This viewer cannot draw this file. Its bytes are under “Show raw bytes”.
            </p>
          )}
          {presentation ? (
            <>
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
                fileLabel={file.name}
                control={control}
              />
              <p className="stage-caption">{caption}</p>
            </>
          ) : (
            <>
              {file.document && scenes.length === 0 && <p className="stage-message">This file has no pages to draw.</p>}
              {scenes[shownPage] && (
                <>
                  <figure
                    className="stage-panel"
                    aria-label={scenes.length > 1 ? `${chartTitle}, page ${shownPage + 1}` : chartTitle}
                  >
                    <div className="stage-slide">
                      <SceneRenderer scene={scenes[shownPage]} />
                    </div>
                  </figure>
                  <p className="stage-caption">
                    {file.name}
                    {scenes.length > 1 ? ` · Page ${shownPage + 1} of ${scenes.length}` : ""} · {caption}
                  </p>
                </>
              )}
              {presenting && scenes.length > 0 && (
                <ScenePresentation
                  scenes={scenes}
                  title={file.name}
                  start={shownPage}
                  onExit={() => setPresenting(false)}
                />
              )}
            </>
          )}
        </main>
        <AboutPanel
          rows={rows}
          diagnostics={diagnostics}
          path={file.path}
          onAddFiles={onAddFiles}
          addNote={addNote}
          settings={settings}
          onShowRawBytes={() => setRawOpen(true)}
        />
      </div>
      <nav className="tab-bar" aria-label="Sections">
        <a href="#main" className="tab">
          Slide
        </a>
        <a href="#about" className="tab">
          Details
        </a>
        {present("tab")}
        <ExportMenu
          viewBox={exportScene?.viewBox ?? null}
          onExport={onExport}
          onExportVideo={onExportVideo}
          label="Export"
          className="tab-menu"
        />
      </nav>
      {videoOpen && presentation && (
        <Suspense fallback={null}>
          <VideoExportDialog
            presentation={presentation}
            fileName={file.name}
            displayMode={displayMode}
            transitionMode={transitionMode}
            resolveFile={resolveFile}
            onClose={() => setVideoOpen(false)}
          />
        </Suspense>
      )}
      {rawOpen && <RawBytesDrawer bytes={file.bytes} fileName={file.name} onClose={() => setRawOpen(false)} />}
    </>
  );
}
