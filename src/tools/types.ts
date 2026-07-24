import type { LucideIcon } from "lucide-react";
import type { ComponentType } from "react";

/** Sidebar categories. Order here drives sidebar order. */
export const CATEGORIES = [
  { id: "quick", label: "Quick Tools", icon: "Zap" },
  { id: "data", label: "Data & Code", icon: "Braces" },
  { id: "api", label: "API", icon: "Globe" },
  { id: "security", label: "Security", icon: "ShieldCheck" },
  { id: "healthcare", label: "Healthcare Integration", icon: "HeartPulse" },
  { id: "integration", label: "Integration", icon: "Plug" },
  { id: "testing", label: "Testing", icon: "FlaskConical" },
  { id: "devops", label: "DevOps", icon: "Container" },
  { id: "database", label: "Database", icon: "Database" },
  { id: "messaging", label: "Messaging", icon: "MessagesSquare" },
  { id: "diagnostics", label: "Diagnostics", icon: "Activity" },
  { id: "ai", label: "AI Assistant", icon: "Bot" },
  { id: "snippets", label: "Snippets", icon: "Code" },
  { id: "projects", label: "Project Profiles", icon: "FolderKanban" },
  { id: "commands", label: "Command Reference", icon: "TerminalSquare" },
] as const;

export type CategoryId = (typeof CATEGORIES)[number]["id"];

export interface Tool {
  /** Stable unique id, e.g. "json-formatter". */
  id: string;
  name: string;
  description: string;
  category: CategoryId;
  icon: LucideIcon;
  /** Extra search terms for the command palette. */
  keywords: string[];
  /** Route path, e.g. "/tools/json-formatter". */
  route: string;
  /** Optional default keyboard shortcut, display only for now. */
  shortcut?: string;
  /** The tool's screen. */
  component: ComponentType;
  /** Marks tools that only work in the desktop (Tauri) build. */
  requiresNative?: boolean;
}
