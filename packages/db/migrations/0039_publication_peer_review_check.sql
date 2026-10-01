-- Correcting the peer-review consistency check.
--
-- The first version required that a work marked peer-reviewed be `published` or `archived`:
--
--     check (not peer_reviewed or status in ('published','archived'))
--
-- That reads sensibly and is wrong, and the workflow shows why. Peer review is completed while a
-- work is still `approved` — the expert review finishes, the editor accepts it, and the work is
-- marked peer-reviewed at that moment, which may be days before it is actually published. The
-- constraint made that transition impossible, so a work that had genuinely completed expert review
-- could not record the fact until after publication, and the whole point of tracking it was lost.
--
-- A test caught it: the transition from `expert_review` to `approved` failed with
-- `ozikoro_publication_peer_review_consistent`.
--
-- The rule that was actually wanted is "peer review is never claimed before the work was accepted".
-- A draft, a submitted manuscript, something under review or out for revision, or something sent
-- back for revision, must not carry the flag — which is exactly the states the plan cares about.
--
-- Additive by necessity: 0038 is applied and the migration runner tracks checksums.

alter table ozikoro_publication drop constraint if exists ozikoro_publication_peer_review_consistent;

alter table ozikoro_publication add constraint ozikoro_publication_peer_review_consistent
  check (not peer_reviewed or status in ('approved','published','archived'));

comment on constraint ozikoro_publication_peer_review_consistent on ozikoro_publication is
  'Peer review can only be claimed once a work has been accepted: approved, published or archived. '
  'A draft, a submission, something under review or out for revision can never carry the flag.';
