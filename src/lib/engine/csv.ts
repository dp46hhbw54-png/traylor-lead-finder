/**
 * Small, dependency-free CSV reader (RFC 4180 style).
 * Handles quoted fields, "" escapes, commas/newlines inside quotes, CRLF, a UTF-8 BOM, and
 * semicolon- or tab-separated files exported from spreadsheets.
 */
export interface ParsedCsv {
  headers: string[];
  rows: string[][];
  delimiter: string;
}

function detectDelimiter(firstLine: string): string {
  const counts = [",", ";", "\t"].map((d) => ({ d, n: firstLine.split(d).length - 1 }));
  counts.sort((a, b) => b.n - a.n);
  return counts[0].n > 0 ? counts[0].d : ",";
}

export function parseCsv(input: string): ParsedCsv {
  const text = input.replace(/^﻿/, "");
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = detectDelimiter(firstLine);
  const records: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
      continue;
    }
    if (ch === '"' && field === "") inQuotes = true;
    else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      records.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    records.push(row);
  }
  // Drop fully blank lines (a trailing newline, spacer rows) — they are not data rows.
  const nonBlank = records.filter((r) => r.some((c) => c.trim() !== ""));
  const [headerRow, ...rows] = nonBlank;
  const headers = (headerRow ?? []).map((h) => h.trim());
  // Short rows are padded; long rows are kept whole so the importer can flag the extra cells (never silently dropped).
  return { headers, rows: rows.map((r) => (r.length >= headers.length ? r : [...r, ...Array(headers.length - r.length).fill("")]).map((c) => c.trim())), delimiter };
}

/** Quote a value for writing a CSV (used for the template download). */
export function csvCell(v: string): string {
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}
