# Import reconciliation: the WordPress dump against the archive's cluster

**Round 339. Read-only against both sides.** Nothing in this document was produced by writing to
`ozikoro.com`, to `.data/pg`, or to any table. The live site was asked for 6 `HEAD` requests in total,
all of them read-only, and the cluster was read from a **copy** at `.data/scratch-recon/pg` taken while
the review server on 3110 held the real one. The real cluster was never opened for writing, no lock was
removed, and no process was signalled.

The owner's instruction is that nothing on the live site may be lost:

> *"ozikoro.com has accounts in the written articles, and archives, so make sure every single archive in
> zokoro.com, with its accounts is retained. every single write, its contents, both draft and published
> is retained."*

This document is the answer, record by record. **"Nothing was lost" is only claimed here where the
difference can be named.** Seven categories have a difference that cannot be explained away as a
duplicate, an orphan or a placeholder, and they are listed plainly in §7.

---

## 1. Method, and why the numbers can be trusted

### The dump

`data/ozikoro-wp/dbdump/sql/ozikbfpe_ozikoro.sql` — **121,468,815 bytes**, 111 `CREATE TABLE`
statements, prefix `wpc9_`, **41 tables holding rows** and 70 holding none.

**A row count is not a line count.** phpMyAdmin writes multi-row `INSERT`s: the file holds **2,616
`INSERT` statements carrying 202,743 tuples**, and one statement line is 1.5 MB. `wpc9_posts` arrives in
1,185 statements and `wpc9_postmeta` in 697, so `grep -c "INSERT INTO"` counts statements and any
per-line arithmetic is wrong by the rows-per-statement factor.

So the dump was read by a byte-level tokeniser that walks each `VALUES` list, tracks whether it is
inside a quoted string (honouring `\'`, `\\`, `''` and the MySQL escape set), and counts the tuples it
actually closes. It reported **0 parse failures**.

**It was validated against figures the project already held**, and reproduces every one exactly:

| table | statements | tuples parsed | previously recorded |
|---|---:|---:|---:|
| `wpc9_posts` | 1,185 | **9,144** | 9,144 |
| `wpc9_postmeta` | 697 | **27,996** | 27,996 |
| `wpc9_users` | 1 | **15** | 15 |
| `wpc9_usermeta` | 2 | **724** | 724 |
| `wpc9_comments` | 1 | **51** | 51 (47 approved + 4 spam) |
| `wpc9_commentmeta` | 1 | **248** | 248 |
| `wpc9_terms` | 11 | **11,150** | 11,150 |
| `wpc9_term_taxonomy` | 8 | **11,150** | 11,150 |
| `wpc9_term_relationships` | 7 | **21,137** | 21,137 |

Two further independent cross-checks agree with earlier rounds: the PHP `image_meta` array inside
`_wp_attachment_metadata` yields **144 non-empty `credit` and 52 non-empty `copyright`** — the same
figures round 337 recorded — and all 3,582 `_wp_attachment_metadata` rows unserialise, read by a
byte-exact PHP unserialiser (PHP's `s:N:"…"` counts **bytes**, so a character-based reader mis-slices on
the first `©` or `ọ`).

### The cluster

A copy of the cluster, read with the repository's own `createDb()` and the repository's own
`mediaUrlMap()` resolver, so the tests below exercise the code the site runs rather than a
re-implementation of it.

---

## 2. The reconciliation table

`cluster` counts are read from the copy. "Difference" is `cluster − dump` for a like-for-like category.

