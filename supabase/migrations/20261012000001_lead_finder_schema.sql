-- =====================================================================================
-- TRAYLOR PRO COMMERCIAL LEAD FINDER — database design (DRAFT)
--
--   STATUS: NOT EXECUTED in any Supabase project. Validated only in a throwaway local Postgres.
--
--   DO NOT run this against any existing Traylor Pro Supabase project
--   (Employee Operations, Supply, Inventory, Command Center POC, Client Portal).
--   It is meant for the NEW, SEPARATE Lead Finder Supabase project only, and only
--   after the CEO has approved that project and approved running this file.
--
--   Everything lives in its own schema, `lead_finder`. Nothing here touches the
--   `public` schema or any other app's objects, and nothing references another
--   Traylor Pro system (the only outside reference is that project's own auth.users).
--
--   Mirrors src/lib/domain/types.ts. A test (src/lib/data/schema.test.ts) fails if a field
--   is added to the app's data model without a matching column here.
-- =====================================================================================

create schema if not exists lead_finder;

-- Fuzzy name matching for duplicate detection (optional but recommended).
create extension if not exists pg_trgm with schema extensions;

-- ---------------------------------------------------------------- helpers

create or replace function lead_finder.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------------------------------------------------------------- users & roles
-- Created first because every access policy below asks "what role does this person have?".

create table lead_finder.user_roles (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid unique references auth.users (id) on delete cascade,
  email         text not null unique,
  display_name  text not null,
  role          text not null check (role in ('owner', 'manager', 'viewer')),
  active        boolean not null default true,
  is_demo       boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- The signed-in user's role, or NULL if they have none (→ no access at all).
-- SECURITY DEFINER so policies can read user_roles without recursion; search_path is pinned.
create or replace function lead_finder.current_app_role() returns text
language sql stable security definer set search_path = '' as $$
  select r.role from lead_finder.user_roles r where r.user_id = auth.uid() and r.active limit 1
$$;
revoke all on function lead_finder.current_app_role() from public, anon;
grant execute on function lead_finder.current_app_role() to authenticated;

-- ---------------------------------------------------------------- reference data

create table lead_finder.markets (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  kind        text not null check (kind in ('city', 'parish')),
  parish      text,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (kind, name)
);

create table lead_finder.sources (
  id                        uuid primary key default gen_random_uuid(),
  name                      text not null unique,
  type                      text not null check (type in ('manual', 'csv', 'url')),
  category                  text not null check (category in (
    'manual_entry', 'csv_import', 'url_reference', 'property_data', 'permits', 'construction',
    'commercial_listings', 'business_directory', 'business_website', 'public_records',
    'announcements', 'news', 'development', 'rfp')),
  url                       text,
  -- A failed source is 'unavailable' — never treated as "no leads found".
  status                    text not null default 'available' check (status in ('available', 'unavailable', 'disabled')),
  status_note               text,
  last_checked_at           timestamptz,
  last_success_at           timestamptz,
  -- NULL = terms not reviewed yet → treat as NOT allowed.
  automated_access_allowed  boolean,
  is_demo                   boolean not null default false,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

-- ---------------------------------------------------------------- who and where

create table lead_finder.companies (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  industry       text,
  website        text,
  phone          text,
  email          text,
  source_id      uuid references lead_finder.sources (id),
  merged_into_id uuid references lead_finder.companies (id),
  is_demo        boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table lead_finder.properties (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  address             text not null,
  -- Lower-cased street with abbreviations and unit numbers removed (see normalizeAddress in the app).
  normalized_address  text not null,
  city                text not null,
  parish              text not null default '',
  zip                 text not null default '',
  market_id           uuid references lead_finder.markets (id),
  facility_type       text not null check (facility_type in (
    'office', 'warehouse', 'distribution_center', 'industrial', 'manufacturing', 'retail_center',
    'restaurant', 'hotel', 'multifamily_common', 'school', 'church', 'medical_office',
    'professional', 'automotive', 'government', 'multi_tenant', 'other')),
  sqft                integer check (sqft is null or sqft > 0),
  sqft_status         text not null default 'unknown' check (sqft_status in ('verified', 'publicly_reported', 'estimated', 'unknown')),
  construction_status text,
  lat                 double precision check (lat is null or lat between -90 and 90),
  lng                 double precision check (lng is null or lng between -180 and 180),
  merged_into_id      uuid references lead_finder.properties (id),
  is_demo             boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  -- Never claim a size we can't back up.
  check (sqft is null or sqft_status <> 'unknown')
);

create table lead_finder.contacts (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  role         text not null default '',
  company_id   uuid references lead_finder.companies (id),
  property_id  uuid references lead_finder.properties (id),
  phone        text,
  email        text,
  data_status  text not null default 'unknown' check (data_status in ('verified', 'publicly_reported', 'estimated', 'unknown')),
  source_id    uuid not null references lead_finder.sources (id),
  is_demo      boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- A company can be the tenant, operator, owner, property manager or leasing company — at many properties.
create table lead_finder.property_relationships (
  id           uuid primary key default gen_random_uuid(),
  property_id  uuid not null references lead_finder.properties (id),
  company_id   uuid not null references lead_finder.companies (id),
  role         text not null check (role in ('owner', 'tenant', 'operator', 'property_manager', 'leasing_company')),
  data_status  text not null default 'unknown' check (data_status in ('verified', 'publicly_reported', 'estimated', 'unknown')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (property_id, company_id, role)
);

-- ---------------------------------------------------------------- opportunities

create table lead_finder.leads (
  id                      uuid primary key default gen_random_uuid(),
  title                   text not null,
  property_id             uuid not null references lead_finder.properties (id),
  company_id              uuid references lead_finder.companies (id),
  primary_contact_id      uuid references lead_finder.contacts (id),
  status                  text not null default 'new' check (status in (
    'new', 'researching', 'contacted', 'interested', 'walkthrough', 'won', 'lost', 'nurture', 'not_a_fit')),
  -- Management's quick read. NOT a quote and NOT a dollar amount — there is deliberately no money column anywhere.
  potential_value         text not null default 'unknown' check (potential_value in ('very_high', 'high', 'medium', 'low', 'unknown')),
  source_id               uuid not null references lead_finder.sources (id),
  source_record_id        uuid,  -- FK added below (leads and source_records point at each other)
  discovered_at           timestamptz not null default now(),
  last_verified_at        timestamptz,
  last_verified_by        text,
  snoozed_until           timestamptz,
  not_a_fit_reason        text,
  lost_reason_code        text check (lost_reason_code is null or lost_reason_code in (
    'price', 'competitor', 'no_response', 'timing', 'building_not_a_fit', 'in_house', 'other')),
  lost_reason             text,
  closed_at               timestamptz,
  notes                   text,
  merged_into_lead_id     uuid references lead_finder.leads (id),
  -- Future quoting hooks: plain text references. NO foreign keys into any other system.
  external_quote_ref      text,
  converted_customer_ref  text,
  is_demo                 boolean not null default false,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create table lead_finder.source_records (
  id               uuid primary key default gen_random_uuid(),
  source_id        uuid not null references lead_finder.sources (id),
  source_name      text not null,
  source_url       text,
  external_id      text,
  discovered_at    timestamptz not null default now(),
  last_verified_at timestamptz,
  status           text not null default 'new' check (status in ('new', 'imported', 'duplicate', 'rejected')),
  imported_lead_id uuid references lead_finder.leads (id),
  -- Exactly what was received. Never edited.
  payload          jsonb,
  kind             text check (kind in ('website', 'news_article', 'property_listing', 'public_record', 'business_announcement', 'referral', 'manual_research', 'other')),
  title            text,
  -- Only a PERSON can mark a source verified. The app never opens links itself.
  verification     text not null default 'not_checked' check (verification in ('verified', 'not_checked', 'unavailable')),
  verified_by      text,
  note             text,
  is_demo          boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

alter table lead_finder.leads
  add constraint leads_source_record_fk foreign key (source_record_id) references lead_finder.source_records (id);

create table lead_finder.opportunity_signals (
  id                uuid primary key default gen_random_uuid(),
  lead_id           uuid not null references lead_finder.leads (id),
  type              text not null check (type in (
    'new_tenant', 'new_business_opening', 'new_construction', 'construction_nearing_completion',
    'facility_opening', 'major_renovation', 'expansion', 'business_relocation', 'new_ownership',
    'new_property_manager', 'new_management_company', 'facility_reopening', 'major_tenant_change',
    'vendor_may_change', 'recently_leased', 'occupancy_expected_soon', 'new_development', 'rfp_bid',
    'listed_for_lease', 'new_business_announced', 'recently_sold', 'multiple_tenants',
    'appears_newly_occupied', 'business_growing', 'generic_commercial')),
  description       text not null,
  source_id         uuid not null references lead_finder.sources (id),
  source_record_id  uuid references lead_finder.source_records (id),
  source_url        text,
  discovered_at     timestamptz not null default now(),
  verified_at       timestamptz,
  verified_by       text,
  -- Defaults to 'unknown': shown as evidence but never adds to the score.
  confidence        text not null default 'unknown' check (confidence in ('verified', 'publicly_reported', 'estimated', 'unknown')),
  expected_date     timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- A saved copy of how a lead scored, with every point explained. Append-only history.
create table lead_finder.lead_score_breakdowns (
  id                uuid primary key default gen_random_uuid(),
  lead_id           uuid not null references lead_finder.leads (id),
  computed_at       timestamptz not null default now(),
  raw_score         integer not null,                      -- unclamped, never thrown away
  score             integer not null check (score between 0 and 100),
  capped            boolean not null,
  tier              text not null check (tier in ('hot', 'high', 'medium', 'low')),
  lines             jsonb not null,                        -- [{key, group, label, points, detail}]
  settings_version  integer not null default 1
);

-- Where a specific fact (one field of one record) came from. History — newer rows never replace older ones.
create table lead_finder.field_provenance (
  id                uuid primary key default gen_random_uuid(),
  entity_type       text not null check (entity_type in ('property', 'company', 'contact', 'lead', 'relationship')),
  entity_id         uuid not null,                         -- polymorphic, so deliberately no foreign key
  field             text not null,
  status            text not null check (status in ('verified', 'publicly_reported', 'estimated', 'unknown')),
  source_id         uuid references lead_finder.sources (id),
  source_record_id  uuid references lead_finder.source_records (id),
  source_url        text,
  value_note        text,
  recorded_at       timestamptz not null default now(),
  verified_at       timestamptz,
  verified_by       text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- ---------------------------------------------------------------- sales activity

create table lead_finder.activities (
  id                     uuid primary key default gen_random_uuid(),
  lead_id                uuid not null references lead_finder.leads (id),
  type                   text not null check (type in (
    'discovered', 'call', 'email', 'text', 'note', 'status_change', 'followup_scheduled',
    'followup_completed', 'walkthrough_scheduled', 'walkthrough_completed', 'snoozed', 'unsnoozed',
    'not_a_fit', 'restored', 'verified', 'quote_requested', 'merged', 'other')),
  summary                text not null,
  outcome                text,
  occurred_at            timestamptz not null default now(),
  performed_by           text not null,
  performed_by_user_id   uuid default auth.uid()
);

create table lead_finder.followups (
  id               uuid primary key default gen_random_uuid(),
  lead_id          uuid not null references lead_finder.leads (id),
  contact_id       uuid references lead_finder.contacts (id),
  due_at           timestamptz not null,
  method           text not null check (method in ('call', 'email', 'text', 'walkthrough', 'other')),
  notes            text not null default '',
  completed_at     timestamptz,
  completed_by     text,
  completion_note  text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table lead_finder.walkthroughs (
  id            uuid primary key default gen_random_uuid(),
  lead_id       uuid not null references lead_finder.leads (id),
  property_id   uuid not null references lead_finder.properties (id),
  contact_id    uuid references lead_finder.contacts (id),
  scheduled_at  timestamptz not null,
  attendees     text not null default '',
  notes         text not null default '',
  outcome       text check (outcome is null or outcome in ('interested', 'not_interested', 'send_to_bid', 'rescheduled')),
  next_action   text,
  completed_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------- accountability & configuration

-- Who changed what, and when. Append-only: there are no update or delete policies.
create table lead_finder.audit_log (
  id                    uuid primary key default gen_random_uuid(),
  entity_type           text not null check (entity_type in (
    'lead', 'property', 'company', 'contact', 'relationship', 'signal', 'followup', 'walkthrough',
    'source_record', 'setting', 'user_role')),
  entity_id             uuid not null,                     -- polymorphic, so deliberately no foreign key
  lead_id               uuid references lead_finder.leads (id),
  action                text not null check (action in ('create', 'update', 'status_change', 'score_change', 'merge', 'restore')),
  field                 text,
  old_value             text,
  new_value             text,
  changed_by            text not null,
  changed_by_user_id    uuid default auth.uid(),
  changed_at            timestamptz not null default now(),
  note                  text
);

-- "This might be a duplicate" — and what a person decided. Append-only: kept as history forever.
create table lead_finder.duplicate_decisions (
  id                      uuid primary key default gen_random_uuid(),
  context                 text not null check (context in ('manual_entry', 'url_reference', 'csv_import', 'review')),
  decision                text not null check (decision in ('create_anyway', 'link_to_property', 'add_to_existing_lead', 'merged', 'not_duplicate', 'skipped')),
  subject                 text not null,
  candidate_property_ids  uuid[] not null default '{}',
  candidate_lead_ids      uuid[] not null default '{}',
  reasons                 text[] not null default '{}',
  result_lead_id          uuid references lead_finder.leads (id),
  result_property_id      uuid references lead_finder.properties (id),
  source_record_id        uuid references lead_finder.source_records (id),
  decided_by              text not null,
  decided_by_user_id      uuid default auth.uid(),
  decided_at              timestamptz not null default now(),
  note                    text
);

-- Tunable settings stored as data (scoring rules live here: key = 'scoring').
create table lead_finder.lead_settings (
  key         text primary key,
  value       jsonb not null,
  version     integer not null default 1,
  updated_at  timestamptz not null default now(),
  updated_by  text not null
);

-- ---------------------------------------------------------------- indexes

-- Today / pipeline: active leads by status.
create index leads_active_status_idx   on lead_finder.leads (status, discovered_at desc) where merged_into_lead_id is null;
create index leads_property_idx        on lead_finder.leads (property_id);
create index leads_company_idx         on lead_finder.leads (company_id);
create index leads_source_idx          on lead_finder.leads (source_id);
create index leads_snoozed_idx         on lead_finder.leads (snoozed_until) where snoozed_until is not null;

-- Duplicate detection.
create index properties_norm_addr_idx  on lead_finder.properties (normalized_address) where merged_into_id is null;
create index properties_market_idx     on lead_finder.properties (market_id);
create index properties_city_idx       on lead_finder.properties (lower(city));
create index properties_geo_idx        on lead_finder.properties (lat, lng) where lat is not null;
create index properties_name_trgm_idx  on lead_finder.properties using gin (name extensions.gin_trgm_ops);
create index companies_name_idx        on lead_finder.companies (lower(name)) where merged_into_id is null;
create index companies_name_trgm_idx   on lead_finder.companies using gin (name extensions.gin_trgm_ops);
create index companies_phone_idx       on lead_finder.companies (phone) where phone is not null;
create index contacts_company_idx      on lead_finder.contacts (company_id);
create index contacts_property_idx     on lead_finder.contacts (property_id);
create index contacts_phone_idx        on lead_finder.contacts (phone) where phone is not null;

create index relationships_property_idx on lead_finder.property_relationships (property_id);
create index relationships_company_idx  on lead_finder.property_relationships (company_id);

create index signals_lead_idx          on lead_finder.opportunity_signals (lead_id);
create index signals_type_idx          on lead_finder.opportunity_signals (type);
create index signals_expected_idx      on lead_finder.opportunity_signals (expected_date) where expected_date is not null;

create index breakdowns_lead_idx       on lead_finder.lead_score_breakdowns (lead_id, computed_at desc);
create index provenance_entity_idx     on lead_finder.field_provenance (entity_type, entity_id, field);
-- NOT unique on purpose: the same listing or CSV row seen again is kept as its own record (status 'duplicate'),
-- never silently dropped. A unique index here would make a repeat import fail outright.
create index source_records_external_idx on lead_finder.source_records (source_id, external_id) where external_id is not null;
create index source_records_lead_idx   on lead_finder.source_records (imported_lead_id);

create index activities_lead_idx       on lead_finder.activities (lead_id, occurred_at desc);
create index followups_lead_idx        on lead_finder.followups (lead_id);
create index followups_open_due_idx    on lead_finder.followups (due_at) where completed_at is null;
create index walkthroughs_lead_idx     on lead_finder.walkthroughs (lead_id);
create index walkthroughs_when_idx     on lead_finder.walkthroughs (scheduled_at);
create index audit_lead_idx            on lead_finder.audit_log (lead_id, changed_at desc);
create index audit_entity_idx          on lead_finder.audit_log (entity_type, entity_id);
create index duplicate_decisions_when_idx on lead_finder.duplicate_decisions (decided_at desc);
create index duplicate_decisions_result_idx on lead_finder.duplicate_decisions (result_lead_id);
create index duplicate_decisions_candidates_idx on lead_finder.duplicate_decisions using gin (candidate_lead_ids);

-- ---------------------------------------------------------------- updated_at triggers

do $$
declare t text;
begin
  foreach t in array array[
    'user_roles', 'markets', 'sources', 'companies', 'properties', 'contacts', 'property_relationships',
    'leads', 'source_records', 'opportunity_signals', 'field_provenance', 'followups', 'walkthroughs'
  ] loop
    execute format(
      'create trigger %I before update on lead_finder.%I for each row execute function lead_finder.touch_updated_at()',
      t || '_touch_updated_at', t);
  end loop;
end $$;

-- ---------------------------------------------------------------- all-or-nothing saves
-- Every foreign key may wait until the end of a save, so one save can add a lead, its property and its
-- source record together even though they point at each other.
do $$
declare r record;
begin
  for r in select c.relname as tbl, k.conname from pg_constraint k join pg_class c on c.oid = k.conrelid
           where k.contype = 'f' and k.connamespace = 'lead_finder'::regnamespace loop
    execute format('alter table lead_finder.%I alter constraint %I deferrable initially immediate', r.tbl, r.conname);
  end loop;
end $$;

-- apply_changes: the ONE way the app saves. One call = one transaction = all saved or nothing saved.
--
--   changes = {
--     "rows":     { "<table>": [ {<column>: <value>, ...}, ... ], ... },   -- new or changed rows
--     "expected": { "<table>": { "<id>": "<updated_at the app last saw>" } } -- refuse if someone else changed it
--   }
--
-- SECURITY INVOKER: it runs as the signed-in person, so every row-level-security rule above still applies
-- (a Viewer cannot write, a Manager cannot change settings, history can be added to but never edited).
-- It never deletes anything. user_roles is not writable through it.
create or replace function lead_finder.apply_changes(changes jsonb) returns void
language plpgsql security invoker set search_path = '' as $$
declare
  ordered constant text[] := array[
    'markets', 'sources', 'companies', 'properties', 'contacts', 'property_relationships', 'leads',
    'source_records', 'opportunity_signals', 'lead_score_breakdowns', 'field_provenance', 'activities',
    'followups', 'walkthroughs', 'audit_log', 'duplicate_decisions', 'lead_settings'];
  history constant text[] := array['lead_score_breakdowns', 'field_provenance', 'activities', 'audit_log', 'duplicate_decisions'];
  t text; k text; r jsonb; expected jsonb; pk text; cols text[]; bad text[]; current_ts timestamptz;
  found boolean; setlist text; n integer;
begin
  if lead_finder.current_app_role() is null then
    raise exception 'LF_NO_ROLE: this account has no Lead Finder access' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(changes -> 'rows', '{}'::jsonb)) <> 'object' then
    raise exception 'LF_BAD_REQUEST: rows must be an object' using errcode = '22023';
  end if;
  for k in select jsonb_object_keys(coalesce(changes -> 'rows', '{}'::jsonb)) loop
    if not k = any(ordered) then raise exception 'LF_BAD_REQUEST: unknown table %', k using errcode = '22023'; end if;
  end loop;

  set constraints all deferred;

  -- Someone else changed it since you loaded it? Stop, so nobody's work is silently overwritten.
  for t, expected in select key, value from jsonb_each(coalesce(changes -> 'expected', '{}'::jsonb)) loop
    if not t = any(ordered) or t = any(history) then raise exception 'LF_BAD_REQUEST: unknown table %', t using errcode = '22023'; end if;
    pk := case when t = 'lead_settings' then 'key' else 'id' end;
    for k in select jsonb_object_keys(expected) loop
      execute format('select updated_at from lead_finder.%I where %I::text = $1', t, pk) into current_ts using k;
      if current_ts is distinct from (expected ->> k)::timestamptz then
        -- PT409 = HTTP 409 Conflict. NOT 40001: PostgREST treats 40001 as a transient serialization failure
        -- and silently re-runs the transaction forever, which would freeze the app for both people.
        raise exception 'LF_CONFLICT: % % was changed by someone else', t, k using errcode = 'PT409';
      end if;
    end loop;
  end loop;

  foreach t in array ordered loop
    pk := case when t = 'lead_settings' then 'key' else 'id' end;
    for r in select value from jsonb_array_elements(coalesce(changes -> 'rows' -> t, '[]'::jsonb)) loop
      select array_agg(key) into cols from jsonb_object_keys(r) key;
      select array_agg(c) into bad from unnest(cols) c
        where not exists (select 1 from pg_catalog.pg_attribute a
                          where a.attrelid = format('lead_finder.%I', t)::regclass and a.attname = c and a.attnum > 0 and not a.attisdropped);
      if bad is not null then raise exception 'LF_BAD_REQUEST: %.% is not a column', t, bad[1] using errcode = '22023'; end if;
      if not pk = any(cols) then raise exception 'LF_BAD_REQUEST: % row without %', t, pk using errcode = '22023'; end if;

      execute format('select exists (select 1 from lead_finder.%I where %I::text = $1)', t, pk) into found using r ->> pk;
      if found and t = any(history) then
        -- History is only ever added to, never rewritten.
        raise exception 'LF_DENIED: % is history and cannot be changed', t using errcode = '42501';
      elsif found then
        -- Change only the fields sent. If a security rule blocks it, say so — never "succeed" silently.
        select string_agg(format('%I = v.%I', c, c), ', ') into setlist from unnest(cols) c where c not in ('id', 'key', 'created_at');
        if setlist is not null then
          execute format('update lead_finder.%I x set %s from jsonb_populate_record(null::lead_finder.%I, $1) v where x.%I = v.%I',
            t, setlist, t, pk, pk) using r;
          get diagnostics n = row_count;
          if n <> 1 then raise exception 'LF_DENIED: you cannot change this % record', t using errcode = '42501'; end if;
        end if;
      else
        execute format('insert into lead_finder.%I (%s) select %s from jsonb_populate_record(null::lead_finder.%I, $1)',
          t, (select string_agg(quote_ident(c), ',') from unnest(cols) c), (select string_agg(quote_ident(c), ',') from unnest(cols) c), t) using r;
      end if;
    end loop;
  end loop;
end $$;

-- =====================================================================================
-- SECURITY — row level security on EVERY table. No anonymous access.
--
--   owner    everything, including settings, users and sources
--   manager  work leads, edit records, merge duplicates, manage sources (not settings or users)
--   viewer   read only
--   nobody   (not signed in, or no row in user_roles) → no access at all
--
-- Same rules as src/lib/domain/permissions.ts.
-- =====================================================================================

revoke all on schema lead_finder from public, anon;
grant usage on schema lead_finder to authenticated;
revoke all on all tables in schema lead_finder from public, anon;
revoke all on all functions in schema lead_finder from public, anon;
grant execute on function lead_finder.current_app_role() to authenticated;
grant execute on function lead_finder.apply_changes(jsonb) to authenticated;
-- "Automatically expose new tables and functions" is OFF in this project, so nothing is reachable
-- unless granted here. Future objects in this schema stay private by default too:
alter default privileges in schema lead_finder revoke all on tables from public, anon;
alter default privileges in schema lead_finder revoke all on functions from public, anon;

alter table lead_finder.user_roles              enable row level security;
alter table lead_finder.markets                 enable row level security;
alter table lead_finder.sources                 enable row level security;
alter table lead_finder.companies               enable row level security;
alter table lead_finder.properties              enable row level security;
alter table lead_finder.contacts                enable row level security;
alter table lead_finder.property_relationships  enable row level security;
alter table lead_finder.leads                   enable row level security;
alter table lead_finder.source_records          enable row level security;
alter table lead_finder.opportunity_signals     enable row level security;
alter table lead_finder.lead_score_breakdowns   enable row level security;
alter table lead_finder.field_provenance        enable row level security;
alter table lead_finder.activities              enable row level security;
alter table lead_finder.followups               enable row level security;
alter table lead_finder.walkthroughs            enable row level security;
alter table lead_finder.audit_log               enable row level security;
alter table lead_finder.duplicate_decisions     enable row level security;
alter table lead_finder.lead_settings           enable row level security;

-- Read: any signed-in person who has a role.
do $$
declare t text;
begin
  foreach t in array array[
    'markets', 'sources', 'companies', 'properties', 'contacts', 'property_relationships', 'leads',
    'source_records', 'opportunity_signals', 'lead_score_breakdowns', 'field_provenance', 'activities',
    'followups', 'walkthroughs', 'audit_log', 'duplicate_decisions', 'lead_settings'
  ] loop
    execute format('grant select on lead_finder.%I to authenticated', t);
    execute format(
      'create policy %I on lead_finder.%I for select to authenticated using (lead_finder.current_app_role() in (''owner'', ''manager'', ''viewer''))',
      t || '_read', t);
  end loop;
end $$;

-- Work and edit: owners and managers. (Rows are never hard-deleted by the app — merges mark rows instead.)
do $$
declare t text;
begin
  foreach t in array array[
    'markets', 'sources', 'companies', 'properties', 'contacts', 'property_relationships', 'leads',
    'source_records', 'opportunity_signals', 'followups', 'walkthroughs'
  ] loop
    execute format('grant insert, update on lead_finder.%I to authenticated', t);
    execute format(
      'create policy %I on lead_finder.%I for insert to authenticated with check (lead_finder.current_app_role() in (''owner'', ''manager''))',
      t || '_insert', t);
    execute format(
      'create policy %I on lead_finder.%I for update to authenticated using (lead_finder.current_app_role() in (''owner'', ''manager'')) with check (lead_finder.current_app_role() in (''owner'', ''manager''))',
      t || '_update', t);
  end loop;
end $$;

-- Append-only history: insert but never update or delete (no such policies exist, and no such grants).
do $$
declare t text;
begin
  foreach t in array array['lead_score_breakdowns', 'field_provenance', 'activities', 'audit_log', 'duplicate_decisions'] loop
    execute format('grant insert on lead_finder.%I to authenticated', t);
    execute format(
      'create policy %I on lead_finder.%I for insert to authenticated with check (lead_finder.current_app_role() in (''owner'', ''manager''))',
      t || '_insert', t);
  end loop;
end $$;

-- Settings: only owners change them.
grant insert, update on lead_finder.lead_settings to authenticated;
create policy lead_settings_insert on lead_finder.lead_settings for insert to authenticated
  with check (lead_finder.current_app_role() = 'owner');
create policy lead_settings_update on lead_finder.lead_settings for update to authenticated
  using (lead_finder.current_app_role() = 'owner') with check (lead_finder.current_app_role() = 'owner');

-- Users and roles: everyone can see their own row; owners see and manage everyone.
grant select, insert, update, delete on lead_finder.user_roles to authenticated;
create policy user_roles_read on lead_finder.user_roles for select to authenticated
  using (user_id = auth.uid() or lead_finder.current_app_role() = 'owner');
create policy user_roles_insert on lead_finder.user_roles for insert to authenticated
  with check (lead_finder.current_app_role() = 'owner');
create policy user_roles_update on lead_finder.user_roles for update to authenticated
  using (lead_finder.current_app_role() = 'owner') with check (lead_finder.current_app_role() = 'owner');
create policy user_roles_delete on lead_finder.user_roles for delete to authenticated
  using (lead_finder.current_app_role() = 'owner');

-- =====================================================================================
-- ONLY AFTER the CEO approves running this in the NEW Lead Finder project (never any other project):
--   1. SQL editor: run this file, then supabase/migrations/20261012000002_lead_finder_reference_data.sql.
--   2. Dashboard → Settings → Data API → add `lead_finder` to "Exposed schemas".
--      ("Automatically expose new tables" stays OFF — everything needed is granted explicitly above.)
--   3. Authentication → invite each person by email (public sign-ups OFF), then give them a role:
--        insert into lead_finder.user_roles (user_id, email, display_name, role)
--        select id, email, '<name>', 'owner' from auth.users where email = '<their email>';
--      Someone signed in without a row here sees nothing and can change nothing.
--   4. Never put the service-role key or database password in browser code, chat, or git.
--      The app only needs the project URL and the public (anon) key.
-- =====================================================================================
