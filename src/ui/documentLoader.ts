/**
 * Opening files and keeping the document shown (no React; App uses it
 * through useDocumentLoader). The rules:
 *
 * - Loading is async (fonts load on demand); only the latest request may
 *   change what is shown, and only it ends the "Opening…" state.
 * - Opened files may be ZIP archives: an archive holding several shows (or
 *   several charts and no show) asks which to open; one opens directly.
 *   While the user picks, the file shown stays.
 * - The latest request is kept, so a parse option change (the palette)
 *   repeats it with the new options (`reload`).
 * - "Add missing files" puts the chosen files beside the file shown and
 *   opens it again, then says which of the missing files were provided.
 */
import type { FileEntry } from "../files/FileSet";
import { type LoadOptions, type LoadedFile, loadEntry, loadFileSet } from "../files/loadFile";
import type { OpenedFiles } from "../files/openFiles";
import { addedSummary, placeAddedFiles, providedNames } from "./addFiles";

export interface LoaderState {
  file: LoadedFile | null;
  loading: boolean;
  error: string | null;
  /** What "Add missing files" added, after it succeeded. */
  addNote: string | null;
  /** An opened archive waiting for the user to pick what to open. */
  picking: OpenedFiles | null;
}

/** Work that opens something; undefined means nothing to open yet (the user is asked to pick). */
type Work = (options: LoadOptions) => Promise<LoadedFile | null | undefined>;

export class DocumentLoader<F> {
  private state: LoaderState;
  private request = 0;
  private lastWork: Work | null = null;

  /**
   * `read` turns what the user chose (browser files, or anything in tests)
   * into the opened set; `options` gives the current parse options; `emit`
   * receives every new state.
   */
  constructor(
    private readonly read: (files: F) => Promise<OpenedFiles>,
    private readonly options: () => LoadOptions,
    private readonly emit: (state: LoaderState) => void,
    initialFile: LoadedFile | null = null,
  ) {
    this.state = { file: initialFile, loading: false, error: null, addNote: null, picking: null };
  }

  get current(): LoaderState {
    return this.state;
  }

  private set(patch: Partial<LoaderState>): void {
    this.state = { ...this.state, ...patch };
    this.emit(this.state);
  }

  private async load(work: Work, options = this.options(), after?: (loaded: LoadedFile | null) => void): Promise<void> {
    const id = ++this.request;
    const previousWork = this.lastWork;
    this.lastWork = work;
    this.set({ loading: true, error: null, addNote: null });
    try {
      const loaded = await work(options);
      if (id !== this.request) return;
      if (loaded === undefined) {
        // Waiting for a pick: the file shown (if any) stays, and so does its reload.
        this.lastWork = previousWork;
        return;
      }
      this.set({ file: loaded, error: loaded ? null : "None of the chosen files could be read." });
      after?.(loaded);
    } catch (e) {
      if (id === this.request) this.set({ error: e instanceof Error ? e.message : String(e) });
    } finally {
      if (id === this.request) this.set({ loading: false });
    }
  }

  /** Open what the user chose. */
  open(files: F): Promise<void> {
    const opened = this.read(files);
    this.set({ picking: null });
    return this.load(async (options) => {
      const { fileSet, choices } = await opened;
      if (choices.length > 1) {
        this.set({ picking: { fileSet, choices } });
        return undefined;
      }
      return choices.length === 1 ? loadEntry(fileSet, choices[0]!, options) : loadFileSet(fileSet, options);
    });
  }

  /** Open the document picked from an archive. */
  pick(entry: FileEntry): Promise<void> {
    const picking = this.state.picking;
    if (!picking) return Promise.resolve();
    const { fileSet } = picking;
    this.set({ picking: null });
    return this.load((options) => loadEntry(fileSet, entry, options));
  }

  cancelPick(): void {
    this.set({ picking: null });
  }

  /** Show another file of the set open. */
  select(path: string): Promise<void> {
    const file = this.state.file;
    if (!file || path === file.path) return Promise.resolve();
    const fileSet = file.fileSet;
    const entry = fileSet.get(path);
    if (!entry) return Promise.resolve();
    return this.load((options) => loadEntry(fileSet, entry, options));
  }

  /** "Add missing files": the chosen files join the set beside the file shown, which opens again. */
  add(files: F): Promise<void> {
    const file = this.state.file;
    if (!file) return Promise.resolve();
    const { fileSet, path, missing } = file;
    const wanted = [...missing, ...fileSet.missing(path)];
    // Files added from a ZIP archive count by their own names.
    let added: { path: string; bytes: Uint8Array }[] = [];
    const work: Work = async (options) => {
      const { fileSet: read } = await this.read(files);
      added = read.entries();
      const merged = fileSet.withFiles(placeAddedFiles(path, added));
      merged.notes.push(...read.notes);
      const entry = merged.get(path);
      return entry ? loadEntry(merged, entry, options) : null;
    };
    return this.load(work, undefined, (loaded) => {
      if (loaded) this.set({ addNote: addedSummary(providedNames(wanted, added), added.length) });
    });
  }

  /** Repeat the latest request (or reopen the file shown) with new parse options. */
  reload(options: LoadOptions): Promise<void> {
    let work = this.lastWork;
    const file = this.state.file;
    if (!work && file) {
      const { fileSet, path } = file;
      const entry = fileSet.get(path);
      if (entry) work = (o) => loadEntry(fileSet, entry, o);
    }
    return work ? this.load(work, options) : Promise.resolve();
  }
}
