import { resolveScoringSettings } from "../../config/scoring-settings";
import { APP_ROLE_LABEL } from "../../domain/labels";
import { can, type Permission } from "../../domain/permissions";
import { SCHEMA_VERSION, type AppRole, type LeadFinderSnapshot } from "../../domain/types";
import { recordScoreChanges } from "../../engine/score-history";
import { defaultNewId, type MutationContext } from "../../workflow/context";
import { RepositoryError } from "../repository";
import { WorkflowRepository } from "../workflow-repository";
import { createDemoSnapshot } from "./seed";

const STORAGE_KEY = `traylor-lead-finder:demo-snapshot:v${SCHEMA_VERSION}`;
const OLD_STORAGE_KEYS = ["traylor-lead-finder:demo-snapshot:v1", "traylor-lead-finder:demo-snapshot:v2"];
const SIM_KEY = "traylor-lead-finder:demo-simulation:v1";
const DEMO_USER = "Demo user";

/** Demo-only switches for reviewing loading / empty / error states and roles. */
export interface DemoSimulation {
  latencyMs: number;
  failLoads: boolean;
  emptyDataset: boolean;
  /** Pretend to be signed in as this role, to see what a Manager or Viewer can do. */
  role: AppRole;
}

export const DEFAULT_SIMULATION: DemoSimulation = { latencyMs: 350, failLoads: false, emptyDataset: false, role: "owner" };

// Browser storage can be missing or throw (private mode, previews) — never let that break the app.
function readStorage<T>(key: string): T | null {
  try {
    if (typeof window === "undefined") return null;
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
function writeStorage(key: string, value: unknown): void {
  try {
    if (typeof window !== "undefined") window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* in-memory only */
  }
}
function removeStorage(key: string): void {
  try {
    if (typeof window !== "undefined") window.localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export function getDemoSimulation(): DemoSimulation {
  return { ...DEFAULT_SIMULATION, ...(readStorage<DemoSimulation>(SIM_KEY) ?? {}) };
}
export function setDemoSimulation(sim: DemoSimulation): void {
  writeStorage(SIM_KEY, sim);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface LocalDemoOptions {
  /** Override the simulated delay (tests use 0). */
  latencyMs?: number;
  /** Override the current time (tests). */
  clock?: () => Date;
  /** Override the signed-in role instead of reading the Settings switch (tests). */
  role?: AppRole;
}

/**
 * In-browser repository backed by the fictional demo dataset.
 * Changes persist to this browser's localStorage only (when available). Nothing leaves the device.
 *
 * It holds NO business rules — those live in src/lib/workflow and are shared with the future Supabase repository.
 * What it does own: loading, saving, simulated latency/errors, and the role check.
 */
export class LocalDemoRepository extends WorkflowRepository {
  readonly kind = "demo" as const;
  readonly label = "Local demo data (fictional) — no database connected";
  private snapshot: LeadFinderSnapshot | null = null;

  constructor(private readonly options: LocalDemoOptions = {}) {
    super();
  }

  private now(): Date {
    return this.options.clock ? this.options.clock() : new Date();
  }

  private ensure(): LeadFinderSnapshot {
    if (!this.snapshot) {
      for (const key of OLD_STORAGE_KEYS) removeStorage(key); // Old demo shapes are discarded, never half-read.
      const stored = readStorage<LeadFinderSnapshot>(STORAGE_KEY);
      this.snapshot = stored && stored.schemaVersion === SCHEMA_VERSION ? stored : createDemoSnapshot(this.now());
      this.persist();
    }
    return this.snapshot;
  }
  private persist() {
    if (this.snapshot) writeStorage(STORAGE_KEY, this.snapshot);
  }

  private async simulate() {
    const sim = getDemoSimulation();
    const latency = this.options.latencyMs ?? sim.latencyMs;
    if (latency > 0) await sleep(latency);
    return { ...sim, role: this.options.role ?? sim.role };
  }

  /**
   * Run a change as one all-or-nothing step on a COPY of the data, re-score, then save.
   * If anything throws, the real data is untouched.
   */
  protected async change<T>(permission: Permission, fn: (s: LeadFinderSnapshot, m: MutationContext) => T): Promise<T> {
    const sim = await this.simulate();
    if (!can(sim.role, permission)) {
      throw new RepositoryError(
        `Your role (${APP_ROLE_LABEL[sim.role]}) can look at leads but can't change them.`,
        "Ask an Owner or Manager to make this change.",
      );
    }
    const draft = structuredClone(this.ensure());
    const m: MutationContext = { now: this.now(), by: DEMO_USER, newId: defaultNewId, isDemo: true };
    const result = fn(draft, m);
    recordScoreChanges(draft, m, resolveScoringSettings(draft.settings));
    draft.generatedAt = m.now.toISOString();
    this.snapshot = draft;
    this.persist();
    return result;
  }

  async loadSnapshot(): Promise<LeadFinderSnapshot> {
    const sim = await this.simulate();
    if (sim.failLoads) {
      throw new RepositoryError(
        "Couldn't load leads (simulated error).",
        "This is a demo of the error state. Turn off “Simulate load error” in Settings, then try again.",
      );
    }
    const snap = structuredClone(this.ensure());
    if (sim.emptyDataset) {
      return { ...snap, leads: [], signals: [], activities: [], followups: [], walkthroughs: [], sourceRecords: [], provenance: [], scoreBreakdowns: [], auditLog: [], duplicateDecisions: [] };
    }
    return snap;
  }

  protected async current(): Promise<LeadFinderSnapshot> {
    await this.simulate();
    return this.ensure();
  }

  async reset() {
    removeStorage(STORAGE_KEY);
    this.snapshot = createDemoSnapshot(this.now());
    this.persist();
  }
}
