-- ---------------------------------------------------------------------------
-- Editable design, without editing the design.
--
-- THE OWNER'S REQUEST, AND THE CONSTRAINT IT HAD TO SURVIVE
--
-- The owner asked to be able to "edit every single part of the design. including the colours." The
-- deliverable at `apps/ozikoro/public/design/` is the approved artefact and is checked byte for byte
-- against the handover copy (`scripts/check-design-parity.mjs`), so it cannot be the thing that changes:
-- a deliverable that silently drifts is no longer the thing that was approved, and an edit written into
-- a file cannot be undone, compared or attributed.
--
-- So the design file stays the source and this table holds the DIFFERENCES the owner makes on top of it.
-- At serve time the file is read as a template, its fills run, and then these rows are applied — which is
-- why an override wins over the design AND over the fill that would otherwise rewrite the same words.
--
-- WHY ONE ROW PER EDITED THING, AND WHY THE KEY IS NOT A CSS PATH
--
-- A row is (screen, kind, key). Tokens are keyed by their custom-property name (`--accent`), which is
-- stable across a re-export because the design's own stylesheets refer to it by that name. Elements are
-- keyed by a selector built to be the narrowest thing that still names ONE element — an `id` when the
-- design has one, then a `data-` attribute, then `tag.class`, and only as a last resort a positional
-- chain. **A key that is `tag:nth-child(7)` and nothing else is a key that points at a different element
-- the day the design is re-exported**, so the generator prefers names over positions and the saved
-- selector is re-checked against the live page on every save.
--
-- Tokens are stored with `screen = '*'`: the palette is one shared stylesheet, so the owner's expectation
-- is that changing the accent changes it everywhere rather than on the screen he happened to be looking at.
--
-- WHY `value` IS JSONB RATHER THAN A COLUMN PER KIND
--
-- An edited image is not one value: it is a source, an alternative text and a credit line, and this
-- archive's rule is that provenance has a designed home. A separate table per kind would be four tables
-- with four sets of the same actor/created_at columns; one jsonb column keeps "one row per edited thing"
-- literally true and lets the shape follow the kind.
--
-- THE ROW IS THE PRESENT AND THE AUDIT IS THE HISTORY
--
-- `actor_id` and `updated_at` say who set the value that is in force now. Every change also writes an
-- `ozikoro_audit` row, so "what did it say before, and who changed it" is answerable after the fact — the
-- property a mutated file cannot have, and the reason this layer exists at all.
-- ---------------------------------------------------------------------------

create table if not exists ozikoro_design_override (
  id         bigserial primary key,

  -- The design screen this applies to (`about`, `home`, `market-days`), or `*` for a token, which is
  -- the shared palette rather than any one screen.
  screen     text        not null,

  kind       text        not null check (kind in ('token','text','image','link','hide')),

  -- A custom-property name (`--accent`) for a token; a validated selector for everything else.
  key        text        not null,

  -- What the owner calls it, so the list reads as a page rather than as a set of selectors.
  label      text,

  -- The value. Shape follows the kind; see the comment on this table and `design-override.ts`.
  value      jsonb       not null,

  -- Why it was changed, when the owner wants to say.
  note       text,

  actor_id   bigint      references account(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- ONE ROW PER EDITED THING. Editing the same heading twice updates its row rather than stacking two
  -- values that would then have to be ordered against each other at serve time.
  unique (screen, kind, key)
);

comment on table ozikoro_design_override is
  'The owner''s edits to the design, held beside the deliverable rather than written into it. Applied at '
  'serve time, after the fills, in app/design-screen/[screen]/route.ts.';

comment on column ozikoro_design_override.screen is
  'The design screen name, or * for a token: the palette is one shared stylesheet and the owner expects a '
  'colour change to be site-wide.';
comment on column ozikoro_design_override.key is
  'A custom-property name for a token, otherwise a selector that names exactly one element. Never a bare '
  'positional path unless nothing nameable exists, because a re-export moves positions.';
comment on column ozikoro_design_override.value is
  'jsonb whose shape follows the kind: {"value":…} token, {"text":…} text, {"src","alt","credit",'
  '"creditKey"} image, {"href","label"} link, {"hidden":true} hide.';

-- The serve-time read is "every row for this screen, plus every token".
create index if not exists ozikoro_design_override_screen_idx
  on ozikoro_design_override (screen, kind);

-- ---------------------------------------------------------------------------
-- WHO MAY EDIT THE DESIGN
--
-- `manage_design` is a new capability and is granted to exactly two roles. It is deliberately NOT an
-- editor's capability: the design is the institution's public face, the owner asked for this himself, and
-- an editor already holds `publish` and `edit_entity` — the editorial record is not the design.
--
-- The owner's row is written explicitly, following 0044's rule that the owner's capabilities are stated as
-- a list rather than derived from a wildcard, so adding a capability to the vocabulary does not silently
-- hand it to one person. `admin` holds it so that a decision can always be made (0042's lesson: a
-- capability on no role is a feature nobody can use, and one an admin lacks is a decision nobody can make).
-- ---------------------------------------------------------------------------
insert into ozikoro_role_capability (role, capability) values
  ('admin', 'manage_design'),
  ('owner', 'manage_design')
on conflict do nothing;

comment on table ozikoro_role_capability is
  'What each Ozikoro role may do. A table because the plan describes capabilities per role and a '
  'reviewer of this schema should be able to read them without opening the TypeScript.';
