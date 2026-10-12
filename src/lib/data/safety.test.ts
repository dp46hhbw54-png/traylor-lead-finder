import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

/** Static checks that Phase 2 did not connect to, or reference, anything it must not. Reads files as text only. */
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

const files = walk(ROOT).filter((f) => /\.(ts|tsx|mjs|json|sql|md|example|css)$/.test(f) || path.basename(f).startsWith(".env"));
const read = (f: string) => fs.readFileSync(f, "utf8");
const rel = (f: string) => path.relative(ROOT, f);
// This file lists the forbidden patterns, so it is allowed to contain them.
const code = files.filter((f) => !rel(f).endsWith("safety.test.ts"));

describe("safety: nothing connects to a database or another Traylor Pro system", () => {
  it("has no Supabase client, no Supabase URL and no keys anywhere", () => {
    for (const f of code) {
      const text = read(f);
      assert.doesNotMatch(text, /@supabase\//, `${rel(f)} imports a Supabase package`);
      assert.doesNotMatch(text, /createClient\s*\(/, `${rel(f)} creates a client`);
      assert.doesNotMatch(text, /https?:\/\/[a-z0-9-]+\.supabase\.(co|in)/i, `${rel(f)} contains a Supabase URL`);
      assert.doesNotMatch(text, /eyJ[A-Za-z0-9_-]{20,}\./, `${rel(f)} contains something shaped like a JWT/API key`);
      assert.doesNotMatch(text, /sb_(publishable|secret)_[A-Za-z0-9]/, `${rel(f)} contains a Supabase key`);
    }
  });

  it("keeps credential settings blank in .env.example and out of browser code", () => {
    const env = read(path.join(ROOT, ".env.example"));
    for (const line of env.split("\n")) {
      const m = /^(NEXT_PUBLIC_SUPABASE_URL|NEXT_PUBLIC_SUPABASE_ANON_KEY|SUPABASE_SERVICE_ROLE_KEY)=(.*)$/.exec(line.trim());
      if (m) assert.equal(m[2].trim(), "", `${m[1]} must stay blank`);
    }
    for (const f of code.filter((x) => rel(x).startsWith("src"))) {
      assert.doesNotMatch(read(f), /SERVICE_ROLE/i, `${rel(f)} must never mention the service-role key`);
    }
  });

  it("does not import from, call, or name any other Traylor Pro system's code or data", () => {
    for (const f of code.filter((x) => /\.(ts|tsx|mjs)$/.test(x))) {
      const text = read(f);
      assert.doesNotMatch(text, /from\s+["'][^"']*(employee|inventory|supply|command-center|client-portal)[^"']*["']/i, `${rel(f)} imports another system`);
      assert.doesNotMatch(text, /fetch\(|XMLHttpRequest|axios|WebSocket/, `${rel(f)} makes a network request — the app is local-only for now`);
    }
  });

  it("does not scrape: no HTML parsing or crawler libraries", () => {
    const pkg = read(path.join(ROOT, "package.json"));
    assert.doesNotMatch(pkg, /cheerio|puppeteer|playwright|jsdom|crawler|scrap/i);
  });

  it("only allows the demo data source", () => {
    const index = read(path.join(ROOT, "src/lib/data/index.ts"));
    assert.match(index, /new LocalDemoRepository\(\)/);
    assert.doesNotMatch(index, /Supabase(Repository)?\(/);
  });
});
