/**
 * Drive the local model server: scan the hub, find the runtime, start, wait,
 * stop.
 *
 * The waiting is the part worth reading. `llm_start` returns as soon as the
 * process exists, which is seconds before the model is loaded and can be
 * minutes before a 20GB one is. So starting is not "spawn and hope": it polls
 * `/health` until llama.cpp says ready, and while it polls it watches the
 * child, because the other way this ends is the process exiting — a wrong CUDA
 * build, a truncated download, a context size the model refuses. When that
 * happens the server's own last words are the error, not a timeout.
 */
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./platform";
import { executeRequest } from "./http";
import { useAiStore } from "@/stores/useAiStore";
import { modelDestination, type CatalogModel } from "@/tools/lib/modelCatalog";
import {
  parseRelease,
  pickRuntimeAsset,
  RUNTIME_RELEASE_API,
  type ReleaseAsset,
  type RuntimeFlavor,
} from "@/tools/lib/llamaRelease";
import {
  RUNTIME_SUBDIR,
  localHealthUrl,
  localModelAlias,
  modelsFromScan,
  runtimeCandidates,
  serverArgs,
  type LocalModel,
  type ScannedFile,
} from "@/tools/lib/localLlm";

export interface LlmStatus {
  running: boolean;
  pid: number | null;
  port: number | null;
  model: string | null;
  runtime: string | null;
  log: string[];
  exit: string | null;
}

const IDLE: LlmStatus = { running: false, pid: null, port: null, model: null, runtime: null, log: [], exit: null };

export class LocalLlmError extends Error {
  /** The server's own output, when it produced any. */
  readonly log: string[];
  constructor(message: string, log: string[] = []) {
    super(message);
    this.name = "LocalLlmError";
    this.log = log;
  }
}

function requireTauri(): void {
  if (!isTauri()) throw new LocalLlmError("Local models need the desktop app — the browser cannot start a process.");
}

/** All the .gguf files under the hub folder. */
export async function scanModels(hubDir: string): Promise<LocalModel[]> {
  requireTauri();
  // Depth 3 covers the shape people actually end up with: hub/, hub/Publisher/,
  // hub/Publisher/Model/. Deeper than that and a scan of a drive root becomes
  // possible by typing one wrong path.
  const files = await invoke<ScannedFile[]>("list_files", { root: hubDir, maxDepth: 3, maxEntries: 4000 });
  return modelsFromScan(files);
}

/** Locate llama-server, or null. */
export async function findRuntime(hubDir: string, explicit?: string): Promise<string | null> {
  requireTauri();
  const candidates = runtimeCandidates(hubDir, explicit?.trim() || undefined);
  return (await invoke<string | null>("llm_find_runtime", { candidates })) ?? null;
}

export async function serverStatus(): Promise<LlmStatus> {
  if (!isTauri()) return IDLE;
  return await invoke<LlmStatus>("llm_status");
}

export async function stopServer(): Promise<void> {
  if (isTauri()) await invoke<LlmStatus>("llm_stop");
  useAiStore.getState().set({ localRunning: false, localPort: 0 });
}

/**
 * One health probe. Ready only on a 200 — llama.cpp answers 503 while loading.
 *
 * The reason comes back with it rather than being swallowed. The first version
 * returned a bare `false` for every outcome, and when the probe itself was being
 * refused — the HTTP scope in `capabilities/default.json` allowed `http://**`,
 * which matches only the protocol's default port, so nothing on a real port ever
 * got through — the panel showed "loading" until the timeout while the server sat
 * there answering curl. An error that cannot be seen costs a build to find.
 */
async function probe(port: number): Promise<{ ready: boolean; error?: string }> {
  try {
    const res = await executeRequest({ method: "GET", url: localHealthUrl(port), headers: {}, body: undefined });
    if (res.status === 200) return { ready: true };
    // 503 is the model still loading, and is not worth reporting as a problem.
    return { ready: false, error: res.status === 503 ? undefined : `health check answered ${res.status}` };
  } catch (e) {
    return { ready: false, error: `health check failed: ${(e as Error).message}` };
  }
}

export interface StartOptions {
  model: LocalModel;
  hubDir: string;
  runtimePath?: string;
  ctxSize?: number;
  gpuLayers?: number;
  threads?: number;
  /** Giving up point. Big models on a cold disk really do take minutes. */
  timeoutMs?: number;
  onProgress?: (status: LlmStatus) => void;
}

/**
 * Start the server and return the port once it is answering.
 *
 * Also writes the port into the AI store, because "configured" for the local
 * provider means "a server is up", and this function is the only thing that
 * knows when that became true.
 */
