import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { freshSnapshot } from "../workflow/test-helpers";

/**
 * Keeps the app's data model and the DRAFT database design (supabase/migrations/20261012000001_lead_finder_schema.sql) in sync.
 * This only READS the SQL file as text. It never runs it, and never connects to anything.
 */
const SQL = fs.readFileSync(path.join(process.cwd(), "supabase", "migrations", "20261012000001_lead_finder_schema.sql"), "utf8");

const TABLE_FOR: Record<string, string> = {
  markets: "markets",
  sources: "sources",
  sourceRecords: "source_records",
  companies: "companies",
  properties: "properties",
  contacts: "contacts",
  relationships: "property_relationships",
  provenance: "field_provenance",
  leads: "leads",
  signals: "opportunity_signals",
  scoreBreakdowns: "lead_score_breakdowns",
  activities: "activities",
  followups: "followups",
  walkthroughs: "walkthroughs",
  auditLog: "audit_log",
  duplicateDecisions: "duplicate_decisions",
  settings: "lead_settings",
  userRoles: "user_roles",
};

const snake = (s: string) => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

function tableColumns(table: string): string[] {
  const start = SQL.indexOf(`create table lead_finder.${table} (`);
  assert.ok(start >= 0, `table ${table} exists in the SQL`);
  const end = SQL.indexOf("\n);", start);
  return SQL.slice(start, end)
    .split("\n")
    .slice(1)
    .map((line) => /^ {2}([a-z_]+)\s/.exec(line)?.[1])
    .filter((c): c is string => Boolean(c) && !["unique", "check", "primary", "foreign", "constraint"].includes(c!));
}

describe("database design matches the app's data model", () => {
  const s = freshSnapshot() as unknown as Record<string, Record<string, unknown>[]>;

  it("has exactly the 18 expected tables, no more", () => {
    const created = [...SQL.matchAll(/create table lead_finder\.([a-z_]+) \(/g)].map((m) => m[1]).sort();
    assert.deepEqual(created, Object.values(TABLE_FOR).sort());
    assert.equal(created.length, 18);
  });

  for (const [key, table] of Object.entries(TABLE_FOR)) {
    it(`every field of ${key} has a column in lead_finder.${table}`, () => {
      const columns = new Set(tableColumns(table));
      const fields = new Set<string>();
      for (const row of s[key]) for (const f of Object.keys(row)) fields.add(f);
      assert.ok(fields.size > 0);
      for (const f of fields) assert.ok(columns.has(snake(f)), `${table}.${snake(f)} is missing from the SQL`);
    });
  }

  it("uses UUID primary keys (settings use their key)", () => {
    for (const table of Object.values(TABLE_FOR)) {
      const block = SQL.slice(SQL.indexOf(`create table lead_finder.${table} (`));
      const firstLine = block.split("\n")[1];
      if (table === "lead_settings") assert.match(firstLine, /key\s+text primary key/);
      else assert.match(firstLine, /id\s+uuid primary key default gen_random_uuid\(\)/, table);
    }
  });

  it("enables row level security on every table, and no table is readable without a role", () => {
    for (const table of Object.values(TABLE_FOR)) {
      assert.match(SQL, new RegExp(`alter table lead_finder\\.${table}\\s+enable row level security`), `RLS on ${table}`);
    }
    assert.match(SQL, /revoke all on schema lead_finder from public, anon/);
    assert.match(SQL, /revoke all on all tables in schema lead_finder from public, anon/);
    assert.doesNotMatch(SQL, /to anon|to public/i, "nothing is ever granted to anon or public");
  });

  it("keeps history append-only: no update or delete rights on audit_log, activities, score history, provenance or duplicate decisions", () => {
    const block = SQL.slice(SQL.indexOf("-- Append-only history"), SQL.indexOf("-- Settings: only owners"));
    assert.match(block, /'lead_score_breakdowns', 'field_provenance', 'activities', 'audit_log', 'duplicate_decisions'/);
    assert.match(block, /grant insert on/);
    assert.doesNotMatch(block, /grant (select, )?(insert, )?(update|delete)/);
  });

  it("stays inside its own schema and never reaches into another system", () => {
    assert.doesNotMatch(SQL, /\bpublic\./i);
    for (const m of SQL.matchAll(/references\s+([a-z_]+)\.([a-z_]+)/g)) {
      assert.ok(m[1] === "lead_finder" || (m[1] === "auth" && m[2] === "users"), `foreign key target ${m[0]}`);
    }
    for (const m of SQL.matchAll(/create (?:table|index|unique index|policy|function|or replace function|trigger)\s+(?:if not exists\s+)?[a-z_]*\.?([a-z_]+)/gi)) void m;
    assert.doesNotMatch(SQL, /drop\s+(table|schema|policy|function|column)|truncate|delete\s+from|alter\s+table\s+(?!lead_finder\.)/i, "no destructive or foreign statements");
    assert.match(SQL, /NOT EXECUTED/);
  });

  it("has no money columns — potential value is qualitative only", () => {
    for (const table of Object.values(TABLE_FOR)) {
      for (const column of tableColumns(table)) assert.doesNotMatch(column, /price|cost|dollar|amount|revenue|money/, `${table}.${column}`);
    }
    const code = SQL.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    assert.doesNotMatch(code, /\b(numeric|decimal|money)\b/i);
  });

  it("indexes the common searches", () => {
    for (const idx of ["leads_active_status_idx", "properties_norm_addr_idx", "followups_open_due_idx", "audit_lead_idx", "signals_lead_idx", "source_records_external_idx"]) {
      assert.match(SQL, new RegExp(`index ${idx}`));
    }
  });

  it("keeps every sighting of a source row: the external-id index is NOT unique (a repeat import must not fail)", () => {
    assert.match(SQL, /create index source_records_external_idx/);
    assert.doesNotMatch(SQL, /create unique index source_records_external/);
  });

  it("saves through one locked-down, all-or-nothing function that runs with the caller's own permissions", () => {
    const fn = SQL.slice(SQL.indexOf("create or replace function lead_finder.apply_changes"), SQL.indexOf("-- SECURITY — row level security"));
    assert.match(fn, /security invoker/, "row level security still applies to every save");
    assert.doesNotMatch(fn, /security definer/);
    assert.match(fn, /set search_path = ''/);
    assert.match(fn, /set constraints all deferred/);
    assert.match(fn, /LF_CONFLICT/, "refuses to overwrite someone else's newer change");
    assert.match(fn, /LF_CONFLICT[^\n]*errcode = 'PT409'/, "conflict is a plain HTTP 409");
    assert.doesNotMatch(fn, /errcode = '40001'/, "never 40001: PostgREST would silently retry it forever");
    assert.match(fn, /history and cannot be changed/);
    assert.doesNotMatch(fn, /\bdelete\b/i, "never deletes");
    assert.doesNotMatch(fn, /'user_roles'/, "roles cannot be changed through it");
    assert.match(SQL, /grant execute on function lead_finder\.apply_changes\(jsonb\) to authenticated;/);
    assert.match(SQL, /revoke all on all functions in schema lead_finder from public, anon;/);
    assert.match(SQL, /alter default privileges in schema lead_finder revoke all on tables from public, anon;/);
  });
});
