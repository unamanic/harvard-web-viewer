import { useRef, useState } from "react";
import { FileDropzone, FilePickers, useFileDrop } from "./components/FileDropzone";
import { FileList } from "./components/FileList";
import { Settings } from "./components/Settings";
import { type PaletteSetting, loadPaletteSetting, paletteLoadOptions, savePaletteSetting } from "./components/paletteSetting";
import { Viewer } from "./components/Viewer";
import { fileSetFromBrowser, type PathedFile } from "./files/fromBrowser";
import { loadDisplayMode, saveDisplayMode, type DisplayMode } from "./render/displayMode";
import { loadMuted, saveMuted } from "./player/sound/controller";
import { loadTransitionMode, saveTransitionMode, type TransitionMode } from "./player/transitions/mode";
import { loadEntry, loadFileSet, type LoadedFile, type LoadOptions } from "./loadFile";

export interface AppProps {
  /** File shown at start (tests); normally files are opened by the user. */
  initialFile?: LoadedFile | null;
}

/**
 * App shell: header (name, open buttons, settings), the list of opened files
 * and the file shown. Dropping files anywhere on the page opens them.
 */
export function App({ initialFile = null }: AppProps = {}) {
  const [file, setFile] = useState<LoadedFile | null>(initialFile);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
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
  const load = async (work: (options: LoadOptions) => Promise<LoadedFile | null>, options = paletteLoadOptions(palette)) => {
    const id = ++request.current;
    lastWork.current = work;
    setLoading(true);
    setLoadError(null);
    try {
      const loaded = await work(options);
      if (id !== request.current) return;
      setFile(loaded);
      if (!loaded) setLoadError("None of the chosen files could be read.");
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

  // The palette changes how charts are parsed: open the file again with it.
  // A show restarts from its first slide.
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

  const drop = useFileDrop(onFiles);
  const entries = file?.fileSet.entries() ?? [];

  return (
    <div className={`app${drop.over ? " dragging" : ""}${file ? "" : " app-empty"}`} {...drop.handlers}>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="app-header">
        <h1 className="app-name">Harvard Web Viewer</h1>
        <div className="app-actions">
          {file && <FilePickers onFiles={onFiles} compact />}
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
        </div>
      </header>
      <div className="app-body">
        {file && entries.length > 0 && (
          <aside className="app-sidebar">
            <FileList entries={entries} current={file.path} onSelect={onSelect} />
            <p className="muted sidebar-note">Files stay on this computer.</p>
          </aside>
        )}
        <main id="main" className="app-main" tabIndex={-1}>
          <p className="status" role="status" aria-live="polite">
            {loading ? "Opening…" : ""}
          </p>
          {loadError && (
            <p className="error" role="alert">
              {loadError}
            </p>
          )}
          {file ? (
            <Viewer
              file={file}
              displayMode={displayMode}
              transitionMode={transitionMode}
              muted={muted}
              onMutedChange={onMutedChange}
            />
          ) : (
            <FileDropzone onFiles={onFiles} over={drop.over} />
          )}
        </main>
      </div>
      {drop.over && file && (
        <div className="drop-overlay" aria-hidden="true">
          Drop to open (files stay on this computer)
        </div>
      )}
    </div>
  );
}
