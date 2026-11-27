/**
 * MIDI music as an FM sound card of 1992 played it: a standard MIDI file
 * rendered to PCM through FM voices (fm/opl.ts) with an open General MIDI
 * FM bank (fm/bank.ts, Freedoom's GENMIDI).
 *
 * Rules:
 * - Channels [I]: MIDI files of the time were often authored in Microsoft's
 *   dual format: an "extended" arrangement on channels 1-10 (drums on 10)
 *   and a "base-level" one on channels 13-16 (drums on 16) for FM cards.
 *   An FM card's driver played the base level only. So when a file has
 *   notes on channels 13-16, only those play, with 16 as the drum channel
 *   (all six music files on the HG 3.05 disks are so authored: "B" and "X"
 *   track names); otherwise every channel plays, with 10 as drums (General
 *   MIDI).
 * - Voices: 18 two-operator voices (an OPL3's count; the Pro AudioSpectrum
 *   16 and later Sound Blasters had one [I]). A note takes one voice, or
 *   two for a double-voice instrument; when none is free the longest
 *   released, else the oldest, voice is taken.
 * - Notes, as the DMX player for which the bank was tuned: the bank's note
 *   offset is added to the key (wrapped into 0-95 by octaves), and note n
 *   sounds at MIDI pitch n + 12; percussion keys 35-81 play a fixed note;
 *   a double-voice instrument's second voice is detuned by fine tune / 64
 *   semitones.
 * - Volume: velocity, channel volume (controller 7) and expression (11)
 *   each attenuate by 40·log10(v / 127) dB (General MIDI's curve), on the
 *   carrier (both operators of an additive voice).
 * - Pitch bend ±2 semitones; sustain pedal (64); all notes off (123), all
 *   sound off (120) and reset controllers (121). Pan, modulation and
 *   pressure are ignored (the chip is mono).
 * - Output: mono at the chip's rate (49716 Hz), each voice at 1/5 of full
 *   scale, clipped; the sound runs to the last event and then until every
 *   voice has died away (at most TAIL_SECONDS more).
 */
import { MELODIC, PERCUSSION, type BankRow } from "./fm/bank";
import { FmVoice, type LfoTables, OPL_RATE, lfoTables, patchFromSbi, type VoicePatch } from "./fm/opl";
import { type MidiEvent, type MidiSong, readMidi } from "./midiFile";
import type { Pcm } from "./pcm";

export const SYNTH_VOICES = 18;
const TAIL_SECONDS = 4;
/** Longest song rendered (seconds); later events are dropped. */
export const MAX_SONG_SECONDS = 15 * 60;
const VOICE_GAIN = 0.2;
/** Samples rendered at a time (the LFO tables' length). */
const BLOCK = 1024;
const BEND_RANGE = 2;

interface Instrument {
  fixedNote: number | null;
  tune: number;
  voices: { patch: VoicePatch; offset: number }[];
}

function hexBytes(hex: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < hex.length; i += 2) out.push(parseInt(hex.slice(i, i + 2), 16));
  return out;
}

function instrumentOf(row: BankRow): Instrument {
  const voices: Instrument["voices"] = [];
  for (let k = 3; k + 1 < row.length; k += 2) {
    voices.push({ patch: patchFromSbi(hexBytes(row[k] as string)), offset: row[k + 1] as number });
  }
  return { fixedNote: row[1], tune: row[2], voices };
}

let bank: { melodic: Instrument[]; percussion: Instrument[] } | null = null;
function loadBank() {
  bank ??= { melodic: MELODIC.map(instrumentOf), percussion: PERCUSSION.map(instrumentOf) };
  return bank;
}

/** Which channels play: the base level (13-16, drums on 16) when the song has notes there, else all (drums on 10). */
export function channelPlan(song: MidiSong): { channels: Set<number>; drums: number; level: "base" | "general" } {
  const base = song.events.some((e) => e.type === 0x90 && e.b > 0 && e.channel >= 12);
  return base
    ? { channels: new Set([12, 13, 14, 15]), drums: 15, level: "base" }
    : { channels: new Set(Array.from({ length: 16 }, (_, i) => i)), drums: 9, level: "general" };
}

