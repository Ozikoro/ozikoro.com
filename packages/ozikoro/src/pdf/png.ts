/**
 * A PNG READER, SO A FIGURE WITH TRANSPARENCY CAN GO INTO A PDF AS WHAT IT IS.
 *
 * WHY THIS EXISTS
 *
 * A PDF carries three kinds of image this writer can use: a JPEG through `/DCTDecode`, and raw samples
 * through `/FlateDecode` with an optional `/SMask` for transparency. **JPEG has no alpha channel**, so the
 * only way to place artwork with transparency — the official logo, which is gold on transparent — through
 * a JPEG is to composite it onto a guessed background. `publication.ts` used to do exactly that, and its
 * own comment admits the cost: the composite is only right on the one ground it was baked for.
 *
 * `/SMask` is the honest route, and the approved reference takes it: its logo objects are `/DeviceRGB`
 * with an `/SMask`, not JPEGs. This decodes a PNG to the two buffers that need — colour and coverage.
 *
 * AND THE SECOND REASON, WHICH IS NOT ABOUT THE LOGO
 *
 * The archive holds 229 WebP and 438 PNG figures, and the download route converted them by shelling out
 * to `sips`, which exists on macOS and **not on the Linux host the archive actually deploys to**. There,
 * every PNG figure vanished from the publication without a word — the same silent shape as the missing
 * media root. PNG is the larger half of that fault and needs no external program.
 *
 * WHAT IT REFUSES
 *
 * Bit depths other than 8 and Adam7 interlacing are refused by name rather than half-decoded. **A PNG
 * decoded wrongly does not look like a mistake, it looks like a photograph of noise**, and a named refusal
 * is a fault someone can act on. WebP is still refused: there is no decoder here for it, and pretending
 * otherwise is how a WebP's bytes end up inside an image object that claims to be a JPEG.
 */

import zlib from 'node:zlib';

export type DecodedPng = {
  width: number;
  height: number;
  /** Row-major RGB, three bytes per pixel. */
  rgb: Buffer;
  /** Row-major coverage, one byte per pixel, or null when every pixel is opaque. */
  alpha: Buffer | null;
};

export class PngError extends Error {}

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function isPng(data: Buffer): boolean {
  return data.length > 8 && data.subarray(0, 8).equals(SIGNATURE);
}

/** Is this a JPEG? A PDF embeds one natively and there is nothing to decode. */
export function isJpeg(data: Buffer): boolean {
  return data.length > 2 && data[0] === 0xff && data[1] === 0xd8;
}

