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
import { slugVariants } from './archive.ts';
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
    `select ${PUBLICATION_COLUMNS} from ozikoro_publication where slug = any($1::text[]) limit 1`,
    [slugVariants(slug)]
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

/**
 * What the public can read: published and public, and nothing else.
 *
 * THE THREE WAYS A WORK IS FOUND, ALL OF THEM HERE
 *
 * The brief names them: "search and discovery by topic, author or institution — findability is the
 * entire value". `search` covers the free-text half of all three at once (it matches the title, the
 * abstract and every author's name and affiliation), and `kind`, `author` and `institution` narrow it
 * to one axis at a time. The author and institution filters both go through
 * `ozikoro_publication_author`, because that is where a name and an affiliation are recorded — an
 * institution is not a column on the work, and copying it there would be a second answer to the same
 * question that drifts the first time a co-author moves.
 */
export interface PublishedOptions {
  limit?: number;
  offset?: number;
  discipline?: string | null;
  /** A publication kind — `journal_article`, `thesis`, `report`. */
  kind?: string | null;
  /** Free text over title, abstract, and every author's name and affiliation. */
  search?: string | null;
  /** An author's name, or part of one. */
  author?: string | null;
  /** An institution, or part of one, matched on the author row's affiliation. */
  institution?: string | null;
  /** Narrow to one account's works — the profile page's "their publications". */
  accountId?: number | null;
}

function publishedWhere(options: PublishedOptions): { clause: string; params: unknown[] } {
  const conditions: string[] = [`p.status = 'published'`, `p.is_public = true`];
  const params: unknown[] = [];

  if (options.discipline) {
    params.push(options.discipline);
    conditions.push(`$${params.length} = any(p.disciplines)`);
  }
  if (options.kind) {
    params.push(options.kind);
    conditions.push(`p.kind = $${params.length}`);
  }
  if (options.accountId) {
    params.push(options.accountId);
    conditions.push(
      `(p.submitted_by = $${params.length}
        or exists (select 1 from ozikoro_publication_author a where a.publication_id = p.id and a.account_id = $${params.length}))`
    );
  }
  if (options.author) {
    params.push(`%${options.author}%`);
    conditions.push(
      `exists (
        select 1 from ozikoro_publication_author a
         where a.publication_id = p.id and a.name ilike $${params.length}
      )`
    );
  }
  if (options.institution) {
    params.push(`%${options.institution}%`);
    conditions.push(
      `exists (
        select 1 from ozikoro_publication_author a
         where a.publication_id = p.id and a.affiliation ilike $${params.length}
      )`
    );
  }
  if (options.search) {
    params.push(options.search);
    const p = `$${params.length}`;
    conditions.push(
      `(p.search_vector @@ websearch_to_tsquery('english', ${p})
        or p.title ilike '%' || ${p} || '%'
        or exists (
             select 1 from ozikoro_publication_author a
              where a.publication_id = p.id
                and (a.name ilike '%' || ${p} || '%' or a.affiliation ilike '%' || ${p} || '%')
           ))`
    );  }

  return { clause: conditions.join(' and '), params };
}

export async function listPublished(db: Db, options: PublishedOptions = {}): Promise<PublicationSummary[]> {
  const { clause, params } = publishedWhere(options);
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
  const offset = Math.max(options.offset ?? 0, 0);
  params.push(limit, offset);

  const rows = await db.rows<Record<string, unknown>>(
    `select ${PUBLICATION_COLUMNS.replace(/(\w+)(,|$)/g, 'p.$1$2')} from ozikoro_publication p
      where ${clause}
      order by p.published_at desc nulls last limit $${params.length - 1} offset $${params.length}`,
    params
  );

  const out: PublicationSummary[] = [];
  for (const row of rows) out.push(rowToSummary(row, await loadAuthors(db, Number(row.id))));
  return out;
}

/**
 * How many works match the same filters, so a page can say whether there are more.
 *
 * Beside `listPublished` and sharing its `where`, deliberately: a count computed from a different
 * set of conditions is a count of a different thing, and a page that says "3 works" while showing
 * four is worse than one that says nothing.
 */
