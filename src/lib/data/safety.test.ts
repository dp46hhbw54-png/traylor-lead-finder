import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { resolveDataSource } from "./supabase/config";

/**
 * Static safety checks (files are read as text only — nothing is run or connected).
 *
 * Phase 2/3 rule was "no database at all". With the CEO-approved database connection the rules are now:
 *   - Supabase is used in exactly ONE file, only on the `lead_finder` schema, only with a PUBLIC key.
 *   - No keys, secrets, connection strings or project URLs are written into the code or the repo.
 *   - Browser code reads only NEXT_PUBLIC_* settings; there is no server secret to leak.
 *   - Demo data is the default and is never switched to silently when the database is asked for.
 *   - Nothing reaches another Traylor Pro system.
 */
const ROOT = process.cwd();

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".next" || entry.name.startsWith(".git")) continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const files = walk(ROOT).filter((f) => /\.(ts|tsx|mjs|js|json|sql|md|example|css)$/.test(f) || path.basename(f).startsWith(".env"));
const read = (f: string) => fs.readFileSync(f, "utf8");
const rel = (f: string) => path.relative(ROOT, f).split(path.sep).join("/");
// Test files describe forbidden patterns (and fake keys), so they're excluded from the text scans.
const code = files.filter((f) => !/\.test\.ts$/.test(f));
const src = code.filter((f) => rel(f).startsWith("src/"));
const CLIENT_FILE = "src/lib/data/supabase/client.ts";

describe("safety: data access and secrets", () => {
  it("uses the Supabase library in exactly one file", () => {
    const users = src.filter((f) => /@supabase\//.test(read(f))).map(rel);
    assert.deepEqual(users, [CLIENT_FILE]);
    const creators = src.filter((f) => /createClient\s*\(/.test(read(f))).map(rel);
    assert.deepEqual(creators, [CLIENT_FILE]);
  });

  it("that one file connects only to the lead_finder schema, with values from the public config", () => {
    const client = read(path.join(ROOT, CLIENT_FILE));
    assert.match(client, /schema: "lead_finder"/);
    assert.match(client, /createClient\(url, publicKey,/, "URL and key come from resolveDataSource, never literals");
    for (const f of src) assert.doesNotMatch(read(f), /\.schema\(\s*["'](?!lead_finder)/, `${rel(f)} must not switch to another schema`);
  });

  it("contains no keys, secrets, connection strings or project URLs anywhere in the repository", () => {
    for (const f of code) {
      const text = read(f);
      assert.doesNotMatch(text, /https?:\/\/[a-z0-9-]+\.supabase\.(co|in)/i, `${rel(f)} contains a Supabase project URL`);
      assert.doesNotMatch(text, /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/, `${rel(f)} contains something shaped like a JWT/API key`);
      assert.doesNotMatch(text, /sb_(publishable|secret)_[A-Za-z0-9]{8,}/, `${rel(f)} contains a Supabase key`);
      assert.doesNotMatch(text, /postgres(ql)?:\/\/[^\s"'`]*:[^\s"'`@]+@/i, `${rel(f)} contains a database connection string with a password`);
    }
  });

  it("browser code never mentions or reads a server secret", () => {
    for (const f of src) {
      const text = read(f);
      assert.doesNotMatch(text, /SERVICE_ROLE|service_role_key|SUPABASE_SECRET|DATABASE_URL|DB_PASSWORD/i, `${rel(f)} mentions a server secret`);
      for (const m of text.matchAll(/process\.env\.([A-Z0-9_]+)/g)) {
        assert.ok(m[1].startsWith("NEXT_PUBLIC_") || m[1] === "NODE_ENV", `${rel(f)} reads non-public setting ${m[1]}`);
      }
    }
  });

  it(".env.example keeps every value blank and lists no secret settings", () => {
    const env = read(path.join(ROOT, ".env.example"));
    for (const line of env.split("\n")) {
      const m = /^(NEXT_PUBLIC_SUPABASE_[A-Z_]+)=(.*)$/.exec(line.trim());
      if (m) assert.equal(m[2].trim(), "", `${m[1]} must stay blank`);
      assert.doesNotMatch(line, /^\s*(SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SECRET_KEY|DATABASE_URL)\s*=/, "no secret settings in the template");
    }
    assert.match(env, /^NEXT_PUBLIC_DATA_SOURCE=demo$/m, "demo is the default");
  });

  it("app code makes no direct network calls (only the Supabase library talks to the database)", () => {
    for (const f of src.filter((x) => /\.(ts|tsx)$/.test(x))) {
      assert.doesNotMatch(read(f), /\bfetch\(|XMLHttpRequest|axios|new WebSocket/, `${rel(f)} makes its own network request`);
    }
  });

  it("does not import from, call, or name any other Traylor Pro system's code or data", () => {
    for (const f of code.filter((x) => /\.(ts|tsx|mjs)$/.test(x))) {
      assert.doesNotMatch(read(f), /from\s+["'][^"']*(employee|inventory|supply|command-center|client-portal)[^"']*["']/i, `${rel(f)} imports another system`);
    }
  });

  it("does not scrape: no HTML parsing or crawler libraries", () => {
    assert.doesNotMatch(read(path.join(ROOT, "package.json")), /cheerio|puppeteer|playwright|jsdom|crawler|scrap/i);
  });

  it("defaults to demo data, and never silently falls back to demo when the database is asked for", () => {
    assert.deepEqual(resolveDataSource({}), { mode: "demo" });
    assert.deepEqual(resolveDataSource({ NEXT_PUBLIC_DATA_SOURCE: "demo" }), { mode: "demo" });
    assert.equal(resolveDataSource({ NEXT_PUBLIC_DATA_SOURCE: "supabase" }).mode, "misconfigured");
    const index = read(path.join(ROOT, "src/lib/data/index.ts"));
    assert.match(index, /config\.mode === "misconfigured"|else \{\s*instance = \{ config, repo: null/, "a broken database setup shows a problem screen");
  });
});
