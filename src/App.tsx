import { useEffect, useRef } from "react";
import { AppHeader } from "./components/AppHeader";
import { DocumentPicker } from "./components/DocumentPicker";
import { EmptyState, SupportedFilesHelp, useFileDrop } from "./components/FileDropzone";
import { Settings } from "./components/Settings";
import { Viewer } from "./components/Viewer";
import { type PathedFile, pathOf } from "./files/fromBrowser";
import type { LoadedFile } from "./files/loadFile";
import { type PaletteSetting, paletteLoadOptions } from "./ui/paletteSetting";
import { useDocumentLoader } from "./ui/useDocumentLoader";
import { useSettings } from "./ui/useSettings";

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
  const settings = useSettings();
  const { displayMode, transitionMode, muted, palette } = settings;
  const { file, loading, error: loadError, addNote, picking, loader } = useDocumentLoader(initialFile, () => paletteLoadOptions(palette));

  const onFiles = (files: PathedFile[]) => void loader.open(files);
  const onSelect = (path: string) => void loader.select(path);
  const onAddFiles = (files: PathedFile[]) => void loader.add(files);

  // The palette changes how charts are parsed: open the file again with it.
  // The viewer keeps a show's position and presentation mode across the
  // reload (Viewer, isReload).
  const onPaletteChange = (p: PaletteSetting) => {
    settings.setPalette(p);
    void loader.reload(paletteLoadOptions(p));
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

  const settingsPanel = (
    <Settings
      displayMode={displayMode}
      transitionMode={transitionMode}
      muted={muted}
      palette={palette}
      onDisplayModeChange={settings.setDisplayMode}
      onTransitionModeChange={settings.setTransitionMode}
      onMutedChange={settings.setMuted}
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
          onMutedChange={settings.setMuted}
          paletteOverride={paletteLoadOptions(palette).paletteOverride}
          settings={settingsPanel}
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
      {picking && (
        <DocumentPicker choices={picking.choices} onPick={(entry) => void loader.pick(entry)} onCancel={() => loader.cancelPick()} />
      )}
      {drop.over && file && (
        <div className="drop-overlay" aria-hidden="true">
          Drop to open (files stay on this computer)
        </div>
      )}
    </div>
  );
}
