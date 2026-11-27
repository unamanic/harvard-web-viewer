/**
 * Web Worker that renders MIDI songs (synth.ts) off the main thread.
 *
 * Messages in (synthProtocol.ts): "start" a song for streaming, then "more"
 * to get its next samples; or "render" a whole song at once. Out: "chunk"
 * (samples, transferred) and "end" while streaming, "pcm" for a whole
 * song, "error" when the file cannot be read.
 */
import { type MidiRenderer, midiRenderer, renderMidi } from "./synth";
import type { SynthRequest, SynthResponse } from "./synthProtocol";

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<SynthRequest>) => void) | null;
  postMessage(message: SynthResponse, transfer?: Transferable[]): void;
};

let renderer: MidiRenderer | null = null;

scope.onmessage = (e) => {
  const msg = e.data;
  try {
    if (msg.type === "render") {
      const pcm = renderMidi(msg.bytes);
      const samples = pcm.channels[0];
      scope.postMessage({ type: "pcm", id: msg.id, sampleRate: pcm.sampleRate, samples }, [samples.buffer]);
    } else if (msg.type === "start") {
      renderer = midiRenderer(msg.bytes);
    } else if (msg.type === "more") {
      const samples = renderer?.next(msg.frames) ?? null;
      if (!renderer || !samples) {
        scope.postMessage({ type: "end" });
        return;
      }
      scope.postMessage({ type: "chunk", sampleRate: renderer.sampleRate, samples }, [samples.buffer]);
    }
  } catch (err) {
    scope.postMessage({ type: "error", id: msg.type === "render" ? msg.id : undefined, message: err instanceof Error ? err.message : String(err) });
  }
};
