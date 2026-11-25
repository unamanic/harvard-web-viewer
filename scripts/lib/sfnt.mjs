/**
 * Minimal TrueType (glyf) reader for the outline clone generator
 * (scripts/gen-outline-faces.mjs, docs/RENDERER_TASKS.md task 7d-2).
 *
 * Reads plain .ttf files and WOFF 1.0 wrappers (zlib, via node:zlib). Only
 * what the generator needs: head, hhea, hmtx, maxp, cmap (formats 4 and 12),
 * loca and glyf, including composite glyphs. CFF-flavoured fonts are refused.
 *
 * Glyph outlines come back as contours of points { x, y, on } in font units
 * (y up), with composite glyphs flattened.
 */
import { inflateSync } from "node:zlib";

const tag = (dv, o) => String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3));

/** Unwrap WOFF 1.0 to a table map; plain sfnt is read in place. */
function readTables(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const sig = tag(dv, 0);
  const tables = new Map();
  if (sig === "wOFF") {
    if (tag(dv, 4) === "OTTO") throw new Error("CFF-flavoured WOFF is not supported");
    const numTables = dv.getUint16(12);
    for (let i = 0; i < numTables; i++) {
      const o = 44 + i * 20;
      const t = tag(dv, o);
      const offset = dv.getUint32(o + 4);
      const compLength = dv.getUint32(o + 8);
      const origLength = dv.getUint32(o + 12);
      const raw = bytes.subarray(offset, offset + compLength);
      tables.set(t, compLength < origLength ? new Uint8Array(inflateSync(raw)) : raw);
    }
    return tables;
  }
  if (sig === "OTTO") throw new Error("CFF-flavoured OpenType is not supported");
  if (sig !== "\0\x01\0\0" && sig !== "true") throw new Error(`not a TrueType font (signature ${JSON.stringify(sig)})`);
  const numTables = dv.getUint16(4);
  for (let i = 0; i < numTables; i++) {
    const o = 12 + i * 16;
    const offset = dv.getUint32(o + 8);
    const length = dv.getUint32(o + 12);
    tables.set(tag(dv, o), bytes.subarray(offset, offset + length));
  }
  return tables;
}

const view = (b) => new DataView(b.buffer, b.byteOffset, b.byteLength);

function readCmap(b) {
  const dv = view(b);
  const n = dv.getUint16(2);
  const subtables = [];
  for (let i = 0; i < n; i++) {
    subtables.push({ platform: dv.getUint16(4 + i * 8), encoding: dv.getUint16(6 + i * 8), offset: dv.getUint32(8 + i * 8) });
  }
  const map = new Map();
  // Prefer full-repertoire (3,10 / 0,4+) format 12, then BMP format 4.
  const rank = (s) => {
    const fmt = dv.getUint16(s.offset);
    if (fmt === 12) return 2;
    if (fmt === 4 && (s.platform === 3 || s.platform === 0)) return 1;
    return 0;
  };
  const best = subtables.filter((s) => rank(s) > 0).sort((a, b2) => rank(b2) - rank(a))[0];
  if (!best) throw new Error("no usable cmap subtable");
  const o = best.offset;
  const fmt = dv.getUint16(o);
  if (fmt === 12) {
    const groups = dv.getUint32(o + 12);
    for (let g = 0; g < groups; g++) {
      const p = o + 16 + g * 12;
      const start = dv.getUint32(p);
      const end = dv.getUint32(p + 4);
      const gid = dv.getUint32(p + 8);
      for (let c = start; c <= end; c++) map.set(c, gid + c - start);
    }
  } else {
    const segX2 = dv.getUint16(o + 6);
    const ends = o + 14;
    const starts = ends + segX2 + 2;
    const deltas = starts + segX2;
    const ranges = deltas + segX2;
    for (let s = 0; s < segX2; s += 2) {
      const end = dv.getUint16(ends + s);
      const start = dv.getUint16(starts + s);
      const delta = dv.getInt16(deltas + s);
      const ro = dv.getUint16(ranges + s);
      for (let c = start; c <= end && c !== 0xffff; c++) {
        let gid;
        if (ro === 0) gid = (c + delta) & 0xffff;
        else {
          const at = ranges + s + ro + (c - start) * 2;
          gid = dv.getUint16(at);
          if (gid !== 0) gid = (gid + delta) & 0xffff;
        }
        if (gid !== 0) map.set(c, gid);
      }
    }
  }
  return map;
}

