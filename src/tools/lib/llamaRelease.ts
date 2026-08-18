/**
 * Choosing which llama.cpp build to install.
 *
 * The project publishes one Windows zip per backend on every release — CPU,
 * CUDA (two toolkit versions), Vulkan, ROCm, SYCL, OpenVINO — and picking the
 * wrong one produces a server that starts and then fails to load a model with an
 * error about a missing DLL. So the choice is made here, from the release
 * metadata, with the machine's own hardware as the input.
 *
 * `cpu` is the default rather than the fastest option on purpose: it depends on
 * nothing, and a runtime that works is worth more than one that might be quicker.
 */

/** The only project DevHelper installs a runtime from. Rust enforces this too. */
export const RUNTIME_REPO = "ggml-org/llama.cpp";
export const RUNTIME_RELEASE_API = `https://api.github.com/repos/${RUNTIME_REPO}/releases/latest`;

/** Backends we know how to pick, in the order they beat each other. */
export type RuntimeFlavor = "cuda" | "vulkan" | "cpu";

export interface ReleaseAsset {
  name: string;
  /** Direct download URL. */
  url: string;
  size: number;
  /** `sha256:…` when GitHub published one. Verified before anything is unpacked. */
  digest?: string | null;
}

export interface LlamaRelease {
  tag: string;
  assets: ReleaseAsset[];
}

/** Read the fields we use out of GitHub's release JSON, ignoring the rest. */
export function parseRelease(json: unknown): LlamaRelease {
  const r = json as { tag_name?: string; assets?: unknown[] };
  const assets: ReleaseAsset[] = (r.assets ?? []).map((a) => {
    const x = a as { name?: string; browser_download_url?: string; size?: number; digest?: string | null };
    return {
      name: x.name ?? "",
      url: x.browser_download_url ?? "",
      size: x.size ?? 0,
      digest: x.digest ?? null,
    };
  });
  return { tag: r.tag_name ?? "", assets };
}

/**
 * The asset for a flavour, or null when this release has none.
 *
 * Matching is on the name because that is the only thing that describes the
 * build: `llama-b10472-bin-win-cpu-x64.zip`. The `cudart-` archives are the CUDA
 * *redistributable* rather than llama.cpp, so they are excluded by requiring the
 * name to start with `llama-`.
 */
export function pickRuntimeAsset(assets: ReleaseAsset[], flavor: RuntimeFlavor): ReleaseAsset | null {
  const windows = assets.filter((a) => /^llama-.*-bin-win-.*-x64\.zip$/i.test(a.name));
  const match = (needle: RegExp) => windows.find((a) => needle.test(a.name)) ?? null;
  if (flavor === "cuda") return match(/-cuda-/i);
  if (flavor === "vulkan") return match(/-vulkan-/i);
  return match(/-cpu-/i);
}

/** `llama-b10472-bin-win-cpu-x64.zip · 17.6 MB` */
export function describeAsset(a: ReleaseAsset): string {
  return `${a.name} · ${(a.size / 1024 ** 2).toFixed(1)} MB`;
}

/** What the flavours mean, for the confirmation step. */
export const FLAVOR_LABELS: Record<RuntimeFlavor, string> = {
  cpu: "CPU only — works everywhere, no driver needed",
  cuda: "NVIDIA CUDA — needs an NVIDIA GPU and its driver",
  vulkan: "Vulkan — uses most GPUs, including integrated ones",
};