export async function countPublished(db: Db, options: PublishedOptions = {}): Promise<number> {
  const { clause, params } = publishedWhere(options);
  const row = await db.one<{ n: number }>(
    `select count(*)::int as n from ozikoro_publication p where ${clause}`,
    params
  );
  return Number(row?.n ?? 0);
}

/**
 * The institutions the repository's works actually name, with how many works each one carries.
 *
 * Counted from `ozikoro_publication_author.affiliation` rather than kept as a list, for the same
 * reason the archive's filter rail is counted: an institution nobody has published from is not an
 * institution this repository can offer, and a hand-maintained list would offer it anyway.
 */
export async function listInstitutions(
  db: Db,
  options: { limit?: number } = {}
): Promise<{ institution: string; works: number }[]> {
  const rows = await db.rows<{ institution: string; n: number }>(
    `select a.affiliation as institution, count(distinct a.publication_id)::int as n
       from ozikoro_publication_author a
       join ozikoro_publication p on p.id = a.publication_id
      where a.affiliation is not null and btrim(a.affiliation) <> ''
        and p.status = 'published' and p.is_public = true
      group by 1
      order by n desc, 1
      limit $1`,
    [Math.min(Math.max(options.limit ?? 60, 1), 200)]
  );
  return rows.map((r) => ({ institution: String(r.institution), works: Number(r.n) }));
}

/** The publication kinds actually present, so the toolbar offers only what exists. */
export async function listPublishedKinds(db: Db): Promise<{ kind: string; works: number }[]> {
  const rows = await db.rows<{ kind: string; n: number }>(
    `select kind, count(*)::int as n
       from ozikoro_publication
      where status = 'published' and is_public = true
      group by 1 order by n desc, 1`
  );
  return rows.map((r) => ({ kind: String(r.kind), works: Number(r.n) }));
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
  /**
   * The picture the person set on `/account/`, or null.
   *
   * ⚠️ **THIS FIELD EXISTS BECAUSE THE PROFILE PAGE DREW A MONOGRAM FOR EVERYBODY.** `/researchers/<id>/`
   * rendered `initials(name)` in an `.avatar` element and never read a picture at all, while the directory
   * one page away drew real portraits for writers — so a person's own profile showed their initials beside a
   * link to a directory that showed their face. The upload path is `/account/` (`setOwnAvatarUrl`); this is
   * the read that carries it to the page a reader meets them on.
   *
   * Null means no picture has been set, and the page draws the monogram — never a stock face, which is the
   * rule `/researchers/` already states about Gravatar's `d=mm` silhouette.
   */
  avatarUrl: string | null;
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
            m.headline, m.institution, m.department, m.orcid, m.research_interests, a.avatar_url,
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
    // The person's own picture, set on `/account/`. Null draws the monogram — never a stock face.
    avatarUrl: r.avatar_url ? String(r.avatar_url) : null,
  }));
}

// ---------------------------------------------------------------------------
// The directory: the people who wrote the archive, and the profiles beside them
// ---------------------------------------------------------------------------

/**
 * WHY THIS EXISTS BESIDE `listResearchers`.
 *
 * `listResearchers` answers a real question — *who has published a research profile* — and gives a
 * real answer: one account. `/researchers/` asked only that, and so rendered one card while **the
 * eleven people who wrote every one of the archive's 1,051 published records appeared nowhere on
 * the page** (round 310). The fault was the definition rather than the query: the page called a
 * researcher "somebody with a profile" where the archive calls a researcher "somebody whose byline
 * is on the record".
 *
 * So this answers both questions at once and keeps them apart:
 *
 *   * `writers` are `ozikoro_contributor` rows with at least one published, non-page record — the
 *     same people, the same counts and the same `records > 0` rule that `/about/` uses in
 *     `fillAbout`, so the two pages cannot disagree about who wrote the archive.
 *   * `profiles` are public, active `ozikoro_member` rows that are NOT already carried on a
 *     writer's entry. A research profile is an ADDITIONAL thing — institution, interests,
 *     publications — and the page says so rather than dissolving it into a byline list.
 *
 * THE LINK BETWEEN THE TWO IS NOT GUESSED. `ozikoro_contributor.account_id` is written only when a
 * claim has been approved by an editor (`decideContributorClaim`), and **no contributor has one**:
 * the owner's profile and the `nze` byline that shares his name are two rows this archive has not
 * joined. They are returned as two entries rather than merged on a matching name, because
 * `requestContributorClaim` already states the rule — a name is neither unique nor secret, so only
 * a human decides whether a claim is true — and a directory that decided from the name would be
 * inventing precisely the thing this archive forbids. When a claim is approved the profile moves
 * onto that writer's entry by itself.
 *
 * Every figure is a `count(*)` over the record. Nothing here is typed into a page.
 */
