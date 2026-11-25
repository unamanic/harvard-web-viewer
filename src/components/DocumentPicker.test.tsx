import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { FileEntry } from "../files/FileSet";
import { DocumentPicker, pickerSummary } from "./DocumentPicker";

const entry = (path: string, sig: string): FileEntry => ({
  path,
  name: path.slice(path.lastIndexOf("/") + 1),
  bytes: new TextEncoder().encode(sig),
});
const shows = [entry("Pack.zip/A/SALES.SH3", "HGB1"), entry("Pack.zip/B/TRAINING.SH3", "HGB1")];

describe("DocumentPicker", () => {
  it("lists each choice as a button with its kind and folder, plus Cancel", () => {
    const html = renderToStaticMarkup(<DocumentPicker choices={shows} onPick={() => {}} onCancel={() => {}} />);
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain("Choose what to open");
    expect(html).toContain("The archive holds 2 shows.");
    expect(html).toContain('<span class="picker-name">SALES.SH3</span>');
    expect(html).toContain("Show · Pack.zip/A");
    expect(html).toContain("TRAINING.SH3");
    expect(html.match(/class="picker-item"/g)).toHaveLength(2);
    expect(html).toContain(">Cancel</button>");
  });

  it("summarises the choices", () => {
    expect(pickerSummary(shows)).toBe("2 shows");
    expect(pickerSummary([entry("X.CH3", "HGB3")])).toBe("1 chart");
    expect(pickerSummary([shows[0]!, entry("X.CH3", "HGB3"), entry("Y.CH3", "HGB3")])).toBe("1 show and 2 charts");
  });
});
