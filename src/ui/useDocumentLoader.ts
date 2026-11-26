/** React side of DocumentLoader (documentLoader.ts): its state, re-rendered on every change. */
import { useEffect, useRef, useState } from "react";
import type { LoadOptions, LoadedFile } from "../files/loadFile";
import { type PathedFile, fileSetFromBrowser } from "../files/fromBrowser";
import { DocumentLoader, type LoaderState } from "./documentLoader";

/** `options` gives the parse options at the time of each load. */
export function useDocumentLoader(
  initialFile: LoadedFile | null,
  options: () => LoadOptions,
): LoaderState & { loader: DocumentLoader<PathedFile[]> } {
  // Loads start from events, after the render that set the options has committed.
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });
  const [loader] = useState(
    () => new DocumentLoader<PathedFile[]>(fileSetFromBrowser, () => optionsRef.current(), (s) => setState(s), initialFile),
  );
  const [state, setState] = useState<LoaderState>(loader.current);
  return { ...state, loader };
}
