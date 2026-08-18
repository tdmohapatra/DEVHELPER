/**
 * Offline LLM hub: turn a folder of downloaded GGUF files into a pickable list,
 * and turn a pick into a llama.cpp server command line.
 *
 * Everything here is pure. The folder walk is `list_files` (already in Rust for
 * the PHI scanner) and the process spawn is `commands/llm.rs`; what is left —
 * which files count, what a file is called, what the server should be told — is
 * string work, and string work belongs where it can be tested.
 *
 * The naming conventions this parses are not a standard. They are what the
 * community publishes: `Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf`,
 * `qwen2.5-coder-7b-instruct-q5_k_m.gguf`, `Mixtral-8x7B-v0.1.IQ3_XS.gguf`.
 * A file that fits none of them is still listed — an unparsed name is a display
 * problem, not a reason to hide a model the user downloaded on purpose.
 */

/** The default hub. The user can point somewhere else in Settings. */
export const DEFAULT_HUB_DIR = "C:/TDM/TDM_OFFLINE_LLMHUB";

/** Where the runtime is looked for inside the hub, if it is not on PATH. */
export const RUNTIME_SUBDIR = "runtime";

/** One entry from the Rust `list_files` command. */
export interface ScannedFile {
  path: string;
  name: string;
  isDir: boolean;
  size: number;
}

/**
 * Names that mean "this file makes vectors, not sentences".
 *
 * Embedding models are published in GGUF exactly like chat models and sit in the
 * same folder, but they have no chat template: llama-server loads one happily
 * and then refuses `/v1/chat/completions`. Nothing in the file name is
 * authoritative — the truth is in the GGUF metadata, which is not worth parsing
 * a 1GB header for — so this is a naming heuristic, used only to label the list
 * and to keep the user from picking one for chat.
 */
const EMBEDDING_HINTS = [
  "embed", "embedding", "bge-", "bge_", "gte-", "e5-", "minilm",
  "nomic-embed", "jina-embed", "mxbai-embed", "arctic-embed", "stella-",
];

/** What the model is for. `chat` is the assumption when nothing says otherwise. */
export type ModelKind = "chat" | "embedding";

/** Does this file name look like an embedding model? */
export function guessModelKind(file: string): ModelKind {
  const n = file.toLowerCase();
  return EMBEDDING_HINTS.some((h) => n.includes(h)) ? "embedding" : "chat";
}

export interface LocalModel {
  /** Absolute path to the file llama-server should be given. */
  path: string;
  /** File name as it is on disk (the first shard, for a split model). */
  file: string;
  /** Display name: the file name with extension, shard and quant removed. */
  name: string;
  /** `Q4_K_M`, `IQ3_XS`, `F16`… or null when the name does not say. */
  quant: string | null;
  /** `8B`, `8x7B`, `1.5B`… or null when the name does not say. */
  params: string | null;
  /** Chat model or embedding model, guessed from the name. */
  kind: ModelKind;
  /** Total bytes, summed across shards. */
  size: number;
  /** How many files make up this model. 1 for the usual case. */
  shards: number;
  /** Set when the shard set is incomplete — the model will not load. */
  problem: string | null;
}

const SHARD_RE = /-(\d{5})-of-(\d{5})\.gguf$/i;
const QUANT_RE = /^(?:I?Q\d+(?:_[A-Z0-9]+)*|F16|FP16|BF16|F32)$/i;
const PARAM_RE = /^\d+(?:\.\d+)?[BM]$|^\d+x\d+(?:\.\d+)?B$/i;

/** Is this a file llama.cpp can load directly? */
export function isGguf(name: string): boolean {
  return name.toLowerCase().endsWith(".gguf");
}

/**
 * Split a GGUF file name into its parts.
 *
 * Tokens are separated by `-` or `.`, and the separator that arrived is the one
 * put back, so `Mixtral-8x7B-v0.1` survives the round trip. Underscore is NOT a
 * separator here: it is the character *inside* a quant name (`Q4_K_M`,
 * `IQ3_XS`), and splitting on it turned every quant into three unrecognisable
 * fragments.
 */
export function parseModelName(file: string): { name: string; quant: string | null; params: string | null } {
  const base = file.replace(SHARD_RE, "").replace(/\.gguf$/i, "");
  const tokens = base.split(/([-.])/); // keep separators, odd indices
  const words = tokens.filter((_, i) => i % 2 === 0);

  let quant: string | null = null;
  let params: string | null = null;
  const kept: boolean[] = words.map((w) => {
    if (!quant && QUANT_RE.test(w)) {
      quant = w.toUpperCase();
      return false;
    }
    if (!params && PARAM_RE.test(w)) {
      // Kept in the name as well: "Llama 3.1 8B" reads better than "Llama 3.1".
      params = w.toUpperCase();
      return true;
    }
    return true;
  });

  let name = "";
  for (let i = 0; i < words.length; i++) {
    if (!kept[i]) continue;
    if (name) name += tokens[i * 2 - 1] ?? "-";
    name += words[i];
  }
  return { name: name || base, quant, params };
}

/**
 * Turn a flat scan of the hub folder into the model list.
 *
 * Split models (`…-00001-of-00003.gguf`) collapse to one entry pointing at the
 * first shard, which is the only path llama.cpp wants — it opens the rest
 * itself. A set missing a shard is still listed, with the problem stated,
 * because a half-downloaded model is exactly the thing a user needs told.
 */
