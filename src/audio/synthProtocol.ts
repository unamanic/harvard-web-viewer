/** Messages between the page and the synth worker (synthWorker.ts). */
export type SynthRequest =
  | { type: "start"; bytes: Uint8Array }
  | { type: "more"; frames: number }
  | { type: "render"; id: number; bytes: Uint8Array };

export type SynthResponse =
  | { type: "chunk"; sampleRate: number; samples: Float32Array }
  | { type: "end" }
  | { type: "pcm"; id: number; sampleRate: number; samples: Float32Array }
  | { type: "error"; id?: number; message: string };

/** A new synth worker, or null where workers are not available (tests, Node). */
export function createSynthWorker(): Worker | null {
  if (typeof Worker === "undefined") return null;
  return new Worker(new URL("./synthWorker.ts", import.meta.url), { type: "module" });
}
