import { type OpenedFiles, openFiles } from "./openFiles";

/** A browser File plus the relative path it had inside a dropped folder. */
export interface PathedFile {
  file: File;
  path: string;
}

/** Relative path of a File from an `<input webkitdirectory>`, else its name. */
export function pathOf(file: File): string {
  return file.webkitRelativePath || file.name;
}

/**
 * Read every file into memory and build a FileSet, unpacking ZIP archives
 * (openFiles.ts). Nothing leaves the machine.
 */
export async function fileSetFromBrowser(files: readonly PathedFile[]): Promise<OpenedFiles> {
  const read = await Promise.all(
    files.map(async ({ file, path }) => ({ path, bytes: new Uint8Array(await file.arrayBuffer()) })),
  );
  return openFiles(read);
}

function readAllEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => {
    const all: FileSystemEntry[] = [];
    // readEntries returns results in batches; call until it returns none.
    const next = () =>
      reader.readEntries((batch) => {
        if (batch.length === 0) resolve(all);
        else {
          all.push(...batch);
          next();
        }
      }, reject);
    next();
  });
}

async function walk(entry: FileSystemEntry, out: PathedFile[]): Promise<void> {
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) =>
      (entry as FileSystemFileEntry).file(resolve, reject),
    );
    out.push({ file, path: entry.fullPath.replace(/^\/+/, "") || file.name });
  } else if (entry.isDirectory) {
    const children = await readAllEntries((entry as FileSystemDirectoryEntry).createReader());
    for (const child of children) await walk(child, out);
  }
}

/**
 * Collect the files of a drop, descending into dropped folders. Must be
 * called synchronously inside the drop handler: the DataTransfer is
 * emptied once the event returns, so entries are taken before any await.
 */
export function filesFromDataTransfer(dt: DataTransfer): Promise<PathedFile[]> {
  const entries: FileSystemEntry[] = [];
  for (const item of Array.from(dt.items ?? [])) {
    if (item.kind !== "file") continue;
    const entry = item.webkitGetAsEntry?.();
    if (entry) entries.push(entry);
  }
  if (entries.length === 0) {
    return Promise.resolve(Array.from(dt.files).map((file) => ({ file, path: pathOf(file) })));
  }
  return (async () => {
    const out: PathedFile[] = [];
    for (const entry of entries) await walk(entry, out);
    return out;
  })();
}
