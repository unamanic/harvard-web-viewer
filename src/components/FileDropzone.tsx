import { useState, type DragEvent } from "react";

interface Props {
  onFile: (file: File) => void;
}

/** Drag-and-drop target with a click-to-browse fallback. Files stay local. */
export function FileDropzone({ onFile }: Props) {
  const [over, setOver] = useState(false);

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const file = e.dataTransfer.files[0];
    if (file) onFile(file);
  };

  return (
    <label
      className={`dropzone${over ? " over" : ""}`}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
    >
      <span>Drop a Harvard Graphics file here, or click to browse</span>
      <input
        type="file"
        hidden
        onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
      />
    </label>
  );
}
