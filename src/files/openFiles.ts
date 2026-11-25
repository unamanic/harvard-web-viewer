/**
 * The files a user opened, with any ZIP archives among them unpacked in
 * place, and which document to open first.
 *
 * An archive's files join the set under the archive's own path
 * ("SALES.ZIP/SHOW/SALES.SH3"), so references resolve inside it like inside
 * a folder (FileSet.find prefers the same folder, then any match). When the
 * archives hold more than one document to start from, the viewer asks which
 * (`choices`); see `documentChoices`.
 */
import { type FileEntry, FileSet } from "./FileSet";
import { fileGroupKind } from "../ui/fileGroups";
import { ZipError, isZipName, looksLikeZip, readZip } from "./zip";

export interface OpenedFiles {
  fileSet: FileSet;
  /**
   * Documents from the opened archives to start from. More than one: ask
   * the user. One: open it. None (no archive, or no show or chart in it):
   * open the set's primary file as usual.
   */
  choices: FileEntry[];
}

/** Whether a file is a ZIP archive to unpack: by its .zip name, or by its contents. */
function isArchive(path: string, bytes: Uint8Array): boolean {
  return isZipName(path) || looksLikeZip(bytes);
}

/**
 * Where to start in the opened archives: their shows, or if they hold no
 * show, their charts (by signature, else extension, as the file list
 * groups them). A show's charts are its slides, so one show with all
 * its charts opens straight away; several shows, or several loose charts,
 * are offered as a choice. In set order (by path).
 */
export function documentChoices(fileSet: FileSet, archives: readonly string[]): FileEntry[] {
  if (archives.length === 0) return [];
  const prefixes = archives.map((a) => a.toLowerCase() + "/");
  const inArchive = fileSet.entries().filter((e) => prefixes.some((p) => e.path.toLowerCase().startsWith(p)));
  const shows = inArchive.filter((e) => fileGroupKind(e.name, e.bytes) === "show");
  return shows.length > 0 ? shows : inArchive.filter((e) => fileGroupKind(e.name, e.bytes) === "chart");
}

/**
 * Build the set from the opened files, unpacking ZIP archives (not archives
 * inside archives). Entries an archive could not give up, and archives that
 * could not be read at all, are noted in `fileSet.notes`.
 */
export async function openFiles(files: readonly { path: string; bytes: Uint8Array }[]): Promise<OpenedFiles> {
  const entries: { path: string; bytes: Uint8Array }[] = [];
  const notes: string[] = [];
  const archives: string[] = [];
  for (const f of files) {
    if (!isArchive(f.path, f.bytes)) {
      entries.push(f);
      continue;
    }
    const where = f.path.replace(/\\/g, "/").replace(/^\/+/, "");
    try {
      const zip = await readZip(f.bytes);
      archives.push(where);
      for (const e of zip.entries) entries.push({ path: `${where}/${e.path}`, bytes: e.bytes });
      for (const w of zip.warnings) notes.push(`${where}: ${w}`);
      if (zip.entries.length === 0) notes.push(`${where} holds no files that could be read.`);
    } catch (e) {
      const why = e instanceof ZipError ? e.message : e instanceof Error ? e.message : String(e);
      notes.push(`${where} could not be opened: ${why}.`);
      // Keep the file itself, so it can still be looked at in the hex view.
      entries.push(f);
    }
  }
  const fileSet = new FileSet(entries);
  fileSet.notes.push(...notes);
  return { fileSet, choices: documentChoices(fileSet, archives) };
}
