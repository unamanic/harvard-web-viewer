/**
 * A two-operator FM voice in the manner of the Yamaha YM3812 (OPL2), the
 * music chip of the Sound Blaster-class cards Harvard Graphics 3 drove.
 *
 * A model of the chip's documented behaviour, not a register-level emulation:
 * the chip's sample rate (3.579545 MHz / 72), frequency numbers and blocks,
 * the frequency multiple table, the four OPL2 waveforms, modulator feedback,
 * FM and additive connections, envelope generator rates (YM3812 datasheet
 * timings, with key scaling of rates), sustain levels in 3 dB steps, key
 * scaling of level, total level in 0.75 dB steps, and the tremolo (3.7 Hz,
 * 1 dB) and vibrato (6.1 Hz, 7 cents) of the chip's shallow settings. All
 * computed in floating point.
 */

/** The chip's sample rate: a 3.579545 MHz clock divided by 72. */
export const OPL_RATE = 3579545 / 72;

/** One operator's registers: 0x20, 0x40, 0x60, 0x80 and 0xE0. */
export interface OperatorRegs {
  /** AM (bit 7), vibrato (6), sustaining envelope (5), key scaling of rate (4), multiple (0-3). */
  char: number;
  /** Key scaling of level (bits 6-7), total level (0-5, 0.75 dB steps). */
  level: number;
  /** Attack rate (high nibble), decay rate (low). */
  attackDecay: number;
  /** Sustain level (high nibble, 3 dB steps), release rate (low). */
  sustainRelease: number;
  /** Waveform (bits 0-1). */
  waveform: number;
}

/** A voice's patch: two operators and register 0xC0 (feedback bits 1-3, additive connection bit 0). */
export interface VoicePatch {
  mod: OperatorRegs;
  car: OperatorRegs;
  feedback: number;
}

/** An SBI instrument's 11 bytes (modulator/carrier 0x20, 0x40, 0x60, 0x80, 0xE0, then 0xC0) as a patch. */
export function patchFromSbi(b: ArrayLike<number>): VoicePatch {
  const op = (k: number): OperatorRegs => ({
    char: b[k],
    level: b[2 + k],
    attackDecay: b[4 + k],
    sustainRelease: b[6 + k],
    waveform: b[8 + k],
  });
  return { mod: op(0), car: op(1), feedback: b[10] };
}

const MULTIPLE = [0.5, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 12, 12, 15, 15];

/** Key scaling of level: the chip's table by the top 4 bits of the frequency number (with the block: units of 0.1875 dB). */
const KSL_ROM = [0, 32, 40, 45, 48, 51, 53, 55, 56, 58, 59, 60, 61, 62, 63, 64];
/** KSL register value → right shift of the table value (0: none, 1: 3 dB/oct, 2: 1.5 dB/oct, 3: 6 dB/oct). */
const KSL_SHIFT = [8, 1, 2, 0];

const SINE_SIZE = 1024;
const SINE = Float32Array.from({ length: SINE_SIZE }, (_, i) => Math.sin((2 * Math.PI * i) / SINE_SIZE));

/** Gain for an attenuation in 1/16 dB steps, up to 128 dB. */
const GAIN_STEPS = 16;
const GAIN = Float32Array.from({ length: 128 * GAIN_STEPS + 1 }, (_, i) => (i >= 96 * GAIN_STEPS ? 0 : 10 ** (-i / GAIN_STEPS / 20)));

/** Silence threshold of the envelope (dB). */
const ENV_MAX = 96;

/** Waveform value at phase `p` (cycles, any real). */
function wave(form: number, p: number): number {
  const f = p - Math.floor(p);
  const s = SINE[(f * SINE_SIZE) | 0];
  switch (form & 3) {
    case 0:
      return s;
    case 1:
      return f < 0.5 ? s : 0;
    case 2:
      return Math.abs(s);
    default:
      return f % 0.5 < 0.25 ? Math.abs(s) : 0;
  }
}

/** Frequency number and block for a frequency, as a driver would pick them (largest frequency number below 1024). */
export function fnumBlock(hz: number): { fnum: number; block: number } {
  for (let block = 0; block < 8; block++) {
    const fnum = Math.round((hz * 2 ** (20 - block)) / OPL_RATE);
    if (fnum < 1024) return { fnum: Math.max(0, fnum), block };
  }
  return { fnum: 1023, block: 7 };
}

/**
 * Time (seconds) of an envelope phase at effective rate `r` (0-63): attack
 * from silence to full, or decay and release over 96 dB. YM3812 datasheet:
 * attack 2826.24 ms and decay 39280.64 ms at rate 1, halving for each rate
 * step, a quarter between; rate 0 never moves, attack rates 60-63 are
 * immediate.
 */
