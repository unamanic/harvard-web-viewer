import { useState } from "react";
import { FileDropzone } from "./components/FileDropzone";
import { Viewer } from "./components/Viewer";
import { loadFile, type LoadedFile } from "./loadFile";

export function App() {
  const [file, setFile] = useState<LoadedFile | null>(null);

  return (
    <main>
      <h1>Harvard Web Viewer</h1>
      <p>View old Harvard Graphics files in your browser. Nothing is uploaded.</p>
      <FileDropzone onFile={async (f) => setFile(await loadFile(f))} />
      {file && <Viewer file={file} />}
    </main>
  );
}