| # | Category | Dump | Cluster | Diff | What the difference is |
|---|---|---:|---:|---:|---|
| 1 | Articles — `post_type='post'`, `publish` | 1,051 | 1,051 | **0** | exact |
| 2 | Articles — `post_type='post'`, `draft` | 39 | 39 | **0** | imported; the archive has no `draft` state, so they land as `review` |
| 3 | Articles — `post_type='post'`, `auto-draft` | 2 | 0 | −2 | WordPress editor placeholders, empty, created when someone opens the editor |
| 4 | Pages — `post_type='page'`, `publish` | 6 | 6 (`is_page`) | **0** | exact |
| 5 | Pages — `post_type='page'`, `draft` | 1 | 0 | **−1** | **"Contact Us", 200 words — see §7.1** |
| 6 | Blogger records (no WordPress id) | — | 524 | +524 | separate export: 661 − 137 de-duplicated against the archive |
| | **Article-bearing records total** | **1,099** | **1,620** | | 1,051 + 39 + 6 = 1,096 from WordPress, + 524 Blogger |
| 7 | Media rows — `post_type='attachment'` | 3,583 | 3,488 | **−95** | 94 are the images the 39 drafts carry; 1 is a private WordPress export `.txt` accidentally uploaded. See §4 |
| 8 | Media rows with a `storage_key` | — | 3,437 | | every one has its file: §4 |
| 9 | Media rows with `storage_key` NULL | — | 51 | | records whose file exists **nowhere**; the live site answers 404 for them too |
| 10 | Files in the served store | — | 3,441 | | 3,437 keyed files + 4 episode recordings (838 MB) |
| 11 | Accounts — `wpc9_users` | 15 | 15 contributors, 2 accounts | see §5 | every WordPress user has a byline; **none has a login** |
| 12 | User metadata — `wpc9_usermeta` | 724 | — | | see §5.3: bios and portraits exact, 4 social URLs absent |
| 13 | Comments — `wpc9_comments` | 51 | 0 | **−51** | **no comment table and no comment importer — §7.2** |
| 14 | Comment metadata — `wpc9_commentmeta` | 248 | 0 | **−248** | same |
| 15 | Tags — `post_tag` terms | 11,056 | 11,056 (`ozikoro_label`) | **0** | exact |
| 16 | Tag assignments — `post_tag` relationships | 18,496 | 18,496 (`ozikoro_article_label`) | **0** | exact |
| 17 | Categories — `category` terms | 14 | 14 (`ozikoro_topic`) | **0** | every term retained |
| 18 | Category assignments | 2,142 | 1,090 | **−1,052** | `topic_id` is one foreign key per article — §7.4 |
| 19 | Menus — `post_type='nav_menu_item'` | 33 | 0 | **−33** | the navigation is hand-written in `apps/ozikoro/app/layout.tsx` |
| 20 | Menu terms — `nav_menu` | 44 | 0 | **−44** | 25 of the 44 are WordPress's own `… duplicate` copies of empty menus |
| 21 | Revisions — `post_type='revision'` | 4,266 | 0 | **−4,266** | **no article-revision table exists — §7.3** |
| 22 | PublishPress author bylines | 455 rel / 8 terms | 15 contributors | **0 unresolved** | all 8 author terms resolve to a contributor, including the merged one — §5.2 |
| 23 | Published words retained | — | 885,335 published + 463,536 in review | | |

**The article arithmetic closes completely.** Every one of the 1,051 published posts, all 39 drafts and
all 6 published pages has a `wp_post_id` in the cluster, and **not one cluster `wp_post_id` exists that
the dump does not hold** — so nothing was invented either. 1,051 + 39 + 6 = 1,096 rows with a
`wp_post_id`, plus 524 Blogger rows = **1,620**, the cluster's exact total.

### The post types that were deliberately not imported

`wpc9_posts` holds 21 post types. The other 2,600-odd rows are WordPress's own bookkeeping, not the
archive's record: `wp_font_face` (33), `cpt_layouts` (32), `googlesitekit_email` (29),
`oembed_cache` (24), `wp_font_family` (12), `elementor_library` (11), `ppma_boxes` (6),
`ppmacf_field` (5), `customize_changeset` (2), `custom_css` (2), `wpcode` (2), `wp_global_styles` (1),
`mc4wp-form` (1), `wpcf7_contact_form` (1), `give_forms` (1), `campaign` (1), plus 4,266 revisions
(§7.3) and 3,583 attachments (§4). None of them is a history or an archive.

---

## 3. The bodies' addresses — the trap, and the measurement through it

**The trap is real.** 1,024 of the 1,051 published articles still hold the *old* address
`ozikoro.com/wp-content/uploads/…`; the rewrite to `/media/…` happens at render time. So a check that
greps for `/media/` reports almost everything as missing, and one that greps for the old address
reports everything as present. Neither is the question. The question is whether each address **resolves
to a file the site can serve**.

