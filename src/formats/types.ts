/**
 * Core types shared by every file-format parser and the renderer.
 *
 * The design goal is a strict separation of concerns:
 *   bytes --(FormatParser)--> Scene --(SceneRenderer)--> pixels
 * Parsers know nothing about React; the renderer knows nothing about file
 * formats. Adding a format means adding one parser module and registering it.
 */

/** A drawable element. Coordinates are in scene units (see `Scene`). */
export type SceneElement =
  | { kind: "text"; x: number; y: number; text: string; size: number; color: string }
  | { kind: "rect"; x: number; y: number; width: number; height: number; fill: string }
  | { kind: "line"; x1: number; y1: number; x2: number; y2: number; color: string };

/** A single page/slide/chart in the format-independent model. */
export interface Scene {
  /** Logical canvas size. DOS Harvard Graphics targeted 640x350/480 displays. */
  width: number;
  height: number;
  background: string;
  elements: SceneElement[];
}

/** A parsed file: one or more scenes (slides) plus informational metadata. */
export interface Document {
  formatName: string;
  scenes: Scene[];
}

/** How sure a parser is that it can handle a file. 0 = no, 1 = certain. */
export type Confidence = number;

export interface FormatParser {
  /** Stable identifier, e.g. "hg-dos". */
  id: string;
  /** Human-readable name shown in the UI. */
  name: string;
  /** Inspect the file and report how likely this parser can read it. */
  detect(bytes: Uint8Array, filename: string): Confidence;
  /** Decode the file. Throw `UnsupportedFormatError` if not (yet) possible. */
  parse(bytes: Uint8Array, filename: string): Document;
}

/** Thrown when a file is recognised but cannot be decoded yet. */
export class UnsupportedFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedFormatError";
  }
}
