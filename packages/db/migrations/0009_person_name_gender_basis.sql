-- Why a name is male, female or unisex, recorded rather than re-derived.
--
-- The importer has always decided a name's gender from its morphemes, and the
-- integrity gate has always checked that decision — but by re-stating the rule
-- in SQL, because the decision itself was not stored. So the two could disagree
-- without anyone noticing, and they could not tell apart the two very different
-- reasons a name might be male:
--
--   title (male)   Amandianaeze contains eze, so the rule makes it male
--   owner (male)   the owner stated it, and the rule says nothing
--
-- The owner's latest correction needs exactly that distinction. Ijele carries no
-- gendering morpheme at all, so the rule calls it unisex, and the owner's word
-- makes it male. A gate that only knows "male names contain nze/eze/ozo" would
-- reject the owner's own instruction — which is the wrong way round, because the
-- gate exists to catch the IMPORTER inventing genders, not to overrule the
-- person the dictionary belongs to.
--
-- The rule now lives in @ozituma/core as `genderFromName`, and both the importer
-- and the gate call it. The gate accepts a stored gender when it either matches
-- the rule or records `owner` as its basis. Nothing else passes.

alter table person_name add column gender_basis text not null default 'unisex';

-- The backfill recomputes the morpheme rule for every existing row, then marks
-- as `owner` the rows whose stored gender contradicts it — which is precisely
-- the set the owner has corrected, since nothing else can produce that state.
update person_name
   set gender_basis = case
         when search_form like '%nwanyi%' then 'nwanyi'
         when search_form like '%nwoke%' then 'nwoke'
         when search_form like 'ada%' then 'ada'
         when search_form like '%lolo%' then 'lolo'
         when search_form ~ 'ozo|eze|nze' then 'title'
         else 'unisex'
       end;

update person_name
   set gender_basis = 'owner'
 where (gender = 'unisex' and gender_basis <> 'unisex')
    or (gender = 'male' and gender_basis in ('ada', 'nwanyi', 'lolo'))
    or (gender = 'female' and gender_basis in ('nwoke', 'title'));

alter table person_name add constraint person_name_gender_basis_check
  check (gender_basis in ('unisex', 'ada', 'nwanyi', 'nwoke', 'lolo', 'title', 'owner'));

comment on column person_name.gender_basis is
  'Why the gender is what it is: the morpheme that decided it (ada, nwanyi, nwoke, '
  'lolo, title), unisex when no morpheme applies, or owner when the owner stated '
  'the gender and it overrules the rule. The integrity gate accepts a stored '
  'gender only when it matches genderFromName() in @ozituma/core or carries the '
  'owner basis.';

create index person_name_gender_basis_idx on person_name (gender_basis);
