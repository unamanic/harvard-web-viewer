/**
 * Running a video export for the export dialog (components/VideoExportDialog):
 * the steps (options, running with progress, done with a download link, or
 * an error), Cancel, and clean-up. The encoders load on first use.
 */
import { type RefObject, useEffect, useRef, useState } from "react";
import type { Presentation } from "../model/presentation";
import type { ResolveFile } from "../player/sound/controller";
import type { TransitionMode } from "../player/transitions/mode";
import type { DisplayMode } from "../render/displayMode";
import type { Progress } from "../video/encode";
import { type VideoOptions, videoFileName } from "../video/options";

export type VideoExportPhase =
  | { kind: "options" }
  | { kind: "running"; progress: Progress | null }
  | { kind: "done"; url: string; name: string; bytes: number; notes: string[] }
  | { kind: "error"; message: string };

export const loadVideo = () => import("../video/index");

export interface VideoExportRun {
  phase: VideoExportPhase;
  /** Start an export with these options. */
  start: (options: VideoOptions) => Promise<void>;
  /** Stop a running export and go back to the options. */
  cancel: () => void;
  /** Back to the options (from done or error). */
  back: () => void;
  /** Stop a running export (before closing). */
  abort: () => void;
}

/**
 * `previewHost` is kept mounted while an export runs: the real-time
 * recorder draws its canvas there. A running export stops when the
 * component unmounts; the download link's blob is freed when the dialog
 * closes or a new export starts.
 */
export function useVideoExport(params: {
  presentation: Presentation;
  fileName: string;
  transitionMode: TransitionMode;
  displayMode: DisplayMode;
  resolveFile?: ResolveFile;
  previewHost: RefObject<HTMLElement | null>;
}): VideoExportRun {
  const [phase, setPhase] = useState<VideoExportPhase>({ kind: "options" });
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const doneUrl = phase.kind === "done" ? phase.url : null;
  useEffect(() => {
    if (!doneUrl) return;
    return () => URL.revokeObjectURL(doneUrl);
  }, [doneUrl]);

  const start = async (options: VideoOptions) => {
    const controller = new AbortController();
    abortRef.current = controller;
    setPhase({ kind: "running", progress: null });
    try {
      const { exportVideo } = await loadVideo();
      const result = await exportVideo({
        presentation: params.presentation,
        options,
        transitionMode: params.transitionMode,
        displayMode: params.displayMode,
        resolveFile: params.resolveFile,
        previewHost: params.previewHost.current,
        signal: controller.signal,
        onProgress: (progress) => setPhase((p) => (p.kind === "running" ? { kind: "running", progress } : p)),
      });
      if (controller.signal.aborted) return;
      setPhase({
        kind: "done",
        url: URL.createObjectURL(result.blob),
        name: videoFileName(params.fileName, result.format),
        bytes: result.blob.size,
        notes: result.notes,
      });
    } catch (e) {
      if (controller.signal.aborted) {
        setPhase({ kind: "options" });
        return;
      }
      setPhase({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  };

  const abort = () => abortRef.current?.abort();
  const cancel = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setPhase({ kind: "options" });
  };
  const back = () => setPhase({ kind: "options" });

  return { phase, start, cancel, back, abort };
}
