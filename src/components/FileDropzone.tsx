import { type ChangeEvent, type DragEvent, useRef, useState } from "react";
import { filesFromDataTransfer, pathOf, type PathedFile } from "../files/fromBrowser";

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

/** "Choose files" and "Choose folder" buttons (file inputs styled as buttons). */
export function FilePickers({ onFiles, compact = false }: { onFiles: OnFiles; compact?: boolean }) {
  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []).map((file) => ({ file, path: pathOf(file) }));
    e.target.value = "";
    if (files.length > 0) onFiles(files);
  };
  return (
    <span className="file-pickers">
      <label className={`button${compact ? "" : " button-primary"}`}>
        {compact ? "Open files" : "Choose files"}
        <input type="file" multiple className="visually-hidden" onChange={onChange} />
      </label>
      <label className="button">
        {compact ? "Open folder" : "Choose folder"}
        <input
          type="file"
          className="visually-hidden"
          ref={(el) => {
            el?.setAttribute("webkitdirectory", "");
          }}
          onChange={onChange}
        />
      </label>
    </span>
  );
}

/**
 * The large drop target of the empty state: explains what the viewer opens,
 * with buttons to choose files or a folder. Dropping works anywhere on the
 * page (the app shell handles it); `over` styles this box meanwhile.
 */
export function FileDropzone({ onFiles, over = false }: { onFiles: OnFiles; over?: boolean }) {
  return (
    <section className={`dropzone${over ? " over" : ""}`} aria-labelledby="dropzone-title">
      <h2 id="dropzone-title">Open Harvard Graphics 3 files</h2>
      <p>Drop files or a whole folder anywhere on this page, or choose them:</p>
      <p className="dropzone-buttons">
        <FilePickers onFiles={onFiles} />
      </p>
      <ul className="dropzone-list">
        <li>
          <strong>.SH3</strong> slide shows play with their transitions, keys and buttons.
        </li>
        <li>
          <strong>.CH3</strong> charts are drawn on their own.
        </li>
        <li>
          <strong>.PL3</strong> and <strong>.PC3</strong> palettes can be opened too.
        </li>
      </ul>
      <p>
        Drop the <strong>whole folder</strong> a show lives in, so the palettes, fonts and bitmaps it names are found.
      </p>
      <p className="privacy">
        Everything happens in your browser: files are read on this computer and never uploaded.
      </p>
    </section>
  );
}
