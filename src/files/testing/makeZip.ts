/** Build ZIP archives for tests (stored or deflated entries, deflated with CompressionStream). */
import { crc32 } from "../zip";

async function deflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export interface TestZipEntry {
  name: string;
  data?: Uint8Array | string;
  /** 0 stored, 8 deflated (default), anything else is written as given with the data stored. */
  method?: number;
  /** General-purpose flags (bit 0 encrypted, bit 11 UTF-8 name). */
  flags?: number;
  /** Raw name bytes, overriding `name` (for code page 437 names). */
  nameBytes?: Uint8Array;
  /** Override the stored CRC-32 or unpacked size (damaged entries). */
  crc?: number;
  size?: number;
}

const enc = new TextEncoder();

export interface MakeZipOptions {
  comment?: string;
  /** Write ZIP64 records: sizes and offsets as 0xFFFFFFFF with a ZIP64 extra field, plus the ZIP64 end records. */
  zip64?: boolean;
}

export async function makeZip(entries: readonly TestZipEntry[], options: MakeZipOptions | string = {}): Promise<Uint8Array> {
  const { comment = "", zip64 = false } = typeof options === "string" ? { comment: options } : options;
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const e of entries) {
    const raw = typeof e.data === "string" ? enc.encode(e.data) : (e.data ?? new Uint8Array());
    const method = e.method ?? 8;
    const packed = method === 8 ? await deflateRaw(raw) : raw;
    const name = e.nameBytes ?? enc.encode(e.name);
    const crc = e.crc ?? crc32(raw);
    const size = e.size ?? raw.length;
    const flags = e.flags ?? 0;
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, flags, true);
    local.setUint16(8, method, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, packed.length, true);
    local.setUint32(22, size, true);
    local.setUint16(26, name.length, true);
    // ZIP64 extra: unpacked size, packed size, local header offset (all 64-bit).
    const extra = new DataView(new ArrayBuffer(zip64 ? 28 : 0));
    if (zip64) {
      extra.setUint16(0, 0x0001, true);
      extra.setUint16(2, 24, true);
      extra.setBigUint64(4, BigInt(size), true);
      extra.setBigUint64(12, BigInt(packed.length), true);
      extra.setBigUint64(20, BigInt(offset), true);
    }
    const head = new DataView(new ArrayBuffer(46));
    head.setUint32(0, 0x02014b50, true);
    head.setUint16(4, 20, true);
    head.setUint16(6, 20, true);
    head.setUint16(8, flags, true);
    head.setUint16(10, method, true);
    head.setUint32(16, crc, true);
    head.setUint32(20, zip64 ? 0xffffffff : packed.length, true);
    head.setUint32(24, zip64 ? 0xffffffff : size, true);
    head.setUint16(28, name.length, true);
    head.setUint16(30, extra.byteLength, true);
    head.setUint32(42, zip64 ? 0xffffffff : offset, true);
    parts.push(new Uint8Array(local.buffer), name, packed);
    central.push(new Uint8Array(head.buffer), name, new Uint8Array(extra.buffer));
    offset += 30 + name.length + packed.length;
  }
  const dirSize = central.reduce((n, c) => n + c.length, 0);
  const note = enc.encode(comment);
  const tail: Uint8Array[] = [];
  if (zip64) {
    const rec = new DataView(new ArrayBuffer(56));
    rec.setUint32(0, 0x06064b50, true);
    rec.setBigUint64(4, 44n, true);
    rec.setUint16(12, 45, true);
    rec.setUint16(14, 45, true);
    rec.setBigUint64(24, BigInt(entries.length), true);
    rec.setBigUint64(32, BigInt(entries.length), true);
    rec.setBigUint64(40, BigInt(dirSize), true);
    rec.setBigUint64(48, BigInt(offset), true);
    const loc = new DataView(new ArrayBuffer(20));
    loc.setUint32(0, 0x07064b50, true);
    loc.setBigUint64(8, BigInt(offset + dirSize), true);
    loc.setUint32(16, 1, true);
    tail.push(new Uint8Array(rec.buffer), new Uint8Array(loc.buffer));
  }
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, zip64 ? 0xffff : entries.length, true);
  end.setUint16(10, zip64 ? 0xffff : entries.length, true);
  end.setUint32(12, zip64 ? 0xffffffff : dirSize, true);
  end.setUint32(16, zip64 ? 0xffffffff : offset, true);
  end.setUint16(20, note.length, true);
  const all = [...parts, ...central, ...tail, new Uint8Array(end.buffer), note];
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of all) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
