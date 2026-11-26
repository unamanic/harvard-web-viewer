import { useRef } from "react";
import type { ViewBox } from "../model/scene";
import { type ExportChoice, exportChoices } from "../ui/exportImage";
import { useDismissableDetails } from "../ui/hooks";

export interface ExportMenuProps {
  /** Page shape of the slide shown, or null when there is no picture to export. */
  viewBox: ViewBox | null;
  onExport: (choice: ExportChoice) => void;
  /** Offered for shows: "Video…" opens the video export dialog. */
  onExportVideo?: () => void;
  /** Button text; defaults to "Export PNG / SVG" (or "Export" when video is offered). */
  label?: string;
  className?: string;
}

/** "Export": a small menu of the picture formats and sizes for the slide shown, and video for a show. */
export function ExportMenu({ viewBox, onExport, onExportVideo, label, className = "" }: ExportMenuProps) {
  const ref = useRef<HTMLDetailsElement>(null);
  useDismissableDetails(ref);
  const text = label ?? (onExportVideo ? "Export" : "Export PNG / SVG");
  if (!viewBox && !onExportVideo) {
    return (
      <button type="button" className={`button ${className}`} disabled title="Nothing to export on this slide">
        {text}
      </button>
    );
  }
  const close = () => {
    if (ref.current) ref.current.open = false;
  };
  return (
    <details
      ref={ref}
      className={`menu ${className}`}
    >
      <summary className="button">
        {text}
      </summary>
      <div className="menu-panel" role="group" aria-label={onExportVideo ? "Export the slide shown or the show" : "Export the slide shown"}>
        {viewBox ? (
          exportChoices(viewBox).map((choice) => (
            <button
              key={choice.id}
              type="button"
              onClick={() => {
                close();
                onExport(choice);
              }}
            >
              {choice.label}
            </button>
          ))
        ) : (
          <p className="menu-note">No picture on this slide to save as PNG or SVG.</p>
        )}
        {onExportVideo && (
          <button
            type="button"
            className="menu-separated"
            aria-haspopup="dialog"
            onClick={() => {
              close();
              onExportVideo();
            }}
          >
            Video… <span className="muted">(the whole show, WebM or MP4)</span>
          </button>
        )}
      </div>
    </details>
  );
}
