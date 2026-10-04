/**
 * THE PNG READER'S TESTS.
 *
 * This is what lets the brand's icon go into a PDF as gold-on-nothing rather than gold composited onto a
 * guessed background, and it is what stops 438 of the archive's figures depending on a macOS-only `sips`
 * that the host it deploys to does not have. **A PNG decoded wrongly does not look like a mistake, it looks
 * like a photograph of noise** — so the filters are tested against PNGs built byte by byte here rather than
 * only against whatever the archive happens to hold.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import zlib from 'node:zlib';
import { decodePng, isJpeg, isPng, PngError } from './png.ts';

/** A PNG built here, so the filter under test is the one being exercised. */
function png(width: number, height: number, colourType: number, raw: Buffer): Buffer {
  const crcTable = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    return table;
  })();
  const crc = (b: Buffer) => {
    let c = 0xffffffff;
    for (const byte of b) c = (crcTable[(c ^ byte) & 0xff] as number) ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, body: Buffer) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(body.length, 0);
    head.write(type, 4, 4, 'latin1');
    const tail = Buffer.alloc(4);
    tail.writeUInt32BE(crc(Buffer.concat([head.subarray(4), body])), 0);
    return Buffer.concat([head, body, tail]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = colourType;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

test('a filtered RGB row is unfiltered back to its pixels', () => {
  // Two pixels: (10,20,30) then (40,50,60), written with the Sub filter (1), which stores differences.
  const raw = Buffer.from([1, 10, 20, 30, 30, 30, 30]); // filter byte, then the deltas
  const decoded = decodePng(png(2, 1, 2, raw));
  assert.equal(decoded.width, 2);
  assert.equal(decoded.height, 1);
  assert.deepEqual([...decoded.rgb], [10, 20, 30, 40, 50, 60]);
  assert.equal(decoded.alpha, null, 'an opaque image must not carry an alpha channel');
});

test('an RGBA image keeps its coverage, and a fully opaque one is not given any', () => {
  const transparent = Buffer.from([0, 10, 20, 30, 0]);
  const decoded = decodePng(png(1, 1, 6, transparent));
  assert.deepEqual([...decoded.rgb], [10, 20, 30]);
  assert.ok(decoded.alpha);
  assert.equal(decoded.alpha[0], 0);

  const opaque = Buffer.from([0, 10, 20, 30, 255]);
  assert.equal(decodePng(png(1, 1, 6, opaque)).alpha, null, 'an opaque PNG was given an alpha channel');
});

test('the official icon decodes to its own gold with real transparency', { skip: !existsSync(join(import.meta.dirname, '..', '..', 'assets', 'official', 'ozikoro-icon-yellow.png')) && 'the icon is not present' }, () => {
  const data = readFileSync(join(import.meta.dirname, '..', '..', 'assets', 'official', 'ozikoro-icon-yellow.png'));
  assert.ok(isPng(data));
  const decoded = decodePng(data);
  assert.equal(decoded.width, 1000);
  assert.equal(decoded.height, 529);
  assert.ok(decoded.alpha, 'the icon lost its transparency');
  let gold = 0;
  let clear = 0;
  for (let i = 0; i < decoded.width * decoded.height; i++) {
    if ((decoded.alpha as Buffer)[i] === 0) { clear++; continue; }
    if (decoded.rgb[i * 3] === 0xdd && decoded.rgb[i * 3 + 1] === 0xb0 && decoded.rgb[i * 3 + 2] === 0x2f) gold++;
  }
  assert.ok(gold > 200_000, `only ${gold} pixels are the brand's #ddb02f`);
  assert.ok(clear > 200_000, 'the icon has almost no transparent area');
});

test('what is not a PNG is said so by name', () => {
  assert.throws(() => decodePng(Buffer.from('this is not a png, it is a sentence')), PngError);
  assert.equal(isPng(Buffer.from('nope')), false);
  assert.equal(isJpeg(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), true);
  assert.equal(isJpeg(Buffer.from([0x89, 0x50])), false);
});