export function envelopeTime(r: number, attack: boolean): number {
  if (r < 4) return Infinity;
  const rate = Math.min(63, r);
  if (attack && rate >= 60) return 0;
  const base = attack ? 2.82624 : 39.28064;
  const step = Math.min(15, rate >> 2);
  return (base / 2 ** (step - 1)) * (4 / (4 + (rate & 3)));
}

const enum Stage {
  Attack,
  Decay,
  Sustain,
  Release,
  Off,
}

class Operator {
  regs!: OperatorRegs;
  phase = 0;
  /** Phase step per sample, cycles, before vibrato. */
  step = 0;
  env = ENV_MAX;
  stage = Stage.Off;
  /** Constant attenuation (dB): total level and key scaling, then the voice's volume. */
  base = 0;
  fixed = 0;
  attackMul = 0;
  decayStep = 0;
  releaseStep = 0;
  sustain = 0;

  setup(regs: OperatorRegs, fnum: number, block: number, extraDb: number): void {
    this.regs = regs;
    this.setPitch(fnum, block);
    const ksl = Math.max(0, KSL_ROM[fnum >> 6] * 4 - (8 - block) * 32) >> KSL_SHIFT[regs.level >> 6];
    this.fixed = (regs.level & 0x3f) * 0.75 + ksl * 0.1875;
    this.base = this.fixed + extraDb;
    // Key scaling of rate: block and the frequency number's top bit, quartered unless KSR is set.
    const kso = (block << 1) | ((fnum >> 9) & 1);
    const scaled = regs.char & 0x10 ? kso : kso >> 2;
    const eff = (r: number) => (r === 0 ? 0 : Math.min(63, r * 4 + scaled));
    const samples = (t: number) => t * OPL_RATE;
    const at = samples(envelopeTime(eff(regs.attackDecay >> 4), true));
    this.attackMul = at < 1 ? 0 : at === Infinity ? 1 : (0.05 / ENV_MAX) ** (1 / at);
    this.decayStep = ENV_MAX / samples(envelopeTime(eff(regs.attackDecay & 15), false));
    this.releaseStep = ENV_MAX / samples(envelopeTime(eff(regs.sustainRelease & 15), false));
    const sl = regs.sustainRelease >> 4;
    this.sustain = sl === 15 ? 93 : sl * 3;
  }

  setPitch(fnum: number, block: number): void {
    this.step = ((fnum * 2 ** block) / 2 ** 20) * MULTIPLE[this.regs.char & 15];
  }

  keyOn(): void {
    this.phase = 0;
    this.stage = Stage.Attack; // an attack rate of 0 never rises: silent until released
  }

  keyOff(): void {
    if (this.stage !== Stage.Off) this.stage = Stage.Release;
  }

  /** Advance the envelope one sample; returns the envelope attenuation (dB). */
  tickEnvelope(): number {
    switch (this.stage) {
      case Stage.Attack:
        this.env *= this.attackMul;
        if (this.env < 0.05) {
          this.env = 0;
          this.stage = Stage.Decay;
        }
        break;
      case Stage.Decay:
        this.env += this.decayStep;
        if (this.env >= this.sustain) {
          this.env = this.sustain;
          this.stage = Stage.Sustain;
        }
        break;
      case Stage.Sustain:
        // A non-sustaining envelope (bit 5 clear) keeps falling at the release rate.
        if (!(this.regs.char & 0x20)) this.env += this.releaseStep;
        break;
      case Stage.Release:
        this.env += this.releaseStep;
        break;
      default:
        break;
    }
    if (this.env >= ENV_MAX) {
      this.env = ENV_MAX;
      if (this.stage !== Stage.Attack) this.stage = Stage.Off;
    }
    return this.env;
  }
}

/** Tremolo depth (dB) and rate, vibrato depth (cents) and rate: the chip's shallow settings. */
const TREMOLO_DB = 1;
const TREMOLO_HZ = 3.7;
const VIBRATO_CENTS = 7;
const VIBRATO_HZ = 6.1;

/** Tremolo attenuation (dB) and vibrato frequency factor for a run of samples. */
export interface LfoTables {
  am: Float32Array;
  vib: Float32Array;
}

/** The LFOs for `count` samples from the song's sample `n0` (into `into`, reused when large enough). */
export function lfoTables(n0: number, count: number, into?: LfoTables): LfoTables {
  const t = into && into.am.length >= count ? into : { am: new Float32Array(count), vib: new Float32Array(count) };
  for (let i = 0; i < count; i++) {
    const n = n0 + i;
    const tPhase = (n * TREMOLO_HZ) / OPL_RATE;
    t.am[i] = (1 - Math.abs(2 * (tPhase - Math.floor(tPhase)) - 1)) * TREMOLO_DB;
    t.vib[i] = 2 ** ((Math.sin((2 * Math.PI * n * VIBRATO_HZ) / OPL_RATE) * VIBRATO_CENTS) / 1200);
  }
  return t;
}