export interface DirectoryWriter {
  slug: string;
  name: string;
  bio: string | null;
  /** Published, non-page records under this byline — the number `/author/<slug>/` also shows. */
  records: number;
  /** The account behind the byline, once a claim has been approved. Null while it has not. */
  accountId: number | null;
  /**
   * A portrait the contributor uploaded, or null.
   *
   * **Read from the contributor row rather than from Gravatar**, and null means the author supplied none —
   * the directory draws a monogram then. It never carries a `d=mm` silhouette, because a stock face standing
   * in for a person is what this archive's rule forbids.
   */
  avatarUrl: string | null;
  /** True when `accountId` also has a public research profile, shown on this entry. */
  hasProfile: boolean;
  headline: string | null;
  institution: string | null;
  department: string | null;
  researchInterests: string[];
}

/** A published research profile the archive does not carry on a writer's entry. */
export interface DirectoryProfile {
  accountId: number;
  name: string;
  headline: string | null;
  institution: string | null;
  department: string | null;
  researchInterests: string[];
  /**
   * The picture the person set on `/account/`, or null.
   *
   * ⚠️ **THE DIRECTORY DREW A MONOGRAM FOR EVERY PROFILE BEFORE THIS FIELD EXISTED**, while drawing real
   * portraits for the writers on the same page. A person's own picture is theirs whichever list they appear
   * in, so it is carried here as well as on `ResearcherCard`. Null draws the monogram.
   */
  avatarUrl: string | null;
}

export interface ResearchDirectoryTotals {
  /** People with at least one published record under their byline. */
  writers: number;
  /** Every published, non-page record in the archive. */
  records: number;
  /**
   * How many of those records carry a byline. Kept apart from `records` so the page can say
   * "11 people wrote 1,051 of the 1,051 published records" **without overstating** if a record is
   * ever published with no author: a total is not a byline count, and a page that treated it as one
   * would claim credit for work nobody is named on.
   */
  recordsByWriters: number;
  writersWithBio: number;
  /**
   * Writers with at least one published record **and a portrait they uploaded**. Kept apart from
   * `writersWithBio` because the two gaps are different sizes: seven of the eleven have a biography and six
   * have a portrait, so one number cannot stand for both.
   */
  writersWithPortrait: number;
  /** Public, active research profiles. */
  profiles: number;
  /** Profiles the record links to a writer — the ones shown on a writer's entry. */
  profilesOnWriters: number;
}

export interface ResearchDirectory {
  writers: DirectoryWriter[];
  profiles: DirectoryProfile[];
  /** Counted over the whole directory, never over a filtered page. */
  totals: ResearchDirectoryTotals;
}

