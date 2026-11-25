/**
 * Bitstream Speedo outline font reader (.SPD), SPEC §2 and §7.5; task 7b.
 *
 * Speedo is Bitstream's published format (reference rasteriser donated to the
 * X Consortium). We only need outlines in ORUs (outline resolution units) and
 * metrics, so hinting data (controlled-coordinate "plaid" zones,
 * interpolation zones, constraints) is read only as far as needed to skip it
 * or to look up edge coordinates.
 *
 * File layout (all offsets from the start of the file):
 *
 *   Public header, big-endian, at 0:
 *     0    8   format id "D1.0" / "D4.0" + CR LF NUL NUL
 *     8    u32 font size in bytes
 *     12   u32 minimum font buffer size (= offset of character data)
 *     16   u16 minimum character buffer size
 *     18   u16 header size (offset of the private header)
 *     20   u16 source font id          22  u16 source font version
 *     24   70  font name               94  10  manufacturing date
 *     104  70  layout name             174 78  copyright notice
 *     252  u16 chars in layout         254 u16 chars in font (directory size)
 *     256  u16 first character index   258 u16 kerning tracks  260 u16 pairs
 *     262  u8 flags, u8 classification, u8 family class, u8 form class
 *     266  32  short font name         298 16  short face name
 *     314  14  font form
 *     328  i16 italic angle (1/256 degree)       330 u16 ORUs per em
 *     332  u16 word space, em space, en space, thin space, figure space
 *     342  i16 font-wide xmin, ymin, xmax, ymax (ORUs)
 *     350  i16 underline position, u16 underline thickness
 *     354  11 × 6-byte transformations (small caps, superiors, numerators …)
 *     420  optional u16 metric resolution (only if header size ≥ 422)
 *
 *   Private header at "header size": u16 max ORU value, u16 max pixel value,
 *   u16 customer number, then six "encrypted" 3-byte offsets: character
 *   directory, constraint data, track kerning, pair kerning, character data,
 *   file size. A 3-byte value is stored [middle ^ key4, high, low ^ key6].
 *
 *   Character directory: format byte (0 = 2-byte entries, else 3-byte), then
 *   one offset per character plus one end offset. 2-byte entries are "words".
 *
 * Words in the directory and character data are little-endian and XORed with
 * a 16-bit key (key32); bytes are plain, except the constraint fields of
 * control zones (key7 decides whether they are 1 or 2 bytes). Fonts from the
 * X11 distribution use zero keys; commercial fonts (like the HG3 ones) use
 * per-customer keys that the rasteriser is built with. We recover them from
 * the file: key4/key6 from the stored file size (public header, plain) vs the
 * encrypted copy in the private header, key32 from the directory's end entry
 * vs that file size, key7 by trial parsing (see detectKey7).
 *
 * Character data:
 *   word id (the Bitstream character code), word set width (metric resolution
 *   units), format byte. Format bit 1: optional data follows (byte length +
 *   data). Bit 0: compound character (bbox, then sub-character references).
 *   Otherwise a simple character:
 *     plaid: bit 2 → byte X edge count, bit 3 → byte Y edge count; that many
 *       words of X then Y edge ORUs (a 0 edge is inserted into each list at
 *       its sorted place if absent); control zones (count = X + Y edges − 2):
 *       from/to (1 byte if format bit 4, else 2) + constraint (1–2 bytes);
 *       interpolation zones: bit 6 → byte X count, bit 7 → byte Y count, each
 *       a format byte, start/end edges (1 byte if format bit 7, else 2) and
 *       start/end adjustments sized by format bits 0–2 and 3–5.
 *     bbox: 4 points (xmin,ymin), (xmax,·), (·,ymax), (xmin,·).
 *     outline: format-byte commands until END (see decodeOutline).
 *
 * Point arguments: each coordinate has a 2-bit code (x: bits 0–1, y: bits
 * 2–3 of a nibble): 0 = 1-byte edge index into the plaid table, 1 = absolute
 * word, 2 = signed byte added to the previous value, 3 = unchanged.
 *
 * Output paths are in ORUs with y pointing UP (as stored: baseline at y = 0,
 * ascenders positive). Flip with `scale(1,-1)` to draw in SVG's y-down space.
 */

