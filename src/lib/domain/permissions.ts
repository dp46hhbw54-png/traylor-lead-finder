import type { AppRole } from "./types";

/**
 * Who can do what. Enforced by the repository today (demo) and by Supabase RLS later —
 * the SQL policies in supabase/migrations/20261012000001_lead_finder_schema.sql follow this same table.
 */
export type Permission = "view" | "work_leads" | "edit_records" | "merge_records" | "manage_sources" | "manage_settings" | "manage_users";

const MATRIX: Record<AppRole, readonly Permission[]> = {
  owner: ["view", "work_leads", "edit_records", "merge_records", "manage_sources", "manage_settings", "manage_users"],
  manager: ["view", "work_leads", "edit_records", "merge_records", "manage_sources"],
  viewer: ["view"],
};

export function can(role: AppRole, permission: Permission): boolean {
  return MATRIX[role].includes(permission);
}