/** Read a TrueType font. */
export function readTrueType(buf) {
  const t = readTables(buf);
  for (const need of ["head", "hhea", "hmtx", "maxp", "cmap", "loca", "glyf"]) {
    if (!t.has(need)) throw new Error(`missing table ${need}`);
  }
  const head = view(t.get("head"));
  const unitsPerEm = head.getUint16(18);
  const longLoca = head.getInt16(50) === 1;
  const numGlyphs = view(t.get("maxp")).getUint16(4);
  const numHMetrics = view(t.get("hhea")).getUint16(34);
  const hmtx = view(t.get("hmtx"));
  const loca = view(t.get("loca"));
  const glyfBytes = t.get("glyf");
  const glyf = view(glyfBytes);
  const cmap = readCmap(t.get("cmap"));

  const advance = (gid) => hmtx.getUint16(4 * Math.min(gid, numHMetrics - 1));
  const lsb = (gid) => (gid < numHMetrics ? hmtx.getInt16(4 * gid + 2) : hmtx.getInt16(4 * numHMetrics + 2 * (gid - numHMetrics)));
  const locaAt = (i) => (longLoca ? loca.getUint32(i * 4) : loca.getUint16(i * 2) * 2);

  /** Contours [{x,y,on}[]] of a glyph, composites flattened. */
  function contours(gid, depth = 0) {
    if (depth > 8) throw new Error("composite glyph nesting too deep");
    const start = locaAt(gid);
    const end = locaAt(gid + 1);
    if (end <= start) return [];
    let p = start;
    const nContours = glyf.getInt16(p);
    p += 10;
    if (nContours >= 0) {
      const endPts = [];
      for (let i = 0; i < nContours; i++, p += 2) endPts.push(glyf.getUint16(p));
      const nPts = nContours ? endPts[nContours - 1] + 1 : 0;
      const insLen = glyf.getUint16(p);
      p += 2 + insLen;
      const flags = [];
      while (flags.length < nPts) {
        const f = glyf.getUint8(p++);
        flags.push(f);
        if (f & 8) {
          let rep = glyf.getUint8(p++);
          while (rep-- > 0) flags.push(f);
        }
      }
      const xs = [];
      let v = 0;
      for (const f of flags) {
        if (f & 2) {
          const d = glyf.getUint8(p++);
          v += f & 16 ? d : -d;
        } else if (!(f & 16)) {
          v += glyf.getInt16(p);
          p += 2;
        }
        xs.push(v);
      }
      const ys = [];
      v = 0;
      for (const f of flags) {
        if (f & 4) {
          const d = glyf.getUint8(p++);
          v += f & 32 ? d : -d;
        } else if (!(f & 32)) {
          v += glyf.getInt16(p);
          p += 2;
        }
        ys.push(v);
      }
      const out = [];
      let s = 0;
      for (const e of endPts) {
        const c = [];
        for (let i = s; i <= e; i++) c.push({ x: xs[i], y: ys[i], on: (flags[i] & 1) === 1 });
        out.push(c);
        s = e + 1;
      }
      return out;
    }
    // Composite.
    const out = [];
    let more = true;
    while (more) {
      const flags = glyf.getUint16(p);
      const sub = glyf.getUint16(p + 2);
      p += 4;
      let a1, a2;
      if (flags & 1) {
        a1 = glyf.getInt16(p);
        a2 = glyf.getInt16(p + 2);
        p += 4;
      } else {
        a1 = glyf.getInt8(p);
        a2 = glyf.getInt8(p + 1);
        p += 2;
      }
      if (!(flags & 2)) throw new Error(`glyph ${gid}: point-matched composites are not supported`);
      let a = 1, b = 0, c = 0, d = 1;
      const f2 = (o) => glyf.getInt16(o) / 16384;
      if (flags & 8) {
        a = d = f2(p);
        p += 2;
      } else if (flags & 0x40) {
        a = f2(p);
        d = f2(p + 2);
        p += 4;
      } else if (flags & 0x80) {
        a = f2(p);
        b = f2(p + 2);
        c = f2(p + 4);
        d = f2(p + 6);
        p += 8;
      }
      for (const contour of contours(sub, depth + 1)) {
        out.push(contour.map((pt) => ({ x: a * pt.x + c * pt.y + a1, y: b * pt.x + d * pt.y + a2, on: pt.on })));
      }
      more = (flags & 0x20) !== 0;
    }
    return out;
  }

  return {
    unitsPerEm,
    numGlyphs,
    /** Glyph id for a Unicode code point, or undefined. */
    glyphId: (cp) => cmap.get(cp),
    advance,
    lsb,
    contours,
  };
}

/** Bounding box of contours (on and off points), or null if empty. */
export function contoursBBox(cs) {
  let xMin = Infinity, yMin = Infinity, xMax = -Infinity, yMax = -Infinity;
  for (const c of cs) {
    for (const p of c) {
      if (p.x < xMin) xMin = p.x;
      if (p.x > xMax) xMax = p.x;
      if (p.y < yMin) yMin = p.y;
      if (p.y > yMax) yMax = p.y;
    }
  }
  return xMin === Infinity ? null : { xMin, yMin, xMax, yMax };
}