export function modelsFromScan(files: ScannedFile[]): LocalModel[] {
  const singles: LocalModel[] = [];
  const groups = new Map<string, { files: ScannedFile[]; total: number; first: ScannedFile | null }>();

  for (const f of files) {
    if (f.isDir || !isGguf(f.name)) continue;
    const shard = SHARD_RE.exec(f.name);
    if (!shard) {
      const { name, quant, params } = parseModelName(f.name);
      singles.push({
        path: f.path, file: f.name, name, quant, params,
        kind: guessModelKind(f.name),
        size: f.size, shards: 1, problem: null,
      });
      continue;
    }
    // Group on the directory as well: two different split models can share a
    // stem in two different folders.
    const stem = f.path.slice(0, f.path.length - f.name.length) + f.name.replace(SHARD_RE, "");
    const g = groups.get(stem) ?? { files: [], total: 0, first: null };
    g.files.push(f);
    g.total += f.size;
    if (Number(shard[1]) === 1) g.first = f;
    groups.set(stem, g);
  }

  const split: LocalModel[] = [];
  for (const [, g] of groups) {
    const head = g.first ?? g.files[0];
    const expected = Number(SHARD_RE.exec(head.name)![2]);
    const { name, quant, params } = parseModelName(head.name);
    split.push({
      path: head.path,
      file: head.name,
      name, quant, params,
      kind: guessModelKind(head.name),
      size: g.total,
      shards: g.files.length,
      problem:
        !g.first ? `first shard (00001-of-${String(expected).padStart(5, "0")}) is missing`
        : g.files.length !== expected ? `${g.files.length} of ${expected} shards present`
        : null,
    });
  }

  return [...singles, ...split].sort((a, b) => a.name.localeCompare(b.name) || (a.quant ?? "").localeCompare(b.quant ?? ""));
}

/** Human size. Models are gigabytes, so this starts at MB. */
export function formatModelSize(bytes: number): string {
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${gb.toFixed(gb >= 10 ? 0 : 1)} GB`;
  return `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`;
}

/** `Meta-Llama-3.1-8B-Instruct · Q4_K_M · 4.6 GB` */
export function describeModel(m: LocalModel): string {
  return [m.name, m.quant, formatModelSize(m.size), m.kind === "embedding" ? "embedding" : null, m.shards > 1 ? `${m.shards} shards` : null]
    .filter(Boolean)
    .join(" · ");
}

export interface ServerOptions {
  modelPath: string;
  port: number;
  /** Context window. 0 asks llama.cpp for the model's trained maximum. */
  ctxSize?: number;
  /**
   * Layers to offload to the GPU. -1 means all, 0 means CPU only.
   * There is no safe default across machines, so the caller states one.
   */
  gpuLayers?: number;
  /** The name the OpenAI-compatible API answers to. */
  alias?: string;
  threads?: number;
}

/**
 * The llama-server command line.
 *
 * `--host 127.0.0.1` is not configurable on purpose: a local model exists so
 * that prompts stay on this machine, and a server bound to 0.0.0.0 quietly
 * undoes that for everyone on the network.
 */
export function serverArgs(o: ServerOptions): string[] {
  const args = [
    "--model", o.modelPath,
    "--host", "127.0.0.1",
    "--port", String(o.port),
    "--ctx-size", String(o.ctxSize ?? 4096),
    "--n-gpu-layers", String(o.gpuLayers ?? 0),
  ];
  if (o.threads && o.threads > 0) args.push("--threads", String(o.threads));
  if (o.alias) args.push("--alias", o.alias);
  return args;
}

/** OpenAI-compatible base URL for a running local server. */
export function localBaseUrl(port: number): string {
  return `http://127.0.0.1:${port}/v1`;
}

/** llama-server's readiness endpoint. 200 means the model is loaded. */
export function localHealthUrl(port: number): string {
  return `http://127.0.0.1:${port}/health`;
}

/**
 * Model name to send in the request body.
 *
 * llama-server serves one model and accepts any name for it, but sending the
 * alias keeps request logs readable and matches what `/v1/models` reports.
 */
export function localModelAlias(m: Pick<LocalModel, "name" | "quant"> | null): string {
  if (!m) return "local-model";
  return m.quant ? `${m.name}-${m.quant}` : m.name;
}

/** Candidate runtime locations, in the order they should be tried. */
export function runtimeCandidates(hubDir: string, explicit?: string): string[] {
  const hub = hubDir.replace(/[/\\]+$/, "");
  const out = explicit ? [explicit] : [];
  out.push(`${hub}/${RUNTIME_SUBDIR}/llama-server.exe`);
  out.push(`${hub}/llama-server.exe`);
  return out;
}

/**
 * Why the offline provider cannot start yet, or null when it can.
 * One reason at a time, in the order the user has to fix them.
 */
export function offlineProblem(state: {
  hubDir: string;
  runtimePath: string | null;
  modelPath: string;
  models: LocalModel[];
}): string | null {
  if (!state.hubDir.trim()) return "Set the model folder.";
  if (!state.models.length) return `No .gguf files under ${state.hubDir}.`;
  if (!state.modelPath) return "Pick a model.";
  const picked = state.models.find((m) => m.path === state.modelPath);
  if (!picked) return "The selected model is no longer in the folder. Refresh and pick again.";
  if (picked.problem) return `That model is incomplete: ${picked.problem}.`;
  // An embedding model has no chat template. Starting it would succeed and then
  // every AI tool would fail on its first prompt, which is a worse outcome than
  // saying so here.
  if (picked.kind === "embedding") return `${picked.name} is an embedding model — it makes vectors, not answers. Pick an instruct or chat model.`;
  if (!state.runtimePath) return "llama-server.exe was not found. Put llama.cpp's Windows build in the runtime folder, or set the path.";
  return null;
}
