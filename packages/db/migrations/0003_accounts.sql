-- ============================================================================
-- Ozituma — accounts, sessions and the contribution review workflow
-- ============================================================================
--
-- The `account` and `suggestion` tables were created in 0001 and left unused.
-- This migration adds the pieces the contribution flow needs to actually work.
--
-- DESIGN NOTES
--
-- 1. SESSIONS ARE SERVER-SIDE AND HASHED.
--    A session cookie carries a random token; the database stores only its
--    SHA-256 hash. A leak of the table therefore does not hand over live
--    sessions, the same reasoning that applies to API keys. Server-side
--    sessions (rather than self-contained JWTs) also mean an account can be
--    suspended and immediately locked out, and an individual session revoked —
--    neither of which a stateless token can do without a revocation list.
--
--    The table is named `auth_session`, not `session`, because `session` is a
--    non-reserved keyword in Postgres and reads ambiguously next to
--    `session_user`.
--
-- 2. CONTRIBUTIONS ARE NEVER APPLIED AUTOMATICALLY.
--    A `suggestion` row is inert data. Only a review action, performed by an
--    account with the `editor` or `admin` role, writes to the dictionary. The
--    payload is jsonb precisely so the review UI can render a submission it
--    does not yet understand, rather than the submission being unreadable if a
--    new kind is introduced before the UI catches up.
--
-- 3. APPROVED CONTRIBUTIONS STILL CARRY ATTRIBUTION.
--    An editorially created word has no upstream corpus, so it gets a `source`
--    row of its own (seeded as `ozituma-editorial` / `ozituma-community`).
--    That keeps the invariant enforced by src/verify.ts — every headword names
--    a source — meaningful rather than merely satisfied.
-- ============================================================================

create table auth_session (
  id           bigserial primary key,
  account_id   bigint not null references account(id) on delete cascade,
  -- sha256 of the opaque token in the cookie; the token itself is never stored.
  token_hash   text not null unique,
  -- Short label so a user can recognise a session in a list ("Chrome on macOS").
  user_agent   text,
  ip_address   inet,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at   timestamptz not null,
  revoked_at   timestamptz
);

create index auth_session_account_idx on auth_session (account_id);
create index auth_session_expiry_idx  on auth_session (expires_at)
  where revoked_at is null;

comment on table auth_session is
  'Server-side sessions. Only the token hash is stored; revoking a row logs the session out immediately.';

-- Track the last successful sign-in for account hygiene and support.
alter table account add column last_login_at timestamptz;

-- The review queue's two hot paths: "my submissions" and "the pending queue".
create index suggestion_submitter_idx on suggestion (submitted_by, submitted_at desc);

-- Prevent an account from piling up identical pending submissions, which is the
-- most likely shape of both accidental double-submits and casual spam. Approved
-- and rejected duplicates are unconstrained, so a word rejected once can be
-- resubmitted later with better evidence.
create unique index suggestion_no_duplicate_pending
  on suggestion (
    coalesce(submitted_by, 0),
    kind,
    coalesce(language_code, ''),
    coalesce(target_word_id, 0),
    coalesce(payload ->> 'headword', '')
  )
  where status = 'pending';

comment on index suggestion_no_duplicate_pending is
  'One pending submission of the same kind per account, language, target and headword.';
