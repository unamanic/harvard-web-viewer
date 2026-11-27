/**
 * A whole MIDI song rendered to PCM (for video export): in the synth worker,
 * so the page stays responsive, or here where there are no workers.
 */
import type { Pcm } from "./pcm";
import { renderMidi } from "./synth";
import { type SynthResponse, createSynthWorker } from "./synthProtocol";

export async function renderMidiOffThread(bytes: Uint8Array): Promise<Pcm> {
  const worker = createSynthWorker();
  if (!worker) return renderMidi(bytes);
  try {
    return await new Promise<Pcm>((resolve, reject) => {
      worker.onmessage = (e: MessageEvent<SynthResponse>) => {
        const msg = e.data;
        if (msg.type === "pcm") resolve({ sampleRate: msg.sampleRate, channels: [msg.samples] });
        else if (msg.type === "error") reject(new Error(msg.message));
      };
      worker.onerror = (e) => reject(new Error(e.message || "the synth worker failed"));
      worker.postMessage({ type: "render", id: 1, bytes: bytes.slice() });
    });
  } finally {
    worker.terminate();
  }
}