Measured by running the archive's own resolver (`mediaUrlMap` from `packages/ozikoro/src/media.ts`, the
function the article route calls) over every `<img>`, `data-trx-lazyload-src` and `<source srcset>`
address in all 1,057 published records:

```
published records                                1,057
image addresses found in their bodies            2,876
  resolver returned a /media/ URL                 2,855   ← and every one of those files is on disk
  resolver returned null                             21
     of those, a third-party host (deliberate)        14
     of those, an ozikoro.com address                  7   ← the holes, named below
```

**2,855 of 2,876 addresses resolve, and 2,855 of 2,855 resolved files exist on disk.** The 14 external
addresses (Twitter 10, BBC, Pinterest, Google, Tumblr) are `null` **by design** — the resolver's own
comment says substituting anything for them would be putting a different photograph on a history page —
and the archive never held those files.

**The 7 holes, named.** Six of the seven have the file on disk already, under no row:

| address in the body | article | file on disk |
|---|---|---|
| `2025/06/WhatsApp-Image-2025-06-10-at-03.11.02.jpeg` | `/the-power-of-culture-what-igbo-omugwo-can-teach-us-about-postpartum-care/` | `3625-…` yes |
| `2025/05/sddefault.jpg` | `/ugbo-a-living-archive-of-ancient-igbo-civilization-and-cultural-resilience-in-enugu-state/` | `3701-…` yes |
| `2025/01/rev-taylor.jpg` | `/how-sunday-became-known-as-uka-in-igbo-language/` | `3734-…` yes |
| `2024/09/IMG_9629.jpeg` | `/the-influence-of-nri-leadership-titles-and-cultural-heritage-in-igbo-land/` | `3779-…` yes |
| `2024/09/Igbo-Men-with-Ichi-Scarification-Thomas-W.-Northcote-300x148.png` | `/ichi-mark-the-igbo-scarification/` | `3780-…` yes |
| `2024/09/Onitsha-Women-G.-F.-Packer-in-the-1880s-300x221.jpg` | `/umuada-women-leadership-roles-in-the-igbo-society/` | `3801-…` yes |
| `2020/01/image-1-copyright.jpg` | `/about/` | **no file anywhere** |

`2025/05/sddefault.jpg` is the instructive one: the archive *does* hold a row for an `sddefault.jpg`
(`ozikoro_media` 3148, `wp_media_id` 1882, `source_url` `…/2024/11/sddefault.jpg`). It is a **different
upload of a file with the same name**, so the resolver's exact match and its stripped-suffix match both
miss, and the body's image falls back to `ozikoro.com`. Holding a file is not the same as being able to
resolve an address to it.

**Six of these seven are fixable trivially and safely** by inserting a media row for the orphan file;
the seventh has no file and cannot be fixed from disk. None was fixed in this round (§7.7), because the
live cluster is held by another process and a reconciliation should not also be a write.

### The body-address shape

| | records | hold the old `ozikoro.com` address | hold a `/media/` address |
|---|---:|---:|---:|
| published articles (`is_page = false`) | 1,051 | **1,024** | **7** |
| published pages (`is_page = true`) | 6 | 3 | 0 |
| all records | 1,620 | 1,054 | 8 |

1,024 and 7 — **exactly the figures the brief carried**, measured independently.

---

## 4. The files

### 4.1 Rows and files

| | count |
|---|---:|
| `ozikoro_media` rows | 3,488 |
| rows with a `storage_key` | 3,437 |
| distinct `storage_key`s | 3,437 |
| **rows with a `storage_key` but no file** | **0** |
| files under `.data/media/ozikoro` (the store `getStorage()` reads) | 3,437 + 4 episode recordings = **3,441** |
| **files in the store with no row** | **0** |

**Every keyed row has its file and every file has its row.** The 4 extra files are the episode
recordings under `ozikoro/episodes/`, which have their own `ozikoro_episode` rows.

### 4.2 Does the served file match the original?

Two whole-set checks, and then three live ones.

1. **The served file against its row.** All **3,437 of 3,437** files are byte-size identical to their
   row's `filesize_bytes`. 0 differ.
