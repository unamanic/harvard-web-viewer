import { useCallback, useEffect, useRef, useState } from "react";
import {
  type ResolveFile,
  type SoundSlide,
  type SoundStatus,
  SoundController,
  browserSoundEnv,
} from "./controller";

/** How long a sound note stays on screen. */
export const NOTE_MS = 4000;

export interface ShowSound {
  status: SoundStatus;
  /** Short message to show over the slide, or null. */
  note: string | null;
  play(slides: readonly SoundSlide[]): void;
  stop(): void;
  toggleMute(): void;
  /** Retry a sound the browser blocked (call from a click). */
  enable(): void;
}

/**
 * React side of the sound controller: one controller per mounted player,
 * stopped on unmount. Pass `controlledMuted` when the mute setting lives
 * elsewhere (the app keeps it, remembered per browser in ui/settings.ts);
 * without it the hook keeps its own, for this player only, and
 * `toggleMute` changes that.
 */
export function useShowSound(resolveFile: ResolveFile | undefined, controlledMuted?: boolean): ShowSound {
  const [ownMuted, setMuted] = useState(false);
  const muted = controlledMuted ?? ownMuted;
  const [status, setStatus] = useState<SoundStatus>({ playing: null, blocked: false, muted });
  const [note, setNote] = useState<{ id: number; text: string } | null>(null);

  const resolveRef = useRef(resolveFile);
  const mutedRef = useRef(muted);
  useEffect(() => {
    resolveRef.current = resolveFile;
    mutedRef.current = muted;
  });

  const warned = useRef(new Set<string>());
  const controllerRef = useRef<SoundController | null>(null);
  useEffect(() => {
    const controller = new SoundController(
      browserSoundEnv((name) => resolveRef.current?.(name) ?? null),
      { onStatus: setStatus, onNote: (text) => setNote((n) => ({ id: (n?.id ?? 0) + 1, text })) },
      { muted: mutedRef.current, warned: warned.current },
    );
    controllerRef.current = controller;
    return () => {
      controller.stop();
      controllerRef.current = null;
    };
  }, []);

  // Follow a controlled mute setting.
  useEffect(() => {
    controllerRef.current?.setMuted(muted);
    setStatus((s) => (s.muted === muted ? s : { ...s, muted }));
  }, [muted]);

  useEffect(() => {
    if (!note) return;
    const timer = setTimeout(() => setNote(null), NOTE_MS);
    return () => clearTimeout(timer);
  }, [note]);

  const play = useCallback((slides: readonly SoundSlide[]) => controllerRef.current?.playSlides(slides), []);
  const stop = useCallback(() => controllerRef.current?.stop(), []);
  const enable = useCallback(() => controllerRef.current?.enable(), []);
  const toggleMute = useCallback(() => {
    const next = !mutedRef.current;
    mutedRef.current = next;
    setMuted(next);
    controllerRef.current?.setMuted(next);
    setStatus((s) => ({ ...s, muted: next }));
  }, []);

  return { status: status.muted === muted ? status : { ...status, muted }, note: note?.text ?? null, play, stop, toggleMute, enable };
}
