-- =====================================================================================
-- TRAYLOR PRO COMMERCIAL LEAD FINDER — starter reference data (DRAFT, NOT EXECUTED)
--
-- Run ONCE, after lead_finder_schema.sql, in the dedicated Lead Finder Supabase project only.
-- Contains NO leads, NO businesses, NO contacts and NO demo data — only:
--   • the service area (markets are data, so more cities/parishes can be added later without code changes)
--   • the three ways leads come in today (manual entry, CSV import, web link)
-- Safe to re-run: existing rows are left alone.
-- =====================================================================================

insert into lead_finder.markets (name, kind, parish) values
  ('Baton Rouge',     'city', 'East Baton Rouge'),
  ('Denham Springs',  'city', 'Livingston'),
  ('Prairieville',    'city', 'Ascension'),
  ('Gonzales',        'city', 'Ascension'),
  ('Walker',          'city', 'Livingston'),
  ('Zachary',         'city', 'East Baton Rouge'),
  ('Port Allen',      'city', 'West Baton Rouge'),
  ('Central',         'city', 'East Baton Rouge'),
  ('East Baton Rouge', 'parish', null),
  ('West Baton Rouge', 'parish', null),
  ('Livingston',      'parish', null),
  ('Ascension',       'parish', null)
on conflict (kind, name) do nothing;

-- automated_access_allowed = false: these are things a PERSON does. The app never fetches anything.
insert into lead_finder.sources (name, type, category, url, automated_access_allowed) values
  ('Manual entry',  'manual', 'manual_entry',  null, false),
  ('CSV import',    'csv',    'csv_import',    null, false),
  ('Web link',      'url',    'url_reference', null, false)
on conflict (name) do nothing;

-- Scoring rules: none stored on purpose. The app uses its built-in, tested defaults until an Owner changes them.
