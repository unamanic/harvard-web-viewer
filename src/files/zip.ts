/**
 * A small ZIP reader, so that one .zip holding a show or chart and the files
 * it names can be opened like a folder. Everything happens in the browser:
 * stored entries are copied, deflated ones go through the platform's
 * DecompressionStream("deflate-raw"). No other compression methods and no
 * encryption. ZIP64 records are read (some archivers write them even for
 * small files, e.g. Info-ZIP when zipping a pipe), within the size limits.
 *
 * Format: PKWARE APPNOTE.TXT. The central directory at the end of the file
 * lists every entry (name, method, sizes, CRC-32, offset of its local
 * header); each local header is followed by the entry's data.
 */

/** One file from an archive. */
export interface ZipEntry {
  /** Path inside the archive, forward slashes. */
  path: string;
  bytes: Uint8Array;
}

export interface ZipContents {
  entries: ZipEntry[];
  /** Entries left out and why (encrypted, unsupported method, damaged…). */
  warnings: string[];
}

/** Limits against damaged or hostile archives ("zip bombs"). */
export const ZIP_LIMITS = {
  maxEntries: 10_000,
  /** Total unpacked bytes. */
  maxTotalBytes: 512 * 1024 * 1024,
};

export class ZipError extends Error {}

const SIG_EOCD = 0x06054b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;
const SIG_ZIP64_LOCATOR = 0x07064b50;
const SIG_ZIP64_EOCD = 0x06064b50;
/** Extra field holding an entry's 64-bit sizes and offset. */
const EXTRA_ZIP64 = 0x0001;

/** True when the bytes start like a ZIP archive (a local header, or an empty archive's end record). */
export function looksLikeZip(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  const sig = bytes[0] | (bytes[1] << 8) | (bytes[2] << 16) | (bytes[3] << 24);
  return sig >>> 0 === SIG_LOCAL || sig >>> 0 === SIG_EOCD;
}

/** True for a file name ending in .zip. */
export function isZipName(name: string): boolean {
  return /\.zip$/i.test(name);
}

/** Code page 437, bytes 0x80 to 0xFF: the default for ZIP names without the UTF-8 flag (DOS-era archivers). */
const CP437_HIGH =
  "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ";

function decodeName(bytes: Uint8Array, utf8: boolean): string {
  if (utf8) return new TextDecoder("utf-8").decode(bytes);
  let s = "";
  for (const b of bytes) s += b < 0x80 ? String.fromCharCode(b) : CP437_HIGH[b - 0x80];
  return s;
}

