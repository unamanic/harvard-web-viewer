import { useEffect, useRef, useState } from "react";
import { AppHeader } from "./components/AppHeader";
import { EmptyState, SupportedFilesHelp, useFileDrop } from "./components/FileDropzone";
import { Settings } from "./components/Settings";
import { type PaletteSetting, loadPaletteSetting, paletteLoadOptions, savePaletteSetting } from "./components/paletteSetting";
import { Viewer } from "./components/Viewer";
import { fileSetFromBrowser, pathOf, type PathedFile } from "./files/fromBrowser";
import { loadDisplayMode, saveDisplayMode, type DisplayMode } from "./render/displayMode";
import { loadMuted, saveMuted } from "./player/sound/controller";
import { loadTransitionMode, saveTransitionMode, type TransitionMode } from "./player/transitions/mode";
import { loadEntry, loadFileSet, type LoadedFile, type LoadOptions } from "./loadFile";
import { addedSummary, placeAddedFiles, providedNames } from "./ui/addFiles";

export interface AppProps {
  /** File shown at start (tests); normally files are opened by the user. */
  initialFile?: LoadedFile | null;
}

/** Files pasted into the page (Ctrl+V), if any. */
function pastedFiles(e: ClipboardEvent): PathedFile[] {
  return Array.from(e.clipboardData?.files ?? []).map((file) => ({ file, path: pathOf(file) }));
}

/**
 * App shell: the empty state, or the open file laid out as the light table
 * (Viewer). Dropping files anywhere on the page, or pasting them, opens them.
 */
export function App({ initialFile = null }: AppProps = {}) {
  const [file, setFile] = useState<LoadedFile | null>(initialFile);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [addNote, setAddNote] = useState<string | null>(null);
  const [displayMode, setDisplayMode] = useState<DisplayMode>(loadDisplayMode);
  const [transitionMode, setTransitionMode] = useState<TransitionMode>(loadTransitionMode);
  const [muted, setMuted] = useState(loadMuted);
  const [palette, setPalette] = useState<PaletteSetting>(loadPaletteSetting);

  const onDisplayModeChange = (mode: DisplayMode) => {
    setDisplayMode(mode);
    saveDisplayMode(mode);
  };
  const onTransitionModeChange = (mode: TransitionMode) => {
    setTransitionMode(mode);
    saveTransitionMode(mode);
  };
  const onMutedChange = (m: boolean) => {
    setMuted(m);
    saveMuted(m);
  };

  // Loading is async (fonts load on demand); only the latest request may show.
  // The latest request is kept so that changing a parse option (the palette)
  // can repeat it with the new options.
  const request = useRef(0);
  const lastWork = useRef<((options: LoadOptions) => Promise<LoadedFile | null>) | null>(null);
  const load = async (
    work: (options: LoadOptions) => Promise<LoadedFile | null>,
    options = paletteLoadOptions(palette),
    after?: (loaded: LoadedFile | null) => void,
  ) => {
    const id = ++request.current;
    lastWork.current = work;
    setLoading(true);
    setLoadError(null);
    setAddNote(null);
    try {
      const loaded = await work(options);
      if (id !== request.current) return;
      setFile(loaded);
      if (!loaded) setLoadError("None of the chosen files could be read.");
      after?.(loaded);
    } catch (e) {
      if (id === request.current) setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      if (id === request.current) setLoading(false);
    }
  };

  const onFiles = (files: PathedFile[]) => {
    const fileSet = fileSetFromBrowser(files);
    void load(async (options) => loadFileSet(await fileSet, options));
  };

  const onSelect = (path: string) => {
    if (!file || path === file.path) return;
    const fileSet = file.fileSet;
    const entry = fileSet.get(path);
    if (!entry) return;
    void load((options) => loadEntry(fileSet, entry, options));
  };

  // "Add missing files": the chosen files join the set open (beside the file
  // shown), and the file is opened again so that it uses them.
  const onAddFiles = (files: PathedFile[]) => {
    if (!file) return;
    const { fileSet, path, missing } = file;
    const wanted = [...missing, ...fileSet.missing(path)];
    const work = async (options: LoadOptions) => {
      const read = await fileSetFromBrowser(files);
      const added = placeAddedFiles(path, read.entries());
      const merged = fileSet.withFiles(added);
      const entry = merged.get(path);
      return entry ? loadEntry(merged, entry, options) : null;
    };
    void load(work, undefined, (loaded) => {
      if (loaded) setAddNote(addedSummary(providedNames(wanted, files), files.length));
    });
  };

  // The palette changes how charts are parsed: open the file again with it.
  // The viewer keeps a show's position and presentation mode across the
  // reload (Viewer, isReload).
  const onPaletteChange = (p: PaletteSetting) => {
    setPalette(p);
    savePaletteSetting(p);
    let work = lastWork.current;
    if (!work && file) {
      const { fileSet, path } = file;
      const entry = fileSet.get(path);
      if (entry) work = (options) => loadEntry(fileSet, entry, options);
    }
    if (work) void load(work, paletteLoadOptions(p));
  };

  // Files pasted anywhere on the page open like dropped ones.
  const onFilesRef = useRef(onFiles);
  useEffect(() => {
    onFilesRef.current = onFiles;
  });
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = pastedFiles(e);
      if (files.length === 0) return;
      e.preventDefault();
      onFilesRef.current(files);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);

  const drop = useFileDrop(onFiles);

  const status = (
    <>
      <p className="status" role="status" aria-live="polite">
        {loading ? "Opening…" : ""}
      </p>
      {loadError && (
        <p className="error" role="alert">
          {loadError}
        </p>
      )}
    </>
  );

  const settings = (
    <Settings
      displayMode={displayMode}
      transitionMode={transitionMode}
      muted={muted}
      palette={palette}
      onDisplayModeChange={onDisplayModeChange}
      onTransitionModeChange={onTransitionModeChange}
      onMutedChange={onMutedChange}
      onPaletteChange={onPaletteChange}
    />
  );

  return (
    <div className={`app${drop.over ? " dragging" : ""}${file ? " app-open" : " app-empty"}`} {...drop.handlers}>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      {file ? (
        <Viewer
          file={file}
          displayMode={displayMode}
          transitionMode={transitionMode}
          muted={muted}
          onMutedChange={onMutedChange}
          paletteOverride={paletteLoadOptions(palette).paletteOverride}
          settings={settings}
          onOpenFiles={onFiles}
          onSelectFile={onSelect}
          onAddFiles={onAddFiles}
          addNote={addNote}
          status={status}
        />
      ) : (
        <>
          <AppHeader tagline={false} heading={false}>
            <SupportedFilesHelp />
          </AppHeader>
          <main id="main" className="empty-main" tabIndex={-1}>
            <EmptyState onFiles={onFiles} over={drop.over} status={status} />
          </main>
        </>
      )}
      {drop.over && file && (
        <div className="drop-overlay" aria-hidden="true">
          Drop to open (files stay on this computer)
        </div>
      )}
    </div>
  );
}