2. **The row against the dump's original.** `_wp_attachment_metadata.filesize` is the size of the file
   as WordPress uploaded it. All **3,488 of 3,488** rows — including the 51 with no file — carry a
   `filesize_bytes` equal to that original. **0 differ.** The archive's record of what each file was is
   exactly the dump's.
3. **Live spot check, 3 requests** (`HEAD`, read-only):

| file | live `Content-Length` | `ozikoro_media.filesize_bytes` |
|---|---:|---:|
| `2024/09/IMG_9354-1.jpeg` | 242,267 | 242,267 |
| `2026/09/Igbo Folk Idioms in Caribbean Phrase.pdf` | 191,005 | 191,005 |
| `2025/05/AQM3P-…VW.mp4` | 7,364,399 | 7,364,399 |

**How they were compared:** by declared length on both sides, not by digest — `HEAD` gives a size and not
a body, and fetching full bodies for 3,488 files is not acceptable behaviour against a production
WordPress install. Size equality is not digest equality; it is strong evidence and it is what was
measured. Round 337's independent finding that 893 of the 3,488 rows now carry a credit read from the
file's own embedded metadata is a second, different corroboration that the served files are the
originals and not substitutes.

### 4.3 The two media directories, which are not the same thing

The brief's "3,441 files on disk, 838 MB" is the **store**: `.data/media/ozikoro`, which is
`LOCAL_MEDIA_ROOT` and the only branch the production media route uses. There is a second directory,
`data/media/ozikoro-wp`, which is the route's **development-only fallback**:

| | store `.data/media/ozikoro` | fallback `data/media/ozikoro-wp` |
|---|---:|---:|
| files at top level | 3,437 | 3,750 |
| …matching a `storage_key` exactly | 3,437 | 3,437 |
| …with **no row** | **0** | **313** |
| episode recordings (subdirectory) | 4 | 1 |

**The 313 unreachable files.** They are named `3489-…` through `3801-…`, consecutive, and **305 of them
carry a WordPress `-WxH` size suffix** (`ofo-anam-225x300.jpg`, `Aboh-1024x683.jpeg`, …). They are
WordPress's generated renditions, downloaded into the fallback directory under a counter that started at
the then-highest media id (3,488), so their numbers collide with real WordPress ids without being them.
They are in no table, are not in the store, and are therefore **not reachable from the site** — the
resolver maps `source_url` → `storage_key`, and no row points at them.

**They are not superseded duplicates, and that is the awkward part.** Their 37 distinct base images have
no full-size original anywhere: the stripping rule the resolver uses (`strip -WxH`) recovers a name that
is **not** a `storage_key` for any of the 37. Six of them are the images §3 named as unresolved holes in
published bodies. So a file that a published article needs is sitting on disk in the directory nobody
serves.

### 4.4 The 51 rows with a `storage_key` of NULL

The brief asked whether 51 rows have a null key, and if so what they are and where their files went.
**Yes: 51.** Their files are in neither store and **not on the live site either** — two of them were
asked for read-only and both answered **404**:

```
2026/01/Cappa_-_കാപ്പ.jpg                  HTTP/2 404
2026/01/Okike-Blower-…-Courtesy-–-…176.jpg  HTTP/2 404
```

So the record is a genuine hole rather than an import failure: WordPress deleted the file and left the
attachment row, whose `_wp_attachment_metadata` still declares the size the file used to be. Their names
are also, in 46 of the 51 cases, outside the media route's `KEY_PATTERN` — an en dash `–`, `Ƙ`, `Ω`,
`×`, Malayalam, or a curly quote — so even a recovered file would need a new address rather than the old
one. The five in-pattern names (`…3D8NB4Y.jpg`, `…2A7B43F.jpg`, two `Uli-painting…` names) 404 as well.

### 4.5 The 95 attachments with no media row

The brief's "3,488 rows against 3,441 files is a discrepancy of 47" is not the discrepancy. The
discrepancy is **3,583 `attachment` rows in the dump against 3,488 `ozikoro_media` rows — 95**. What
they are:

