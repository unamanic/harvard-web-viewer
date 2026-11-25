import { useEffect, useRef, useState } from "react";
import { AppHeader } from "./components/AppHeader";
import { DocumentPicker } from "./components/DocumentPicker";
import { EmptyState, SupportedFilesHelp, useFileDrop } from "./components/FileDropzone";
import { Settings } from "./components/Settings";
import { type PaletteSetting, loadPaletteSetting, paletteLoadOptions, savePaletteSetting } from "./components/paletteSetting";
import { Viewer } from "./components/Viewer";
import type { FileEntry } from "./files/FileSet";
import { fileSetFromBrowser, pathOf, type PathedFile } from "./files/fromBrowser";
import type { OpenedFiles } from "./files/openFiles";
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
  // An opened archive with several shows (or charts) waiting for the user to pick one.
  const [picking, setPicking] = useState<OpenedFiles | null>(null);

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
  const lastWork = useRef<((options: LoadOptions) => Promise<LoadedFile | null | undefined>) | null>(null);
  // `work` may resolve to undefined: nothing to open yet (the user is asked to pick), no error.
  const load = async (
    work: (options: LoadOptions) => Promise<LoadedFile | null | undefined>,
    options = paletteLoadOptions(palette),
    after?: (loaded: LoadedFile | null) => void,
  ) => {
    const id = ++request.current;
    const previousWork = lastWork.current;
    lastWork.current = work;
    setLoading(true);
    setLoadError(null);
    setAddNote(null);
    try {
      const loaded = await work(options);
      if (id !== request.current) return;
      if (loaded === undefined) {
        // Waiting for a pick: the file shown (if any) stays, and so does its reload.
        lastWork.current = previousWork;
        return;
      }
      setFile(loaded);
      if (!loaded) setLoadError("None of the chosen files could be read.");
      after?.(loaded);
    } catch (e) {
      if (id === request.current) setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      if (id === request.current) setLoading(false);
    }
  };

  // Opened files, with ZIP archives unpacked: an archive holding several shows
  // (or several charts and no show) asks which to open; one opens directly.
  const onFiles = (files: PathedFile[]) => {
    const opened = fileSetFromBrowser(files);
    setPicking(null);
    void load(async (options) => {
      const { fileSet, choices } = await opened;
      if (choices.length > 1) {
        setPicking({ fileSet, choices });
        return undefined;
      }
      return choices.length === 1 ? loadEntry(fileSet, choices[0]!, options) : loadFileSet(fileSet, options);
    });
  };

  const onPick = (entry: FileEntry) => {
    if (!picking) return;
    const { fileSet } = picking;
    setPicking(null);
    void load((options) => loadEntry(fileSet, entry, options));
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
    // Files added from a ZIP archive count by their own names.
    let added: { path: string; bytes: Uint8Array }[] = [];
    const work = async (options: LoadOptions) => {
      const { fileSet: read } = await fileSetFromBrowser(files);
      added = read.entries();
      const merged = fileSet.withFiles(placeAddedFiles(path, added));
      merged.notes.push(...read.notes);
      const entry = merged.get(path);
      return entry ? loadEntry(merged, entry, options) : null;
    };
    void load(work, undefined, (loaded) => {
      if (loaded) setAddNote(addedSummary(providedNames(wanted, added), added.length));
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
      {picking && <DocumentPicker choices={picking.choices} onPick={onPick} onCancel={() => setPicking(null)} />}
      {drop.over && file && (
        <div className="drop-overlay" aria-hidden="true">
          Drop to open (files stay on this computer)
        </div>
      )}
    </div>
  );
}
