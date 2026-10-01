-- Archaeology, oral history, and the rights that decide whether any of it may be published.
--
-- THE PROBLEM THIS FILE IS MOSTLY ABOUT
--
-- 3,488 media records were migrated from WordPress. Every one of them has a file, a title, a date
-- and a place in an article. None of them has a recorded licence, because WordPress has no such
-- field — measured, not assumed: `withRights` is 0 of 3,488.
--
-- The archive has so far handled that honestly by saying "not recorded" on every page and refusing to
-- imply a permission nobody granted. That is the right default and it cannot be the end state: an
-- archive that cannot state its rights cannot be reused, and one that guesses is worse. So this
-- migration gives rights a real shape — who holds them, what they permit, where the permission came
-- from, and when it was checked — and gives the editorial screen something to fill in.
--
-- WHY RIGHTS ARE NOT SIMPLY A `licence` COLUMN
--
-- `ozikoro_media.licence` already exists and is a string, which is enough for "CC BY 4.0" and not
-- enough for anything an archive actually needs to answer:
--
--   * Who granted it, and on what date? A licence with no provenance is a claim.
--   * Does it permit commercial use? A derivative work? An audio version? The plan's podcast and
--     read-aloud features turn on those answers.
--   * Is the person in the photograph still living? That is a different question from copyright and
--     it constrains publication independently.
--   * Has anyone asked for it to be taken down? That has to be recordable and actionable.
--
-- So rights become a record of their own, attached to a media item, with the answers above as data
-- rather than as prose in a notes field.

-- ---------------------------------------------------------------------------
-- Rights
-- ---------------------------------------------------------------------------
create table if not exists ozikoro_media_rights (
  id            bigserial primary key,
  media_id      bigint not null references ozikoro_media(id) on delete cascade,

  -- Who holds the rights. `holder_name` is free text because the honest answer is often "the family
  -- of the photographer" and no table can express that.
  holder_name   text,
  holder_contact text,

  /*
   * What the archive may do. Three booleans rather than a licence enum, because a licence string does
   * not answer these and the features depend on them: a podcast reading of an article needs
   * `allows_derivative`, an image on a public page needs `allows_publication`, and anything offered
   * for sale would need `allows_commercial`.
   *
   * Defaults are false. The safe state is the default state, so a row created and not finished
   * permits nothing rather than everything.
   */
  allows_publication boolean not null default false,
  allows_derivative  boolean not null default false,
  allows_commercial  boolean not null default false,

  -- The licence itself, as it is named by whoever issues it.
  licence       text,
  licence_url   text,
  -- Where the permission came from: an email, a contract, a published statement, a public record.
  permission_basis text check (permission_basis is null or permission_basis in (
                     'written_permission','verbal_permission','contract','published_licence',
                     'public_record','institutional_agreement','orphan_work','unknown')),
  -- The date the permission was given or the licence was granted, as stated.
  permission_date date,
  permission_note text,

  /*
   * The person depicted. Copyright and personality are different rights and this archive holds both
   * kinds of material: a 1911 district record has no living subject, and a photograph taken last year
   * may. Where the subject is living the plan requires privacy controls, and asking is a real answer.
   */
  subject_is_living boolean,
  subject_consent   text check (subject_consent is null or subject_consent in
                      ('granted','refused','not_required','not_sought','withdrawn')),

  -- Take-down and restriction, recorded rather than acted on silently.
  restricted    boolean not null default false,
  restriction_reason text,
  takedown_requested_at timestamptz,
  takedown_resolved_at  timestamptz,

  -- Who checked, and when. The plan asks for provenance; a rights statement with nobody's name
  -- against it is one nobody has stood behind.
  checked_by    bigint references account(id) on delete set null,
  checked_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- One rights record per item. A second opinion is an edit to this row, not a second row, so the
  -- question "what are the rights on this?" has exactly one answer.
  unique (media_id)
);

comment on table ozikoro_media_rights is
  'The rights on a media item: who holds them, what they permit, where the permission came from, and '
  'whether the person depicted is living and consented. Permissions default to false so an unfinished '
  'record permits nothing rather than everything.';

comment on column ozikoro_media_rights.subject_is_living is
  'Whether the person in the record is living. Copyright and personality are independent: a photograph '
  'out of copyright can still depict somebody alive, and the plan requires privacy controls for that.';

