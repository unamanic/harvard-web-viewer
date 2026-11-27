import { type ChangeEvent, type DragEvent, Fragment, type ReactNode, useRef, useState } from "react";
import { filesFromDataTransfer, pathOf, type PathedFile } from "../files/fromBrowser";
import { useDismissableDetails } from "../ui/hooks";

type OnFiles = (files: PathedFile[]) => void;

/**
 * Drag-and-drop of files and whole folders onto an element. Returns whether
 * something is dragged over it and the handlers to spread on it.
 */
export function useFileDrop(onFiles: OnFiles) {
  const [over, setOver] = useState(false);
  // dragenter/dragleave fire for every child; count them.
  const depth = useRef(0);
  const handlers = {
    onDragEnter: (e: DragEvent) => {
      if (!e.dataTransfer.types.includes("Files")) return;
      e.preventDefault();
      depth.current++;
      setOver(true);
    },
    onDragOver: (e: DragEvent) => {
      if (!e.dataTransfer.types.includes("Files")) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    },
    onDragLeave: () => {
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setOver(false);
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      depth.current = 0;
      setOver(false);
      // Take the entries synchronously; the DataTransfer empties after the event.
      void filesFromDataTransfer(e.dataTransfer).then((files) => {
        if (files.length > 0) onFiles(files);
      });
    },
  };
  return { over, handlers };
}

/** Files chosen in a file input, with their paths; the input is cleared so the same files can be chosen again. */
function chosenFiles(e: ChangeEvent<HTMLInputElement>): PathedFile[] {
  const files = Array.from(e.target.files ?? []).map((file) => ({ file, path: pathOf(file) }));
  e.target.value = "";
  return files;
}

export interface FileInputButtonProps {
  onFiles: OnFiles;
  children: ReactNode;
  className?: string;
  /** Choose a whole folder instead of files. */
  folder?: boolean;
  /** Accessible name when it differs from the text. */
  ariaLabel?: string;
}

/** A file input styled as a button (the label is the button; the input is visually hidden but focusable). */
export function FileInputButton({ onFiles, children, className = "button", folder = false, ariaLabel }: FileInputButtonProps) {
  return (
    <label className={className}>
      {children}
      <input
        type="file"
        multiple={!folder}
        className="visually-hidden"
        aria-label={ariaLabel}
        ref={
          folder
            ? (el) => {
                el?.setAttribute("webkitdirectory", "");
              }
            : undefined
        }
        onChange={(e) => {
          const files = chosenFiles(e);
          if (files.length > 0) onFiles(files);
        }}
      />
    </label>
  );
}

/**
 * The header's "Open a file" button, with a small menu beside it to open a
 * whole folder instead. On phones it reads "Open" (CSS).
 */
export function OpenButton({ onFiles }: { onFiles: OnFiles }) {
  const more = useRef<HTMLDetailsElement>(null);
  useDismissableDetails(more);
  return (
    <span className="open-button">
      <FileInputButton onFiles={onFiles} className="button button-primary open-files" ariaLabel="Open a file">
        <span className="open-long">Open a file</span>
        <span className="open-short" aria-hidden="true">
          Open
        </span>
      </FileInputButton>
      <details ref={more} className="menu open-more">
        <summary className="button button-primary" aria-label="More ways to open">
          <span aria-hidden="true">▾</span>
        </summary>
        <div className="menu-panel">
          <FileInputButton
            onFiles={(files) => {
              if (more.current) more.current.open = false;
              onFiles(files);
            }}
            folder
            className="menu-item"
          >
            Open a folder…
          </FileInputButton>
          <p className="menu-note">Or drop files or a folder anywhere on this page.</p>
        </div>
      </details>
    </span>
  );
}

/** What the viewer opens, by kind (the empty state and the help panel). */
export const SUPPORTED_FILES: readonly { kind: string; extensions: string[] }[] = [
  { kind: "charts", extensions: [".CH3", ".CHT"] },
  { kind: "shows", extensions: [".SH3", ".SHW"] },
  { kind: "palettes", extensions: [".PL3", ".PC3"] },
  { kind: "fonts", extensions: [".SPD", ".FN3"] },
  { kind: "bitmaps", extensions: [".PCX", ".PCC"] },
  { kind: "sounds", extensions: [".WAV", ".MID"] },
  { kind: "archives", extensions: [".ZIP"] },
];

