/**
 * "Export → Video…" for a show: options, the estimate, then the export with
 * a progress bar, Cancel, and a download link. Everything happens in this
 * tab. Loaded on demand (React.lazy in Viewer); the encoders and muxers
 * load when the dialog first asks what the browser supports.
 */
import { type KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import type { Presentation } from "../formats/types";
import type { DisplayMode } from "../render/displayMode";
import type { ResolveFile } from "../player/sound/controller";
import { TRANSITION_MODES, type TransitionMode } from "../player/transitions/mode";
import type { Progress } from "../video/encode";
import type { Support } from "../video/index";
import {
  FPS,
  MAX_WAIT_SECONDS,
  VIDEO_WIDTHS,
  type VideoFormat,
  type VideoOptions,
  clampWaitSeconds,
  defaultVideoOptions,
  estimate,
  formatDuration,
  timelineFor,
  videoFileName,
  videoSize,
} from "../video/options";

export interface VideoExportDialogProps {
  presentation: Presentation;
  /** The show's file name (e.g. "SALES93.SH3"): the video is named after it. */
  fileName: string;
  displayMode: DisplayMode;
  transitionMode: TransitionMode;
  resolveFile?: ResolveFile;
  onClose: () => void;
}

type Phase =
  | { kind: "options" }
  | { kind: "running"; progress: Progress | null }
  | { kind: "done"; url: string; name: string; bytes: number; notes: string[] }
  | { kind: "error"; message: string };

const loadVideo = () => import("../video/index");

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function formatBytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function VideoExportDialog({ presentation, fileName, displayMode, transitionMode, resolveFile, onClose }: VideoExportDialogProps) {
  const titleId = useId();
  const ref = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  // "Include transitions" uses the Transitions setting; with the setting Off it means the show's own.
  const mode: TransitionMode = transitionMode === "off" ? "file" : transitionMode;
  const modeLabel = TRANSITION_MODES.find((m) => m.mode === mode)?.label ?? mode;

  const soundCount = useMemo(
    () => estimate(timelineFor(presentation, { waitSeconds: 5, transitions: false }, "off"), resolveFile).sounds,
    [presentation, resolveFile],
  );
  const [options, setOptions] = useState<VideoOptions>(() => defaultVideoOptions(transitionMode, soundCount > 0));
  const [waitText, setWaitText] = useState(String(options.waitSeconds));
  const [phase, setPhase] = useState<Phase>({ kind: "options" });
  const [support, setSupport] = useState<Support | null>(null);
  const [supportError, setSupportError] = useState<string | null>(null);

  const timeline = useMemo(() => timelineFor(presentation, options, mode), [presentation, options, mode]);
  const est = useMemo(() => estimate(timeline, resolveFile), [timeline, resolveFile]);
  const viewBox = timeline.pictures[0]?.scene()?.viewBox ?? null;
  const sizes = VIDEO_WIDTHS.map((w) => ({ width: w, size: viewBox ? videoSize(w, viewBox) : { width: w, height: (w * 3) / 4 } }));

  // What the browser can encode (checked once, at the larger size).
  useEffect(() => {
    let live = true;
    const big = sizes[sizes.length - 1].size;
    loadVideo()
      .then((m) => m.detectSupport(big.width, big.height))
      .then((s) => live && setSupport(s))
      .catch((e: unknown) => live && setSupportError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
    // Checked once per dialog.
  }, []);

  // Focus the dialog; give focus back when it closes; stop a running export.
  useEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    ref.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    return () => {
      abortRef.current?.abort();
      // "Video…" sits in the Export menu, closed by now: its summary takes the focus back.
      const target = before?.closest("details")?.querySelector<HTMLElement>("summary") ?? before;
      target?.focus?.();
    };
  }, []);

  // Each step's first control takes the focus (the button pressed has gone).
  const phaseKind = phase.kind;
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const target = ref.current?.querySelector<HTMLElement>(phaseKind === "done" ? "a[download]" : FOCUSABLE);
    target?.focus();
  }, [phaseKind]);

  // The download link's blob is freed when the dialog closes or a new export starts.
  const doneUrl = phase.kind === "done" ? phase.url : null;
  useEffect(() => {
    if (!doneUrl) return;
    return () => URL.revokeObjectURL(doneUrl);
  }, [doneUrl]);

  const formatSupport = support?.[options.format] ?? null;
  const mp4Offered = support?.mp4.method != null;
  const canStart = est.slides > 0 && (support === null ? false : formatSupport?.method != null);

  const update = (patch: Partial<VideoOptions>) => setOptions((o) => ({ ...o, ...patch }));

  const start = async () => {
    const controller = new AbortController();
    abortRef.current = controller;
    setPhase({ kind: "running", progress: null });
    try {
      const { exportVideo } = await loadVideo();
      const result = await exportVideo({
        presentation,
        options,
        transitionMode: mode,
        displayMode,
        resolveFile,
        previewHost: previewRef.current,
        signal: controller.signal,
        onProgress: (progress) => setPhase((p) => (p.kind === "running" ? { kind: "running", progress } : p)),
      });
      if (controller.signal.aborted) return;
      setPhase({
        kind: "done",
        url: URL.createObjectURL(result.blob),
        name: videoFileName(fileName, result.format),
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

  const cancel = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setPhase({ kind: "options" });
  };

  const close = () => {
    abortRef.current?.abort();
    onClose();
  };

  // Esc closes (cancelling an export); Tab stays inside the dialog.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      e.preventDefault();
      close();
      return;
    }
    if (e.key !== "Tab" || !ref.current) return;
    const items = Array.from(ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null || el === document.activeElement);
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const notes: string[] = [];
  if (est.midi.length) notes.push(`MIDI music (${est.midi.join(", ")}) is skipped: the viewer has no MIDI synthesizer.`);
  if (est.missing.length) notes.push(`Missing sound: ${est.missing.join(", ")}.`);
  if (options.sound && soundCount > 0 && formatSupport && !formatSupport.audio)
    notes.push(`This browser cannot encode sound for ${options.format === "mp4" ? "MP4" : "WebM"}: the video will have no sound.`);
  if (formatSupport?.method === "recorder")
    notes.push("This browser records in real time: the export takes as long as the video. Keep this tab visible.");

  const running = phase.kind === "running";
  const progress = running ? phase.progress : null;

  return (
    <div className="dialog-backdrop" onClick={(e) => e.target === e.currentTarget && !running && close()}>
      <div ref={ref} className="dialog video-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={onKeyDown}>
        <header className="dialog-header">
          <h2 id={titleId}>Export the show as a video</h2>
        </header>

        {phase.kind === "options" && (
          <form
            className="video-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (canStart) void start();
            }}
          >
            <p className="muted dialog-note">
              The show plays from the start as if nobody pressed a key, with the display mode and palette chosen now. Made in this tab;
              nothing is uploaded.
            </p>
            <label className="field">
              <span>Slides that wait for a key are shown for</span>
              <span className="field-inline">
                <input
                  type="number"
                  min={0}
                  max={MAX_WAIT_SECONDS}
                  step={0.5}
                  value={waitText}
                  onChange={(e) => {
                    setWaitText(e.target.value);
                    const v = Number.parseFloat(e.target.value);
                    if (Number.isFinite(v)) update({ waitSeconds: clampWaitSeconds(v) });
                  }}
                  onBlur={() => setWaitText(String(options.waitSeconds))}
                />
                seconds
              </span>
              <span className="field-hint">Slides with their own display time keep it.</span>
            </label>
            <label className="check">
              <input type="checkbox" checked={options.transitions} onChange={(e) => update({ transitions: e.target.checked })} />
              <span>
                Include transitions <span className="muted">({modeLabel})</span>
              </span>
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={options.sound && soundCount > 0}
                disabled={soundCount === 0}
                onChange={(e) => update({ sound: e.target.checked })}
              />
              <span>
                Include sound{" "}
                <span className="muted">
                  ({soundCount === 0 ? "the show plays no WAV sound" : `${soundCount} WAV sound${soundCount === 1 ? "" : "s"}`})
                </span>
              </span>
            </label>
            <fieldset className="field">
              <legend>Size</legend>
              {sizes.map(({ width, size }) => (
                <label key={width} className="check">
                  <input type="radio" name="video-size" checked={options.width === width} onChange={() => update({ width })} />
                  <span>
                    {size.width} × {size.height}
                    {width === 640 ? <span className="muted"> (original screen)</span> : null}
                  </span>
                </label>
              ))}
            </fieldset>
            <fieldset className="field">
              <legend>Format</legend>
              <label className="check">
                <input type="radio" name="video-format" checked={options.format === "webm"} onChange={() => update({ format: "webm" as VideoFormat })} />
                <span>
                  WebM <span className="muted">(VP9 or VP8{support?.webm.audio ? ", Opus sound" : ""})</span>
                </span>
              </label>
              {mp4Offered && (
                <label className="check">
                  <input type="radio" name="video-format" checked={options.format === "mp4"} onChange={() => update({ format: "mp4" as VideoFormat })} />
                  <span>
                    MP4 <span className="muted">(H.264{support?.mp4.audio ? ", AAC sound" : ""})</span>
                  </span>
                </label>
              )}
              {support === null && !supportError && <p className="field-hint">Checking what this browser can encode…</p>}
              {supportError && <p className="error">Could not check the encoders: {supportError}</p>}
              {support && support.webm.method === null && support.mp4.method === null && (
                <p className="error">This browser cannot make video files (it has neither WebCodecs nor MediaRecorder).</p>
              )}
            </fieldset>
            <p className="video-estimate" aria-live="polite">
              {est.slides === 0
                ? "This show has no slides to put in a video."
                : `About ${formatDuration(est.durationMs)} · ${est.slides} slide${est.slides === 1 ? "" : "s"} · ${est.frames.toLocaleString("en-US")} frames at ${FPS} fps`}
            </p>
            {notes.map((n) => (
              <p key={n} className="field-hint">
                {n}
              </p>
            ))}
            <div className="dialog-actions">
              <button type="button" className="button" onClick={close}>
                Close
              </button>
              <button type="submit" className="button button-primary" disabled={!canStart}>
                Make video
              </button>
            </div>
          </form>
        )}

        {/* Kept mounted while running: the recorder fallback draws its canvas here. */}
        <div ref={previewRef} className="video-preview" hidden={!running} />

        {running && (
          <div className="video-progress">
            <progress max={progress?.total ?? 1} value={progress?.done ?? 0} aria-label="Video export progress" />
            <p aria-live="polite">
              {progress
                ? `Frame ${progress.done.toLocaleString("en-US")} of ${progress.total.toLocaleString("en-US")}` +
                  (progress.remainingMs !== null ? ` · about ${formatDuration(progress.remainingMs)} left` : "")
                : "Preparing…"}
            </p>
            <div className="dialog-actions">
              <button type="button" className="button" onClick={cancel}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {phase.kind === "done" && (
          <div className="video-done">
            <p role="status">
              The video is ready: {phase.name}, {formatBytes(phase.bytes)}.
            </p>
            {phase.notes.map((n) => (
              <p key={n} className="field-hint">
                {n}
              </p>
            ))}
            <div className="dialog-actions">
              <button type="button" className="button" onClick={() => setPhase({ kind: "options" })}>
                Back
              </button>
              <a className="button button-primary" href={phase.url} download={phase.name}>
                Download {phase.name}
              </a>
            </div>
          </div>
        )}

        {phase.kind === "error" && (
          <div className="video-done">
            <p className="error" role="alert">
              Video export failed: {phase.message}
            </p>
            <div className="dialog-actions">
              <button type="button" className="button" onClick={() => setPhase({ kind: "options" })}>
                Back
              </button>
              <button type="button" className="button" onClick={close}>
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default VideoExportDialog;