/** One OPL2 channel: two operators. */
export class FmVoice {
  private readonly mod = new Operator();
  private readonly car = new Operator();
  private patch: VoicePatch | null = null;
  private fb0 = 0;
  private fb1 = 0;

  /** Whether the voice is silent (both envelopes finished). */
  get idle(): boolean {
    return this.patch === null || (this.car.stage === Stage.Off && (!(this.patch.feedback & 1) || this.mod.stage === Stage.Off));
  }

  /** Whether the voice has been released (or is idle). */
  get released(): boolean {
    return this.patch === null || this.car.stage === Stage.Release || this.car.stage === Stage.Off;
  }

  /**
   * Start a note: `hz` the pitch, `volumeDb` the attenuation of the voice's
   * volume (velocity, channel volume) added to the carrier (and to the
   * modulator too when the connection is additive).
   */
  noteOn(patch: VoicePatch, hz: number, volumeDb: number): void {
    this.patch = patch;
    const { fnum, block } = fnumBlock(hz);
    const additive = (patch.feedback & 1) !== 0;
    this.mod.setup(patch.mod, fnum, block, additive ? volumeDb : 0);
    this.car.setup(patch.car, fnum, block, volumeDb);
    this.mod.env = ENV_MAX;
    this.car.env = ENV_MAX;
    this.fb0 = 0;
    this.fb1 = 0;
    this.mod.keyOn();
    this.car.keyOn();
  }

  /** Change the volume of a sounding note (channel volume, expression). */
  setVolume(volumeDb: number): void {
    if (!this.patch) return;
    this.car.base = this.car.fixed + volumeDb;
    if (this.patch.feedback & 1) this.mod.base = this.mod.fixed + volumeDb;
  }

  /** Change the pitch of a sounding note (pitch bend). */
  setPitch(hz: number): void {
    if (!this.patch) return;
    const { fnum, block } = fnumBlock(hz);
    this.mod.setPitch(fnum, block);
    this.car.setPitch(fnum, block);
  }

  noteOff(): void {
    this.mod.keyOff();
    this.car.keyOff();
  }

  /** Silence at once (voice stolen). */
  kill(): void {
    this.mod.stage = Stage.Off;
    this.car.stage = Stage.Off;
    this.mod.env = ENV_MAX;
    this.car.env = ENV_MAX;
    this.patch = null;
  }

  /**
   * Add `count` samples to `out` from `offset`. `lfo` gives, for each of the
   * samples, the tremolo attenuation (dB, `am`) and the vibrato frequency
   * factor (`vib`), shared by every voice (lfoTables).
   */
  render(out: Float32Array, offset: number, count: number, lfo: LfoTables): void {
    const patch = this.patch;
    if (!patch) return;
    const mod = this.mod;
    const car = this.car;
    const fbLevel = (patch.feedback >> 1) & 7;
    const fbScale = fbLevel ? 2 ** (fbLevel - 6) : 0;
    const additive = (patch.feedback & 1) !== 0;
    const modAm = (mod.regs.char & 0x80) !== 0;
    const carAm = (car.regs.char & 0x80) !== 0;
    const modVib = (mod.regs.char & 0x40) !== 0;
    const carVib = (car.regs.char & 0x40) !== 0;
    const modWave = mod.regs.waveform;
    const carWave = car.regs.waveform;
    const { am: amTable, vib: vibTable } = lfo;
    const top = GAIN.length - 1;
    for (let i = 0; i < count; i++) {
      const am = amTable[i];
      const vib = vibTable[i];
      const modAtt = mod.tickEnvelope() + mod.base + (modAm ? am : 0);
      const fb = fbScale * (this.fb0 + this.fb1) * 0.5;
      const modOut = wave(modWave, mod.phase + fb) * GAIN[Math.min(top, (modAtt * GAIN_STEPS) | 0)];
      this.fb1 = this.fb0;
      this.fb0 = modOut;
      mod.phase += mod.step * (modVib ? vib : 1);

      const carAtt = car.tickEnvelope() + car.base + (carAm ? am : 0);
      const carOut = wave(carWave, car.phase + (additive ? 0 : modOut * 4)) * GAIN[Math.min(top, (carAtt * GAIN_STEPS) | 0)];
      car.phase += car.step * (carVib ? vib : 1);
      if (car.phase > 1e6) car.phase -= Math.floor(car.phase);
      if (mod.phase > 1e6) mod.phase -= Math.floor(mod.phase);

      out[offset + i] += additive ? modOut + carOut : carOut;
    }
    if (this.idle) this.patch = null;
  }
}
