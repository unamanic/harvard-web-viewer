import { detectFormat } from "./formats/registry";
import type { Document } from "./formats/types";

/** Everything the UI needs to know about a file the user opened. */
export interface LoadedFile {
  name: string;
  bytes: Uint8Array;
  /** Parser name, or null if no parser recognised the file. */
  formatName: string | null;
  document: Document | null;
  /** Set when the file was recognised but could not be decoded. */
  error: string | null;
}

/** Read a File in the browser and run it through detection + parsing. */
export async function loadFile(file: File): Promise<LoadedFile> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const detection = detectFormat(bytes, file.name);
  const base = { name: file.name, bytes };
  if (!detection) {
    return { ...base, formatName: null, document: null, error: null };
  }
  try {
    const document = detection.parser.parse(bytes, file.name);
    return { ...base, formatName: detection.parser.name, document, error: null };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return { ...base, formatName: detection.parser.name, document: null, error };
  }
}
