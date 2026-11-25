import type { ReactNode } from "react";
import type { PathedFile } from "../files/fromBrowser";
import type { Diagnostics } from "../ui/diagnostics";
import type { AboutRow } from "../ui/fileFacts";
import { noticeItems, noticeTitle } from "../ui/notice";
import { DiagnosticsPanel } from "./DiagnosticsPanel";
import { FileInputButton } from "./FileDropzone";

/** Items of the notice shown before "Show all". */
const NOTICE_SHOWN = 3;

/** The key/value list of "About this file". */
export function AboutRows({ rows }: { rows: readonly AboutRow[] }) {
  return (
    <dl className="about-rows">
      {rows.map((row) => (
        <div key={row.label} className="about-row">
          <dt>{row.label}</dt>
          <dd>
            {row.value.map((line, i) => (
              <span key={i} className="about-line">
                {line}
              </span>
            ))}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * "N things to know": the diagnostics in plain words (the first few), then
 * every detail behind "Show all". Without anything to say in plain words,
 * only the "Show all" toggle remains (when there are raw details at all).
 */
export function NoticeBox({ diagnostics, path }: { diagnostics: Diagnostics; path: string }) {
  const items = noticeItems(diagnostics);
  if (items.length === 0) {
    return diagnostics.count > 0 ? (
      <div className="notice-quiet">
        <DiagnosticsPanel diagnostics={diagnostics} path={path} summary="Decoding notes" />
      </div>
    ) : null;
  }
  const shown = items.slice(0, NOTICE_SHOWN);
  return (
    <section className="notice" aria-labelledby="notice-title">
      <h3 id="notice-title" className="notice-title">
        {noticeTitle(items.length)}
      </h3>
      {shown.length === 1 ? (
        <p className="notice-text">{shown[0]}</p>
      ) : (
        <ul className="notice-list">
          {shown.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      )}
      {items.length > NOTICE_SHOWN && (
        <p className="notice-more">
          and {items.length - NOTICE_SHOWN} more.
        </p>
      )}
      <DiagnosticsPanel diagnostics={diagnostics} path={path} />
    </section>
  );
}

export interface AboutPanelProps {
  rows: readonly AboutRow[];
  diagnostics: Diagnostics;
  path: string;
  /** Add files to the set open and show this file again with them (shown when files are missing). */
  onAddFiles?: (files: PathedFile[]) => void;
  /** A note after adding files ("Added LOGO.PCX."). */
  addNote?: string | null;
  /** The Display settings section. */
  settings?: ReactNode;
  onShowRawBytes: () => void;
  /** Problems shown above the rows (e.g. the file could not be decoded). */
  alert?: ReactNode;
}

/** The right column: "About this file", the notice, "Add missing files…", Display, privacy and raw bytes. */
export function AboutPanel({ rows, diagnostics, path, onAddFiles, addNote, settings, onShowRawBytes, alert }: AboutPanelProps) {
  const missing = diagnostics.missing.length > 0;
  return (
    <aside className="about" id="about" aria-labelledby="about-title">
      <h2 id="about-title" className="about-title">
        About this file
      </h2>
      {alert}
      <AboutRows rows={rows} />
      <NoticeBox diagnostics={diagnostics} path={path} />
      {missing && onAddFiles && (
        <FileInputButton onFiles={onAddFiles} className="button button-block">
          Add missing files…
        </FileInputButton>
      )}
      {addNote && (
        <p className="about-note" role="status">
          {addNote}
        </p>
      )}
      {settings}
      <p className="about-privacy">
        Your file is read in this browser tab and never leaves your computer.{" "}
        <button type="button" className="link" onClick={onShowRawBytes}>
          Show raw bytes
        </button>
      </p>
    </aside>
  );
}
