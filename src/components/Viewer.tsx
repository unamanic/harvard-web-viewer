import type { LoadedFile } from "../loadFile";
import { SceneRenderer } from "../render/SceneRenderer";
import { HexInspector } from "./HexInspector";

/** Shows the result of loading a file: slides if decoded, else diagnostics. */
export function Viewer({ file }: { file: LoadedFile }) {
  return (
    <div>
      <h2>{file.name}</h2>
      <p>
        {file.formatName ? `Detected: ${file.formatName}` : "Format not recognised."}
      </p>
      {file.error && <p className="error">{file.error}</p>}
      {file.document?.scenes.map((scene, i) => (
        <SceneRenderer key={i} scene={scene} />
      ))}
      <HexInspector bytes={file.bytes} />
    </div>
  );
}