/** Thrown when the bytes are not a Speedo font (bad format id or header). */
export class NotSpeedoError extends Error {
  constructor(reason: string) {
    super(`not a Speedo font: ${reason}`);
    this.name = "NotSpeedoError";
  }
}

export interface SpeedoBBox {
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
}

export interface SpeedoGlyph {
  /** Directory index (what the HG3.FGF character map stores). */
  id: number;
  /** Bitstream character code stored with the glyph. */
  charCode: number;
  /** Advance width in ORUs. */
  advanceWidth: number;
  /** Bounding box in ORUs (y up) as stored in the glyph, or of the outline. */
  bbox: SpeedoBBox;
  /** SVG path data in ORUs, y up as stored (flip to draw). "" if blank. */
  path: string;
  contours: number;
  /** True when built from sub-characters (accented letters and the like). */
  compound: boolean;
}

export interface SpeedoMetrics {
  /** Italic angle in degrees (header stores 1/256 degree). */
  italicAngle: number;
  wordSpace: number;
  emSpace: number;
  enSpace: number;
  thinSpace: number;
  figureSpace: number;
  /** Font-wide bounding box in ORUs. */
  fontBBox: SpeedoBBox;
  underlinePosition: number;
  underlineThickness: number;
}

export interface SpeedoFont {
  /** Format id, e.g. "D1.0". */
  formatId: string;
  /** Font name from the header, e.g. "Swiss 721(TM)". */
  name: string;
  /** Short font name, e.g. "Swiss721BT-Roman". */
  shortName: string;
  /** Short face name, e.g. "Swiss 721". */
  faceName: string;
  /** Font form, e.g. "Roman". */
  form: string;
  layoutName: string;
  copyright: string;
  sourceFontId: number;
  orusPerEm: number;
  /** Units of the stored set widths (= orusPerEm unless the header says). */
  metricResolution: number;
  metrics: SpeedoMetrics;
  /** Directory entries (glyph ids firstCharIndex .. firstCharIndex+glyphCount-1). */
  glyphCount: number;
  firstCharIndex: number;
  kerningTracks: number;
  kerningPairs: number;
  /** Header warnings plus one per glyph that failed to decode. */
  warnings: string[];
  /** Decode (cached) a glyph by directory index; null if empty or damaged. */
  glyph(id: number): SpeedoGlyph | null;
}

/** Size of the nominal public header; the private header follows. */
const PUBLIC_HEADER_SIZE = 420;
/** Private header: 3 u16 + 6 encrypted 3-byte fields. */
const PRIVATE_HEADER_SIZE = 24;
/** Sub-character scale unit in compound characters (1.0). */
const ONE_SCALE = 4096;
/** Compound characters may reference compound characters (seen in BICS fonts). */
const MAX_COMPOUND_DEPTH = 4;

interface Keys {
  key4: number;
  key6: number;
  key32: number;
  key7: number;
}

class GlyphError extends Error {}

/** Cursor over glyph bytes with Speedo's word/byte encodings. */
class Cursor {
  constructor(
    private readonly b: Uint8Array,
    public pos: number,
    readonly end: number,
    private readonly keys: Keys,
  ) {}

  byte(): number {
    if (this.pos >= this.end) throw new GlyphError("glyph data runs past its end");
    return this.b[this.pos++];
  }

  sbyte(): number {
    const v = this.byte();
    return v >= 128 ? v - 256 : v;
  }

  /** Little-endian word XOR key32, signed. */
  word(): number {
    const lo = this.byte();
    const hi = this.byte();
    const v = ((hi << 8) | lo) ^ this.keys.key32;
    return v >= 0x8000 ? v - 0x10000 : v;
  }

