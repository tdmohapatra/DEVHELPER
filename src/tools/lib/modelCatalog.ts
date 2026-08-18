/**
 * A short list of chat models DevHelper can fetch for you.
 *
 * Not a browser for Hugging Face. The point of the list is that a new machine can
 * get from "nothing installed" to "AI works" without the user having to know what
 * a quant is, which repo is trustworthy, or which of nine files in a release is
 * the one they want. Three sizes, all instruct-tuned, all Q4_K_M — the quant that
 * is small enough to be worth downloading and good enough to be worth running.
 *
 * Sizes are the real byte counts of these files, so the confirmation can state
 * what it is about to spend before it spends it. They are checked against the
 * server's own content-length while downloading, and a mismatch fails the
 * download rather than leaving a truncated file that looks like a model.
 */

export interface CatalogModel {
  id: string;
  /** What to show in the list. */
  name: string;
  /** Parameter count, as published. */
  params: string;
  quant: string;
  /** Exact size in bytes. */
  size: number;
  /** Filename it lands under in the hub folder. */
  file: string;
  /** Direct download URL. Rust re-checks the host before fetching. */
  url: string;
  /** Who published it, for the confirmation. */
  source: string;
  /** One line on when to pick this one. */
  note: string;
}

const HF = "https://huggingface.co";

export const MODEL_CATALOG: CatalogModel[] = [
  {
    id: "qwen2.5-3b-instruct-q4km",
    name: "Qwen2.5 3B Instruct",
    params: "3B",
    quant: "Q4_K_M",
    size: 1_929_903_264,
    file: "Qwen2.5-3B-Instruct-Q4_K_M.gguf",
    url: `${HF}/bartowski/Qwen2.5-3B-Instruct-GGUF/resolve/main/Qwen2.5-3B-Instruct-Q4_K_M.gguf?download=true`,
    source: "bartowski on Hugging Face",
    note: "Fast on any laptop CPU. Good for explanations, summaries and short code.",
  },
  {
    id: "qwen2.5-7b-instruct-q4km",
    name: "Qwen2.5 7B Instruct",
    params: "7B",
    quant: "Q4_K_M",
    size: 4_683_073_184,
    file: "Qwen2.5-7B-Instruct-Q4_K_M.gguf",
    url: `${HF}/bartowski/Qwen2.5-7B-Instruct-GGUF/resolve/main/Qwen2.5-7B-Instruct-Q4_K_M.gguf?download=true`,
    source: "bartowski on Hugging Face",
    note: "Noticeably better answers. Slower without a GPU — a few words a second.",
  },
  {
    id: "qwen2.5-coder-7b-instruct-q4km",
    name: "Qwen2.5 Coder 7B Instruct",
    params: "7B",
    quant: "Q4_K_M",
    size: 4_683_071_776,
    file: "Qwen2.5-Coder-7B-Instruct-Q4_K_M.gguf",
    url: `${HF}/bartowski/Qwen2.5-Coder-7B-Instruct-GGUF/resolve/main/Qwen2.5-Coder-7B-Instruct-Q4_K_M.gguf?download=true`,
    source: "bartowski on Hugging Face",
    note: "Tuned for code review, SQL and stack traces rather than prose.",
  },
];

/** Look one up by id. */
export function catalogModel(id: string): CatalogModel | null {
  return MODEL_CATALOG.find((m) => m.id === id) ?? null;
}

/**
 * Which one to offer first.
 *
 * RAM is the constraint that actually bites: a 7B Q4 needs roughly 6GB resident
 * once the context is allocated, and a machine that swaps to run it is worse than
 * one running the 3B. With no reading available, the small one is the safe offer.
 */
export function suggestedModel(ramGb?: number | null): CatalogModel {
  if (ramGb && ramGb >= 16) return MODEL_CATALOG[1];
  return MODEL_CATALOG[0];
}

/** `Qwen2.5 3B Instruct · Q4_K_M · 1.8 GB` */
export function describeCatalogModel(m: CatalogModel): string {
  return `${m.name} · ${m.quant} · ${(m.size / 1024 ** 3).toFixed(1)} GB`;
}

/** Where the file will land. */
export function modelDestination(hubDir: string, m: CatalogModel): string {
  return `${hubDir.replace(/[/\\]+$/, "")}/${m.file}`;
}

/** Percentage for a progress bar, clamped and safe when the total is unknown. */
export function downloadPercent(received: number, total: number): number | null {
  if (!total || total <= 0) return null;
  return Math.max(0, Math.min(100, Math.round((received / total) * 100)));
}

/** `1.2 GB of 1.8 GB` — or just what has arrived, when the size is unknown. */
export function downloadLabel(received: number, total: number): string {
  const gb = (n: number) => `${(n / 1024 ** 3).toFixed(1)} GB`;
  return total > 0 ? `${gb(received)} of ${gb(total)}` : gb(received);
}
