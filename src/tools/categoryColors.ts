import type { CategoryId } from "./types";

export interface CategoryColor {
  text: string;
  bg: string;
  bgSolid: string;
  border: string;
  hoverBorder: string;
  ring: string;
}

/** One accent color per category, used to color-code icons, badges and active nav state. */
export const CATEGORY_COLORS: Record<CategoryId, CategoryColor> = {
  quick: { text: "text-amber-500", bg: "bg-amber-500/10", bgSolid: "bg-amber-500", border: "border-amber-500/30", hoverBorder: "hover:border-amber-500/50", ring: "ring-amber-500/30" },
  data: { text: "text-blue-500", bg: "bg-blue-500/10", bgSolid: "bg-blue-500", border: "border-blue-500/30", hoverBorder: "hover:border-blue-500/50", ring: "ring-blue-500/30" },
  api: { text: "text-sky-500", bg: "bg-sky-500/10", bgSolid: "bg-sky-500", border: "border-sky-500/30", hoverBorder: "hover:border-sky-500/50", ring: "ring-sky-500/30" },
  security: { text: "text-red-500", bg: "bg-red-500/10", bgSolid: "bg-red-500", border: "border-red-500/30", hoverBorder: "hover:border-red-500/50", ring: "ring-red-500/30" },
  healthcare: { text: "text-rose-500", bg: "bg-rose-500/10", bgSolid: "bg-rose-500", border: "border-rose-500/30", hoverBorder: "hover:border-rose-500/50", ring: "ring-rose-500/30" },
  integration: { text: "text-violet-500", bg: "bg-violet-500/10", bgSolid: "bg-violet-500", border: "border-violet-500/30", hoverBorder: "hover:border-violet-500/50", ring: "ring-violet-500/30" },
  testing: { text: "text-emerald-500", bg: "bg-emerald-500/10", bgSolid: "bg-emerald-500", border: "border-emerald-500/30", hoverBorder: "hover:border-emerald-500/50", ring: "ring-emerald-500/30" },
  devops: { text: "text-cyan-500", bg: "bg-cyan-500/10", bgSolid: "bg-cyan-500", border: "border-cyan-500/30", hoverBorder: "hover:border-cyan-500/50", ring: "ring-cyan-500/30" },
  database: { text: "text-indigo-500", bg: "bg-indigo-500/10", bgSolid: "bg-indigo-500", border: "border-indigo-500/30", hoverBorder: "hover:border-indigo-500/50", ring: "ring-indigo-500/30" },
  messaging: { text: "text-pink-500", bg: "bg-pink-500/10", bgSolid: "bg-pink-500", border: "border-pink-500/30", hoverBorder: "hover:border-pink-500/50", ring: "ring-pink-500/30" },
  diagnostics: { text: "text-orange-500", bg: "bg-orange-500/10", bgSolid: "bg-orange-500", border: "border-orange-500/30", hoverBorder: "hover:border-orange-500/50", ring: "ring-orange-500/30" },
  ai: { text: "text-fuchsia-500", bg: "bg-fuchsia-500/10", bgSolid: "bg-fuchsia-500", border: "border-fuchsia-500/30", hoverBorder: "hover:border-fuchsia-500/50", ring: "ring-fuchsia-500/30" },
  snippets: { text: "text-teal-500", bg: "bg-teal-500/10", bgSolid: "bg-teal-500", border: "border-teal-500/30", hoverBorder: "hover:border-teal-500/50", ring: "ring-teal-500/30" },
  projects: { text: "text-lime-500", bg: "bg-lime-500/10", bgSolid: "bg-lime-500", border: "border-lime-500/30", hoverBorder: "hover:border-lime-500/50", ring: "ring-lime-500/30" },
  commands: { text: "text-slate-500", bg: "bg-slate-500/10", bgSolid: "bg-slate-500", border: "border-slate-500/30", hoverBorder: "hover:border-slate-500/50", ring: "ring-slate-500/30" },
};
