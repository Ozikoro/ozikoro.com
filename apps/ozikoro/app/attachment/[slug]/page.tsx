/**
 * The destination for WordPress attachment permalinks.
 *
 * WHY THIS EXISTS, AND WHY THE PATH LOOKS LIKE THIS
 *
 * The old site published every attachment at `/<parent-post-slug>/<attachment-slug>/`. Round 81 measured
 * that 26 of the 30 remaining broken targets have that shape and that the last segment resolves exactly
 * against `ozikoro_media.slug`. This platform serves those records at `/documents/<slug>/`.
 *
 * A route for the original shape is **impossible** here, proven both ways in rounds 81 and 82:
 *
 *     app/[parent]/[child]/   "You cannot use different slug names for the same dynamic path"
 *     app/[slug]/[slug]/      "You cannot have the same slug name \"slug\" repeat within a single dynamic path"
 *
 * `app/[slug]` already claims depth one, and a nested dynamic must either repeat that name or differ.
 * So the address is rewritten to THIS path by the middleware — a STATIC parent, which is expressible —
 * and this page resolves the record and sends the reader to its canonical home.
 *
 * It is deliberately a `permanentRedirect`: the attachment address is a permanent alias, and a temporary
 * status would tell a crawler to keep indexing the old shape.
 */
import { notFound, permanentRedirect } from 'next/navigation';
import { getDb } from '@ozituma/db/client';
import { getMediaBySlug } from '@ozikoro/platform';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ slug: string }>;
}

export default async function AttachmentPage({ params }: PageProps) {
  const { slug } = await params;
  const db = await getDb();
  const media = await getMediaBySlug(db, slug);
  if (media) permanentRedirect(`/documents/${media.slug}/`);
  notFound();
}
