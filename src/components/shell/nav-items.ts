import type { IconType } from "react-icons";
import {
  LuBuilding2,
  LuDatabase,
  LuHandshake,
  LuKanban,
  LuList,
  LuListTodo,
  LuMap,
  LuSearch,
  LuSettings,
  LuSunrise,
} from "react-icons/lu";

export interface NavItem {
  href: string;
  label: string;
  icon: IconType;
  /** Phase where the screen gets its full functionality. */
  phase: number;
}

/** Screens built up to and including this phase are live; later ones show "Soon". */
export const CURRENT_PHASE = 3;

export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Today", icon: LuSunrise, phase: 1 },
  { href: "/lead-finder", label: "Lead Finder", icon: LuSearch, phase: 3 },
  { href: "/map", label: "Map", icon: LuMap, phase: 8 },
  { href: "/leads", label: "Leads", icon: LuList, phase: 3 },
  { href: "/pipeline", label: "Pipeline", icon: LuKanban, phase: 7 },
  { href: "/follow-ups", label: "Follow-Ups", icon: LuListTodo, phase: 7 },
  { href: "/companies", label: "Companies", icon: LuHandshake, phase: 4 },
  { href: "/properties", label: "Properties", icon: LuBuilding2, phase: 4 },
  { href: "/sources", label: "Sources", icon: LuDatabase, phase: 9 },
  { href: "/settings", label: "Settings", icon: LuSettings, phase: 1 },
];

export const APP_NAME = "Traylor Pro Commercial Lead Finder";
