'use client';

/**
 * A thumbnail that admits it when the file is not there.
 *
 * ── WHY THIS IS A CLIENT COMPONENT AND NOT A PLAIN `<img>` ───────────────────────────────────────────
 *
 * The register holds rows whose `storage_key` names a file that was catalogued from WordPress. **3,444 rows
 * carry a key and 3,443 objects were measured in the bucket**, and 51 of the migrated files were found to
 * have gone from the old site entirely — so "the row has a key" and "the archive can serve the bytes" are two
 * different facts, and only a request settles the second one.
 *
 * A plain `<img>` on a row like that draws the browser's broken-image glyph: **a picture-shaped hole that
 * says the archive holds something it cannot produce**, which is the one thing this work is not allowed to
 * do. There is no server-side check to make instead — a `HEAD` per row would be 3,444 round trips to render
 * one page — so the check happens where the bytes are actually requested, and what fails is drawn as a
 * labelled plate naming the kind and the file, exactly as a film or a PDF is drawn.
 *
 * The plate's own class names are generic (`mediathumb__plate`, `mediathumb__file`) because the same
 * component is used by the register's grid (`.mediareg`) and by the media picker's grid (`.modal`), and each
 * of those stylesheets styles them inside its own scope.
 */
import { useState } from 'react';

export interface MediaThumbProps {
  /** The record's own address — `/media/<key>`. Null when the archive holds no file for the row. */
  src: string | null;
  /** The record's alternative text, or the empty string. The archive does not invent one. */
  alt: string;
  /** Shown on the plate when there is no picture to draw. */
  label: string;
  /** The file's own name, for the plate. */
  file: string;
}

export function MediaThumb({ src, alt, label, file }: MediaThumbProps) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <span className="mediathumb__plate">
        <strong>{label}</strong>
        <span className="mediathumb__file">{failed ? `${file} — not served` : file}</span>
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- served by this archive's own media route, at its
    // own intrinsic size; there is no optimizer configuration for `/media/...` and none is wanted.
    <img src={src} alt={alt} loading="lazy" decoding="async" onError={() => setFailed(true)} />
  );
}