- **94 have a parent post with `post_status = 'draft'`** — the images of the 39 drafts, across 34
  distinct draft posts. The drafts themselves were imported, and sit in the cluster as `review`.
- **1 is `wpc9_posts` 4338**, `post_status='private'`, `2025/02/walfr.WordPress.2023-10-28.xml_.txt` — a
  WordPress **export XML file** uploaded into the media library by mistake. Not a media asset.
- Of the 95, **15 have the identical filename held under a different media id** (9991's
  `cafi_a_2531114_f0003_b.gif` is held as `8562-…`, 10243's `Old_Calabar_River_Mouth_1820.png` as
  `9034-…`, and so on): WordPress holds duplicate uploads, so the image is present, catalogued under its
  other attachment.
- **80 have no file with that filename anywhere on disk.** Their files would have to be fetched from
  `ozikoro.com`; whether they are still there was not tested, because that is 80 requests against a
  production install.

So the honest statement is: the 39 drafts kept their bodies but **80 of their images are in no store and
under no row**, and 15 more are held under a duplicate's row.

---

## 5. The accounts

### 5.1 Every WordPress user, and where each one is now

Roles in the dump: **1 administrator, 4 editors, 9 authors, 1 contributor** — 15 users, exactly.

| `wpc9_users` | login | role | records authored | contributor | account |
|---:|---|---|---:|---|---|
| 1 | `OZIKORO` | administrator | 4 | **merged into `nze`** (audit 721) | — |
| 2 | `Chizobem Chinedu Opiah` | editor | 20 | `chizobem-chinedu-opiah` (id 3) | — |
| 3 | `Nze` | administrator | 188 | `nze` (id 6) | `idenzeme@gmail.com` (owner) |
| 4 | `chuka` | author | 314 | `chuka` (id 4) | — |
| 5 | `aka` | author | 2 | `aka` (id 1) | — |
| 6 | `Ossai` | editor | 173 | `ossai` (id 5) | — |
| 7 | `Pepple` | author | 0 | `pepple` (id 18) | — |
| 9 | `Nzubechi` | editor | 22 | `nzubechi` (id 10) | — |
| 10 | `Camela` | author | 0 | `camela` (id 20) | — |
| 11 | `Chinemerem` | contributor | 59 | `chinemerem` (id 2) | — |
| 13 | `Ghostofokello` | author | 1 | `ghostofokello` (id 7) | — |
| 14 | `Odiari` | author | 0 | `odiari` (id 23) | — |
| 15 | `Kosiso` | author | 305 | `kosiso` (id 9) | — |
| 16 | `Okenwa` | author | 4 | `okenwa` (id 8) | — |
| 17 | `Uzondu` | editor | 0 | `uzondu` (id 26) | — |

Plus one contributor with no WordPress user — `emeka-esogbue` (id 60), who carries all **524** Blogger
records.

**So: every `wpc9_users` row has a contributor record, except user 1, whose contributor was
deliberately merged. No WordPress user has a login account in this archive.** Four users (7, 10, 14, 17)
authored no records at all and still have a byline row, which is why "10 writers with records and 16
contributors historically" is not contradicted: the cluster holds a contributor for each of the 15, and
4 of them have written nothing.

### 5.2 The deliberate merges, with their audit trail

`ozikoro_audit` holds **515 rows**. The one merge is audit row **721**:

```
action      merge_contributor
entity      ozikoro_contributor 11  ("Ozi Ikoro", slug ozikoro, wp_user_id 1)
after       merged_into 6 ("Idenze Ezeme", slug nze)
            files_attributed 791 → files_reassigned 791
            articles_attributed 7 → articles_reassigned 7
            files_attributed_before  { nze: 259, ozikoro: 791 }
            files_attributed_after   { nze: 1050 }
```

and **seven `reassign_byline` rows (714–720)**, one per record, each carrying its own before/after and
naming the article. This is the case the brief warned about — *"a missing contributor may be a
deliberate merge, not a loss"* — and it is a merge: **nothing was dropped, and the arithmetic agrees
with the tables** (`nze` today holds 196 articles and 1,050 media; 259 + 791 = 1,050).

