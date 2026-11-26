import type { Presentation } from "./presentation";
import type { Scene } from "./scene";

/** A parsed file: one or more scenes (slides) plus informational metadata. */
export interface Document {
  formatName: string;
  scenes: Scene[];
  /** Non-fatal problems met while decoding (damaged or partial data). */
  warnings: string[];
  /**
   * Set when the file is a slide show (e.g. a Harvard Graphics .SH3): the
   * viewer then plays it instead of listing `scenes` (which may be empty).
   */
  presentation?: Presentation;
}
