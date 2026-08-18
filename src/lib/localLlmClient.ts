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
import {
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

/** One health probe. `true` only for a 200 — llama.cpp returns 503 while loading. */
async function healthy(port: number): Promise<boolean> {
  try {
    const res = await executeRequest({ method: "GET", url: localHealthUrl(port), headers: {}, body: undefined });
    return res.status === 200;
  } catch {
    return false;
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
  while (Date.now() < deadline) {
    if (await healthy(port)) {
      useAiStore.getState().set({
        localPort: port,
        localRunning: true,
        localModelPath: o.model.path,
        localModelLabel: localModelAlias(o.model),
      });
      return port;
    }
    status = await serverStatus();
    o.onProgress?.(status);
    if (!status.running) {
      // The child is gone. Its last lines say why; a bare "exited with code 1"
      // helps nobody.
      const tail = status.log.slice(-12);
      throw new LocalLlmError(`llama-server ${status.exit ?? "stopped"} before it was ready.`, tail);
    }
    await new Promise((r) => setTimeout(r, 700));
  }

  await stopServer();
  throw new LocalLlmError("The model did not finish loading in time. Try a smaller quant, or raise the timeout.");
}
