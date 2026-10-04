/**
 * A TRUE TYPE READER AND SUBSETTER, BECAUSE THE IGBO DIACRITICS NEED A REAL FACE.
 *
 * WHAT WAS WRONG BEFORE THIS FILE EXISTED
 *
 * The publication used the PDF base-14 fonts — Times and Helvetica — through `/WinAnsiEncoding`. **WinAnsi
 * stops at U+00FF, so `ọ ụ ị ṅ` and every tone-marked vowel had no code at all**, and `pdfString` in
 * `writer.ts` quietly replaced each one with `?`. An article titled "Ụmụ Ada and Ụmụ Ọkpụ" printed as
 * "?m? Ada and ?m? ?kp?", and an Igbo place name with a dot below lost the letter that carries the
 * meaning. **That is a fault in the record, not a shortcoming of the typeface.**
 *
 * The reference publication embeds DejaVu Serif and DejaVu Sans (its objects are `/AAAAAA+DejaVuSerif` and
 * friends), which is exactly why its own `Ozi Ikòrò` footer and its body text keep their marks. This reads
 * the same faces and embeds them properly, as a **Type0 font with `/Identity-H` encoding, a CIDFontType2
 * descendant and a `/ToUnicode` CMap** — so the text is still searchable, still selectable, and still read
 * aloud by a screen reader.
 *
 * WHY IT SUBSETS RATHER THAN EMBEDS THE WHOLE FACE
 *
 * DejaVu Serif is 380 KB and DejaVu Sans is 756 KB; five faces would add about 2.5 MB to **every**
 * download. A document only ever uses a few hundred of a face's several thousand glyphs, so only those are
 * copied out — which is what the reference's own writer did, and why its embedded fonts are called
 * `AAAAAA+DejaVuSerif` rather than `DejaVuSerif`. **Glyph ids are preserved rather than renumbered**, so
 * `/CIDToGIDMap /Identity` is honest and a composite accent cannot be separated from the letter under it.
 *
 * WHAT IT REFUSES TO DO
 *
 * It reads `glyf`-based outlines, which is what DejaVu and virtually every free text face is. **A CFF
 * (`OTTO`) face is refused rather than half-embedded**, because writing CFF into `FontFile3` while claiming
 * `FontFile2` produces a document that renders blank on some readers — the same class of fault as a WebP
 * written into a `DCTDecode` image object.
 */

/** The eight bytes of an sfnt table directory entry, and its offset. */
type TableRecord = { tag: string; offset: number; length: number };

const u16 = (b: Buffer, at: number) => b.readUInt16BE(at);
const i16 = (b: Buffer, at: number) => b.readInt16BE(at);
const u32 = (b: Buffer, at: number) => b.readUInt32BE(at);

/** A font face this writer can measure, draw and embed. */
export type EmbeddableFont = {
  /** PostScript-ish family name, used for the PDF `/BaseFont`. */
  family: string;
  unitsPerEm: number;
  /** Typographic ascent in 1/1000 em, positive — the PDF's own unit. */
  ascent: number;
  /** Typographic descent in 1/1000 em, **negative**, as the PDF font descriptor wants it. */
  descent: number;
  capHeight: number;
  bbox: readonly [number, number, number, number];
  italicAngle: number;
  fixedPitch: boolean;
  /** The role the layout asked for, not what the file's own style bits claim. */
  bold: boolean;
  italic: boolean;
  /** Glyph id for a code point, or 0 when the face has no glyph for it. */
  glyph(codePoint: number): number;
  /** Advance width in 1/1000 em. */
  advance(glyphId: number): number;
  /** TrueType bytes holding only `codePoints`, for `/FontFile2`. */
  subset(codePoints: Set<number>): Buffer;
  /** The code points this face can actually draw — used to warn rather than to guess. */
  covers(codePoint: number): boolean;
};

export class FontError extends Error {}