export async function listResearchDirectory(
  db: Db,
  options: { search?: string | null; limit?: number } = {}
): Promise<ResearchDirectory> {
  const limit = Math.min(Math.max(options.limit ?? 200, 1), 500);
  const search = options.search?.trim() || null;

  /*
   * THE FILTER IS THE LABEL'S PROMISE. The box says "name, institution or interest", so it reads
   * exactly those three and not biographies or record text: a search that quietly matched a
   * biography would answer a question the reader did not ask, and the records' own words are
   * searched at `/search`. Institutions and interests live on the research profile, so a writer
   * who has not published one is found by name alone — which the page states above the box.
   */
  const writerParams: unknown[] = [];
  let writerSearch = '';
  if (search) {
    writerParams.push(`%${search}%`);
    const p = `$${writerParams.length}`;
    writerSearch = `and (c.display_name ilike ${p}
                         or m.institution ilike ${p}
                         or exists (select 1 from unnest(m.research_interests) i where i ilike ${p}))`;
  }
  writerParams.push(limit);

  const profileParams: unknown[] = [];
  let profileSearch = '';
  if (search) {
    profileParams.push(`%${search}%`);
    const p = `$${profileParams.length}`;
    profileSearch = `and (coalesce(m.display_name, ac.display_name, ac.email) ilike ${p}
                          or m.institution ilike ${p}
                          or exists (select 1 from unnest(m.research_interests) i where i ilike ${p}))`;
  }
  profileParams.push(limit);

  const [writerRows, profileRows, totalRow] = await Promise.all([
    db.rows<Record<string, unknown>>(
      `select c.slug, c.display_name as name, c.bio, c.avatar_url, c.account_id,
              count(a.id)::int as records,
              (m.account_id is not null) as has_profile,
              m.headline, m.institution, m.department,
              m.research_interests,
              /*
               * THE PERSON'S OWN PICTURE, WHERE THE RECORD LINKS THEM TO A BYLINE AND THEY HAVE SET ONE.
               *
               * c.avatar_url is the byline's portrait: the archive's record, imported from the old site's
               * author-box field and curated since. ac.avatar_url is the picture the person uploaded
               * themselves on /account/. Where an editor has approved their claim the two are the same human
               * being, and the person's own picture is the more recent statement about themselves, so it is
               * preferred; where no claim is approved ac.avatar_url is null for everybody and the imported
               * portrait stands. See getBylineProfile for the same precedence and why it is not a merge.
               *
               * (This comment carries no backticks on purpose: it sits inside a template literal, and a
               * backtick would end the SQL string.)
               */
              coalesce(
                (select ac.avatar_url from account ac
                  where ac.id = c.account_id
                    and ac.avatar_url is not null and length(trim(ac.avatar_url)) > 0),
                c.avatar_url
              ) as portrait_url
         from ozikoro_contributor c
         left join ozikoro_article a
                on a.author_id = c.id and a.status = 'published' and a.is_page = false
         left join ozikoro_member m
                on m.account_id = c.account_id and m.is_public = true and m.status = 'active'
        where true ${writerSearch}
        group by c.id, c.slug, c.display_name, c.bio, c.avatar_url, c.account_id,
                 m.account_id, m.headline, m.institution, m.department, m.research_interests
       having count(a.id) > 0
        order by records desc, c.display_name
        limit $${writerParams.length}`,
      writerParams
    ),
    db.rows<Record<string, unknown>>(
      `select m.account_id, coalesce(m.display_name, ac.display_name, ac.email) as name,
              m.headline, m.institution, m.department, m.research_interests,
              /*
               * A profile card draws the person's own picture. Until this column was read, /researchers/ drew
               * a monogram for every profile while drawing a real portrait for the writers beside them — so a
               * person who had uploaded a picture of themselves appeared on the same page as their own
               * initials. The upload path is /account/; see setOwnAvatarUrl.
               */
              ac.avatar_url
         from ozikoro_member m
         join account ac on ac.id = m.account_id
        where m.is_public = true and m.status = 'active'
          and not exists (
            select 1 from ozikoro_contributor c
             where c.account_id = m.account_id
               and exists (select 1 from ozikoro_article a
                            where a.author_id = c.id and a.status = 'published' and a.is_page = false)
          )
          ${profileSearch}
        order by name
        limit $${profileParams.length}`,
      profileParams
    ),
    db.one<Record<string, unknown>>(
      `select
         (select count(*)::int from ozikoro_contributor c
           where exists (select 1 from ozikoro_article a
                          where a.author_id = c.id and a.status = 'published' and a.is_page = false)) as writers,
         (select count(*)::int from ozikoro_article where status = 'published' and is_page = false) as records,
         (select coalesce(sum(n), 0)::int from (
            select count(a.id)::int as n from ozikoro_contributor c
              join ozikoro_article a on a.author_id = c.id and a.status = 'published' and a.is_page = false
             group by c.id) bylined) as records_by_writers,
         (select count(*)::int from ozikoro_contributor c
           where c.bio is not null and length(trim(c.bio)) > 0
             and exists (select 1 from ozikoro_article a
                          where a.author_id = c.id and a.status = 'published' and a.is_page = false)) as writers_with_bio,
         (select count(*)::int from ozikoro_contributor c
           where c.avatar_url is not null and length(trim(c.avatar_url)) > 0
             and exists (select 1 from ozikoro_article a
                          where a.author_id = c.id and a.status = 'published' and a.is_page = false)) as writers_with_portrait,
         (select count(*)::int from ozikoro_member m
           where m.is_public = true and m.status = 'active') as profiles,
         (select count(*)::int from ozikoro_member m
            join ozikoro_contributor c on c.account_id = m.account_id
           where m.is_public = true and m.status = 'active'
             and exists (select 1 from ozikoro_article a
                          where a.author_id = c.id and a.status = 'published' and a.is_page = false)) as profiles_on_writers`
    ),
  ]);

  const interests = (value: unknown): string[] =>
    Array.isArray(value) ? value.map(String) : [];

  return {
    writers: writerRows.map((r) => ({
      slug: String(r.slug),
      name: String(r.name),
      bio: r.bio ? String(r.bio) : null,
      /*
       * `portrait_url` is the person's own picture where the record links an account that has set one, and
       * the imported byline portrait otherwise. See the note on the query above; `c.avatar_url` is read only
       * for the totals now, so a directory that preferred the wrong one would be visible here.
       */
      avatarUrl: r.portrait_url ? String(r.portrait_url) : null,
      records: Number(r.records ?? 0),
      accountId: r.account_id === null || r.account_id === undefined ? null : Number(r.account_id),
      hasProfile: Boolean(r.has_profile),
      headline: r.headline ? String(r.headline) : null,
      institution: r.institution ? String(r.institution) : null,
      department: r.department ? String(r.department) : null,
      researchInterests: interests(r.research_interests),
    })),
    profiles: profileRows.map((r) => ({
      accountId: Number(r.account_id),
      name: String(r.name),
      headline: r.headline ? String(r.headline) : null,
      institution: r.institution ? String(r.institution) : null,
      department: r.department ? String(r.department) : null,
      researchInterests: interests(r.research_interests),
      avatarUrl: r.avatar_url ? String(r.avatar_url) : null,
    })),
    totals: {
      writers: Number(totalRow?.writers ?? 0),
      records: Number(totalRow?.records ?? 0),
      recordsByWriters: Number(totalRow?.records_by_writers ?? 0),
      writersWithBio: Number(totalRow?.writers_with_bio ?? 0),
      writersWithPortrait: Number(totalRow?.writers_with_portrait ?? 0),
      profiles: Number(totalRow?.profiles ?? 0),
      profilesOnWriters: Number(totalRow?.profiles_on_writers ?? 0),
    },
  };
}