export function decodePng(data: Buffer): DecodedPng {
  if (!isPng(data)) throw new PngError('not a PNG: the signature does not match');
  let at = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colourType = 0;
  let interlace = 0;
  let palette: Buffer | null = null;
  let transparency: Buffer | null = null;
  const idat: Buffer[] = [];

  while (at + 8 <= data.length) {
    const length = data.readUInt32BE(at);
    const type = data.toString('latin1', at + 4, at + 8);
    const body = at + 8;
    if (body + length + 4 > data.length) break;
    if (type === 'IHDR') {
      width = data.readUInt32BE(body);
      height = data.readUInt32BE(body + 4);
      bitDepth = data[body + 8] as number;
      colourType = data[body + 9] as number;
      interlace = data[body + 12] as number;
    } else if (type === 'PLTE') {
      palette = Buffer.from(data.subarray(body, body + length));
    } else if (type === 'tRNS') {
      transparency = Buffer.from(data.subarray(body, body + length));
    } else if (type === 'IDAT') {
      idat.push(Buffer.from(data.subarray(body, body + length)));
    } else if (type === 'IEND') {
      break;
    }
    at = body + length + 4;
  }

  if (!width || !height) throw new PngError('PNG has no IHDR');
  if (bitDepth !== 8) throw new PngError(`PNG bit depth ${bitDepth} is not supported; 8 is`);
  if (interlace !== 0) throw new PngError('interlaced (Adam7) PNG is not supported');
  if (idat.length === 0) throw new PngError('PNG has no image data');

  const channels = colourType === 0 ? 1 : colourType === 2 ? 3 : colourType === 3 ? 1 : colourType === 4 ? 2 : colourType === 6 ? 4 : 0;
  if (channels === 0) throw new PngError(`PNG colour type ${colourType} is not supported`);
  if (colourType === 3 && !palette) throw new PngError('indexed PNG has no palette');

  const raw = inflate(Buffer.concat(idat));
  const stride = width * channels;
  if (raw.length < (stride + 1) * height) {
    throw new PngError(`PNG image data is ${raw.length} bytes, short of the ${(stride + 1) * height} it needs`);
  }
  const pixels = unfilter(raw, width, height, channels);

  const rgb = Buffer.alloc(width * height * 3);
  let alpha: Buffer | null = null;
  const needAlpha = colourType === 4 || colourType === 6 || (colourType === 3 && transparency !== null);
  if (needAlpha) alpha = Buffer.alloc(width * height, 255);

  for (let i = 0; i < width * height; i++) {
    let r: number; let g: number; let b: number; let a = 255;
    if (colourType === 0) {
      r = g = b = pixels[i] as number;
      if (transparency && transparency.length >= 2) {
        const grey = transparency.readUInt16BE(0) & 0xff;
        if ((pixels[i] as number) === grey) a = 0;
      }
    } else if (colourType === 2) {
      r = pixels[i * 3] as number; g = pixels[i * 3 + 1] as number; b = pixels[i * 3 + 2] as number;
    } else if (colourType === 3) {
      const index = pixels[i] as number;
      r = palette?.[index * 3] ?? 0; g = palette?.[index * 3 + 1] ?? 0; b = palette?.[index * 3 + 2] ?? 0;
      if (transparency && index < transparency.length) a = transparency[index] as number;
    } else if (colourType === 4) {
      r = g = b = pixels[i * 2] as number;
      a = pixels[i * 2 + 1] as number;
    } else {
      r = pixels[i * 4] as number; g = pixels[i * 4 + 1] as number; b = pixels[i * 4 + 2] as number;
      a = pixels[i * 4 + 3] as number;
    }
    rgb[i * 3] = r; rgb[i * 3 + 1] = g; rgb[i * 3 + 2] = b;
    if (alpha) alpha[i] = a;
  }

  // **A fully opaque alpha channel is not an alpha channel.** Sending one anyway writes a second full-size
  // image into the PDF for nothing, which on a photographic plate is several hundred kilobytes.
  if (alpha && alpha.every((v) => v === 255)) alpha = null;
  return { width, height, rgb, alpha };
}

function inflate(data: Buffer): Buffer {
  try {
    return zlib.inflateSync(data);
  } catch (error) {
    throw new PngError(`PNG image data is not a valid zlib stream: ${(error as Error).message}`);
  }
}

/** Undo the per-row filters. **Every row carries its own filter byte**, which is why this cannot be a map. */
function unfilter(raw: Buffer, width: number, height: number, channels: number): Buffer {
  const stride = width * channels;
  const out = Buffer.alloc(stride * height);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)] as number;
    const from = y * (stride + 1) + 1;
    const row = out.subarray(y * stride, y * stride + stride);
    raw.copy(row, 0, from, from + stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? (row[x - channels] as number) : 0;
      const b = prev[x] as number;
      const c = x >= channels ? (prev[x - channels] as number) : 0;
      const v = row[x] as number;
      if (filter === 1) row[x] = (v + a) & 0xff;
      else if (filter === 2) row[x] = (v + b) & 0xff;
      else if (filter === 3) row[x] = (v + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) row[x] = (v + paeth(a, b, c)) & 0xff;
      else if (filter !== 0) throw new PngError(`unknown PNG row filter ${filter}`);
    }
    prev = row;
  }
  return out;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}
