/**
 * The research network: works, their versions, their review, and what may honestly be claimed about them.
 *
 * THE CLAIM THIS MODULE EXISTS TO PROTECT
 *
 * The plan: "Never label a work peer-reviewed unless it completed the actual peer-review workflow."
 *
 * A `status` column cannot enforce that on its own. Any caller could set it to `published` and any
 * screen could draw a badge. So the workflow here is a set of *permitted transitions*, every one of
 * them written to `ozikoro_publication_transition`, and `peer_reviewed` is set in exactly one place:
 * the transition out of `expert_review`, and only when a completed expert review exists. Nothing else
 * in the codebase writes that column, which makes the honest answer a property of the data rather
 * than of somebody remembering.
 *
 * WHY VERSIONS ARE ROWS
 *
 * "Store every version rather than overwriting published manuscripts." A citation to version 2 has to
 * keep resolving to version 2 after version 3 exists, or the repository is not citable.
 *
 * WHY CITATIONS ARE GENERATED HERE AND NOT IN A COMPONENT
 *
 * The same work is cited in APA, Chicago, MLA, BibTeX and RIS, and each has rules about author lists,
 * et al., title case and date placement. Putting them in the package means they can be tested against
 * the rules, and means a second surface — an export, an API — cannot format the same work differently
 * from the page.
 */
import type { Db } from '@ozituma/db/client';
import { MemberError } from './members.ts';

// ---------------------------------------------------------------------------
// The workflow
// ---------------------------------------------------------------------------

export const PUBLICATION_STATES = [
  'draft',
  'submitted',
  'editorial_screening',
  'under_review',
  'revision_required',
  'expert_review',
  'approved',
  'published',
  'archived',
] as const;

export type PublicationState = (typeof PUBLICATION_STATES)[number];

/**
 * Where a work may go from where it is.
 *
 * `archived` is reachable from every live state, because withdrawing a work is always allowed and
 * refusing to let an author or editor withdraw something is worse than any inconsistency it creates.
 * Nothing leaves `archived`: an archived work is kept, not resurrected, and a new version is a new
 * submission.
 */
export const PUBLICATION_TRANSITIONS: Record<PublicationState, PublicationState[]> = {
  draft: ['submitted', 'archived'],
  submitted: ['editorial_screening', 'archived'],
  editorial_screening: ['under_review', 'revision_required', 'archived'],
  under_review: ['expert_review', 'revision_required', 'approved', 'archived'],
  revision_required: ['submitted', 'archived'],
  expert_review: ['approved', 'revision_required', 'archived'],
  approved: ['published', 'archived'],
  published: ['archived'],
  archived: [],
};

export function canTransition(from: PublicationState, to: PublicationState): boolean {
  return (PUBLICATION_TRANSITIONS[from] ?? []).includes(to);
}

/**
 * Who may make which move.
 *
 * The capability is the one needed to PERFORM the move, not the one named after the destination, and
 * the difference is a real trap. Sending a work INTO expert review is an editorial act — an editor
 * decides a work needs an outside opinion — so it needs `review_queue`. The `expert_review`
 * capability belongs to the reviewer and is what they need to COMPLETE the review they were given,
 * which `completeReview` enforces. Mapping this to `expert_review` would mean only reviewers could
 * send work to reviewers, and no editor could ever start the process. That was the first version of
 * this table, and a test caught it.
 */
const TRANSITION_CAPABILITY: Record<PublicationState, string> = {
  draft: 'read',
  submitted: 'submit_work',
  editorial_screening: 'review_queue',
  under_review: 'review_queue',
  revision_required: 'review_queue',
  // An editor sends a work out; the reviewer's own capability guards completing the review.
  expert_review: 'review_queue',
  approved: 'publish',
  published: 'publish',
  archived: 'publish',
};

export function capabilityForTransition(to: PublicationState): string {
  return TRANSITION_CAPABILITY[to];
}

export const STATE_LABEL: Record<PublicationState, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  editorial_screening: 'Editorial screening',
  under_review: 'Under review',
  revision_required: 'Revision required',
  expert_review: 'Expert review',
  approved: 'Approved',
  published: 'Published',
  archived: 'Archived',
};

/** What a reader is told, in plain words, about where a work stands. */
export const STATE_MEANING: Record<PublicationState, string> = {
  draft: 'The author is still writing. Not visible to anyone else.',
  submitted: 'Submitted and waiting to be looked at by an editor.',
  editorial_screening: 'An editor is checking it is in scope and properly formed.',
  under_review: 'Reviewers are reading it.',
  revision_required: 'The author has been asked to revise it and has not resubmitted.',
  expert_review: 'Out with a named expert reviewer. This is the stage that decides peer review.',
  approved: 'Accepted, and queued to be published.',
  published: 'Published and citable at a permanent address.',
  archived: 'Withdrawn from publication. Kept, with its history, rather than deleted.',
};

