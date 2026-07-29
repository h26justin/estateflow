-- Add 'short_term_let' to the properties.status vocabulary.
--
-- Piers View (and any future Airbnb/Lodgify-operated unit) was being shown
-- as 'vacant' because there was no status for a property that is operated
-- as short-term accommodation. The frontend gains a purple "Short-Term Let"
-- badge (matching the STL booking segment colour) and treats the status as
-- occupied-but-not-monthly-earning (see src/lib/propertyStatus.js).
--
-- The status CHECK constraint whitelists values, so widen it. Dropping and
-- re-adding is safe: existing rows all hold values from the old list.

alter table public.properties
  drop constraint if exists properties_status_check;

alter table public.properties
  add constraint properties_status_check
  check (status = any (array[
    'purchased'::text,
    'refurb'::text,
    'let_agreed'::text,
    'rented'::text,
    'short_term_let'::text,
    'notice_given'::text,
    'vacant'::text,
    'sold'::text
  ]));