/**
 * Read a TrueType face.
 *
 * `bold` and `italic` are not read from the file's style bits: **they are the roles the layout asked for.**
 * The file knows its own `fsSelection`, and where the two disagree the layout is right and the file's
 * metadata is not — DejaVu Serif's italic face, for instance, is a separate file the caller named.
 */
export function readFont(data: Buffer, opts: { bold?: boolean; italic?: boolean } = {}): EmbeddableFont {
  if (data.length < 12) throw new FontError('not a font: fewer than 12 bytes');
  const version = u32(data, 0);
  if (version === 0x4f54544f) {
    throw new FontError('CFF/OpenType (OTTO) faces are not supported; supply a TrueType (glyf) face');
  }
  if (version !== 0x00010000 && version !== 0x74727565) {
    throw new FontError(`not a TrueType face: sfnt version 0x${version.toString(16)}`);
  }

  const numTables = u16(data, 4);
  const tables = new Map<string, TableRecord>();
  for (let i = 0; i < numTables; i++) {
    const at = 12 + i * 16;
    if (at + 16 > data.length) break;
    const tag = data.toString('latin1', at, at + 4);
    // The offsets are relative to the start of the file; a wrong one is a font no reader will open.
    const offset = u32(data, at + 8);
    const length = u32(data, at + 12);
    if (offset + length <= data.length) tables.set(tag, { tag, offset, length });
  }
  const need = ['head', 'hhea', 'hmtx', 'maxp', 'loca', 'glyf'];
  for (const tag of need) {
    if (!tables.has(tag)) throw new FontError(`not a TrueType outline face: no ${tag} table`);
  }
  const at = (tag: string) => (tables.get(tag) as TableRecord).offset;
  const len = (tag: string) => (tables.get(tag) as TableRecord).length;

  const head = at('head');
  const unitsPerEm = u16(data, head + 18) || 1000;
  const indexToLocFormat = i16(data, head + 50);
  const fontBBox: [number, number, number, number] = [
    i16(data, head + 36), i16(data, head + 38), i16(data, head + 40), i16(data, head + 42),
  ];

  const hhea = at('hhea');
  const ascentRaw = i16(data, hhea + 4);
  const descentRaw = i16(data, hhea + 6);
  const numberOfHMetrics = u16(data, hhea + 34);

  const numGlyphs = u16(data, at('maxp') + 4);
  const scale = 1000 / unitsPerEm;

  // `loca` is either a list of u16 halves or a list of u32 bytes, and `head` says which. Reading the wrong
  // one does not throw — it produces glyph outlines that are scaled fractally, which is unmistakable on the
  // page and impossible to miss.
  const locaAt = at('loca');
  const loca: number[] = new Array(numGlyphs + 1);
  for (let i = 0; i <= numGlyphs; i++) {
    loca[i] = indexToLocFormat === 0 ? u16(data, locaAt + i * 2) * 2 : u32(data, locaAt + i * 4);
  }
  const glyfAt = at('glyf');

  const hmtxAt = at('hmtx');
  const advanceRaw = (gid: number): number => {
    const i = gid < numberOfHMetrics ? gid : numberOfHMetrics - 1;
    return i < 0 ? 0 : u16(data, hmtxAt + i * 4);
  };

  // ── cmap ───────────────────────────────────────────────────────────────────
  const cmapMap = new Map<number, number>();
  if (tables.has('cmap')) {
    const cmap = at('cmap');
    const n = u16(data, cmap + 2);
    const subs: { platform: number; encoding: number; offset: number }[] = [];
    for (let i = 0; i < n; i++) {
      const e = cmap + 4 + i * 8;
      subs.push({ platform: u16(data, e), encoding: u16(data, e + 2), offset: cmap + u32(data, e + 4) });
    }
    // Full-repertoire subtables first: (3,10) or (0,4)/format 12 beat the BMP-only format 4.
    const rank = (s: { platform: number; encoding: number; offset: number }) => {
      const fmt = u16(data, s.offset);
      if (fmt === 12) return 0;
      if (fmt === 4) return s.platform === 3 && s.encoding === 1 ? 1 : 2;
      return 3;
    };
    subs.sort((a, b) => rank(a) - rank(b));
    for (const s of subs) {
      const fmt = u16(data, s.offset);
      if (fmt === 4) {
        const segCountX2 = u16(data, s.offset + 6);
        const segCount = segCountX2 / 2;
        const endAt = s.offset + 14;
        const startAt = endAt + segCountX2 + 2;
        const deltaAt = startAt + segCountX2;
        const rangeAt = deltaAt + segCountX2;
        for (let seg = 0; seg < segCount; seg++) {
          const end = u16(data, endAt + seg * 2);
          const start = u16(data, startAt + seg * 2);
          const delta = i16(data, deltaAt + seg * 2);
          const rangeOffset = u16(data, rangeAt + seg * 2);
          if (start === 0xffff) continue;
          for (let cp = start; cp <= end && cp !== 0x10000; cp++) {
            let gid: number;
            if (rangeOffset === 0) {
              gid = (cp + delta) & 0xffff;
            } else {
              const gAt = rangeAt + seg * 2 + rangeOffset + (cp - start) * 2;
              if (gAt + 2 > data.length) continue;
              gid = u16(data, gAt);
              if (gid !== 0) gid = (gid + delta) & 0xffff;
            }
            if (gid !== 0) cmapMap.set(cp, gid);
          }
        }
        break;
      }
      if (fmt === 12) {
        const nGroups = u32(data, s.offset + 12);
        for (let g = 0; g < nGroups; g++) {
          const e = s.offset + 16 + g * 12;
          if (e + 12 > data.length) break;
          const start = u32(data, e);
          const end = u32(data, e + 4);
          const startGid = u32(data, e + 8);
          if (end - start > 0x10ffff) break;
          for (let cp = start; cp <= end; cp++) cmapMap.set(cp, startGid + (cp - start));
        }
        break;
      }
    }
  }
  const glyph = (cp: number) => cmapMap.get(cp) ?? 0;

  // ── glyph geometry helpers ────────────────────────────────────────────────
  const glyphSlice = (gid: number): { at: number; length: number; numberOfContours: number } => {
    if (gid < 0 || gid >= numGlyphs) return { at: 0, length: 0, numberOfContours: 0 };
    const start = loca[gid] as number;
    const end = loca[gid + 1] as number;
    const length = end - start;
    return { at: glyfAt + start, length, numberOfContours: length >= 10 ? i16(data, glyfAt + start) : 0 };
  };

  /** The component glyph ids of a composite glyph, in the order they are referenced. */
  const components = (gid: number): number[] => {
    const g = glyphSlice(gid);
    if (g.numberOfContours >= 0) return [];
    const out: number[] = [];
    let p = g.at + 10;
    const end = g.at + g.length;
    for (let guard = 0; guard < 64; guard++) {
      if (p + 4 > end) break;
      const flags = u16(data, p);
      const index = u16(data, p + 2);
      p += 4;
      out.push(index);
      p += flags & 0x0001 ? 4 : 2; // ARG_1_AND_2_ARE_WORDS
      if (flags & 0x0008) p += 2; // WE_HAVE_A_SCALE
      else if (flags & 0x0040) p += 4; // WE_HAVE_AN_X_AND_Y_SCALE
      else if (flags & 0x0080) p += 8; // WE_HAVE_A_TWO_BY_TWO
      if (!(flags & 0x0020)) break; // MORE_COMPONENTS
    }
    return out;
  };

  const yMaxOf = (gid: number): number => {
    const g = glyphSlice(gid);
    return g.length >= 10 ? i16(data, g.at + 8) : 0;
  };

  // Cap height from the `H`, because it is the only value that is the same on every page. An OS/2
  // `sCapHeight` is preferred where the table is version 2 or later, but plenty of faces leave it at 0.
  let capHeight = Math.round(ascentRaw * 0.72);
  const os2 = tables.get('OS/2');
  if (os2) {
    const v = u16(data, os2.offset);
    if (v >= 2 && os2.length >= 90) {
      const raw = i16(data, os2.offset + 88);
      if (raw > 0) capHeight = raw;
    }
  }
  const hGid = glyph(0x48);
  if (hGid) {
    const raw = yMaxOf(hGid);
    if (raw > 0) capHeight = raw;
  }

  let italicAngle = 0;
  let fixedPitch = false;
  if (tables.has('post')) {
    const post = at('post');
    italicAngle = data.readInt32BE(post + 4) / 65536;
    fixedPitch = u32(data, post + 12) !== 0;
  }
  const family = readName(data, tables);

  return {
    family,
    unitsPerEm,
    ascent: Math.round(ascentRaw * scale),
    descent: Math.round(descentRaw * scale),
    capHeight: Math.round(capHeight * scale),
    bbox: [
      Math.round(fontBBox[0] * scale), Math.round(fontBBox[1] * scale),
      Math.round(fontBBox[2] * scale), Math.round(fontBBox[3] * scale),
    ],
    italicAngle,
    fixedPitch,
    bold: opts.bold ?? false,
    italic: opts.italic ?? false,
    glyph,
    advance: (gid: number) => Math.round(advanceRaw(gid) * scale),
    covers: (cp: number) => cmapMap.has(cp),
    subset: (codePoints: Set<number>) => buildSubset(codePoints),
  };

  function buildSubset(codePoints: Set<number>): Buffer {
    const used = new Set<number>([0]);
    for (const cp of codePoints) {
      const gid = glyph(cp);
      if (gid) used.add(gid);
    }
    // **A composite glyph is a reference, not a copy**, so an `ọ` made of `o` plus a dot below needs both
    // outlines or the letter prints as an empty box with a stray mark. The closure is taken to a fixed
    // point, because a composite can reference another composite.
    for (let pass = 0; pass < 4; pass++) {
      let added = false;
      for (const gid of used) {
        for (const component of components(gid)) {
          if (component && !used.has(component)) { used.add(component); added = true; }
        }
      }
      if (!added) break;
    }
    let maxGid = 0;
    for (const gid of used) maxGid = Math.max(maxGid, gid);

    // glyf, in glyph-id order, with everything unused left empty. Offsets are 4-byte aligned so the long
    // `loca` format can address every one of them exactly.
    const glyfParts: Buffer[] = [];
    const offsets: number[] = [0];
    let cursor = 0;
    for (let gid = 0; gid <= maxGid; gid++) {
      if (used.has(gid)) {
        const g = glyphSlice(gid);
        const body = Buffer.from(data.subarray(g.at, g.at + g.length));
        const pad = (4 - (body.length % 4)) % 4;
        glyfParts.push(body, Buffer.alloc(pad));
        cursor += body.length + pad;
      }
      offsets.push(cursor);
    }
    const glyf = Buffer.concat(glyfParts);
    const loca = Buffer.alloc((maxGid + 2) * 4);
    for (let i = 0; i <= maxGid + 1; i++) loca.writeUInt32BE(offsets[i] as number, i * 4);

    const hmtx = Buffer.alloc((maxGid + 1) * 4);
    for (let gid = 0; gid <= maxGid; gid++) {
      hmtx.writeUInt16BE(Math.min(65535, advanceRaw(gid)), gid * 4);
      const g = glyphSlice(gid);
      const lsb = g.length >= 10 ? i16(data, g.at + 2) : 0;
      hmtx.writeInt16BE(lsb, gid * 4 + 2);
    }

    const head = Buffer.from(data.subarray(at('head'), at('head') + len('head')));
    head.writeUInt32BE(0, 8); // checkSumAdjustment, rewritten once the file is assembled
    head.writeInt16BE(1, 50); // long loca, because the subset's offsets are not in 2-byte halves

    const hhea = Buffer.from(data.subarray(at('hhea'), at('hhea') + len('hhea')));
    hhea.writeUInt16BE(maxGid + 1, 34); // numberOfHMetrics: one per glyph, so hmtx is a plain array

    const maxp = Buffer.from(data.subarray(at('maxp'), at('maxp') + len('maxp')));
    maxp.writeUInt16BE(maxGid + 1, 4);

    const os2 = tables.has('OS/2')
      ? Buffer.from(data.subarray(at('OS/2'), at('OS/2') + len('OS/2')))
      : null;

    const name = tables.has('name')
      ? Buffer.from(data.subarray(at('name'), at('name') + len('name')))
      : null;

    // `post` version 3: no glyph names at all. The original table carries one name per glyph, which in a
    // subset is several kilobytes of strings no PDF reader ever asks for.
    const post = Buffer.alloc(32);
    post.writeUInt32BE(0x00030000, 0);
    post.writeInt32BE(Math.round(italicAngle * 65536), 4);

    return assemble([
      ['OS/2', os2],
      ['cmap', buildCmap(codePoints)],
      ['glyf', glyf],
      ['head', head],
      ['hhea', hhea],
      ['hmtx', hmtx],
      ['loca', loca],
      ['maxp', maxp],
      ['name', name],
      ['post', post],
    ]);
  }

  /** A format 4 subtable, one segment per used code point. **Only what the document contains.** */
  function buildCmap(codePoints: Set<number>): Buffer {
    const bmp = [...codePoints].filter((cp) => cp > 0 && cp < 0xffff).sort((a, b) => a - b);
    const segs: { code: number; gid: number }[] = [];
    for (const cp of bmp) {
      const gid = glyph(cp);
      if (gid) segs.push({ code: cp, gid });
    }
    segs.push({ code: 0xffff, gid: 0 }); // the required terminator
    const segCount = segs.length;
    const buf = Buffer.alloc(16 + segCount * 8);
    buf.writeUInt16BE(4, 0); // format
    buf.writeUInt16BE(buf.length, 2);
    buf.writeUInt16BE(0, 4); // language
    buf.writeUInt16BE(segCount * 2, 6);
    const searchRange = 2 * 2 ** Math.floor(Math.log2(segCount));
    buf.writeUInt16BE(searchRange, 8);
    buf.writeUInt16BE(Math.log2(searchRange / 2), 10);
    buf.writeUInt16BE(segCount * 2 - searchRange, 12);
    for (let i = 0; i < segCount; i++) buf.writeUInt16BE(segs[i]?.code ?? 0xffff, 14 + i * 2);
    buf.writeUInt16BE(0, 14 + segCount * 2); // reservedPad
    const startAt = 16 + segCount * 2;
    const deltaAt = startAt + segCount * 2;
    const rangeAt = deltaAt + segCount * 2;
    for (let i = 0; i < segCount; i++) {
      const s = segs[i] as { code: number; gid: number };
      buf.writeUInt16BE(s.code, startAt + i * 2);
      // An idDelta is signed but the arithmetic is modulo 65536, so it is written unsigned and read back
      // by the same rule. `writeInt16BE` would refuse every delta above 32767.
      buf.writeUInt16BE(s.code === 0xffff ? 1 : (s.gid - s.code) & 0xffff, deltaAt + i * 2);
      buf.writeUInt16BE(0, rangeAt + i * 2);
    }
    // One cmap with two encodings pointing at the same subtable: the Unicode platform and the Windows BMP
    // one. A reader that looks for either finds the same glyphs.
    // The encoding records sit between the header and the subtable, so the subtable's offset is 4 + 8n
    // bytes and not 12 — a subtable pointed at its own directory entry decodes as segment garbage.
    const header = Buffer.alloc(4 + 2 * 8);
    header.writeUInt16BE(0, 0);
    header.writeUInt16BE(2, 2);
    header.writeUInt16BE(0, 4); header.writeUInt16BE(3, 6); header.writeUInt32BE(header.length, 8);
    header.writeUInt16BE(3, 12); header.writeUInt16BE(1, 14); header.writeUInt32BE(header.length, 16);
    return Buffer.concat([header, buf]);
  }

  /** An sfnt file: offset table, directory, data — with the checksums a strict reader checks. */
  function assemble(entries: [string, Buffer | null][]): Buffer {
    const kept = entries.filter((e): e is [string, Buffer] => e[1] !== null && e[1].length > 0);
    kept.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    const n = kept.length;
    const searchRange = 16 * 2 ** Math.floor(Math.log2(n));
    const header = Buffer.alloc(12 + n * 16);
    header.writeUInt32BE(0x00010000, 0);
    header.writeUInt16BE(n, 4);
    header.writeUInt16BE(searchRange, 6);
    header.writeUInt16BE(Math.log2(searchRange / 16), 8);
    header.writeUInt16BE(n * 16 - searchRange, 10);
    const chunks: Buffer[] = [header];
    let offset = header.length;
    for (let i = 0; i < n; i++) {
      const [tag, body] = kept[i] as [string, Buffer];
      const pad = (4 - (body.length % 4)) % 4;
      const padded = pad ? Buffer.concat([body, Buffer.alloc(pad)]) : body;
      const rec = 12 + i * 16;
      header.write(tag, rec, 4, 'latin1');
      header.writeUInt32BE(checksum(padded), rec + 4);
      header.writeUInt32BE(offset, rec + 8);
      header.writeUInt32BE(body.length, rec + 12);
      chunks.push(padded);
      offset += padded.length;
    }
    const file = Buffer.concat(chunks);
    const headRecord = kept.findIndex(([tag]) => tag === 'head');
    if (headRecord >= 0) {
      const at = u32(file, 12 + headRecord * 16 + 8) + 8;
      file.writeUInt32BE((0xb1b0afba - checksum(file)) >>> 0, at);
    }
    return file;
  }

  /** The sfnt checksum: the sum of the table's bytes read as big-endian u32, modulo 2^32. */
  function checksum(b: Buffer): number {
    let sum = 0;
    for (let i = 0; i < b.length; i += 4) {
      const v = ((b[i] ?? 0) << 24) | ((b[i + 1] ?? 0) << 16) | ((b[i + 2] ?? 0) << 8) | (b[i + 3] ?? 0);
      sum = (sum + (v >>> 0)) >>> 0;
    }
    return sum;
  }
}