/** The sentence a work's page shows, which must not overstate what happened. */
export function reviewStatusSentence(state: PublicationState, peerReviewed: boolean): string {
  if (state === 'published' || state === 'archived') {
    return peerReviewed
      ? 'This work was peer-reviewed: it completed expert review, and the recommendation is recorded with it.'
      : 'This work is published but has not been peer-reviewed. It went through editorial screening only, and the archive does not describe that as peer review.';
  }
  return STATE_MEANING[state];
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PublicationAuthor {
  accountId: number | null;
  name: string;
  affiliation: string | null;
  department: string | null;
  orcid: string | null;
  email: string | null;
  position: number;
  isCorresponding: boolean;
}

export interface PublicationSummary {
  id: number;
  slug: string;
  url: string;
  title: string;
  abstract: string | null;
  authors: PublicationAuthor[];
  kind: string;
  disciplines: string[];
  keywords: string[];
  status: PublicationState;
  peerReviewed: boolean;
  isPublic: boolean;
  doi: string | null;
  publishedAt: string | null;
  currentVersion: number;
  reviewStatus: string;
}

export interface PublicationDetail extends PublicationSummary {
  journal: string | null;
  volume: string | null;
  issue: string | null;
  pages: string | null;
  publisher: string | null;
  externalUrl: string | null;
  licence: string | null;
  submittedAt: string | null;
  versions: { version: number; title: string; changeNote: string | null; createdAt: string }[];
  files: { id: number; filename: string; role: string; mimeType: string; sizeBytes: number }[];
  reviews: {
    id: number; kind: string; recommendation: string | null; completedAt: string | null;
    reviewerName: string | null;
  }[];
  transitions: { from: string | null; to: string; at: string; note: string | null }[];
  citations: Record<CitationStyle, string>;
}

export type CitationStyle = 'apa' | 'chicago' | 'mla' | 'bibtex' | 'ris';

export const CITATION_STYLES: { value: CitationStyle; label: string }[] = [
  { value: 'apa', label: 'APA 7th' },
  { value: 'chicago', label: 'Chicago' },
  { value: 'mla', label: 'MLA 9th' },
  { value: 'bibtex', label: 'BibTeX' },
  { value: 'ris', label: 'RIS' },
];

// ---------------------------------------------------------------------------
// Citations
// ---------------------------------------------------------------------------

function slugify(name: string): string {
  const base = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return base.length > 0 ? base : 'work';
}

/** The year a citation uses: publication if it happened, submission otherwise, never invented. */
function citationYear(publication: { publishedAt: string | null; submittedAt: string | null }): string {
  const source = publication.publishedAt ?? publication.submittedAt;
  if (!source) return 'n.d.';
  const year = new Date(source).getUTCFullYear();
  return Number.isFinite(year) ? String(year) : 'n.d.';
}

/** "Family, G." from "Given Family", which is what the author styles need. */
function apaName(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0]!;
  const family = parts[parts.length - 1]!;
  const initials = parts.slice(0, -1).map((p) => `${p[0]!.toUpperCase()}.`).join(' ');
  return `${family}, ${initials}`;
}

function mlaName(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0]!;
  return `${parts[parts.length - 1]}, ${parts.slice(0, -1).join(' ')}`;
}

/**
 * The author list as each style wants it.
 *
 * The rules differ in ways that matter and are easy to get wrong: APA inverts every name and joins
 * with an ampersand, MLA inverts only the first author, and Chicago spells out the same inversion but
 * with "and". Getting these wrong is not cosmetic — a citation is the thing a reader copies.
 */
function authorList(authors: PublicationAuthor[], style: 'apa' | 'mla' | 'chicago'): string {
  const names = authors.slice().sort((a, b) => a.position - b.position).map((a) => a.name);
  if (names.length === 0) return '';

  if (style === 'apa') {
    const formatted = names.map(apaName);
    if (formatted.length === 1) return formatted[0]!;
    // APA 7 lists up to 20 authors; beyond that it is the first 19, an ellipsis, and the last.
    if (formatted.length > 20) {
      return `${formatted.slice(0, 19).join(', ')}, … ${formatted[formatted.length - 1]}`;
    }
    return `${formatted.slice(0, -1).join(', ')}, & ${formatted[formatted.length - 1]}`;
  }

  if (style === 'mla') {
    if (names.length === 1) return mlaName(names[0]!);
    // MLA 9th lists two authors as "Dorris, Michael, and Louise Erdrich" — the comma is part of the
    // style, not a British/American preference, and omitting it is the commonest citation error here.
    if (names.length === 2) return `${mlaName(names[0]!)}, and ${names[1]}`;
    return `${mlaName(names[0]!)}, et al`;
  }

  // Chicago's bibliography does the same for two authors.
  if (names.length === 1) return mlaName(names[0]!);
  if (names.length === 2) return `${mlaName(names[0]!)}, and ${names[1]}`;
  return `${mlaName(names[0]!)}, et al.`;
}

export interface CitationInput {
  title: string;
  abstract: string | null;
  authors: PublicationAuthor[];
  kind: string;
  publishedAt: string | null;
  submittedAt: string | null;
  journal: string | null;
  volume: string | null;
  issue: string | null;
  pages: string | null;
  publisher: string | null;
  doi: string | null;
  externalUrl: string | null;
  slug: string;
}

export const OZIKORO_CITATION_HOST = 'https://ozikoro.com';

/**
 * One work in one style.
 *
 * Every style is produced from the same facts, and where a fact is missing the citation degrades
 * rather than inventing one — a work with no DOI simply has no DOI in its citation, and a work with
 * no date says `n.d.`, which is what the styles specify.
 */