The merge is also **the right call on the evidence**, which the reconciliation can now show: WordPress
had *two* byline systems, and person 39 in the PublishPress `author` taxonomy is **"Ide Nze", slug
`ozikoro`** — the same person WordPress also recorded as term 2517, "Ide Nze", slug `nze`. Two author
terms for one writer; merging them corrected a duplicate rather than deleting a person.

### 5.3 User metadata

| | dump | cluster | difference |
|---|---:|---:|---|
| non-empty `description` (the biography) | **7** | **7** contributors with a bio | **0** |
| `sabox-profile-image` (the WordPress portrait) | **7** | **7** contributors with an `avatar_url` | **0** |
| non-empty `user_url` | 2 | 1 (`nze` → `https://idenze.com`) | 1, on the merged user |
| roles | 15 | 2 `ozikoro_member` rows, 15 `grant_role` audits | see below |
| social profile URLs (`sabox_social_links`) | **4** (2 users) | 0 | **−4, §7.9** |

The biographies and portraits are exact: the 7 users with a non-empty `description` are precisely the 7
contributors holding a bio, and the 7 `sabox-profile-image` URLs are precisely the 7 `avatar_url`s, each
rewritten to `/media/…`. Every contributor *without* a bio had none in WordPress either. The only
`user_url` not carried forward is `https://ozikoro.com` on user 1, which is the user that was merged.

**Two things in the metadata do not reconcile, and are reported rather than smoothed over.** The audit
trail records **15 `approve_claim` rows** on `ozikoro_contributor_claim` and **15 `grant_role` rows** on
`ozikoro_member` — but the tables now hold **0 claims, 2 members and 0 contributor-to-account links**
(`ozikoro_contributor.account_id` is NULL on all 15 rows). A fixture of 15 member records created on
1 October was later removed; whatever the reason, the current state is that **no contributor can be
reached by a login**, and the audit rows are the only evidence the link ever existed.

### 5.4 The retired address, verified

`ozikoro_redirect` holds **one** row, and it is not this one: `/` → `/home/`, "Migrated from WordPress:
the slug changed". The `/author/ozikoro/` → `/author/nze/` redirect is a **constant in
`apps/ozikoro/middleware.ts`**, deliberately so — that file explains that middleware runs in Next's edge
runtime where PGlite cannot run, so the table is not readable from there.

Asked directly, read-only:

```
GET /author/ozikoro/   301 → http://127.0.0.1:3110/author/nze/
GET /author/nze/       200
```

**A published byline address keeps working, which is the owner's rule.**

### 5.5 Bylines attributed to somebody else

WordPress recorded a byline twice — `post_author` and a PublishPress `author` taxonomy term. Across all
**455** PublishPress relationships, comparing the term's `user_nicename` with `post_author`, only **two
posts disagree**, and both disagree the same way:

```
post  279  post_author=nze  PublishPress byline=ozikoro
post 3277  post_author=nze  PublishPress byline=ozikoro
```

Both were bylined "Ozi Ikoro" while being authored by `nze` — the same person the merge joined. **After
the merge, both are attributed consistently and correctly, and no third-party byline was reassigned.**
Every one of the 8 PublishPress author terms maps to a contributor record: `chuka`, `nze`,
`chukwuwike ossai`, `chinemerem okwuchukwu`, `chikwere` (= `chizobem-chinedu-opiah`), `aka`, `pepple`, and
`ozikoro` (the merged one). No byline is unaccounted for.

---

## 6. Comments, menus, categories

**Comments are simply absent.** There is **no comment table in the cluster and no comment importer** —
`packages/ozikoro/src/import/archive.ts` and `recovered.ts` carry the post's `comment_status` (open or
closed) and nothing else. So the dump's **51 comments and 248 `commentmeta` rows have nowhere to land**.
They are not spam, mostly: **47 are approved reader comments**, several substantive and several with a
reply from the editor, on 38 different articles, from October 2024 to March 2026 (the other 4 are spam
from September 2026). This is a real category of the record with no representation in the archive, and
it is listed in §7.