/** The family name, from the first `name` record that holds one. */
function readName(data: Buffer, tables: Map<string, TableRecord>): string {
  const rec = tables.get('name');
  if (!rec) return 'Unknown';
  const count = u16(data, rec.offset + 2);
  const stringAt = rec.offset + u16(data, rec.offset + 4);
  /*
   * **nameID 1, the family, and not nameID 6.** A PostScript name already carries its style — DejaVu
   * Serif Bold's is `DejaVuSerif-Bold` — so building a subset's name from it and then appending the style
   * produces `/VSOCAW+DejaVuSerif-Bold-Bold`, which is the sort of thing a preflight check flags and a
   * reader quietly tolerates. The family plus the role gives `DejaVuSerif-Bold` once.
   */
  for (const want of [1, 6, 4]) {
    for (let i = 0; i < count; i++) {
      const e = rec.offset + 6 + i * 12;
      if (u16(data, e + 6) !== want) continue;
      const length = u16(data, e + 8);
      const offset = u16(data, e + 10);
      const from = stringAt + offset;
      if (from + length > data.length) continue;
      const raw = data.subarray(from, from + length);
      const platform = u16(data, e);
      const text = platform === 3 || platform === 0
        ? Buffer.from(raw).swap16().toString('utf16le')
        : raw.toString('latin1');
      // PDF names cannot carry spaces or punctuation, so a PostScript name is flattened to its parts.
      const cleaned = text.replace(/[^A-Za-z0-9-]/g, '');
      if (cleaned) return cleaned;
    }
  }
  return 'Unknown';
}