create index if not exists ozikoro_rights_media_idx on ozikoro_media_rights (media_id);
create index if not exists ozikoro_rights_restricted_idx on ozikoro_media_rights (restricted) where restricted;
create index if not exists ozikoro_rights_unchecked_idx on ozikoro_media_rights (checked_at) where checked_at is null;

-- ---------------------------------------------------------------------------
-- Archaeology
-- ---------------------------------------------------------------------------
/*
 * Sites, excavations, objects and dating. The knowledge graph's `ozikoro_entity` already carries an
 * `archaeological_site` kind with coordinates and date qualifiers, so a site is an entity with one of
 * these rows attached rather than a parallel table — which keeps "everything about this place" one
 * query away, as the plan asks.
 */
create table if not exists ozikoro_site (
  id            bigserial primary key,
  entity_id     bigint not null unique references ozikoro_entity(id) on delete cascade,

  site_type     text,                       -- settlement, shrine, burial, workshop, cave, earthwork…
  -- Chronology as it is known. The qualifier is not decoration: "circa 1200" and "1200" are different
  -- claims and the plan requires uncertainty to be representable.
  period_label  text,
  date_start    integer,
  date_end      integer,
  date_qualifier text check (date_qualifier is null or date_qualifier in
                   ('exact','circa','before','after','range','unknown')),

  -- Coordinates live on the entity, so they are not repeated here.

  -- Provenance carries a caveat: antiquarian collections and colonial-era surveys recorded sites for
  -- their own purposes, and the plan forbids presenting their characterisations as description.
  survey_history text,
  documented_by  bigint references account(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table ozikoro_site is
  'An archaeological site: an ozikoro_entity of kind archaeological_site with its archaeology attached. '
  'Coordinates live on the entity so the map has one source.';

create table if not exists ozikoro_excavation (
  id            bigserial primary key,
  site_entity_id bigint not null references ozikoro_entity(id) on delete cascade,
  label         text not null,
  year_start    integer,
  year_end      integer,
  -- Free text: an excavation is directed by people and institutions that both change over time.
  director      text,
  institution   text,
  methods       text[] not null default '{}',
  summary       text,
  -- Disputed provenance is representable, per the plan: incomplete and contested records are normal
  -- in this field and must not be smoothed into certainty.
  is_disputed   boolean not null default false,
  dispute_note  text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists ozikoro_excavation_site_idx on ozikoro_excavation (site_entity_id, year_start);

create table if not exists ozikoro_object (
  id            bigserial primary key,
  entity_id     bigint not null unique references ozikoro_entity(id) on delete cascade,
  site_entity_id bigint references ozikoro_entity(id) on delete set null,
  excavation_id bigint references ozikoro_excavation(id) on delete set null,

  -- Accession numbers are issued by the holding institution and are not ours to invent.
  accession_number text,
  material      text,
  object_type   text,
  -- Free text, because dimensions are recorded in whatever the excavator used and converting them
  -- would assert a precision the record does not have.
  dimensions    text,
  weight_grams  numeric,
  function_note text,
  condition     text,

  museum_entity_id bigint references ozikoro_entity(id) on delete set null,
  collection    text,

  identified_by bigint references account(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table ozikoro_object is
  'A find or object: an entity with its material, dimensions, site and museum attached. The accession '
  'number is left empty rather than generated, because it belongs to the holding institution.';

create index if not exists ozikoro_object_site_idx on ozikoro_object (site_entity_id);
create index if not exists ozikoro_object_museum_idx on ozikoro_object (museum_entity_id);
create index if not exists ozikoro_object_material_idx on ozikoro_object (material);

create table if not exists ozikoro_dating (
  id            bigserial primary key,
  subject_entity_id bigint not null references ozikoro_entity(id) on delete cascade,
  method        text not null,              -- radiocarbon, thermoluminescence, seriation…
  -- The result and its uncertainty are separate columns because they are separate facts, and a
  -- measurement without its error is not a measurement.
  result        text not null,
  result_years_bp integer,
  uncertainty_years integer,
  calibrated    boolean,
  lab_reference text,
  source_id     bigint references ozikoro_source(id) on delete set null,
  note          text,
  created_at    timestamptz not null default now()
);

comment on table ozikoro_dating is
  'A dating measurement with its method and its uncertainty. Stored beside the object rather than as '
  'a date on it, because one object may have several and they may disagree.';

create index if not exists ozikoro_dating_subject_idx on ozikoro_dating (subject_entity_id);

-- ---------------------------------------------------------------------------
-- Oral history
-- ---------------------------------------------------------------------------
/*
 * The plan lists what an oral-history record must carry: "narrator, recorder, community, language,
 * date, transcript, translation and consent". All of those are columns here, and consent is the one
 * that decides whether the record may be published at all.
 */
create table if not exists ozikoro_oral_history (
  id            bigserial primary key,
  entity_id     bigint references ozikoro_entity(id) on delete set null,
  media_id      bigint references ozikoro_media(id) on delete set null,

  title         text not null,
  -- The narrator is the author of an oral account in every sense that matters, and is named unless
  -- they asked not to be.
  narrator_name text,
  narrator_community text,
  -- Anonymous narration is a legitimate request and must be representable.
  narrator_is_named boolean not null default true,

  recorder_name text,
  recorded_on   date,
  recorded_place text,
  language_code text references language(code) on delete set null,

  -- Transcript and translation are separate because a translation is an interpretation and the
  -- archive must not present one as the other.
  transcript    text,
  translation   text,
  translation_note text,
  duration_seconds integer,

  /*
   * Consent is not a checkbox at the end of a form. It names what was consented to, by whom, when,
   * and it can be withdrawn — which is why withdrawal is a state rather than a deletion.
   */
  consent_status text not null default 'not_sought' check (consent_status in
                   ('granted','refused','not_sought','withdrawn')),
  consent_scope text,
  consent_date  date,
  consent_note  text,

  -- The plan requires that oral tradition is not silently promoted into established fact.
  evidence_type text not null default 'oral_history',

  created_by    bigint references account(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table ozikoro_oral_history is
  'An oral account: who told it, who recorded it, in what language, with its transcript and its '
  'translation kept apart, and the consent that decides whether it may be published.';
comment on column ozikoro_oral_history.consent_status is
  'Withdrawal is a state rather than a deletion, so an account whose consent was withdrawn is kept '
  'and marked rather than quietly vanishing.';

create index if not exists ozikoro_oral_consent_idx on ozikoro_oral_history (consent_status);
create index if not exists ozikoro_oral_language_idx on ozikoro_oral_history (language_code);

-- ---------------------------------------------------------------------------
-- Corrections, with a visible trail
-- ---------------------------------------------------------------------------
/*
 * The plan: "Correction/add-community-knowledge workflow with visible review trail; do not silently
 * replace published records."
 *
 * This is the workflow. A correction is proposed against a record, reviewed, and either accepted —
 * which writes the change and keeps what it replaced — or declined with a reason. Nothing is
 * overwritten without a row here naming who decided and why.
 */
create table if not exists ozikoro_correction (
  id            bigserial primary key,
  -- What is being corrected. Kept as type and id rather than a foreign key per kind, because the
  -- kinds that need correcting grow and a union of foreign keys would need a migration per kind.
  subject_type  text not null,
  subject_id    bigint not null,

  proposed_by   bigint references account(id) on delete set null,
  -- Community submissions arrive from people without accounts, which is the point of the workflow.
  proposer_name text,
  proposer_contact text,

  field         text,
  current_value text,
  proposed_value text,
  rationale     text not null,
  -- What the proposer is basing it on. A correction with no ground is a preference.
  evidence      text,
  source_id     bigint references ozikoro_source(id) on delete set null,

  status        text not null default 'pending' check (status in ('pending','accepted','declined','withdrawn')),
  decided_by    bigint references account(id) on delete set null,
  decided_at    timestamptz,
  decision_note text,
  -- What the field held when the change was applied, so the decision is reversible.
  previous_value text,

  created_at    timestamptz not null default now(),
  constraint ozikoro_correction_decision_consistent
    check ((status in ('accepted','declined')) = (decided_at is not null))
);

comment on table ozikoro_correction is
  'A proposed correction or addition to a published record, with the ground for it and the decision '
  'made. Accepted corrections keep what they replaced, so nothing in the archive is overwritten '
  'without a record of what was there.';

create index if not exists ozikoro_correction_subject_idx on ozikoro_correction (subject_type, subject_id, created_at desc);
create index if not exists ozikoro_correction_pending_idx on ozikoro_correction (status, created_at) where status = 'pending';