export async function startServer(o: StartOptions): Promise<number> {
  requireTauri();
  if (o.model.problem) throw new LocalLlmError(`${o.model.name}: ${o.model.problem}`);

  const runtime = await findRuntime(o.hubDir, o.runtimePath);
  if (!runtime) {
    throw new LocalLlmError(
      "llama-server.exe was not found. Put llama.cpp's Windows build in the hub's runtime folder, or set the path in Settings.",
    );
  }

  const port = await invoke<number>("llm_free_port");
  const args = serverArgs({
    modelPath: o.model.path,
    port,
    ctxSize: o.ctxSize,
    gpuLayers: o.gpuLayers,
    threads: o.threads,
    alias: localModelAlias(o.model),
  });

  let status = await invoke<LlmStatus>("llm_start", { runtime, args, port, model: o.model.path });
  o.onProgress?.(status);

  const deadline = Date.now() + (o.timeoutMs ?? 300_000);
  let lastProbeError: string | undefined;
  while (Date.now() < deadline) {
    const health = await probe(port);
    lastProbeError = health.error ?? lastProbeError;
    if (health.ready) {
      useAiStore.getState().set({
        localPort: port,
        localRunning: true,
        localModelPath: o.model.path,
        localModelLabel: localModelAlias(o.model),
      });
      return port;
    }
    status = await serverStatus();
    o.onProgress?.(health.error ? { ...status, log: [...status.log, health.error] } : status);
    if (!status.running) {
      // The child is gone. Its last lines say why; a bare "exited with code 1"
      // helps nobody.
      const tail = status.log.slice(-12);
      throw new LocalLlmError(`llama-server ${status.exit ?? "stopped"} before it was ready.`, tail);
    }
    await new Promise((r) => setTimeout(r, 700));
  }

  await stopServer();
  throw new LocalLlmError(
    lastProbeError
      ? `The server started but DevHelper could not talk to it: ${lastProbeError}`
      : "The model did not finish loading in time. Try a smaller quant, or raise the timeout.",
  );
}

/**
 * Install the llama.cpp runtime into the hub's `runtime` folder.
 *
 * Two steps, deliberately separate: `fetchRuntimeChoice` asks GitHub what the
 * latest release contains and returns the exact file it would download, so the
 * UI can show the user what they are agreeing to; `installRuntime` is what runs
 * after they agree. Nothing is downloaded by the first step.
 */
export interface RuntimeChoice {
  tag: string;
  flavor: RuntimeFlavor;
  asset: ReleaseAsset;
  /** Where it will be unpacked. */
  dest: string;
}

export async function fetchRuntimeChoice(hubDir: string, flavor?: RuntimeFlavor): Promise<RuntimeChoice> {
  requireTauri();
  const res = await executeRequest({
    method: "GET",
    url: RUNTIME_RELEASE_API,
    // The API answers without a token for public repos, but it wants a UA.
    headers: { Accept: "application/vnd.github+json", "User-Agent": "DevHelper" },
    body: undefined,
  });
  if (!res.ok) throw new LocalLlmError(`Could not reach GitHub to list llama.cpp releases (${res.status}).`);

  const release = parseRelease(JSON.parse(res.body));
  // CPU unless the caller says otherwise. There is no reliable GPU probe on this
  // side — `check_environment` reports toolchains, not adapters — and guessing
  // wrong installs a build that starts and then cannot load a model. The UI
  // offers the other backends explicitly instead.
  const chosen = flavor ?? "cpu";
  const asset = pickRuntimeAsset(release.assets, chosen);
  if (!asset) throw new LocalLlmError(`Release ${release.tag} has no Windows ${chosen} build.`);

  return { tag: release.tag, flavor: chosen, asset, dest: runtimeDir(hubDir) };
}

export async function installRuntime(choice: RuntimeChoice): Promise<string> {
  requireTauri();
  const report = await invoke<{ runtime: string; files: number; bytes: number }>("llm_install_runtime", {
    url: choice.asset.url,
    dest: choice.dest,
    expectedSha256: choice.asset.digest ?? null,
  });
  return report.runtime;
}

/** `<hub>/runtime` — the folder the discovery order looks in first. */
export function runtimeDir(hubDir: string): string {
  return `${hubDir.replace(/[/\\]+$/, "")}/${RUNTIME_SUBDIR}`;
}

/** Make sure the hub folder exists. Quiet no-op when it already does. */
export async function ensureHubDir(hubDir: string): Promise<void> {
  if (!isTauri()) return;
  await invoke("llm_ensure_dir", { path: hubDir });
}

export interface DownloadProgress {
  received: number;
  total: number;
  done: boolean;
}

/**
 * Download a catalogue model into the hub folder.
 *
 * Progress arrives as Rust events rather than a return value, because the point
 * of a two-gigabyte download is that the user can see it moving. The listener is
 * attached before the download starts and detached whatever happens — a leaked
 * listener would keep updating a progress bar that belongs to a screen the user
 * has left.
 */
export async function downloadCatalogModel(
  hubDir: string,
  model: CatalogModel,
  onProgress?: (p: DownloadProgress) => void,
): Promise<string> {
  requireTauri();
  await ensureHubDir(hubDir);

  const { listen } = await import("@tauri-apps/api/event");
  const un = await listen<DownloadProgress>("llm://download", (e) => onProgress?.(e.payload));
  try {
    return await invoke<string>("llm_download_model", {
      url: model.url,
      dest: modelDestination(hubDir, model),
    });
  } finally {
    un();
  }
}