  /** Constraint field: 1 byte, or 2 if the first (XOR key7) is ≥ 248. */
  skipBytesField(): void {
    const v = this.byte() ^ this.keys.key7;
    if (v >= 248) this.byte();
  }

  skip(n: number): void {
    if (this.pos + n > this.end) throw new GlyphError("glyph data runs past its end");
    this.pos += n;
  }
}

/** Plaid (edge) table of a simple character: X edges then Y edges, in ORUs. */
interface Plaid {
  orus: number[];
  yEdgeOrigin: number;
}

/**
 * Bytes taken by an interpolation-zone adjustment, by its 3-bit code.
 * Codes 0, 1, 3 and 5 are the only ones in the 15 HG3 sample fonts; sizes
 * 0, 1, 0, 0 make every glyph's data end exactly at its directory end. The
 * sizes for codes 2, 4, 6, 7 are guesses [?] (no sample uses them).
 */
const INT_ADJUST_SIZE = [0, 1, 2, 0, 2, 0, 2, 2];

interface OutlineSink {
  move(x: number, y: number): void;
  line(x: number, y: number): void;
  curve(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number): void;
}

interface ArgState {
  x: number;
  y: number;
}

function readArgs(c: Cursor, format: number, plaid: Plaid, s: ArgState): void {
  switch (format & 3) {
    case 0: {
      const e = c.byte();
      if (e >= plaid.yEdgeOrigin) throw new GlyphError(`X edge index ${e} out of range`);
      s.x = plaid.orus[e];
      break;
    }
    case 1:
      s.x = c.word();
      break;
    case 2:
      s.x += c.sbyte();
      break;
  }
  switch ((format >> 2) & 3) {
    case 0: {
      const e = plaid.yEdgeOrigin + c.byte();
      if (e >= plaid.orus.length) throw new GlyphError(`Y edge index ${e - plaid.yEdgeOrigin} out of range`);
      s.y = plaid.orus[e];
      break;
    }
    case 1:
      s.y = c.word();
      break;
    case 2:
      s.y += c.sbyte();
      break;
  }
}

/** Read one edge list (n words), inserting 0 at its place if absent. */
function readEdges(c: Cursor, n: number, out: number[]): void {
  let zeroPending = true;
  for (let k = 0; k < n; k++) {
    const oru = c.word();
    if (zeroPending && oru >= 0) {
      if (oru !== 0) out.push(0);
      zeroPending = false;
    }
    out.push(oru);
  }
  if (zeroPending) out.push(0);
}

/** Read the plaid data of a simple character, keeping only the edge table. */
function readPlaid(c: Cursor, format: number): Plaid {
  const nx = format & 0x04 ? c.byte() : 0;
  const ny = format & 0x08 ? c.byte() : 0;
  const orus: number[] = [];
  readEdges(c, nx, orus);
  const yEdgeOrigin = orus.length;
  readEdges(c, ny, orus);
  // Control zones: one per gap between adjacent edges.
  const zones = orus.length - 2;
  for (let i = 0; i < zones; i++) {
    c.skip(format & 0x10 ? 1 : 2);
    c.skipBytesField();
  }
  // Interpolation zones.
  const ints = (format & 0x40 ? c.byte() : 0) + (format & 0x80 ? c.byte() : 0);
  for (let i = 0; i < ints; i++) {
    const f = c.byte();
    c.skip(f & 0x80 ? 1 : 2);
    c.skip(INT_ADJUST_SIZE[f & 7] + INT_ADJUST_SIZE[(f >> 3) & 7]);
  }
  return { orus, yEdgeOrigin };
}

