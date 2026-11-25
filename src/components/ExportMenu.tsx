import { useRef } from "react";
import type { ViewBox } from "../formats/types";
import { type ExportChoice, exportChoices } from "../ui/exportImage";
import { useDismissableDetails } from "../ui/hooks";

export interface ExportMenuProps {
  /** Page shape of the slide shown, or null when there is nothing to export. */
  viewBox: ViewBox | null;
  onExport: (choice: ExportChoice) => void;
  /** Button text; defaults to "Export PNG / SVG". */
  label?: string;
  className?: string;
}

/** "Export PNG / SVG": a small menu of the formats and sizes offered for the slide shown. */
export function ExportMenu({ viewBox, onExport, label = "Export PNG / SVG", className = "" }: ExportMenuProps) {
  const ref = useRef<HTMLDetailsElement>(null);
  useDismissableDetails(ref);
  if (!viewBox) {
    return (
      <button type="button" className={`button ${className}`} disabled title="Nothing to export on this slide">
        {label}
      </button>
    );
  }
  return (
    <details
      ref={ref}
      className={`menu ${className}`}
    >
      <summary className="button">
        {label}
      </summary>
      <div className="menu-panel" role="group" aria-label="Export the slide shown">
        {exportChoices(viewBox).map((choice) => (
          <button
            key={choice.id}
            type="button"
            onClick={() => {
              if (ref.current) ref.current.open = false;
              onExport(choice);
            }}
          >
            {choice.label}
          </button>
        ))}
      </div>
    </details>
  );
}
