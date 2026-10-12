"use client";

import clsx from "clsx";
import Link from "next/link";
import { useMemo, useState } from "react";
import { LuCircleAlert, LuCircleCheck, LuCopy, LuDownload, LuFileSpreadsheet, LuUpload } from "react-icons/lu";
import { StatusPill } from "@/components/ui/badges";
import { Button, buttonClass } from "@/components/ui/button";
import { ChoiceChips, controlClass, FieldBlock } from "@/components/ui/form";
import { PageHeader, WithData } from "@/components/ui/screen";
import { parseCsv, type ParsedCsv } from "@/lib/engine/csv";
import { DUPLICATE_REASON_LABEL } from "@/lib/engine/duplicates";
import {
  autoMapColumns,
  buildCsvPreview,
  CSV_FIELDS,
  csvTemplate,
  missingRequiredMappings,
  summarizePreview,
  type CsvImportOptions,
  type CsvImportResult,
  type CsvMapping,
  type CsvPreviewRow,
  type CsvRowChoice,
} from "@/lib/workflow/csv-import";
import { useLeadFinder } from "@/state/lead-finder-store";
import { useEvaluatedLeads } from "@/state/use-evaluated-leads";

const MAX_ROWS = 2000;
type Step = "upload" | "map" | "review" | "done";
type Reliability = CsvImportOptions["dataStatus"];