/** Attenuation (dB) of a MIDI level 0-127 on General MIDI's 40·log10 curve. */
function levelDb(v: number): number {
  return v <= 0 ? 96 : Math.min(96, -40 * Math.log10(v / 127));
}

interface ChannelState {
  program: number;
  volume: number;
  expression: number;
  /** Semitones. */
  bend: number;
  sustain: boolean;
}

interface VoiceState {
  fm: FmVoice;
  channel: number;
  key: number;
  /** Note number before the pitch bend and detune (DMX numbering). */
  note: number;
  detune: number;
  velocity: number;
  started: number;
  releasedAt: number;
  held: boolean;
  /** Key released while the sustain pedal was down. */
  sustained: boolean;
}

function hzOf(note: number, semitones: number): number {
  return 440 * 2 ** ((note + 12 - 69 + semitones) / 12);
}

/** A song being rendered piece by piece (for playing while it renders). */
export interface MidiRenderer {
  readonly sampleRate: number;
  /** Most frames the song can have (its events plus the longest tail). */
  readonly maxFrames: number;
  /** The next samples, up to `frames` of them (mono, -1..1); null once the song has ended. */
  next(frames: number): Float32Array | null;
}

/** A renderer for a song (or MIDI file bytes). */
export function midiRenderer(input: Uint8Array | MidiSong): MidiRenderer {
  const song = input instanceof Uint8Array ? readMidi(input) : input;
  const { melodic, percussion } = loadBank();
  const plan = channelPlan(song);
  const events = song.events.filter((e) => plan.channels.has(e.channel) && e.time <= MAX_SONG_SECONDS);
  const lastTime = Math.min(MAX_SONG_SECONDS, song.duration);
  const maxFrames = Math.ceil((lastTime + TAIL_SECONDS) * OPL_RATE);
  const lastFrame = Math.round(lastTime * OPL_RATE);

  const channels: ChannelState[] = Array.from({ length: 16 }, () => ({ program: 0, volume: 100, expression: 127, bend: 0, sustain: false }));
  const voices: VoiceState[] = Array.from({ length: SYNTH_VOICES }, () => ({
    fm: new FmVoice(),
    channel: -1,
    key: -1,
    note: 0,
    detune: 0,
    velocity: 0,
    started: -1,
    releasedAt: -1,
    held: false,
    sustained: false,
  }));
  let order = 0;

  const volumeOf = (v: VoiceState) => {
    const ch = channels[v.channel];
    return levelDb(v.velocity) + levelDb(ch.volume) + levelDb(ch.expression);
  };

  const allocate = (): VoiceState => {
    let best: VoiceState | null = null;
    for (const v of voices) if (v.fm.idle) return v;
    for (const v of voices) if (!v.held && (!best || v.releasedAt < best.releasedAt)) best = v;
    if (best) return best;
    for (const v of voices) if (!best || v.started < best.started) best = v;
    return best!;
  };

  const release = (v: VoiceState) => {
    v.fm.noteOff();
    v.held = false;
    v.sustained = false;
    v.releasedAt = order++;
  };

  const noteOn = (e: MidiEvent) => {
    const isDrum = e.channel === plan.drums;
    const instrument = isDrum ? percussion[e.a - 35] : melodic[channels[e.channel].program];
    if (!instrument) return;
    // A key struck again while still sounding: release the old note first.
    for (const v of voices) if (v.held && v.channel === e.channel && v.key === e.a) release(v);
    instrument.voices.forEach((iv, k) => {
      let note = (instrument.fixedNote ?? e.a) + iv.offset;
      while (note < 0) note += 12;
      while (note > 95) note -= 12;
      const v = allocate();
      v.fm.kill();
      Object.assign(v, { channel: e.channel, key: e.a, note, detune: k === 1 ? instrument.tune / 64 : 0, velocity: e.b, started: order++, held: true, sustained: false });
      const bend = isDrum ? 0 : channels[e.channel].bend;
      v.fm.noteOn(iv.patch, hzOf(note, bend + v.detune), volumeOf(v));
    });
  };

  const noteOff = (channel: number, key: number) => {
    const ch = channels[channel];
    for (const v of voices) {
      if (!v.held || v.channel !== channel || v.key !== key) continue;
      if (ch.sustain) v.sustained = true;
      else release(v);
    }
  };

  const apply = (e: MidiEvent) => {
    const ch = channels[e.channel];
    switch (e.type) {
      case 0x90:
        if (e.b > 0) noteOn(e);
        else noteOff(e.channel, e.a);
        break;
      case 0x80:
        noteOff(e.channel, e.a);
        break;
      case 0xc0:
        ch.program = e.a;
        break;
      case 0xe0: {
        ch.bend = ((((e.b << 7) | e.a) - 8192) / 8192) * BEND_RANGE;
        if (e.channel === plan.drums) break;
        for (const v of voices) if (v.channel === e.channel && !v.fm.idle) v.fm.setPitch(hzOf(v.note, ch.bend + v.detune));
        break;
      }
      case 0xb0:
        switch (e.a) {
          case 7:
          case 11:
            if (e.a === 7) ch.volume = e.b;
            else ch.expression = e.b;
            for (const v of voices) if (v.channel === e.channel && !v.fm.idle) v.fm.setVolume(volumeOf(v));
            break;
          case 64:
            ch.sustain = e.b >= 64;
            if (!ch.sustain) for (const v of voices) if (v.channel === e.channel && v.sustained) release(v);
            break;
          case 120:
            for (const v of voices) if (v.channel === e.channel) v.fm.kill();
            break;
          case 121:
            ch.expression = 127;
            ch.bend = 0;
            ch.sustain = false;
            break;
          case 123:
            for (const v of voices) if (v.channel === e.channel && v.held) release(v);
            break;
        }
        break;
    }
  };

  let frame = 0;
  let next = 0;
  let ended = false;
  let lfo: LfoTables | undefined;
  /** Render into `out` (which starts at song frame `base`) up to song frame `end`. */
  const renderTo = (out: Float32Array, base: number, end: number) => {
    while (frame < end) {
      const n = Math.min(BLOCK, end - frame);
      lfo = lfoTables(frame, n, lfo);
      for (const v of voices) if (!v.fm.idle) v.fm.render(out, frame - base, n, lfo);
      frame += n;
    }
  };

  return {
    sampleRate: OPL_RATE,
    maxFrames,
    next(frames: number): Float32Array | null {
      if (ended || frame >= maxFrames) return null;
      const base = frame;
      const end = Math.min(maxFrames, base + Math.max(1, Math.floor(frames)));
      const out = new Float32Array(end - base);
      while (frame < end) {
        if (next < events.length) {
          const at = Math.round(events[next].time * OPL_RATE);
          if (at > end) {
            renderTo(out, base, end);
            break;
          }
          renderTo(out, base, at);
          apply(events[next++]);
          continue;
        }
        if (frame < lastFrame) {
          renderTo(out, base, Math.min(end, lastFrame));
          continue;
        }
        // The tail: release every key, then run until every voice has died away.
        for (const v of voices) if (v.held) release(v);
        if (frame % BLOCK === 0 && !voices.some((v) => !v.fm.idle)) {
          ended = true;
          break;
        }
        // Up to the next whole block, so that the check falls on the same frames however the song is cut up.
        renderTo(out, base, Math.min(end, (Math.floor(frame / BLOCK) + 1) * BLOCK));
      }
      const got = frame - base;
      if (got === 0) {
        ended = true;
        return null;
      }
      const pcm = got === out.length ? out : out.slice(0, got);
      for (let k = 0; k < pcm.length; k++) pcm[k] = Math.max(-1, Math.min(1, pcm[k] * VOICE_GAIN));
      return pcm;
    },
  };
}

/** Render a whole song (or MIDI file bytes) to PCM. */
export function renderMidi(input: Uint8Array | MidiSong): Pcm {
  const r = midiRenderer(input);
  const out = new Float32Array(r.maxFrames);
  let length = 0;
  for (let chunk = r.next(65536); chunk; chunk = r.next(65536)) {
    out.set(chunk, length);
    length += chunk.length;
  }
  return { sampleRate: r.sampleRate, channels: [out.slice(0, length)] };
}