**The navigation is not derived from WordPress.** `apps/ozikoro/app/layout.tsx` writes its menu by hand
(Histories, Clans, Folklores, Watch, Archive, Researchers, Academy, About, plus account). WordPress's 33
`nav_menu_item` rows point at: the About, Authors, Privacy Policy and Contact pages (10 items, three of
them at the un-imported draft Contact page); the Facebook, Twitter and YouTube profiles; **a
`themeforest.net` "Buy now!" link and four `#` links** from the theme's demo content; and **11 items
filed as `category` whose labels are article titles** (`Carved wooden door from Nri-Awka (Igbo)`, …) or
revision slugs (`4092-revision-v1`) — broken menu entries in WordPress itself. All 33 are `publish`.
Nothing here is a record the archive lost; 25 of the 44 `nav_menu` terms are WordPress's own
`… duplicate` copies of empty menus.

**Tags reconcile exactly and categories do not.** All **11,056** `post_tag` terms are `ozikoro_label`
rows (0 labels lack a `wp_term_id`; 0 point at a category), and all **18,496** tag relationships are
`ozikoro_article_label` rows — both sides identical. All **14** `category` terms are `ozikoro_topic`
rows, but WordPress assigned **2,142** categories to 1,090 posts (419 posts had one, 671 had between two
and six) and the cluster holds **1,090** assignments, because `ozikoro_article.topic_id` is a single
foreign key. **1,052 category assignments are in no table** — and the one kept is not even always
Yoast's declared primary category (765 agree, 243 differ). The `ozikoro_entity` facet (188 rows, 232
article links) is derived from article titles through the dictionary, not from WordPress, and so has no
counterpart to reconcile against.

---

## 7. What is genuinely missing

**These are the differences that are not a duplicate, an orphan, a placeholder or a merge.** None was
fixed in this round; the list is the deliverable. Ordered by how much of the record it is.

1. **The draft page "Contact Us"** — `wpc9_posts` 3591, slug `contact`, `post_status='draft'`, first
   written 2025-01-19 and last modified 2026-08-20, **200 words**: `contact@ozikoro.com`,
   `stories@ozikoro.com`, a Contact Form 7 shortcode, and the social links. It is the **only** WordPress
   page or post of any status that was not imported, and `apps/ozikoro/app` has **no `/contact` route**,
   so `/contact/` answers **404**. Three published WordPress menu items pointed at it.
2. **51 comments (47 approved, 4 spam) and their 248 `commentmeta` rows** — no table, no importer (§6).
3. **4,266 revisions**, of which **3,061 hold 30,007,462 bytes (28.6 MiB) of text that appears in no
   surviving post**, across 808 parent posts; 1,192 others merely duplicate their parent's current text
   and 27 are empty. There is no `ozikoro_article_revision` table — the archive versions episodes,
   clans, words, names and proverbs, but not articles. So superseded editorial text of the articles is
   the largest measured category with no home in the cluster.
4. **1,052 category assignments** on 671 posts, and for 243 posts not even the category Yoast declared
   as primary (§6).
5. **80 images of the 39 WordPress drafts** — no media row and no file in any store; recoverable only by
   fetching them from `ozikoro.com` (§4.5). A further 15 are held under a duplicate attachment's row.
6. **51 media records whose file exists nowhere** — not in the store, not in the fallback, and 404 on the
   live site (§4.4). The record survives with its original size and rights; the bytes are gone from both
   sides, so this is not recoverable from the dump.
7. **Six published articles whose image cannot be resolved**, although the file is on disk:
   `/the-power-of-culture-what-igbo-omugwo-can-teach-us-about-postpartum-care/`,
   `/ugbo-a-living-archive-of-ancient-igbo-civilization-and-cultural-resilience-in-enugu-state/`,
   `/how-sunday-became-known-as-uka-in-igbo-language/`,
   `/the-influence-of-nri-leadership-titles-and-cultural-heritage-in-igbo-land/`,
   `/ichi-mark-the-igbo-scarification/`, `/umuada-women-leadership-roles-in-the-igbo-society/`. The files
   are `3625-`, `3701-`, `3734-`, `3779-`, `3780-` and `3801-` in `data/media/ozikoro-wp`; each needs a
   media row whose `source_url` is the address the body holds. **The seventh hole, `/about/`'s
   `2020/01/image-1-copyright.jpg`, has no file and cannot be resolved from disk.**
