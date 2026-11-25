import { describe, expect, it } from "vitest";
import { type AudioLike, type SoundEnv, type SoundStatus, SoundController } from "./controller";
import { describeWav, soundFormat } from "./format";

/** A minimal RIFF/WAVE file: PCM, `channels`, `rate`, `bits`, `samples` frames of silence. */
function wav(channels = 1, rate = 11025, bits = 8, samples = 4): Uint8Array {
  const dataBytes = samples * channels * (bits / 8);
  const out = new Uint8Array(44 + dataBytes);
  const view = new DataView(out.buffer);
  const text = (pos: number, s: string) => [...s].forEach((c, i) => (out[pos + i] = c.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * channels * (bits / 8), true);
  view.setUint16(32, channels * (bits / 8), true);
  view.setUint16(34, bits, true);
  text(36, "data");
  view.setUint32(40, dataBytes, true);
  return out;
}

const MIDI = new Uint8Array([0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0, 96]);

class FakeAudio implements AudioLike {
  src = "";
  muted = false;
  paused = true;
  plays = 0;
  onended: ((ev: Event) => unknown) | null = null;
  /** What the next play() does: resolve, reject with this error name, or throw. */
  outcome: "ok" | "NotAllowedError" | "NotSupportedError" = "ok";
  play(): Promise<void> {
    this.plays++;
    if (this.outcome === "ok") {
      this.paused = false;
      return Promise.resolve();
    }
    const err = new Error(this.outcome === "NotAllowedError" ? "autoplay blocked" : "bad data");
    err.name = this.outcome;
    return Promise.reject(err);
  }
  pause(): void {
    this.paused = true;
  }
  end(): void {
    this.paused = true;
    this.onended?.(new Event("ended"));
  }
}

function setup(files: Record<string, Uint8Array>, options: { muted?: boolean; outcome?: FakeAudio["outcome"] } = {}) {
  const audios: FakeAudio[] = [];
  const urls = new Map<string, Uint8Array>();
  const revoked: string[] = [];
  const warnings: string[] = [];
  const notes: string[] = [];
  const statuses: SoundStatus[] = [];
  let n = 0;
  const env: SoundEnv = {
    resolveFile: (name) => files[name.toUpperCase()] ?? null,
    createAudio: () => {
      const a = new FakeAudio();
      if (options.outcome) a.outcome = options.outcome;
      audios.push(a);
      return a;
    },
    createObjectUrl: (bytes) => {
      const url = `blob:${++n}`;
      urls.set(url, bytes);
      return url;
    },
    revokeObjectUrl: (url) => revoked.push(url),
    warn: (m) => warnings.push(m),
  };
  const controller = new SoundController(
    env,
    { onStatus: (s) => statuses.push(s), onNote: (t) => notes.push(t) },
    { muted: options.muted },
  );
  return { controller, audios, urls, revoked, warnings, notes, statuses };
}

const slide = (fileName: string) => ({ label: fileName, fileName });
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("sound format", () => {
  it("tells WAV from MIDI by signature, then by extension", () => {
    expect(soundFormat("X.WAV", wav())).toBe("wav");
    expect(soundFormat("X.MID", MIDI)).toBe("midi");
    expect(soundFormat("WRONG.WAV", MIDI)).toBe("midi");
    expect(soundFormat("X.MID", null)).toBe("midi");
    expect(soundFormat("X.WAV", new Uint8Array(20))).toBe("unknown");
    expect(soundFormat("X.TXT", new Uint8Array(20))).toBe("unknown");
  });

  it("reads a WAV header", () => {
    expect(describeWav(wav(2, 22050, 16, 10))).toEqual({ formatTag: 1, channels: 2, sampleRate: 22050, bitsPerSample: 16, dataBytes: 40 });
    expect(describeWav(MIDI)).toBeNull();
  });
});

describe("SoundController", () => {
  it("plays a WAV from a blob URL and revokes the URL when it ends", async () => {
    const rim = wav();
    const t = setup({ "RIM.WAV": rim });
    t.controller.playSlides([slide("RIM.WAV")]);
    expect(t.audios).toHaveLength(1);
    const [a] = t.audios;
    expect(a.src).toBe("blob:1");
    expect(t.urls.get("blob:1")).toBe(rim);
    expect(a.plays).toBe(1);
    expect(t.controller.status).toEqual({ playing: "RIM.WAV", blocked: false, muted: false });
    await flush();
    a.end();
    expect(t.revoked).toEqual(["blob:1"]);
    expect(t.controller.status.playing).toBeNull();
    expect(t.notes).toEqual([]);
    expect(t.warnings).toEqual([]);
  });

  it("plays one sound at a time: a new one stops the previous; stop() stops it", () => {
    const t = setup({ "A.WAV": wav(), "B.WAV": wav() });
    t.controller.playSlides([slide("A.WAV")]);
    t.controller.playSlides([slide("B.WAV")]);
    expect(t.audios[0].paused).toBe(true);
    expect(t.audios[0].onended).toBeNull();
    expect(t.revoked).toEqual(["blob:1"]);
    expect(t.controller.status.playing).toBe("B.WAV");
    t.controller.stop();
    expect(t.audios[1].paused).toBe(true);
    expect(t.revoked).toEqual(["blob:1", "blob:2"]);
    expect(t.controller.status.playing).toBeNull();
  });

  it("starts only the last playable sound of one move; MIDI does not stop a WAV", () => {
    const t = setup({ "A.WAV": wav(), "B.WAV": wav(), "M.MID": MIDI });
    t.controller.playSlides([slide("A.WAV"), slide("B.WAV"), slide("M.MID")]);
    expect(t.audios).toHaveLength(1);
    expect(t.controller.status.playing).toBe("B.WAV");
    t.controller.playSlides([slide("M.MID")]);
    expect(t.audios[0].paused).toBe(false);
    expect(t.controller.status.playing).toBe("B.WAV");
  });

  it("mutes and unmutes the playing sound and new ones", () => {
    const t = setup({ "A.WAV": wav(), "B.WAV": wav() }, { muted: true });
    t.controller.playSlides([slide("A.WAV")]);
    expect(t.audios[0].muted).toBe(true);
    t.controller.setMuted(false);
    expect(t.audios[0].muted).toBe(false);
    expect(t.statuses.at(-1)?.muted).toBe(false);
    t.controller.setMuted(true);
    t.controller.playSlides([slide("B.WAV")]);
    expect(t.audios[1].muted).toBe(true);
  });

  it("reports a blocked play() quietly and retries on enable()", async () => {
    const t = setup({ "A.WAV": wav() }, { outcome: "NotAllowedError" });
    t.controller.playSlides([slide("A.WAV")]);
    await flush();
    expect(t.controller.status).toEqual({ playing: "A.WAV", blocked: true, muted: false });
    expect(t.warnings).toEqual([]);
    expect(t.notes).toEqual([]);
    t.audios[0].outcome = "ok";
    t.controller.enable();
    await flush();
    expect(t.audios[0].plays).toBe(2);
    expect(t.controller.status.blocked).toBe(false);
  });

  it("warns and gives up on a sound the browser cannot decode", async () => {
    const t = setup({ "A.WAV": wav() }, { outcome: "NotSupportedError" });
    t.controller.playSlides([slide("A.WAV")]);
    await flush();
    expect(t.controller.status.playing).toBeNull();
    expect(t.revoked).toEqual(["blob:1"]);
    expect(t.warnings).toEqual(["Could not play A.WAV: bad data"]);
    expect(t.notes).toEqual(["A.WAV could not be played"]);
  });

  it("does not play MIDI: a note, and one warning per file", () => {
    const t = setup({ "SPFAIRY.MID": MIDI, "IMAGE2.MID": MIDI });
    t.controller.playSlides([slide("SPFAIRY.MID")]);
    t.controller.playSlides([slide("SPFAIRY.MID")]);
    t.controller.playSlides([slide("SPFAIRY.MID"), slide("IMAGE2.MID")]);
    expect(t.audios).toHaveLength(0);
    expect(t.notes).toEqual([
      "MIDI music (SPFAIRY.MID) is not played",
      "MIDI music (SPFAIRY.MID) is not played",
      "MIDI music (SPFAIRY.MID, IMAGE2.MID) is not played",
    ]);
    expect(t.warnings).toEqual([
      "MIDI music (SPFAIRY.MID) is not played: the viewer has no MIDI synthesizer.",
      "MIDI music (IMAGE2.MID) is not played: the viewer has no MIDI synthesizer.",
    ]);
  });

  it("notes a missing or unplayable file and carries on", () => {
    const t = setup({ "B.WAV": wav(), "JUNK.WAV": new Uint8Array(30) });
    t.controller.playSlides([slide("GONE.WAV"), slide("JUNK.WAV"), slide("B.WAV")]);
    expect(t.notes).toEqual(["Sound file GONE.WAV is missing. JUNK.WAV cannot be played"]);
    expect(t.warnings).toEqual([
      "Sound file GONE.WAV is missing; the show goes on without it.",
      "JUNK.WAV is not a WAV or MIDI file; not played.",
    ]);
    expect(t.controller.status.playing).toBe("B.WAV");
    t.controller.playSlides([{ label: "untitled", fileName: null }]);
    expect(t.notes.at(-1)).toBe("Sound file untitled is missing");
    expect(t.controller.status.playing).toBe("B.WAV");
  });
});
