-- Merge entries that are the same word with the same meaning.
--
-- The gate refuses two published entries with the same folded spelling and the
-- same meaning, because a reader searching for one of them finds both and cannot
-- tell which to trust. The pairs that exist differ only in a tone mark on the
-- final vowel ("-bòkasì" / "-bòkasị", "-da" / "-dà") — a real distinction in
-- speech, but not one that makes two dictionary entries out of one word.
--
-- The merge keeps the LOWER id, records the other spelling as a variant so the
-- form is not lost, moves every example and recording link across, and deletes
-- the redundant entry. Nothing is deleted that another row points at.
begin;

create temp table pairs as
with ranked as (
  select w.id, w.headword, w.search_form, w.slug,
         d.text as meaning,
         row_number() over (partition by w.search_form, d.text order by w.id) as rn,
         count(*) over (partition by w.search_form, d.text) as n
    from word w
    join definition d on d.word_id = w.id and d.language_code = 'eng'
   where w.language_code = 'ibo' and w.status = 'published'
),
groups as (
  select search_form, meaning from ranked where n > 1 group by search_form, meaning
)
select min(r.id) as keep_id, max(r.id) as drop_id
  from ranked r
  join groups g on g.search_form = r.search_form and g.meaning = r.meaning
 group by r.search_form, r.meaning
having count(*) = 2
   and (select count(*) from definition d2 where d2.word_id = min(r.id) and d2.language_code = 'eng')
     = (select count(*) from definition d3 where d3.word_id = max(r.id) and d3.language_code = 'eng');

select 'pairs to merge: ' || count(*) from pairs;

-- The dropped spelling becomes a variant of the surviving entry.
insert into word_form (word_id, form_type_id, value, search_form)
select p.keep_id,
       (select id from form_type where code = 'variant' limit 1),
       w.headword,
       w.search_form
  from pairs p join word w on w.id = p.drop_id
on conflict do nothing;

-- Links move across before the row goes.
insert into example_word (example_id, word_id)
select ew.example_id, p.keep_id
  from example_word ew join pairs p on p.drop_id = ew.word_id
on conflict do nothing;

insert into word_dialect (word_id, dialect_id, spelling, search_form)
select p.keep_id, wd.dialect_id, wd.spelling, wd.search_form
  from word_dialect wd join pairs p on p.drop_id = wd.word_id
on conflict do nothing;

update audio a set word_id = p.keep_id
  from pairs p where a.word_id = p.drop_id;

-- word_relation points with from_word_id / to_word_id. Re-pointing can collide
-- with a relation the surviving entry already has, and the table is unique on
-- (from, to, type), so a colliding row is dropped rather than duplicated.
delete from word_relation r
 using pairs p
 where (r.from_word_id = p.drop_id or r.to_word_id = p.drop_id)
   and exists (
     select 1 from word_relation o
      where o.relation_type = r.relation_type
        and o.from_word_id = case when r.from_word_id = p.drop_id then p.keep_id else r.from_word_id end
        and o.to_word_id   = case when r.to_word_id   = p.drop_id then p.keep_id else r.to_word_id end
   );

update word_relation r set from_word_id = p.keep_id
  from pairs p where r.from_word_id = p.drop_id;

update word_relation r set to_word_id = p.keep_id
  from pairs p where r.to_word_id = p.drop_id;

delete from word w using pairs p where w.id = p.drop_id;

select 'entries now: ' || count(*) from word where language_code = 'ibo' and status = 'published';
commit;