/** "Supported files": a small in-app help panel in the header. */
export function SupportedFilesHelp() {
  const ref = useRef<HTMLDetailsElement>(null);
  useDismissableDetails(ref);
  return (
    <details ref={ref} className="menu help">
      <summary className="header-link">Supported files</summary>
      <div className="menu-panel help-panel">
        <p>Harvard Graphics for DOS files:</p>
        <ul>
          <li>
            Harvard Graphics 3 (checked against 3.05): <strong>.SH3</strong> slide shows play with their transitions,
            keys and buttons, and <strong>.CH3</strong> charts are drawn on their own.
          </li>
          <li>
            Harvard Presentation Graphics 1.0 and Harvard Graphics 2.10, 2.12 and 2.30: <strong>.SHW</strong> slide
            shows play in order with their timing and effects, and <strong>.CHT</strong> charts are laid out from their
            data.
          </li>
          <li>
            <strong>.PL3</strong> and <strong>.PC3</strong> palettes, <strong>.SPD</strong> and <strong>.FN3</strong>{" "}
            fonts and <strong>.PCX</strong> / <strong>.PCC</strong> bitmaps are used by the charts that name them;{" "}
            <strong>.WAV</strong> sounds and <strong>.MID</strong> music (played as an FM sound card of the time
            would) by the shows that play them.
          </li>
        </ul>
        <p className="muted">
          Open the whole folder a show lives in, or a <strong>.ZIP</strong> of it, so the files it names are found.
        </p>
        <p className="muted">Harvard Graphics for Windows files are not supported.</p>
      </div>
    </details>
  );
}

/**
 * The empty state (first visit): what the viewer is for, buttons to choose
 * files or a folder, the privacy promise and a large drop target. Dropping
 * works anywhere on the page (the app shell handles it); `over` styles the
 * drop target meanwhile.
 */
export function EmptyState({ onFiles, over = false, status }: { onFiles: OnFiles; over?: boolean; status?: ReactNode }) {
  return (
    <section className="empty" aria-labelledby="empty-title">
      <div className="empty-intro">
        <h1 id="empty-title" className="empty-title">
          Open a chart
          <br />
          from 1986 to 1992.
        </h1>
        <p className="empty-lead">
          Harvard Graphics for DOS saved millions of charts and slide shows that almost nothing can open today. Drop one
          here and see it again.
        </p>
        <p className="empty-versions">
          Opens charts and shows from Harvard Graphics 3 (checked against 3.05), Harvard Presentation Graphics 1.0 and
          Harvard Graphics 2.10, 2.12 and 2.30.
        </p>
        <div className="empty-buttons">
          <FileInputButton onFiles={onFiles} className="button button-primary button-large">
            Choose files…
          </FileInputButton>
          <FileInputButton onFiles={onFiles} folder className="button button-large">
            Choose a folder…
          </FileInputButton>
        </div>
        {status}
        <p className="empty-privacy">
          Files are read inside this browser tab. Nothing is uploaded.
          <br />
          Charts often use a palette, fonts or images stored in other files, so drop the whole folder (or a .zip of it) if
          you have it.
        </p>
      </div>
      <div className={`dropzone${over ? " over" : ""}`}>
        <svg
          width="64"
          height="64"
          viewBox="0 0 64 64"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className="dropzone-icon"
        >
          <path d="M32 44V12M20 24l12-12 12 12" />
          <path d="M10 40v10a4 4 0 004 4h36a4 4 0 004-4V40" />
        </svg>
        <p className="dropzone-title">Drop files or a folder here</p>
        <p className="dropzone-kinds">
          Looks for{" "}
          {/* The space between kinds sits outside the nowrap groups so the
              line can wrap between kinds (but never inside one). */}
          {SUPPORTED_FILES.map(({ kind, extensions }, i) => (
            <Fragment key={kind}>
              {i > 0 ? " " : ""}
              <span className="dropzone-kind">
                {kind}{" "}
                {extensions.map((ext, j) => (
                  <span key={ext}>
                    {j > 0 ? " / " : ""}
                    <b>{ext}</b>
                  </span>
                ))}
              </span>
            </Fragment>
          ))}
        </p>
        <p className="dropzone-paste">Paste from clipboard · Ctrl+V</p>
      </div>
    </section>
  );
}