export function formatCitation(publication: CitationInput, style: CitationStyle): string {
  const year = citationYear(publication);
  const url = `${OZIKORO_CITATION_HOST}/publications/${publication.slug}/`;
  const doi = publication.doi ? `https://doi.org/${publication.doi.replace(/^https?:\/\/doi\.org\//, '')}` : null;

  if (style === 'bibtex') {
    const key = `${(publication.authors[0]?.name.split(/\s+/).pop() ?? 'ozikoro').toLowerCase()}${year.replace(/\D/g, '') || ''}${slugify(publication.title).split('-')[0] ?? ''}`;
    const type = publication.kind === 'thesis' || publication.kind === 'dissertation' ? 'phdthesis'
      : publication.kind === 'book' || publication.kind === 'chapter' ? 'incollection'
      : publication.kind === 'conference_paper' ? 'inproceedings'
      : 'article';
    const fields: [string, string | null][] = [
      ['author', publication.authors.slice().sort((a, b) => a.position - b.position).map((a) => a.name).join(' and ') || null],
      ['title', publication.title],
      ['year', year === 'n.d.' ? null : year],
      ['journal', publication.journal],
      ['volume', publication.volume],
      ['number', publication.issue],
      ['pages', publication.pages],
      ['publisher', publication.publisher],
      ['doi', publication.doi?.replace(/^https?:\/\/doi\.org\//, '') ?? null],
      ['url', url],
    ];
    const body = fields.filter(([, v]) => v).map(([k, v]) => `  ${k} = {${v}}`).join(',\n');
    return `@${type}{${key},\n${body}\n}`;
  }

  if (style === 'ris') {
    const names = publication.authors.slice().sort((a, b) => a.position - b.position).map((a) => a.name);
    const lines = [
      `TY  - ${publication.kind === 'thesis' || publication.kind === 'dissertation' ? 'THES' : publication.kind === 'book' ? 'BOOK' : 'JOUR'}`,
      ...names.map((n) => `AU  - ${n}`),
      `TI  - ${publication.title}`,
      ...(publication.journal ? [`JO  - ${publication.journal}`] : []),
      ...(publication.volume ? [`VL  - ${publication.volume}`] : []),
      ...(publication.issue ? [`IS  - ${publication.issue}`] : []),
      ...(publication.pages ? [`SP  - ${publication.pages}`] : []),
      ...(publication.publisher ? [`PB  - ${publication.publisher}`] : []),
      ...(year !== 'n.d.' ? [`PY  - ${year}`] : []),
      ...(publication.doi ? [`DO  - ${publication.doi.replace(/^https?:\/\/doi\.org\//, '')}`] : []),
      `UR  - ${url}`,
      'ER  -',
    ];
    return lines.join('\n');
  }

  const authors = authorList(publication.authors, style);

  if (style === 'apa') {
    const container = publication.journal
      ? `${publication.journal}${publication.volume ? `, ${publication.volume}` : ''}${publication.issue ? `(${publication.issue})` : ''}${publication.pages ? `, ${publication.pages}` : ''}`
      : publication.publisher ?? null;
    return [
      authors ? `${authors} (${year}).` : `(${year}).`,
      `${publication.title}.`,
      container ? `${container}.` : null,
      doi ?? url,
    ].filter(Boolean).join(' ');
  }

  if (style === 'mla') {
    const container = publication.journal ?? publication.publisher ?? 'Ozikoro';
    return [
      authors ? `${authors}.` : null,
      `"${publication.title}."`,
      `${container},`,
      year === 'n.d.' ? 'n.d.,' : `${year},`,
      doi ?? url,
    ].filter(Boolean).join(' ');
  }

  // Chicago, notes and bibliography style.
  const container = publication.journal ?? publication.publisher ?? 'Ozikoro';
  return [
    authors ? `${authors}.` : null,
    `${year === 'n.d.' ? 'n.d.' : year}.`,
    `"${publication.title}."`,
    `${container}${publication.volume ? ` ${publication.volume}` : ''}${publication.issue ? `, no. ${publication.issue}` : ''}${publication.pages ? `: ${publication.pages}` : ''}.`,
    doi ?? url,
  ].filter(Boolean).join(' ');
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

const PUBLICATION_COLUMNS = `id, slug, title, abstract, disciplines, keywords, kind, status,
  peer_reviewed, is_public, doi, external_url, publisher, journal, volume, issue, pages,
  published_at, submitted_at, current_version, licence, rights_note, created_at, updated_at`;

async function loadAuthors(db: Db, publicationId: number): Promise<PublicationAuthor[]> {
  const rows = await db.rows<Record<string, unknown>>(
    `select account_id, name, affiliation, department, orcid, email, position, is_corresponding
       from ozikoro_publication_author where publication_id = $1 order by position, id`,
    [publicationId]
  );
  return rows.map((r) => ({
    accountId: r.account_id === null || r.account_id === undefined ? null : Number(r.account_id),
    name: String(r.name),
    affiliation: r.affiliation ? String(r.affiliation) : null,
    department: r.department ? String(r.department) : null,
    orcid: r.orcid ? String(r.orcid) : null,
    email: r.email ? String(r.email) : null,
    position: Number(r.position ?? 0),
    isCorresponding: Boolean(r.is_corresponding),
  }));
}

function rowToSummary(row: Record<string, unknown>, authors: PublicationAuthor[]): PublicationSummary {
  const status = String(row.status) as PublicationState;
  const peerReviewed = Boolean(row.peer_reviewed);
  return {
    id: Number(row.id),
    slug: String(row.slug),
    url: `/publications/${String(row.slug)}/`,
    title: String(row.title),
    abstract: row.abstract ? String(row.abstract) : null,
    authors,
    kind: String(row.kind),
    disciplines: Array.isArray(row.disciplines) ? row.disciplines.map(String) : [],
    keywords: Array.isArray(row.keywords) ? row.keywords.map(String) : [],
    status,
    peerReviewed,
    isPublic: Boolean(row.is_public),
    doi: row.doi ? String(row.doi) : null,
    publishedAt: row.published_at ? new Date(String(row.published_at)).toISOString() : null,
    currentVersion: Number(row.current_version ?? 0),
    reviewStatus: reviewStatusSentence(status, peerReviewed),
  };
}

export async function getPublicationBySlug(db: Db, slug: string): Promise<PublicationDetail | null> {
  const row = await db.one<Record<string, unknown>>(
    `select ${PUBLICATION_COLUMNS} from ozikoro_publication where slug = $1`,
    [slug]
  );
  if (!row) return null;

  const id = Number(row.id);
  const [authors, versions, files, reviews, transitions] = await Promise.all([
    loadAuthors(db, id),
    db.rows<Record<string, unknown>>(
      `select version, title, change_note, created_at from ozikoro_publication_version
        where publication_id = $1 order by version desc`,
      [id]
    ),
    db.rows<Record<string, unknown>>(
      `select id, filename, role, mime_type, size_bytes from ozikoro_publication_file
        where publication_id = $1 order by role, id`,
      [id]
    ),
    db.rows<Record<string, unknown>>(
      `select r.id, r.kind, r.recommendation, r.completed_at,
              coalesce(m.display_name, a.display_name, a.email) as reviewer_name
         from ozikoro_publication_review r
         left join account a on a.id = r.reviewer_id
         left join ozikoro_member m on m.account_id = r.reviewer_id
        where r.publication_id = $1 order by r.assigned_at`,
      [id]
    ),
    db.rows<Record<string, unknown>>(
      `select from_status, to_status, note, created_at from ozikoro_publication_transition
        where publication_id = $1 order by created_at`,
      [id]
    ),
  ]);

  const summary = rowToSummary(row, authors);
  const citationInput: CitationInput = {
    title: summary.title,
    abstract: summary.abstract,
    authors,
    kind: summary.kind,
    publishedAt: summary.publishedAt,
    submittedAt: row.submitted_at ? new Date(String(row.submitted_at)).toISOString() : null,
    journal: row.journal ? String(row.journal) : null,
    volume: row.volume ? String(row.volume) : null,
    issue: row.issue ? String(row.issue) : null,
    pages: row.pages ? String(row.pages) : null,
    publisher: row.publisher ? String(row.publisher) : null,
    doi: summary.doi,
    externalUrl: row.external_url ? String(row.external_url) : null,
    slug: summary.slug,
  };

  return {
    ...summary,
    journal: citationInput.journal,
    volume: citationInput.volume,
    issue: citationInput.issue,
    pages: citationInput.pages,
    publisher: citationInput.publisher,
    externalUrl: citationInput.externalUrl,
    licence: row.licence ? String(row.licence) : null,
    submittedAt: citationInput.submittedAt,
    versions: versions.map((v) => ({
      version: Number(v.version),
      title: String(v.title),
      changeNote: v.change_note ? String(v.change_note) : null,
      createdAt: new Date(String(v.created_at)).toISOString(),
    })),
    files: files.map((f) => ({
      id: Number(f.id),
      filename: String(f.filename),
      role: String(f.role),
      mimeType: String(f.mime_type),
      sizeBytes: Number(f.size_bytes),
    })),
    reviews: reviews.map((r) => ({
      id: Number(r.id),
      kind: String(r.kind),
      recommendation: r.recommendation ? String(r.recommendation) : null,
      completedAt: r.completed_at ? new Date(String(r.completed_at)).toISOString() : null,
      reviewerName: r.reviewer_name ? String(r.reviewer_name) : null,
    })),
    transitions: transitions.map((t) => ({
      from: t.from_status ? String(t.from_status) : null,
      to: String(t.to_status),
      at: new Date(String(t.created_at)).toISOString(),
      note: t.note ? String(t.note) : null,
    })),
    citations: {
      apa: formatCitation(citationInput, 'apa'),
      chicago: formatCitation(citationInput, 'chicago'),
      mla: formatCitation(citationInput, 'mla'),
      bibtex: formatCitation(citationInput, 'bibtex'),
      ris: formatCitation(citationInput, 'ris'),
    },
  };
}

/** What the public can read: published and public, and nothing else. */
export async function listPublished(
  db: Db,
  options: { limit?: number; offset?: number; discipline?: string | null; search?: string | null; accountId?: number | null } = {}
): Promise<PublicationSummary[]> {
  const params: unknown[] = [];
  const conditions: string[] = [`p.status = 'published'`, `p.is_public = true`];

  if (options.discipline) {
    params.push(options.discipline);
    conditions.push(`$${params.length} = any(p.disciplines)`);
  }
  if (options.search) {
    params.push(options.search);
    conditions.push(`(p.search_vector @@ websearch_to_tsquery('english', $${params.length}) or p.title ilike '%' || $${params.length} || '%')`);
  }
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
  const offset = Math.max(options.offset ?? 0, 0);
  params.push(limit, offset);

  const rows = await db.rows<Record<string, unknown>>(
    `select ${PUBLICATION_COLUMNS.replace(/(\w+)(,|$)/g, 'p.$1$2')} from ozikoro_publication p
      where ${conditions.join(' and ')}
      order by p.published_at desc nulls last limit $${params.length - 1} offset $${params.length}`,
    params
  );

  const out: PublicationSummary[] = [];
  for (const row of rows) out.push(rowToSummary(row, await loadAuthors(db, Number(row.id))));
  return out;
}

/** A researcher's own works, including the ones nobody else can see yet. */
export async function listByAccount(
  db: Db,
  accountId: number,
  options: { includePrivate?: boolean } = {}
): Promise<PublicationSummary[]> {
  const rows = await db.rows<Record<string, unknown>>(
    `select distinct ${PUBLICATION_COLUMNS.replace(/(\w+)(,|$)/g, 'p.$1$2')}
       from ozikoro_publication p
       join ozikoro_publication_author a on a.publication_id = p.id
      where (a.account_id = $1 or p.submitted_by = $1)
        ${options.includePrivate ? '' : "and p.status = 'published' and p.is_public = true"}
      order by p.updated_at desc`,
    [accountId]
  );
  const out: PublicationSummary[] = [];
  for (const row of rows) out.push(rowToSummary(row, await loadAuthors(db, Number(row.id))));
  return out;
}

/** The editorial queue for works: everything not yet published, oldest submission first. */
export async function listReviewQueue(db: Db, options: { limit?: number } = {}): Promise<PublicationSummary[]> {
  const rows = await db.rows<Record<string, unknown>>(
    `select ${PUBLICATION_COLUMNS.replace(/(\w+)(,|$)/g, 'p.$1$2')} from ozikoro_publication p
      where p.status not in ('draft','published','archived')
      order by p.submitted_at asc nulls last limit $1`,
    [Math.min(Math.max(options.limit ?? 50, 1), 200)]
  );
  const out: PublicationSummary[] = [];
  for (const row of rows) out.push(rowToSummary(row, await loadAuthors(db, Number(row.id))));
  return out;
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export interface PublicationInput {
  title: string;
  abstract?: string | null;
  kind?: string;
  disciplines?: string[];
  keywords?: string[];
  authors: { name: string; affiliation?: string | null; department?: string | null; orcid?: string | null; email?: string | null; accountId?: number | null; isCorresponding?: boolean }[];
  doi?: string | null;
  journal?: string | null;
  volume?: string | null;
  issue?: string | null;
  pages?: string | null;
  publisher?: string | null;
  externalUrl?: string | null;
  licence?: string | null;
  rightsNote?: string | null;
  languageCode?: string | null;
}

/**
 * Create a draft.
 *
 * It starts private and in `draft`, always. There is no way to create a work that is already
 * published, which means every published work has a transition history behind it — and therefore a
 * review history, or a documented absence of one.
 */
export async function createPublication(
  db: Db,
  input: { author: { accountId: number; name: string; affiliation?: string | null }; publication: PublicationInput }
): Promise<number> {
  const title = input.publication.title.trim();
  if (title.length === 0) throw new MemberError('no_title', 'A work needs a title.');
  if (!input.publication.authors.some((a) => a.name.trim().length > 0)) {
    throw new MemberError('no_authors', 'A work needs at least one author.');
  }
  if (input.publication.doi && !/^10\.\d{4,9}\/\S+$/.test(input.publication.doi.replace(/^https?:\/\/doi\.org\//, ''))) {
    // A DOI has a shape. A value that is not one is almost always a URL pasted into the wrong field,
    // and a wrong DOI in a citation is worse than a missing one.
    throw new MemberError('bad_doi', 'A DOI looks like 10.1234/abcde. Leave it empty if you do not have one.');
  }

  const base = slugify(title);
  let slug = base;
  for (let n = 2; n < 200; n += 1) {
    const taken = await db.one<{ n: number }>(`select count(*)::int as n from ozikoro_publication where slug = $1`, [slug]);
    if (Number(taken?.n ?? 0) === 0) break;
    slug = `${base}-${n}`;
  }

  const row = await db.one<{ id: string }>(
    `insert into ozikoro_publication
       (slug, title, abstract, kind, disciplines, keywords, doi, journal, volume, issue, pages,
        publisher, external_url, licence, rights_note, language_code, submitted_by, status, is_public)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'draft',false)
     returning id`,
    [
      slug, title, input.publication.abstract ?? null, input.publication.kind ?? 'journal_article',
      input.publication.disciplines ?? [], input.publication.keywords ?? [],
      input.publication.doi?.replace(/^https?:\/\/doi\.org\//, '') ?? null,
      input.publication.journal ?? null, input.publication.volume ?? null, input.publication.issue ?? null,
      input.publication.pages ?? null, input.publication.publisher ?? null, input.publication.externalUrl ?? null,
      input.publication.licence ?? null, input.publication.rightsNote ?? null,
      input.publication.languageCode ?? null, input.author.accountId,
    ]
  );

  const id = Number(row!.id);
  await writeAuthors(db, id, input.publication.authors);
  await writeVersion(db, id, 1, title, input.publication.abstract ?? null, 'First draft', input.author.accountId);
  await recordTransition(db, { publicationId: id, from: null, to: 'draft', actorId: input.author.accountId, note: 'Created' });

  return id;
}

async function writeAuthors(
  db: Db,
  publicationId: number,
  authors: PublicationInput['authors']
): Promise<void> {
  await db.query(`delete from ozikoro_publication_author where publication_id = $1`, [publicationId]);
  let position = 0;
  for (const author of authors) {
    const name = author.name.trim();
    if (name.length === 0) continue;
    await db.query(
      `insert into ozikoro_publication_author
         (publication_id, account_id, name, affiliation, department, orcid, email, position, is_corresponding)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [publicationId, author.accountId ?? null, name, author.affiliation ?? null, author.department ?? null,
       author.orcid ?? null, author.email ?? null, position, Boolean(author.isCorresponding)]
    );
    position += 1;
  }
}

async function writeVersion(
  db: Db,
  publicationId: number,
  version: number,
  title: string,
  abstract: string | null,
  changeNote: string | null,
  actorId: number | null
): Promise<void> {
  await db.query(
    `insert into ozikoro_publication_version (publication_id, version, title, abstract, change_note, created_by)
     values ($1,$2,$3,$4,$5,$6) on conflict (publication_id, version) do update
       set title = excluded.title, abstract = excluded.abstract, change_note = excluded.change_note`,
    [publicationId, version, title, abstract, changeNote, actorId]
  );
  await db.query(`update ozikoro_publication set current_version = $2, updated_at = now() where id = $1`, [publicationId, version]);
}

async function recordTransition(
  db: Db,
  input: { publicationId: number; from: PublicationState | null; to: PublicationState; actorId: number | null; note?: string | null }
): Promise<void> {
  await db.query(
    `insert into ozikoro_publication_transition (publication_id, from_status, to_status, actor_id, note)
     values ($1,$2,$3,$4,$5)`,
    [input.publicationId, input.from, input.to, input.actorId, input.note ?? null]
  );
}

/**
 * Move a work to a new state.
 *
 * The single gate. It checks that the transition is one the workflow allows, that the actor holds the
 * capability that state needs, and — the rule this whole module exists for — that a work may only be
 * marked peer-reviewed on the way out of `expert_review`, and only when a completed expert review is
 * actually recorded against it.
 */
export async function transitionPublication(
  db: Db,
  input: {
    publicationId: number;
    to: PublicationState;
    actorId: number;
    /** What the actor is allowed to do, resolved by the caller from `capabilitiesFor`. */
    capabilities: Set<string>;
    note?: string | null;
  }
): Promise<void> {
  const current = await db.one<{ status: string; is_public: boolean; current_version: number }>(
    `select status, is_public, current_version from ozikoro_publication where id = $1`,
    [input.publicationId]
  );
  if (!current) throw new MemberError('no_publication', 'That work does not exist.');

  const from = String(current.status) as PublicationState;
  if (!PUBLICATION_STATES.includes(input.to)) throw new MemberError('bad_state', 'That is not a state in the workflow.');
  if (from === input.to) throw new MemberError('same_state', `That work is already ${STATE_LABEL[input.to].toLowerCase()}.`);
  if (!canTransition(from, input.to)) {
    throw new MemberError(
      'bad_transition',
      `A work cannot go from ${STATE_LABEL[from].toLowerCase()} to ${STATE_LABEL[input.to].toLowerCase()}.`
    );
  }

  /*
   * `submitted` is the AUTHOR's act, and `submit_work` is held by every contributor role, so the
   * capability alone does not say whose work may be submitted. Without this, any signed-in contributor
   * could push another person's private draft into the editorial queue — the same broken
   * object-level authorization that `revisePublication` had, on the transition path.
   *
   * Editorial transitions are governed by their own capabilities and are not affected: an editor
   * moving a work through review is acting on the archive's business, not on somebody's authorship.
   */
  if (input.to === 'submitted') {
    await assertOwnsPublication(db, input.publicationId, input.actorId);
  }

  const needed = capabilityForTransition(input.to);
  if (!input.capabilities.has(needed)) {
    throw new MemberError('forbidden', `Moving a work to ${STATE_LABEL[input.to].toLowerCase()} needs the “${needed.replace(/_/g, ' ')}” permission.`);
  }

  /*
   * THE RULE. `peer_reviewed` is written here and nowhere else, and only when the work is leaving
   * expert review with a completed expert review recorded. A work approved straight from
   * `under_review` is published and is not peer-reviewed, and this leaves that column false.
   */
  let peerReviewed: boolean | null = null;
  if (from === 'expert_review') {
    const completed = await db.one<{ n: number }>(
      `select count(*)::int as n from ozikoro_publication_review
        where publication_id = $1 and kind = 'expert' and completed_at is not null`,
      [input.publicationId]
    );
    if (Number(completed?.n ?? 0) === 0) {
      throw new MemberError(
        'no_completed_review',
        'No expert review has been completed for this work, so it cannot leave expert review. Assign one and record its outcome first.'
      );
    }
    peerReviewed = input.to !== 'revision_required';
  }

  const publishedAt = input.to === 'published' ? new Date().toISOString() : null;
  const isPublic = input.to === 'published' ? true : current.is_public;

  await db.query(
    `update ozikoro_publication set
        status = $2,
        is_public = $3,
        published_at = coalesce($4::timestamptz, published_at),
        submitted_at = case when $2 = 'submitted' and submitted_at is null then now() else submitted_at end,
        peer_reviewed = coalesce($5::boolean, peer_reviewed),
        updated_at = now()
      where id = $1`,
    [input.publicationId, input.to, isPublic, publishedAt, peerReviewed]
  );

  await recordTransition(db, {
    publicationId: input.publicationId,
    from,
    to: input.to,
    actorId: input.actorId,
    note: input.note ?? null,
  });
}

/** A new version, snapshotted before the work is revised further. */

/**
 * Is this account allowed to change this work's CONTENT?
 *
 * MEASURED BEFORE THIS EXISTED: account A created a private draft; account B, holding only
 * `submit_work` — which every contributor role holds, so it is not a restriction — called
 * `revisePublication` on it and succeeded. The title and abstract were rewritten and a new version
 * was recorded **attributed to B**. A draft its author had not submitted was readable and editable by
 * any other signed-in contributor.
 *
 * The capability check in the route could not catch this because the capability is universal among
 * contributors. Authorization for a specific record is a different question from a role, and it has to
 * be asked of the record.
 *
 * Allowed: a listed author of the work, or whoever submitted it. An editor does not need to edit
 * another person's manuscript — editing it would attribute their words to the author — which is why
 * editorial roles are not granted this and the transition path remains the editorial route.
 */
async function assertOwnsPublication(db: Db, publicationId: number, actorId: number): Promise<void> {
  const owns = await db.one<{ n: number }>(
    `select count(*)::int as n from ozikoro_publication p
      where p.id = $1
        and (p.submitted_by = $2
             or exists (select 1 from ozikoro_publication_author a
                         where a.publication_id = p.id and a.account_id = $2))`,
    [publicationId, actorId]
  );
  if (Number(owns?.n ?? 0) === 0) {
    throw new MemberError(
      'not_your_work',
      'Only an author of this work can change it. If you believe it is yours, claim the byline or ask an editor.'
    );
  }
}

export async function revisePublication(
  db: Db,
  input: { publicationId: number; title: string; abstract: string | null; changeNote: string; actorId: number }
): Promise<number> {
  const current = await db.one<{ current_version: number; status: string }>(
    `select current_version, status from ozikoro_publication where id = $1`,
    [input.publicationId]
  );
  if (!current) throw new MemberError('no_publication', 'That work does not exist.');
  if (String(current.status) === 'archived') throw new MemberError('archived', 'An archived work is not revised. Submit a new one.');
  await assertOwnsPublication(db, input.publicationId, input.actorId);

  const next = Number(current.current_version) + 1;
  await db.query(`update ozikoro_publication set title = $2, abstract = $3, updated_at = now() where id = $1`, [
    input.publicationId, input.title, input.abstract,
  ]);
  await writeVersion(db, input.publicationId, next, input.title, input.abstract, input.changeNote, input.actorId);
  return next;
}

// ---------------------------------------------------------------------------
// Review
// ---------------------------------------------------------------------------

export async function assignReview(
  db: Db,
  input: { publicationId: number; reviewerId: number; kind?: 'editorial' | 'expert' | 'statistical' | 'community'; actorId: number; note?: string | null }
): Promise<number> {
  const publication = await db.one<{ current_version: number; status: string }>(
    `select current_version, status from ozikoro_publication where id = $1`,
    [input.publicationId]
  );
  if (!publication) throw new MemberError('no_publication', 'That work does not exist.');
  if (['draft', 'archived'].includes(String(publication.status))) {
    throw new MemberError('not_reviewable', 'A work that is a draft or archived is not sent for review.');
  }
  // One open review per person per work, so a reviewer does not appear twice on the same version.
  const existing = await db.one<{ n: number }>(
    `select count(*)::int as n from ozikoro_publication_review
      where publication_id = $1 and reviewer_id = $2 and completed_at is null`,
    [input.publicationId, input.reviewerId]
  );
  if (Number(existing?.n ?? 0) > 0) throw new MemberError('already_assigned', 'That reviewer already has this work.');

  const row = await db.one<{ id: string }>(
    `insert into ozikoro_publication_review (publication_id, version, reviewer_id, kind)
     values ($1,$2,$3,$4) returning id`,
    [input.publicationId, Number(publication.current_version), input.reviewerId, input.kind ?? 'expert']
  );
  return Number(row!.id);
}

export async function completeReview(
  db: Db,
  input: {
    reviewId: number;
    reviewerId: number;
    recommendation: 'accept' | 'minor_revision' | 'major_revision' | 'reject' | 'abstain';
    comments?: string | null;
    privateComments?: string | null;
    /** What the reviewer is allowed to do. Checked here so no route can forget it. */
    capabilities?: Set<string>;
  }
): Promise<void> {
  /*
   * The capability, checked at the only place that completes a review. Assignation is an editorial
   * act; completing one is a reviewer's, and this is where that distinction is enforced rather than
   * trusted to a route.
   */
  if (input.capabilities && !input.capabilities.has('expert_review')) {
    throw new MemberError('forbidden', 'Completing a review needs the “expert review” permission.');
  }
  const review = await db.one<{ reviewer_id: string; completed_at: string | null }>(
    `select reviewer_id, completed_at from ozikoro_publication_review where id = $1`,
    [input.reviewId]
  );
  if (!review) throw new MemberError('no_review', 'That review does not exist.');
  if (review.completed_at !== null) throw new MemberError('already_completed', 'That review has already been completed.');
  /*
   * Only the assigned reviewer completes their own review. An editor who could complete a review on
   * a reviewer's behalf could manufacture the very record that peer review rests on.
   */
  if (Number(review.reviewer_id) !== input.reviewerId) {
    throw new MemberError('not_your_review', 'This review was assigned to somebody else.');
  }

  await db.query(
    `update ozikoro_publication_review
        set recommendation = $2, comments = $3, private_comments = $4, completed_at = now()
      where id = $1 and completed_at is null`,
    [input.reviewId, input.recommendation, input.comments ?? null, input.privateComments ?? null]
  );
}

/** Reviews assigned to a person, for their own queue. */
export async function listMyReviews(
  db: Db,
  reviewerId: number,
  options: { open?: boolean } = {}
): Promise<{ id: number; publicationId: number; slug: string; title: string; kind: string; version: number; completedAt: string | null }[]> {
  const rows = await db.rows<Record<string, unknown>>(
    `select r.id, r.publication_id, r.version, r.kind, r.completed_at, p.slug, p.title
       from ozikoro_publication_review r join ozikoro_publication p on p.id = r.publication_id
      where r.reviewer_id = $1 ${options.open === false ? '' : 'and r.completed_at is null'}
      order by r.assigned_at`,
    [reviewerId]
  );
  return rows.map((r) => ({
    id: Number(r.id),
    publicationId: Number(r.publication_id),
    slug: String(r.slug),
    title: String(r.title),
    kind: String(r.kind),
    version: Number(r.version),
    completedAt: r.completed_at ? new Date(String(r.completed_at)).toISOString() : null,
  }));
}

// ---------------------------------------------------------------------------
// Public researcher directory
// ---------------------------------------------------------------------------

export interface ResearcherCard {
  accountId: number;
  slug: string;
  name: string;
  headline: string | null;
  institution: string | null;
  department: string | null;
  orcid: string | null;
  researchInterests: string[];
  publicationCount: number;
}

/**
 * The people who have chosen to be findable.
 *
 * Being found is the stated purpose of the research network, so the directory lists members with a
 * public profile. It deliberately does not require an institution: the plan is explicit that
 * university affiliation must not be mandatory for an independent or community researcher.
 */
export async function listResearchers(
  db: Db,
  options: { search?: string | null; limit?: number; offset?: number } = {}
): Promise<ResearcherCard[]> {
  /*
   * No placeholder is pushed here for the directory's own filters. An earlier version pushed a value
   * that no clause referenced, and Postgres refused the statement with "could not determine data type
   * of parameter $1" — an unreferenced parameter has nothing to infer its type from. Positional
   * parameters have to be pushed in the same order they are used, and only when used.
   */
  const params: unknown[] = [];
  const conditions: string[] = [`m.is_public = true`, `m.status = 'active'`];

  if (options.search) {
    params.push(`%${options.search}%`);
    conditions.push(
      `(coalesce(m.display_name, a.display_name, a.email) ilike $${params.length}
        or m.institution ilike $${params.length}
        or exists (select 1 from unnest(m.research_interests) i where i ilike $${params.length}))`
    );
  }
  const limit = Math.min(Math.max(options.limit ?? 24, 1), 100);
  params.push(limit, Math.max(options.offset ?? 0, 0));

  const rows = await db.rows<Record<string, unknown>>(
    `select m.account_id, coalesce(m.display_name, a.display_name, a.email) as name,
            m.headline, m.institution, m.department, m.orcid, m.research_interests,
            (select count(distinct p.id)::int from ozikoro_publication p
               join ozikoro_publication_author pa on pa.publication_id = p.id
              where pa.account_id = m.account_id and p.status = 'published' and p.is_public = true) as publication_count
       from ozikoro_member m join account a on a.id = m.account_id
      where ${conditions.join(' and ')}
      order by publication_count desc, name
      limit $${params.length - 1} offset $${params.length}`,
    params
  );

  return rows.map((r) => ({
    accountId: Number(r.account_id),
    slug: String(r.account_id),
    name: String(r.name),
    headline: r.headline ? String(r.headline) : null,
    institution: r.institution ? String(r.institution) : null,
    department: r.department ? String(r.department) : null,
    orcid: r.orcid ? String(r.orcid) : null,
    researchInterests: Array.isArray(r.research_interests) ? r.research_interests.map(String) : [],
    publicationCount: Number(r.publication_count ?? 0),
  }));
}

/** One researcher's public profile, or null when the profile is private or does not exist. */
export async function getResearcher(db: Db, accountId: number): Promise<(ResearcherCard & { memberSince: string | null }) | null> {
  const row = await db.one<Record<string, unknown>>(
    `select m.account_id, coalesce(m.display_name, a.display_name, a.email) as name,
            m.headline, m.institution, m.department, m.orcid, m.research_interests,
            m.bio, m.website, m.created_at,
            (select count(distinct p.id)::int from ozikoro_publication p
               join ozikoro_publication_author pa on pa.publication_id = p.id
              where pa.account_id = m.account_id and p.status = 'published' and p.is_public = true) as publication_count
       from ozikoro_member m join account a on a.id = m.account_id
      where m.account_id = $1 and m.is_public = true and m.status = 'active'`,
    [accountId]
  );
  if (!row) return null;
  return {
    accountId: Number(row.account_id),
    slug: String(row.account_id),
    name: String(row.name),
    headline: row.headline ? String(row.headline) : null,
    institution: row.institution ? String(row.institution) : null,
    department: row.department ? String(row.department) : null,
    orcid: row.orcid ? String(row.orcid) : null,
    researchInterests: Array.isArray(row.research_interests) ? row.research_interests.map(String) : [],
    publicationCount: Number(row.publication_count ?? 0),
    memberSince: row.created_at ? new Date(String(row.created_at)).toISOString() : null,
  };
}

/** A profile's biography and website, which the card above does not carry. */
export async function getResearcherBio(db: Db, accountId: number): Promise<{ bio: string | null; website: string | null }> {
  const row = await db.one<{ bio: string | null; website: string | null }>(
    `select bio, website from ozikoro_member where account_id = $1`,
    [accountId]
  );
  return { bio: row?.bio ?? null, website: row?.website ?? null };
}