/** Read the 4 bbox points (the reference rasteriser's sp_read_bbox). */
function readBBox(c: Cursor, plaid: Plaid): SpeedoBBox {
  const s: ArgState = { x: 0, y: 0 };
  const f1 = c.byte();
  readArgs(c, f1, plaid, s);
  const bb = { xMin: s.x, yMin: s.y, xMax: s.x, yMax: s.y };
  const add = () => {
    bb.xMin = Math.min(bb.xMin, s.x);
    bb.xMax = Math.max(bb.xMax, s.x);
    bb.yMin = Math.min(bb.yMin, s.y);
    bb.yMax = Math.max(bb.yMax, s.y);
  };
  readArgs(c, (f1 >> 4) | 0x0c, plaid, s); // x only (bits 6/7 pick int zones)
  add();
  const f2 = c.byte();
  readArgs(c, f2, plaid, s);
  add();
  readArgs(c, f2 >> 4, plaid, s);
  add();
  return bb;
}

/** Outline commands until END (the reference rasteriser's sp_proc_outl_data). */
function decodeOutline(c: Cursor, plaid: Plaid, sink: OutlineSink): void {
  const s: ArgState = { x: 0, y: 0 };
  for (;;) {
    const f1 = c.byte();
    switch (f1 >> 4) {
      case 0: // LINE
        readArgs(c, f1, plaid, s);
        sink.line(s.x, s.y);
        break;
      case 1: // short X interpolation zone select (hinting only)
      case 2: // short Y interpolation zone select
        break;
      case 3:
        switch (f1 & 0x0f) {
          case 0: // END
            return;
          case 1: // long X / Y interpolation zone select
          case 2:
            c.byte();
            break;
        }
        break;
      case 4: // MOVE inside
      case 5: // MOVE outside
        readArgs(c, f1, plaid, s);
        sink.move(s.x, s.y);
        break;
      case 6:
      case 7:
        break; // undefined, no arguments
      default: {
        // CURVE (cubic); bits 4–6 are a subdivision depth hint.
        const f2 = c.byte();
        readArgs(c, f1, plaid, s);
        const x1 = s.x;
        const y1 = s.y;
        readArgs(c, f2, plaid, s);
        const x2 = s.x;
        const y2 = s.y;
        readArgs(c, f2 >> 4, plaid, s);
        sink.curve(x1, y1, x2, y2, s.x, s.y);
      }
    }
  }
}

type Transform = [number, number, number, number];

/** Plaid of a compound character (it has none; bbox args use ORU values). */
const NO_PLAID: Plaid = { orus: [0, 0], yEdgeOrigin: 1 };

/** Collects outline commands as SVG path data, with a transform. */
class PathSink implements OutlineSink {
  parts: string[] = [];
  contours = 0;
  private open = false;
  /** [sx, sy, dx, dy]: output = input × s + d. */
  private t: Transform = [1, 1, 0, 0];

  getTransform(): Transform {
    return this.t;
  }

  /** Change the transform; also ends any open contour. */
  setTransform(t: Transform): void {
    if (this.open) this.parts.push("Z");
    this.open = false;
    this.t = t;
  }

  private pt(x: number, y: number): string {
    const tx = round(x * this.t[0] + this.t[2]);
    const ty = round(y * this.t[1] + this.t[3]);
    return `${tx} ${ty}`;
  }

  move(x: number, y: number): void {
    if (this.open) this.parts.push("Z");
    this.parts.push(`M${this.pt(x, y)}`);
    this.open = true;
    this.contours++;
  }

  line(x: number, y: number): void {
    if (!this.open) throw new GlyphError("line before the first move");
    this.parts.push(`L${this.pt(x, y)}`);
  }

  curve(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number): void {
    if (!this.open) throw new GlyphError("curve before the first move");
    this.parts.push(`C${this.pt(x1, y1)} ${this.pt(x2, y2)} ${this.pt(x3, y3)}`);
  }

  finish(): string {
    if (this.open) this.parts.push("Z");
    this.open = false;
    return this.parts.join("");
  }
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}

function readString(b: Uint8Array, offset: number, length: number): string {
  let s = "";
  for (let i = offset; i < offset + length && i < b.length; i++) {
    const ch = b[i];
    if (ch === 0) break;
    s += String.fromCharCode(ch);
  }
  return s.trim();
}