8. **313 files in `data/media/ozikoro-wp` with no row** — WordPress thumbnail renditions, in the
   development-only fallback directory rather than the served store, reachable by nothing (§4.3).
9. **Four social profile URLs** — Chizobem's `x.com/NwekereNdoki` and `facebook.com/ChizobemOpiah`,
   Nze's `x.com/nzemmili` and `instagram.com/nzeora` (§5.3).
10. **Four of the six published pages' WordPress addresses answer 404**: `/authors/`, `/privacy-policy/`
    (the content is served at `/privacy/`), `/nze/` and `/construction/`. `/about/` and `/home/` are 200.
    The page *content* is in the cluster for all six; the *published addresses* are not all served, which
    the owner's own rule says they should be. This is adjacent to the links-and-menus sweep and is
    reported rather than touched.
11. **2 `auto-draft` rows and 1 private WordPress export file** — correctly not imported: editor
    placeholders with no content, and a `.txt` of a database export that was uploaded by mistake.

**And what is not missing, stated as plainly:** every published article, every draft article, every
published page, every attachment record with a file, every tag and tag assignment, every category term,
every WordPress user's byline, every non-empty biography, every portrait, every media file's original
size, and every published body's HTML — all present, all counted on both sides.

---

## 8. What does not work

- **`npm run typecheck` from the repo root exits 2, and it is not this round's change.** This round
  added no source file; its scripts live under the gitignored `.scratch/recon/`. The two failures are
  other agents' work in flight in the shared checkout:
  - `packages/ozikoro/src/external-audio.test.ts(157,31): error TS2345` — a test fixture not updated for
    the current `RealArticle` type (`entities`, `archiveTotals` missing);
  - `apps/ozikoro/.next/types/…` and `.next-verify/types/…`: `TS2307 Cannot find module
    '../../app/listen/page.js'` — stale Next-generated type files referencing `app/listen/page.tsx`,
    which `git status` shows as **deleted** in the working tree by another round. `.next` was not
    touched, per the standing rule that only `bash scripts/serve-review.sh` may build here.
- **The live-site spot check is a size comparison, not a digest comparison.** Three files, three
  matching `Content-Length`s. A byte-exact digest would need the bodies, and 3,488 requests against a
  production WordPress install is not a thing to do.
- **The 80 missing draft images were not tested against the live site.** Whether they are still on
  `ozikoro.com` is unknown; finding out is 80 requests.
- **The copy of the cluster was taken while the review server held the original.** It opened and every
  query in this document ran against it, which is the test that it is consistent; a copy is still a
  copy, and the counts should be re-read from the live cluster before this document is treated as the
  final word.
- **`ozikoro_media_rights` holds 61 rows and a person has checked 0 of them.** That is round 337's
  finding, repeated here because it is the licence risk this reconciliation cannot close.

---

## 9. Evidence, and how to re-run it

The scripts are under `.scratch/recon/` (gitignored, so they do not pollute the repository):
`parse-dump.py` (the tokeniser), `dump-side.py`, `dump-menu-tax.py`, `unserialize-meta.py`,
`media-files.py`, and the TypeScript readers `tables.ts`, `cluster-side.ts`, `cluster-more.ts`,
`media-recon.ts`, `body-refs.ts`, `id-diff.ts`, `primary.ts` and `unresolved.ts`, each opening
`{ dataDir: '.data/scratch-recon/pg' }`.

```
cp -Rc .data/pg .data/scratch-recon/pg          # never move or delete .data/pg, never kill -9
python3 .scratch/recon/parse-dump.py            # 41 tables, 202,743 tuples, 0 parse failures
python3 .scratch/recon/unserialize-meta.py      # 144 credits, 52 copyrights
node    .scratch/recon/id-diff.ts               # 1,051 + 39 + 6 in, 0 invented
node    .scratch/recon/body-refs.ts             # 2,876 addresses, 2,855 resolve
node    .scratch/recon/media-files.py           # 0 rows without a file in the store
```

**One invariant held throughout.** `apps/ozikoro/public/design/` prints, verbatim:

```
identical 63 differing 0 missing 0
```