function Steps({ step }: { step: Step }) {
  const steps: [Step, string][] = [
    ["upload", "Upload"],
    ["map", "Match columns"],
    ["review", "Review"],
    ["done", "Import"],
  ];
  const i = steps.findIndex(([k]) => k === step);
  return (
    <ol className="mb-4 grid grid-cols-4 gap-1 text-center text-xs font-semibold" aria-label="Import steps">
      {steps.map(([k, l], n) => (
        <li key={k} aria-current={k === step ? "step" : undefined} className={clsx("rounded-lg px-1 py-2", n < i ? "bg-emerald-50 text-emerald-800" : n === i ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-500")}>
          {n + 1}. {l}
        </li>
      ))}
    </ol>
  );
}

export function ImportCsvScreen() {
  return (
    <>
      <PageHeader title="Import leads from a CSV" description="Upload a spreadsheet saved as CSV. You'll see every row before anything is saved — nothing is skipped or overwritten without you seeing it." />
      <WithData>
        <ImportFlow />
      </WithData>
    </>
  );
}

function ImportFlow() {
  const { snapshot, actions, busy } = useLeadFinder();
  const views = useEvaluatedLeads();
  const [step, setStep] = useState<Step>("upload");
  const [fileName, setFileName] = useState("");
  const [parsed, setParsed] = useState<ParsedCsv | null>(null);
  const [mapping, setMapping] = useState<CsvMapping>({});
  const [reliability, setReliability] = useState<Reliability | null>(null);
  const [choices, setChoices] = useState<Record<number, CsvRowChoice>>({});
  const [error, setError] = useState<string | null>(null);
  const [pasted, setPasted] = useState("");
  const [showPaste, setShowPaste] = useState(false);
  const [result, setResult] = useState<CsvImportResult | null>(null);

  const csvSource = snapshot?.sources.find((s) => s.type === "csv" && s.status === "available");

  const load = (text: string, name: string) => {
    setError(null);
    const p = parseCsv(text);
    if (p.headers.length === 0 || p.rows.length === 0) {
      setError(`We couldn't find any rows in “${name}”. Check that the first line has column names and there's at least one row under it.`);
      return;
    }
    if (p.rows.length > MAX_ROWS) {
      setError(`“${name}” has ${p.rows.length.toLocaleString("en-US")} rows. Please split it into files of ${MAX_ROWS.toLocaleString("en-US")} rows or fewer.`);
      return;
    }
    setParsed(p);
    setFileName(name);
    setMapping(autoMapColumns(p.headers));
    setChoices({});
    setStep("map");
  };

  const onFile = (files: FileList | null) => {
    const f = files?.[0];
    if (!f) return;
    if (!/\.(csv|txt)$/i.test(f.name)) {
      setError(`“${f.name}” isn't a CSV file. In Excel or Google Sheets choose File → Save as / Download → CSV, then upload that file.`);
      return;
    }
    f.text().then(
      (t: string) => load(t, f.name),
      () => setError(`We couldn't read “${f.name}”. Try saving it again as CSV.`),
    );
  };

  const options: CsvImportOptions | null = csvSource && reliability ? { fileName, sourceId: csvSource.id, dataStatus: reliability } : null;
  const preview = useMemo<CsvPreviewRow[]>(
    () => (snapshot && parsed && options && step !== "upload" && step !== "map" ? buildCsvPreview(snapshot, parsed, mapping, options) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [snapshot, parsed, mapping, reliability, step, fileName],
  );
  const summary = summarizePreview(preview);
  const missing = missingRequiredMappings(mapping);
  const toImport = preview.filter((r) => r.status === "ready" || (r.status === "duplicate" && choices[r.rowNumber] && choices[r.rowNumber].action !== "skip")).length;

  const runImport = async () => {
    if (!parsed || !options) return;
    const res = await actions.importCsv({ parsed, mapping, options, choices });
    if (res) {
      setResult(res);
      setStep("done");
      window.scrollTo?.(0, 0);
    }
  };

  const restart = () => {
    setStep("upload");
    setParsed(null);
    setResult(null);
    setChoices({});
    setReliability(null);
    setPasted("");
    setError(null);
  };

  if (!csvSource) {
    return (
      <p role="alert" className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
        CSV import is turned off or temporarily unavailable. Nothing can be imported right now — try again later, or add leads one at a time.
      </p>
    );
  }

  return (
    <div>
      <Steps step={step} />
      {error && (
        <p role="alert" className="mb-3 flex gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800">
          <LuCircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </p>
      )}

      {step === "upload" && (
        <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
          <label className="flex min-h-36 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center hover:border-brand-400 hover:bg-brand-50/40">
            <LuUpload className="h-8 w-8 text-slate-400" />
            <span className="font-semibold text-slate-900">Choose a CSV file</span>
            <span className="text-sm text-slate-500">Up to {MAX_ROWS.toLocaleString("en-US")} rows. Saved from Excel or Google Sheets as CSV.</span>
            <input type="file" accept=".csv,text/csv,.txt" className="sr-only" aria-label="Choose a CSV file" onChange={(e) => onFile((e.target as unknown as HTMLInputElement).files)} />
          </label>
          <div className="flex flex-wrap gap-2">
            <a href={`data:text/csv;charset=utf-8,${encodeURIComponent(csvTemplate())}`} download="lead-import-template.csv" className={buttonClass("secondary", "md", "min-h-11")}>
              <LuDownload className="h-4 w-4" /> Download a template
            </a>
            <Button variant="ghost" className="min-h-11" aria-expanded={showPaste} onClick={() => setShowPaste((v) => !v)}>
              {showPaste ? "Hide paste box" : "Or paste CSV text"}
            </Button>
          </div>
          {showPaste && (
            <div>
              <textarea aria-label="Paste CSV text" className={`${controlClass} min-h-40 font-mono text-xs`} value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder="Business name,City,Facility type,Why it's an opportunity&#10;…" />
              <Button className="mt-2 min-h-11" variant="primary" disabled={!pasted.trim()} onClick={() => load(pasted, "pasted.csv")}>
                Use this text
              </Button>
            </div>
          )}
          <div className="rounded-xl bg-slate-50 p-3 text-sm text-slate-600">
            <p className="font-semibold text-slate-800">Each row needs:</p>
            <p>Business or property name · City · Facility type · Why it's an opportunity. The file itself is recorded as the source.</p>
          </div>
        </section>
      )}

      {step === "map" && parsed && (
        <section className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
            <p className="flex items-center gap-2 font-semibold text-slate-900">
              <LuFileSpreadsheet className="h-5 w-5 text-slate-400" /> {fileName} · {parsed.rows.length} row{parsed.rows.length === 1 ? "" : "s"}
            </p>
            <p className="mt-1 text-sm text-slate-600">We matched the columns we recognized. Check them, and pick a column for anything required that's missing.</p>
            {missing.length > 0 && (
              <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-800">
                Still needed: {missing.join(", ")}.
              </p>
            )}
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {CSV_FIELDS.map((f) => {
                const idx = mapping[f.key];
                const sample = idx !== undefined && idx !== null ? parsed.rows.find((r) => r[idx]?.trim())?.[idx] : null;
                return (
                  <div key={f.key}>
                    <label htmlFor={`map-${f.key}`} className="mb-1 block text-sm font-semibold text-slate-800">
                      {f.label}
                      {f.required && <span className="ml-1 text-xs font-medium text-slate-500">{f.required === "name" ? "(this or the other name)" : "(required)"}</span>}
                    </label>
                    <select
                      id={`map-${f.key}`}
                      className={controlClass}
                      value={idx ?? ""}
                      onChange={(e) => setMapping({ ...mapping, [f.key]: e.target.value === "" ? null : Number(e.target.value) })}
                    >
                      <option value="">— Not in this file —</option>
                      {parsed.headers.map((h, i) => (
                        <option key={i} value={i}>
                          {h || `Column ${i + 1}`}
                        </option>
                      ))}
                    </select>
                    {sample && <p className="mt-1 truncate text-xs text-slate-500">e.g. “{sample}”</p>}
                  </div>
                );
              })}
            </div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
            <FieldBlock label="How reliable is this list?" required hint="Applied to the size, phone numbers, emails and opportunity in every row. You can change individual leads later.">
              <ChoiceChips
                name="How reliable is this list?"
                columns={3}
                value={reliability}
                onChange={setReliability}
                options={[
                  { value: "publicly_reported", label: "Publicly reported", hint: "From listings, news, websites" },
                  { value: "verified", label: "Verified by our team", hint: "We checked every row" },
                  { value: "estimated", label: "Rough / estimates", hint: "Not confirmed" },
                ]}
              />
            </FieldBlock>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:flex">
            <Button variant="primary" size="lg" disabled={missing.length > 0 || !reliability} onClick={() => setStep("review")}>
              Check the rows
            </Button>
            <Button variant="ghost" size="lg" onClick={restart}>
              Choose a different file
            </Button>
          </div>
          {(missing.length > 0 || !reliability) && <p className="text-sm text-slate-500">{missing.length > 0 ? "Match the required columns first." : "Say how reliable the list is first."}</p>}
        </section>
      )}

      {step === "review" && (
        <section className="space-y-4">
          <div className="grid grid-cols-3 gap-2" aria-label="Row summary">
            <div className="rounded-xl bg-emerald-50 p-3 text-center ring-1 ring-emerald-200">
              <p className="text-2xl font-bold text-emerald-800">{summary.ready}</p>
              <p className="text-xs font-semibold text-emerald-900">Ready to import</p>
            </div>
            <div className="rounded-xl bg-amber-50 p-3 text-center ring-1 ring-amber-200">
              <p className="text-2xl font-bold text-amber-800">{summary.duplicates}</p>
              <p className="text-xs font-semibold text-amber-900">Possible duplicates</p>
            </div>
            <div className="rounded-xl bg-red-50 p-3 text-center ring-1 ring-red-200">
              <p className="text-2xl font-bold text-red-700">{summary.errors}</p>
              <p className="text-xs font-semibold text-red-900">With problems</p>
            </div>
          </div>
          <p className="text-sm text-slate-600">
            {summary.total} rows in {fileName}.{summary.missingRequired > 0 && ` ${summary.missingRequired} ${summary.missingRequired === 1 ? "is" : "are"} missing required information.`}
          </p>

          {summary.errors > 0 && (
            <div className="rounded-2xl border border-red-200 bg-white p-4 sm:p-5" aria-label="Rows with problems">
              <h2 className="font-semibold text-red-900">Rows with problems — these won't be imported</h2>
              <p className="text-sm text-slate-600">Fix them in your file and upload it again. They're kept in the import history, never silently dropped.</p>
              <ul className="mt-2 space-y-2">
                {preview
                  .filter((r) => r.status === "error")
                  .map((r) => (
                    <li key={r.rowNumber} className="rounded-lg bg-red-50 px-3 py-2 text-sm" data-csv-row={r.rowNumber}>
                      <p className="font-semibold text-red-950">
                        Row {r.rowNumber} · {r.label}
                      </p>
                      <ul className="list-disc pl-5 text-red-900">
                        {r.errors.map((e) => (
                          <li key={e}>{e}</li>
                        ))}
                      </ul>
                    </li>
                  ))}
              </ul>
            </div>
          )}

          {summary.duplicates > 0 && (
            <div className="rounded-2xl border border-amber-300 bg-white p-4 sm:p-5" aria-label="Possible duplicates">
              <h2 className="flex items-center gap-2 font-semibold text-amber-950">
                <LuCopy className="h-5 w-5" /> Possible duplicates — choose for each
              </h2>
              <p className="text-sm text-slate-600">They're skipped unless you choose otherwise. An existing lead is never overwritten.</p>
              <ul className="mt-2 space-y-3">
                {preview
                  .filter((r) => r.status === "duplicate")
                  .map((r) => {
                    const choice = choices[r.rowNumber] ?? { action: "skip" };
                    const key = choice.action === "add_to_existing_lead" ? `lead:${choice.leadId}` : choice.action === "link_to_property" ? `prop:${choice.propertyId}` : choice.action;
                    const leadOptions = r.duplicates.flatMap((d) => d.openLeadIds.map((id) => ({ id, view: views.find((v) => v.ctx.lead.id === id) })));
                    return (
                      <li key={r.rowNumber} className="rounded-xl bg-amber-50 p-3 text-sm" data-csv-row={r.rowNumber}>
                        <p className="font-semibold text-slate-900">
                          Row {r.rowNumber} · {r.label}
                        </p>
                        {r.inFileDuplicateOf && <p className="text-amber-900">Same building as row {r.inFileDuplicateOf} in this file.</p>}
                        {r.duplicates.map((d) => (
                          <p key={d.propertyId} className="text-amber-900">
                            Looks like <span className="font-semibold">{d.propertyName}</span> ({[d.address, d.city].filter(Boolean).join(", ")}) — {d.reasons.map((x) => DUPLICATE_REASON_LABEL[x]).join(", ")}
                          </p>
                        ))}
                        {leadOptions.map(({ id, view }) =>
                          view ? (
                            <p key={id} className="text-slate-700">
                              Existing lead: {view.ctx.lead.title} · Score {view.score.score} — {view.score.tier.toUpperCase()} · <StatusPill status={view.ctx.lead.status} />
                            </p>
                          ) : null,
                        )}
                        <label htmlFor={`choice-${r.rowNumber}`} className="mt-2 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                          What should we do?
                        </label>
                        <select
                          id={`choice-${r.rowNumber}`}
                          className={controlClass}
                          value={key}
                          onChange={(e) => {
                            const v = e.target.value;
                            const next: CsvRowChoice = v.startsWith("lead:")
                              ? { action: "add_to_existing_lead", leadId: v.slice(5) }
                              : v.startsWith("prop:")
                                ? { action: "link_to_property", propertyId: v.slice(5) }
                                : ({ action: v } as CsvRowChoice);
                            setChoices({ ...choices, [r.rowNumber]: next });
                          }}
                        >
                          <option value="skip">Skip this row (don't import)</option>
                          {leadOptions.map(({ id, view }) => (
                            <option key={`lead:${id}`} value={`lead:${id}`}>
                              Merge into existing lead{view ? ` “${view.ctx.lead.title}”` : ""}
                            </option>
                          ))}
                          {r.duplicates.map((d) => (
                            <option key={`prop:${d.propertyId}`} value={`prop:${d.propertyId}`}>
                              Same building ({d.propertyName}) — new opportunity
                            </option>
                          ))}
                          <option value="create_anyway">{r.duplicates.length ? "Create anyway — it's different" : "Import anyway"}</option>
                        </select>
                      </li>
                    );
                  })}
              </ul>
            </div>
          )}

          {summary.ready > 0 && (
            <details className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
              <summary className="min-h-11 cursor-pointer py-2 font-semibold text-slate-900">Ready to import ({summary.ready})</summary>
              <ul className="mt-2 space-y-1 text-sm">
                {preview
                  .filter((r) => r.status === "ready")
                  .map((r) => (
                    <li key={r.rowNumber} data-csv-row={r.rowNumber}>
                      <span className="font-medium">Row {r.rowNumber}</span> · {r.label}
                      {r.warnings.map((w) => (
                        <span key={w} className="block text-xs text-slate-500">
                          {w}
                        </span>
                      ))}
                    </li>
                  ))}
              </ul>
            </details>
          )}

          <div className="sticky bottom-0 -mx-4 grid grid-cols-1 gap-2 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur sm:static sm:mx-0 sm:flex sm:border-0 sm:bg-transparent sm:p-0">
            <Button variant="primary" size="lg" disabled={busy || toImport === 0} onClick={() => void runImport()}>
              {busy ? "Importing…" : toImport === 0 ? "Nothing to import" : `Import ${toImport} lead${toImport === 1 ? "" : "s"}`}
            </Button>
            <Button variant="ghost" size="lg" onClick={() => setStep("map")}>
              Back to columns
            </Button>
          </div>
        </section>
      )}

      {step === "done" && result && (
        <section className="space-y-4" aria-label="Import result">
          <div className={clsx("rounded-2xl p-4 sm:p-5", result.imported + result.addedToExisting > 0 ? "border border-emerald-200 bg-emerald-50" : "border border-amber-200 bg-amber-50")}>
            <p className="flex items-center gap-2 text-lg font-bold text-slate-900">
              <LuCircleCheck className="h-6 w-6 text-emerald-700" /> {result.imported + result.addedToExisting > 0 ? "Import finished" : "Nothing was imported"}
            </p>
            <p className="text-sm text-slate-800">
              All {result.total} rows from {result.fileName} are accounted for:
            </p>
            <ul className="mt-2 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
              <li className="rounded-lg bg-white px-3 py-2">
                <span className="text-lg font-bold">{result.imported}</span> imported
              </li>
              <li className="rounded-lg bg-white px-3 py-2">
                <span className="text-lg font-bold">{result.addedToExisting}</span> added to existing
              </li>
              <li className="rounded-lg bg-white px-3 py-2">
                <span className="text-lg font-bold">{result.skipped}</span> skipped by you
              </li>
              <li className="rounded-lg bg-white px-3 py-2">
                <span className="text-lg font-bold">{result.notImported}</span> not imported
              </li>
            </ul>
          </div>
          <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white text-sm">
            {result.rows.map((r) => (
              <li key={r.rowNumber} className="flex flex-wrap items-start justify-between gap-2 px-4 py-2" data-result-row={r.rowNumber}>
                <div className="min-w-0">
                  <p className="font-medium text-slate-900">
                    Row {r.rowNumber} · {r.label}
                  </p>
                  <p className={clsx("text-xs", r.outcome === "not_imported" ? "text-red-800" : "text-slate-500")}>{r.message}</p>
                </div>
                {r.leadId ? (
                  <Link href={`/leads/${r.leadId}`} className="inline-flex min-h-11 items-center text-sm font-semibold text-brand-700 hover:underline">
                    Open lead
                  </Link>
                ) : (
                  <span className={clsx("rounded-full px-2 py-0.5 text-xs font-semibold", r.outcome === "skipped" ? "bg-slate-100 text-slate-600" : "bg-red-50 text-red-800")}>
                    {r.outcome === "skipped" ? "Skipped" : "Not imported"}
                  </span>
                )}
              </li>
            ))}
          </ul>
          <div className="grid grid-cols-1 gap-2 sm:flex">
            <Link href="/leads" className={buttonClass("primary", "lg")}>
              Go to Leads
            </Link>
            <Button variant="secondary" size="lg" onClick={restart}>
              Import another file
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}