/** One researcher's public profile, or null when the profile is private or does not exist. */
export async function getResearcher(db: Db, accountId: number): Promise<(ResearcherCard & { memberSince: string | null }) | null> {
  const row = await db.one<Record<string, unknown>>(
    `select m.account_id, coalesce(m.display_name, a.display_name, a.email) as name,
            m.headline, m.institution, m.department, m.orcid, m.research_interests,
            m.bio, m.website, m.created_at, a.avatar_url,
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
    avatarUrl: row.avatar_url ? String(row.avatar_url) : null,
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

/**
 * A person's own profile, whether or not they have made it public.
 *
 * WHY THIS EXISTS RATHER THAN A FLAG ON `getResearcher`. The public reader filters on
 * `is_public = true`, which is right: the directory and every profile page should show the people who
 * chose to be findable. But the profile page is also the only surface where a researcher can EDIT
 * theirs, so a person who cleared the visibility box would find their own page answering "not found"
 * and would have no way to put it back — **a control that can lock you out of the screen that undoes
 * it.** The owner's view is therefore a different question from the public one, and it is asked
 * separately rather than by loosening the public read.
 */
export async function getOwnResearcher(
  db: Db,
  accountId: number
): Promise<(ResearcherCard & { memberSince: string | null }) | null> {
  const row = await db.one<Record<string, unknown>>(
    `select m.account_id, coalesce(m.display_name, a.display_name, a.email) as name,
            m.headline, m.institution, m.department, m.orcid, m.research_interests,
            m.created_at, a.avatar_url,
            (select count(distinct p.id)::int from ozikoro_publication p
               join ozikoro_publication_author pa on pa.publication_id = p.id
              where pa.account_id = m.account_id and p.status = 'published' and p.is_public = true) as publication_count
       from ozikoro_member m join account a on a.id = m.account_id
      where m.account_id = $1`,
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
    avatarUrl: row.avatar_url ? String(row.avatar_url) : null,
    memberSince: row.created_at ? new Date(String(row.created_at)).toISOString() : null,
  };
}

/** The profile's visibility setting, which `ResearcherCard` deliberately does not carry. */
export async function getProfileForEditing(db: Db, accountId: number): Promise<{
  isPublic: boolean;
  bio: string | null;
  website: string | null;
} | null> {
  const row = await db.one<{ is_public: boolean; bio: string | null; website: string | null }>(
    `select is_public, bio, website from ozikoro_member where account_id = $1`,
    [accountId]
  );
  if (!row) return null;
  return { isPublic: row.is_public, bio: row.bio ?? null, website: row.website ?? null };
}

/**
 * A portrait value, if and only if this site can actually draw it — otherwise `null`.
 *
 * ── WHY A PAGE NEEDS THIS AND NOT JUST A CAREFUL IMPORT ──────────────────────────────────────────────
 *
 * ⚠️ **`/author/<slug>/` DREW A BROKEN IMAGE, AND THE COMMENT ABOVE IT CLAIMED IT COULD NOT.** The byline page
 * renders `byline.avatarUrl` with no guard and its own header says *"the author's own portrait … never a
 * Gravatar default"* — **but that is a property of the DATA, not of the page.** It holds only while
 * `backfill-author-portraits.ts` has been run against the database being served, and measured here it has not:
 * 15 of this checkout's 16 rows carry an `avatar_url` and at least one of them is
 * `https://secure.gravatar.com/avatar/…?d=mm&r=g` on a byline with 314 published records.
 *
 * It would be a cosmetic fault anywhere and it is worse than that here: **this site's Content-Security-Policy
 * is `img-src 'self' data: https://i.ytimg.com` plus the advertisement origins, so a Gravatar URL is not
 * merely a stock face — it is a request the browser REFUSES**, and the page shows a broken-image box where a
 * person's portrait should be. An agent measured exactly that on `/researchers/`: 22 Gravatar avatars refused.
 *
 * So the rule the pages state is enforced where it is used. Only a path this site serves is returned, which
 * means a stored value from any other host — Gravatar's silhouette, a hotlink, a value a migration wrote —
 * falls through to the monogram the page already knows how to draw. **The page still draws either way**, which
 * is the failing-safe shape the archive asks for: a missing portrait is a monogram, never a broken box.
 *
 * `'/media/'` with the trailing slash, so a protocol-relative `//host/path` cannot slip through it.
 */
export function sameOriginPortrait(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed.startsWith('/media/') ? trimmed : null;
}

/**
 * One byline, as `/author/<slug>/` needs it: the record's own portrait and biography, and the
 * published research profile the record links to it — or none.
 *
 * WHY THIS IS A QUERY RATHER THAN TWO FIELDS ALREADY IN HAND
 *
 * `/author/<slug>/` listed a person's records and read the person's name off the first summary. **It read
 * neither `avatar_url` nor `bio`, so it showed LESS about a writer than `/about/` did** — the page a reader
 * arrived from named the same person with the same portrait and the same biography. The columns were in the
 * row the whole time; nothing asked for them.
 *
 * The fields and the joins are the ones `listResearchDirectory` already uses, so the byline page and the
 * directory cannot come to disagree about the same person: the portrait is the contributor's own upload (or
 * null, which the page draws as a monogram), the biography is the WordPress `description`, and the profile
 * fields appear only where a public, active member profile is joined to the byline by the record — never by
 * a matching name, because a name is not proof.
 */
export interface BylineProfile {
  slug: string;
  name: string;
  bio: string | null;
  avatarUrl: string | null;
  /** Published, non-page records under this byline. */
  records: number;
  /** The account behind the byline, once a claim has been approved. Null while it has not. */
  accountId: number | null;
  headline: string | null;
  institution: string | null;
  department: string | null;
  researchInterests: string[];
}

export async function getBylineProfile(db: Db, slug: string): Promise<BylineProfile | null> {
  const row = await db.one<Record<string, unknown>>(
    /*
     * ── WHERE A BYLINE'S PORTRAIT AND BIOGRAPHY COME FROM, ONCE THE BYLINE IS CLAIMED ─────────────────
     *
     * Two rows describe the same person here and they are not interchangeable:
     *
     *   ozikoro_contributor            the ARCHIVE'S RECORD of the byline — the name WordPress published,
     *                                  the description the import carried (7 of 16 rows have one) and the
     *                                  portrait recovered from the old site's author-box field (8 of 16).
     *   account + ozikoro_member       the PERSON — what they have written about themselves on /account/
     *                                  since they were able to, and the picture they uploaded.
     *
     * c.account_id is set only by an approved claim, so before that the person's columns are not reachable
     * from this byline at all and the imported record stands. After it, the person's own words are the more
     * recent statement about themselves, and a bio they cannot see on their own byline page is the exact
     * fault the owner reported — "writers to change their bio". So coalesce prefers the person's value and
     * falls back to the archive's, per field rather than per row: a writer who has written a biography but
     * not uploaded a picture keeps the archive's portrait.
     *
     * NOTHING IS MERGED, and no join is made on a matching name: this is the record's own account_id or it is
     * nothing. That is the rule requestContributorClaim states — "a name is neither unique nor secret" — and
     * it is why the precedence is expressed as a coalesce over a link rather than a lookup.
     *
     * (These comments carry no backticks on purpose: they sit inside a template literal, and one would end
     * the SQL string.)
     */
    `select c.slug, c.display_name as name,
            coalesce(
              (select nullif(trim(m.bio), '') from ozikoro_member m where m.account_id = c.account_id),
              c.bio
            ) as bio,
            coalesce(
              (select nullif(trim(ac.avatar_url), '') from account ac where ac.id = c.account_id),
              c.avatar_url
            ) as avatar_url,
            c.account_id,
            count(a.id)::int as records,
            m.headline, m.institution, m.department, m.research_interests
       from ozikoro_contributor c
       left join ozikoro_article a
              on a.author_id = c.id and a.status = 'published' and a.is_page = false
       left join ozikoro_member m
              on m.account_id = c.account_id and m.is_public = true and m.status = 'active'
      where c.slug = $1
      group by c.id, c.slug, c.display_name, c.bio, c.avatar_url, c.account_id,
               m.headline, m.institution, m.department, m.research_interests`,
    [slug]
  );
  if (!row) return null;
  return {
    slug: String(row.slug),
    name: String(row.name),
    bio: row.bio ? String(row.bio) : null,
    /*
     * A PORTRAIT IS THE AUTHOR'S OWN UPLOAD OR IT IS NOTHING.
     *
     * The archive's import once filled this column with Gravatar's `d=mm` fallback — one grey silhouette
     * served for everybody who has no account there — and the honest value for that is null, so the page
     * draws a monogram. The backfill cleared those rows; this guard is what keeps a row that arrives with
     * one from putting a stock face on a real person's page.
     */
    avatarUrl: row.avatar_url ? String(row.avatar_url) : null,
    records: Number(row.records ?? 0),
    accountId: row.account_id === null || row.account_id === undefined ? null : Number(row.account_id),
    headline: row.headline ? String(row.headline) : null,
    institution: row.institution ? String(row.institution) : null,
    department: row.department ? String(row.department) : null,
    researchInterests: Array.isArray(row.research_interests) ? row.research_interests.map(String) : [],
  };
}