let crcTable: Uint32Array | null = null;
/** CRC-32 (IEEE), as stored in ZIP headers. */
export function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (const b of bytes) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Inflate raw DEFLATE data, stopping with an error past `limit` bytes. */
async function inflateRaw(data: Uint8Array, limit: number): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limit) {
      await reader.cancel();
      throw new ZipError("unpacks to more than its stated size");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/** Entries that are archiver or OS clutter, not files the user put in. */
function isClutter(path: string): boolean {
  const parts = path.split("/");
  const name = parts[parts.length - 1];
  return parts.includes("__MACOSX") || name.startsWith("._") || name === ".DS_Store" || name === "Thumbs.db" || name === "desktop.ini";
}

/** Clean an entry path: forward slashes, no leading slash, no "." or ".." segments. */
function cleanPath(name: string): string {
  return name
    .replace(/\\/g, "/")
    .split("/")
    .filter((s) => s !== "" && s !== "." && s !== "..")
    .join("/");
}

/**
 * Read every file in a ZIP archive. Directories and archiver clutter
 * (__MACOSX, ._ files, .DS_Store) are skipped silently; entries that cannot
 * be read are skipped with a warning. Throws ZipError when the archive as a
 * whole cannot be read.
 */
export async function readZip(bytes: Uint8Array, limits = ZIP_LIMITS): Promise<ZipContents> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (o: number) => view.getUint16(o, true);
  const u32 = (o: number) => view.getUint32(o, true);
  const u64 = (o: number) => Number(view.getBigUint64(o, true));

  // The end-of-central-directory record is the last 22 bytes plus a comment of up to 65,535.
  let eocd = -1;
  for (let o = bytes.length - 22; o >= Math.max(0, bytes.length - 22 - 0xffff); o--) {
    if (u32(o) === SIG_EOCD && o + 22 + u16(o + 20) === bytes.length) {
      eocd = o;
      break;
    }
  }
  if (eocd < 0) {
    for (let o = bytes.length - 22; o >= Math.max(0, bytes.length - 22 - 0xffff); o--) {
      if (u32(o) === SIG_EOCD) {
        eocd = o;
        break;
      }
    }
  }
  if (eocd < 0) throw new ZipError("not a ZIP archive, or it is incomplete");
  let count = u16(eocd + 10);
  let dirSize = u32(eocd + 12);
  let dirOffset = u32(eocd + 16);
  let dirEnd = eocd;
  if (eocd >= 20 && u32(eocd - 20) === SIG_ZIP64_LOCATOR) {
    // ZIP64: the real counts and offsets are in the ZIP64 end record the locator points to.
    const at = u64(eocd - 20 + 8);
    if (at + 56 > eocd - 20 || u32(at) !== SIG_ZIP64_EOCD) throw new ZipError("its ZIP64 directory is damaged");
    count = u64(at + 32);
    dirSize = u64(at + 40);
    dirOffset = u64(at + 48);
    dirEnd = at;
  }
  if (count > limits.maxEntries) throw new ZipError(`has more than ${limits.maxEntries} entries`);
  if (dirOffset + dirSize > dirEnd) throw new ZipError("its directory is damaged");

  const entries: ZipEntry[] = [];
  const warnings: string[] = [];
  let total = 0;
  let o = dirOffset;
  for (let i = 0; i < count; i++) {
    if (o + 46 > dirEnd || u32(o) !== SIG_CENTRAL) throw new ZipError("its directory is damaged");
    const flags = u16(o + 8);
    const method = u16(o + 10);
    const crc = u32(o + 16);
    let packed = u32(o + 20);
    let size = u32(o + 24);
    const nameLen = u16(o + 28);
    const extraLen = u16(o + 30);
    const commentLen = u16(o + 32);
    let local = u32(o + 42);
    const rawName = bytes.subarray(o + 46, o + 46 + nameLen);
    // ZIP64 extra field: 64-bit values for the fields stored as 0xFFFFFFFF, in this order.
    let zip64Missing = false;
    if (size === 0xffffffff || packed === 0xffffffff || local === 0xffffffff) {
      let e = o + 46 + nameLen;
      const extraEnd = e + extraLen;
      zip64Missing = true;
      while (e + 4 <= extraEnd) {
        const id = u16(e);
        const len = u16(e + 2);
        if (id === EXTRA_ZIP64 && e + 4 + len <= extraEnd) {
          let v = e + 4;
          const next = () => {
            if (v + 8 > e + 4 + len) throw new ZipError("its directory is damaged");
            const n = u64(v);
            v += 8;
            return n;
          };
          if (size === 0xffffffff) size = next();
          if (packed === 0xffffffff) packed = next();
          if (local === 0xffffffff) local = next();
          zip64Missing = false;
          break;
        }
        e += 4 + len;
      }
    }
    o += 46 + nameLen + extraLen + commentLen;

    const name = decodeName(rawName, (flags & 0x800) !== 0);
    const path = cleanPath(name);
    if (path === "" || name.endsWith("/") || name.endsWith("\\") || isClutter(path)) continue;
    const skip = (why: string) => warnings.push(`${path}: ${why}; skipped`);

    if (flags & 0x1) {
      skip("encrypted");
      continue;
    }
    if (method !== 0 && method !== 8) {
      skip(`compressed with method ${method}, which is not supported`);
      continue;
    }
    if (zip64Missing) {
      skip("damaged (its 64-bit sizes are missing)");
      continue;
    }
    if (total + size > limits.maxTotalBytes) throw new ZipError(`unpacks to more than ${Math.round(limits.maxTotalBytes / 1048576)} MB`);
    if (local + 30 > bytes.length || u32(local) !== SIG_LOCAL) {
      skip("damaged");
      continue;
    }
    const start = local + 30 + u16(local + 26) + u16(local + 28);
    if (start + packed > bytes.length) {
      skip("damaged (cut short)");
      continue;
    }
    const data = bytes.subarray(start, start + packed);
    let out: Uint8Array;
    try {
      out = method === 0 ? data.slice() : await inflateRaw(data, size);
    } catch (e) {
      skip(e instanceof ZipError ? e.message : "damaged (cannot be unpacked)");
      continue;
    }
    if (out.length !== size || crc32(out) !== crc) {
      skip("damaged (checksum does not match)");
      continue;
    }
    total += size;
    entries.push({ path, bytes: out });
  }
  return { entries, warnings };
}