interface RawGlyph {
  charCode: number;
  setWidth: number;
  bbox: SpeedoBBox | null;
  path: string;
  contours: number;
  compound: boolean;
}

class SpeedoFontImpl implements SpeedoFont {
  formatId: string;
  name: string;
  shortName: string;
  faceName: string;
  form: string;
  layoutName: string;
  copyright: string;
  sourceFontId: number;
  orusPerEm: number;
  metricResolution: number;
  metrics: SpeedoMetrics;
  glyphCount: number;
  firstCharIndex: number;
  kerningTracks: number;
  kerningPairs: number;
  warnings: string[] = [];

  private readonly b: Uint8Array;
  private readonly keys: Keys = { key4: 0, key6: 0, key32: 0, key7: 0 };
  private key7Known = false;
  /** Glyph data offsets, one per directory entry plus the end. */
  private readonly offsets: number[] = [];
  private readonly cache = new Map<number, SpeedoGlyph | null>();

  constructor(bytes: Uint8Array) {
    const b = bytes;
    this.b = b;
    if (b.length < 8) throw new NotSpeedoError("file too short");
    const id = readString(b, 0, 4);
    if (!/^D\d\.\d$/.test(id) || b[4] !== 0x0d || b[5] !== 0x0a) throw new NotSpeedoError("no D<n>.<n> format id");
    this.formatId = id;
    if (b.length < PUBLIC_HEADER_SIZE) throw new NotSpeedoError("header truncated");
    const u16 = (o: number) => (b[o] << 8) | b[o + 1];
    const i16 = (o: number) => (u16(o) << 16) >> 16;
    const u32 = (o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;

    const fontSize = u32(8);
    const fontBufferSize = u32(12);
    const headerSize = u16(18);
    if (headerSize < PUBLIC_HEADER_SIZE || headerSize + PRIVATE_HEADER_SIZE > b.length) {
      throw new NotSpeedoError(`bad header size ${headerSize}`);
    }
    this.sourceFontId = u16(20);
    this.name = readString(b, 24, 70);
    this.layoutName = readString(b, 104, 70);
    this.copyright = readString(b, 174, 78);
    this.glyphCount = u16(254);
    this.firstCharIndex = u16(256);
    this.kerningTracks = u16(258);
    this.kerningPairs = u16(260);
    this.shortName = readString(b, 266, 32);
    this.faceName = readString(b, 298, 16);
    this.form = readString(b, 314, 14);
    this.orusPerEm = u16(330);
    if (this.orusPerEm === 0) throw new NotSpeedoError("ORUs per em is 0");
    this.metricResolution = headerSize >= PUBLIC_HEADER_SIZE + 2 ? u16(PUBLIC_HEADER_SIZE) || this.orusPerEm : this.orusPerEm;
    this.metrics = {
      italicAngle: i16(328) / 256,
      wordSpace: u16(332),
      emSpace: u16(334),
      enSpace: u16(336),
      thinSpace: u16(338),
      figureSpace: u16(340),
      fontBBox: { xMin: i16(342), yMin: i16(344), xMax: i16(346), yMax: i16(348) },
      underlinePosition: i16(350),
      underlineThickness: u16(352),
    };
    if (fontSize !== b.length) this.warnings.push(`header says ${fontSize} bytes, file has ${b.length}`);

    // Private header: recover key4/key6 from the encrypted copy of the size.
    const p = headerSize;
    const nb = p + 21;
    if (b[nb + 1] === ((fontSize >>> 16) & 0xff)) {
      this.keys.key4 = b[nb] ^ ((fontSize >>> 8) & 0xff);
      this.keys.key6 = b[nb + 2] ^ (fontSize & 0xff);
    } else {
      this.warnings.push("encrypted file size disagrees with the header; assuming no encryption");
    }
    const long3 = (o: number) => (((b[o] ^ this.keys.key4) << 8) | (b[o + 1] << 16) | (b[o + 2] ^ this.keys.key6)) >>> 0;
    const dirOffset = long3(p + 6);
    const charDataOffset = long3(p + 18);
    if (charDataOffset !== fontBufferSize) {
      this.warnings.push(`character data offset ${charDataOffset} differs from font buffer size ${fontBufferSize}`);
    }
    this.readDirectory(dirOffset, Math.min(fontSize, b.length), long3);
  }

  private readDirectory(dirOffset: number, endOffset: number, long3: (o: number) => number): void {
    const b = this.b;
    const n = this.glyphCount + 1;
    if (dirOffset >= b.length) {
      this.warnings.push(`character directory offset ${dirOffset} is past the end of the file`);
      this.glyphCount = 0;
      return;
    }
    const wide = b[dirOffset] !== 0;
    const entrySize = wide ? 3 : 2;
    const avail = Math.floor((b.length - dirOffset - 1) / entrySize);
    if (avail < n) {
      this.warnings.push(`character directory truncated: ${avail} of ${n} entries`);
    }
    const count = Math.min(n, avail);
    const base = dirOffset + 1;
    if (wide) {
      for (let i = 0; i < count; i++) this.offsets.push(long3(base + i * 3));
      this.glyphCount = Math.max(0, this.offsets.length - 1);
      this.keys.key32 = this.searchKey32();
    } else {
      const raw: number[] = [];
      for (let i = 0; i < count; i++) raw.push(b[base + i * 2] | (b[base + i * 2 + 1] << 8));
      // The directory's last entry is the end of the character data (= file
      // size); that gives key32. Fall back to 0 (unencrypted).
      const candidates = count === n ? [raw[count - 1] ^ (endOffset & 0xffff), 0] : [0];
      let chosen = -1;
      for (const k of candidates) {
        if (isMonotonic(raw, k, b.length)) {
          chosen = k;
          break;
        }
      }
      if (chosen < 0) {
        this.warnings.push("character directory offsets are not in order; glyphs may fail to decode");
        chosen = candidates[0];
      }
      this.keys.key32 = chosen;
      for (const r of raw) this.offsets.push(r ^ chosen);
    }
    this.glyphCount = Math.max(0, this.offsets.length - 1);
  }

  /**
   * 3-byte directories don't give key32 away, so search for it: the key
   * under which the set widths and edge coordinates of the first glyphs all
   * fall inside the font-wide bounding box (plain in the public header).
   * Lengths don't depend on key32, so the raw words can be read without it.
   */
  private searchKey32(): number {
    const { fontBBox } = this.metrics;
    const em = this.metricResolution;
    const slack = this.orusPerEm >> 3;
    // [raw word, min, max] constraints.
    const checks: [number, number, number][] = [];
    const widths: number[] = [];
    for (let slot = 0; slot < this.glyphCount && checks.length < 400; slot++) {
      const start = this.offsets[slot];
      const end = this.offsets[slot + 1];
      if (end <= start || end > this.b.length) continue;
      const b = this.b;
      const rawWord = (o: number) => b[o] | (b[o + 1] << 8);
      if (start + 5 > end) continue;
      checks.push([rawWord(start + 2), 0, 2 * em]);
      widths.push(rawWord(start + 2));
      let o = start + 4;
      const format = b[o++];
      if (format & 0x03) continue; // optional data or compound: widths only
      const nx = format & 0x04 ? b[o++] : 0;
      const ny = format & 0x08 ? b[o++] : 0;
      if (o + 2 * (nx + ny) > end) continue;
      for (let i = 0; i < nx + ny; i++, o += 2) {
        const [lo, hi] = i < nx ? [fontBBox.xMin, fontBBox.xMax] : [fontBBox.yMin, fontBBox.yMax];
        checks.push([rawWord(o), lo - slack, hi + slack]);
      }
    }
    // Ties (keys differing in low bits often all fit) go to the key that
    // makes the most set widths equal one of the header's space widths.
    const m = this.metrics;
    const spaces = new Set([m.wordSpace, m.emSpace, m.enSpace, m.thinSpace, m.figureSpace]);
    let best = 0;
    let bestMisses = Infinity;
    let bestHits = -1;
    for (let k = 0; k < 0x10000; k++) {
      let misses = 0;
      for (let i = 0; i < checks.length && misses <= bestMisses; i++) {
        const [raw, lo, hi] = checks[i];
        let v = raw ^ k;
        if (v >= 0x8000) v -= 0x10000;
        if (v < lo || v > hi) misses++;
      }
      if (misses > bestMisses) continue;
      let hits = 0;
      for (const raw of widths) if (spaces.has(raw ^ k)) hits++;
      if (misses < bestMisses || hits > bestHits) {
        bestMisses = misses;
        bestHits = hits;
        best = k;
      }
    }
    if (bestMisses > 0) {
      this.warnings.push(`character data key uncertain: ${bestMisses} of ${checks.length} values out of range`);
    }
    return best;
  }

  glyph(id: number): SpeedoGlyph | null {
    if (this.cache.has(id)) return this.cache.get(id) ?? null;
    if (!this.key7Known) this.detectKey7();
    let g: SpeedoGlyph | null = null;
    try {
      const raw = this.decode(id);
      if (raw) {
        const scale = this.orusPerEm / this.metricResolution;
        g = {
          id,
          charCode: raw.charCode,
          advanceWidth: round(raw.setWidth * scale),
          bbox: raw.bbox ?? { xMin: 0, yMin: 0, xMax: 0, yMax: 0 },
          path: raw.path,
          contours: raw.contours,
          compound: raw.compound,
        };
      }
    } catch (e) {
      if (!(e instanceof GlyphError)) throw e;
      this.warnings.push(`glyph ${id}: ${e.message}`);
    }
    this.cache.set(id, g);
    return g;
  }

  /** Data range of a glyph, or null if the slot is empty / out of range. */
  private range(id: number): [number, number] | null {
    const slot = id - this.firstCharIndex;
    if (!Number.isInteger(slot) || slot < 0 || slot >= this.glyphCount) return null;
    const start = this.offsets[slot];
    const end = this.offsets[slot + 1];
    if (end <= start) return null;
    if (end > this.b.length) throw new GlyphError("glyph data past the end of the file");
    return [start, end];
  }

  /**
   * Decode a glyph into path data. `strict` also requires the data to end
   * exactly at the glyph's end (used when detecting key7).
   */
  private decode(id: number, strict = false): RawGlyph | null {
    const r = this.range(id);
    if (!r) return null;
    const c = new Cursor(this.b, r[0], r[1], this.keys);
    const charCode = c.word() & 0xffff;
    const setWidth = c.word();
    const sink = new PathSink();
    const { bbox, compound } = this.body(c, sink, 0, strict);
    return { charCode, setWidth, bbox, path: sink.finish(), contours: sink.contours, compound };
  }

  /**
   * Decode a character body (from its format byte on) into `sink`, using the
   * sink's current transform. Compound characters recurse into their parts.
   */
  private body(c: Cursor, sink: PathSink, depth: number, strict: boolean): { bbox: SpeedoBBox; compound: boolean } {
    const format = c.byte();
    if (format & 0x02) c.skip(c.byte()); // optional data
    if (format & 0x01) {
      if (depth >= MAX_COMPOUND_DEPTH) throw new GlyphError("compound characters nested too deeply");
      const bbox = readBBox(c, NO_PLAID);
      const outer = sink.getTransform();
      for (;;) {
        const f = c.byte();
        if (!(f & 0x80)) break;
        const posn = (code: number) => (code === 1 ? c.word() : code === 2 ? c.sbyte() : 0);
        const dx = posn(f & 3);
        const dy = posn((f >> 2) & 3);
        const sx = (f & 0x10 ? c.word() : ONE_SCALE) / ONE_SCALE;
        const sy = (f & 0x20 ? c.word() : ONE_SCALE) / ONE_SCALE;
        const sub = f & 0x40 ? c.word() & 0xffff : c.byte();
        const r = this.range(sub);
        if (!r) continue;
        const sc = new Cursor(this.b, r[0], r[1], this.keys);
        sc.skip(4); // id, set width
        sink.setTransform([outer[0] * sx, outer[1] * sy, outer[0] * dx + outer[2], outer[1] * dy + outer[3]]);
        this.body(sc, sink, depth + 1, strict);
      }
      sink.setTransform(outer);
      if (strict && c.pos !== c.end) throw new GlyphError("compound data ends early");
      return { bbox, compound: true };
    }
    const plaid = readPlaid(c, format);
    const bbox = readBBox(c, plaid);
    decodeOutline(c, plaid, sink);
    if (strict && c.pos !== c.end) throw new GlyphError("outline ends before the glyph data");
    return { bbox, compound: false };
  }

  /**
   * key7 only decides whether a control-zone constraint takes 1 or 2 bytes
   * (byte ^ key7 ≥ 248), so only its top 5 bits matter and it cannot be read
   * from any single field. Pick the first key under which every glyph's data
   * ends exactly where the directory says.
   */
  private detectKey7(): void {
    this.key7Known = true;
    let alive: number[] = [];
    for (let k = 0; k < 256; k += 8) alive.push(k);
    for (let id = this.firstCharIndex; id < this.firstCharIndex + this.glyphCount && alive.length > 1; id++) {
      const ok = alive.filter((k) => {
        this.keys.key7 = k;
        try {
          this.decode(id, true);
          return true;
        } catch {
          return false;
        }
      });
      if (ok.length > 0) alive = ok; // a glyph no key can parse is damaged; ignore it
    }
    this.keys.key7 = alive[0];
  }
}

function isMonotonic(raw: number[], key: number, fileLength: number): boolean {
  let prev = 0;
  for (const r of raw) {
    const v = r ^ key;
    if (v < prev || v > fileLength) return false;
    prev = v;
  }
  return true;
}

/** Parse a Speedo font. Throws NotSpeedoError on a bad header. */
export function parseSpeedo(bytes: Uint8Array): SpeedoFont {
  return new SpeedoFontImpl(bytes);
}

/** CP437 codes used to derive vertical metrics from glyph outlines. */
const METRIC_CODES = { capHeight: 0x48 /* H */, xHeight: 0x78 /* x */, ascender: 0x64 /* d */, descender: 0x70 /* p */ };

export interface FontMetricsTable {
  orusPerEm: number;
  /** Per CP437 code 0–255: advance width in ORUs, or null (no glyph). */
  advances: (number | null)[];
  /** Header metrics (see SpeedoMetrics). */
  header: SpeedoMetrics;
  /**
   * Measured from glyph bboxes (the header has no such fields): top of 'H',
   * top of 'x', top of 'd', bottom of 'p'. Undefined if that glyph is missing.
   */
  capHeight?: number;
  xHeight?: number;
  ascender?: number;
  descender?: number;
}

/**
 * Metrics of a Speedo font as seen through an HG3.FGF character map
 * (code → glyph id, 0xFFFF = none). This is what task 7d measures and stores.
 */
export function fontMetricsTable(font: SpeedoFont, charMap: Uint16Array): FontMetricsTable {
  const glyphFor = (code: number): SpeedoGlyph | null => {
    const id = charMap[code];
    return id === undefined || id === 0xffff ? null : font.glyph(id);
  };
  const advances: (number | null)[] = [];
  for (let code = 0; code < 256; code++) advances.push(glyphFor(code)?.advanceWidth ?? null);
  const top = (code: number) => glyphFor(code)?.bbox.yMax;
  return {
    orusPerEm: font.orusPerEm,
    advances,
    header: font.metrics,
    capHeight: top(METRIC_CODES.capHeight),
    xHeight: top(METRIC_CODES.xHeight),
    ascender: top(METRIC_CODES.ascender),
    descender: glyphFor(METRIC_CODES.descender)?.bbox.yMin,
  };
}
