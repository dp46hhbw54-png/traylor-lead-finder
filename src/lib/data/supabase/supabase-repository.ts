import { resolveScoringSettings } from "../../config/scoring-settings";
import { RepositoryError } from "../../domain/errors";
import { APP_ROLE_LABEL } from "../../domain/labels";
import { can, type Permission } from "../../domain/permissions";
import { SCHEMA_VERSION, type LeadFinderSnapshot, type UserRole } from "../../domain/types";
import { recordScoreChanges } from "../../engine/score-history";
import type { MutationContext } from "../../workflow/context";
import { WorkflowRepository } from "../workflow-repository";
import { DbError, type LeadFinderDb, type SignedInUser } from "./db";
import { computeChanges, fromRow, isEmptyChangeSet, newUuid, primaryKeyOf, SNAPSHOT_KEYS, TABLE_FOR } from "./rows";

/** Thrown when there is no signed-in session. The app shows the sign-in screen. */
export class SignedOutError extends RepositoryError {
  constructor() {
    super("You're signed out, so that wasn't saved.", "Sign in again with your email code, then redo the last change. New-lead forms keep what you typed.");
    this.name = "SignedOutError";
  }
}

/** Signed in, but this account hasn't been given access to the Lead Finder. */
export class NoAccessError extends RepositoryError {
  constructor(readonly email: string) {
    super(`${email || "This account"} doesn't have access to the Lead Finder yet.`, "Ask the Owner to give your account a role, then tap Try again.");
    this.name = "NoAccessError";
  }
}

/** Plain-language explanation of a failed database call. Every save failure says nothing was saved. */
export function explainDbError(err: unknown, doing: "load" | "save"): RepositoryError {
  if (err instanceof RepositoryError) return err;
  const kind = err instanceof DbError ? err.kind : "unknown";
  const saved = doing === "save" ? " Nothing was saved." : "";
  switch (kind) {
    case "network":
      return new RepositoryError(
        `Couldn't reach the Lead Finder database.${saved}`,
        doing === "save" ? "Check your signal or Wi-Fi, then tap Save again — what you typed is still there." : "Check your signal or Wi-Fi, then tap Try again.",
      );
    case "signed_out":
      return new SignedOutError();
    case "denied":
      return new RepositoryError(`Your account isn't allowed to do that.${saved}`, "Ask the Owner if you need this access.");
    case "conflict":
      return new RepositoryError(
        "Someone else changed this lead a moment ago, so your change wasn't saved (nothing was overwritten).",
        "The latest version is loaded now — please make your change again.",
      );
    case "invalid":
      return new RepositoryError(`The database didn't accept that change.${saved}`, "Check the details and try again. If it keeps happening, tell the Owner what you were doing.");
    default:
      return new RepositoryError(`Something went wrong talking to the database.${saved}`, "Try again in a moment. If it keeps happening, tell the Owner what you were doing.");
  }
}

export interface SupabaseRepositoryOptions {
  clock?: () => Date;
}

/**
 * The Lead Finder on its dedicated Supabase database.
 *
 * Reads: every table the signed-in person is allowed to see (row-level security does the filtering).
 * Writes: the same business rules as the demo run on a copy of the data; only the rows that changed
 * are sent to the database in ONE all-or-nothing call (lead_finder.apply_changes), which runs as the
 * signed-in person, refuses to overwrite newer changes, and never deletes. Afterwards the data is
 * reloaded so everyone sees exactly what the database holds.
 */
export class SupabaseRepository extends WorkflowRepository {
  readonly kind = "supabase" as const;
  private snapshot: LeadFinderSnapshot | null = null;
  private me: { user: SignedInUser; role: UserRole } | null = null;

  constructor(
    private readonly db: LeadFinderDb,
    private readonly options: SupabaseRepositoryOptions = {},
  ) {
    super();
  }

  get label(): string {
    return this.me ? `Lead Finder database — signed in as ${this.me.role.displayName} (${APP_ROLE_LABEL[this.me.role.role]})` : "Lead Finder database";
  }

  /** Who is signed in and with which role (after the first load). */
  get signedInAs(): { email: string; displayName: string; role: UserRole["role"] } | null {
    return this.me ? { email: this.me.user.email, displayName: this.me.role.displayName, role: this.me.role.role } : null;
  }

  private now(): Date {
    return this.options.clock ? this.options.clock() : new Date();
  }

  async loadSnapshot(): Promise<LeadFinderSnapshot> {
    let user: SignedInUser | null;
    try {
      user = await this.db.currentUser();
    } catch (err) {
      throw explainDbError(err, "load");
    }
    if (!user) {
      this.snapshot = null;
      this.me = null;
      throw new SignedOutError();
    }
    let tables: Record<string, unknown>[][];
    try {
      tables = await Promise.all(SNAPSHOT_KEYS.map((k) => this.db.selectAll(TABLE_FOR[k], primaryKeyOf(k))));
    } catch (err) {
      throw explainDbError(err, "load");
    }
    const snap = { schemaVersion: SCHEMA_VERSION, generatedAt: this.now().toISOString() } as LeadFinderSnapshot;
    SNAPSHOT_KEYS.forEach((k, i) => {
      (snap as unknown as Record<string, unknown>)[k] = tables[i].map(fromRow);
    });
    const role = snap.userRoles.find((r) => r.userId === user.id && r.active);
    if (!role) {
      this.snapshot = null;
      this.me = null;
      throw new NoAccessError(user.email);
    }
    this.me = { user, role };
    this.snapshot = snap;
    return structuredClone(snap);
  }

  protected async current(): Promise<LeadFinderSnapshot> {
    return this.snapshot ?? (await this.loadSnapshot());
  }

  protected async change<T>(permission: Permission, fn: (s: LeadFinderSnapshot, m: MutationContext) => T): Promise<T> {
    const before = this.snapshot ?? (await this.loadSnapshot(), this.snapshot!);
    const me = this.me!;
    if (!can(me.role.role, permission)) {
      throw new RepositoryError(
        `Your role (${APP_ROLE_LABEL[me.role.role]}) can look at leads but can't change them.`,
        "Ask an Owner or Manager to make this change.",
      );
    }
    const draft = structuredClone(before);
    const m: MutationContext = { now: this.now(), by: me.role.displayName || me.user.email, newId: () => newUuid(), isDemo: false };
    const result = fn(draft, m); // business-rule errors are thrown here, before anything is sent
    recordScoreChanges(draft, m, resolveScoringSettings(draft.settings));
    const changes = computeChanges(before, draft);
    if (isEmptyChangeSet(changes)) return result;

    try {
      await this.db.applyChanges(changes);
    } catch (err) {
      const explained = explainDbError(err, "save");
      // After a conflict, load the latest so the next attempt starts from what the database holds.
      if (err instanceof DbError && err.kind === "conflict") await this.loadSnapshot().catch(() => undefined);
      throw explained;
    }
    // Saved. Reload so dates, triggers and other people's changes are exactly as stored.
    await this.loadSnapshot().catch(() => {
      // The save itself succeeded; a failed refresh is not a failed save. The store reloads again.
      this.snapshot = draft;
    });
    return result;
  }
}
