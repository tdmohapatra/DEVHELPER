import { describe, expect, it } from "vitest";
import {
  describeAsset,
  parseRelease,
  pickRuntimeAsset,
  type ReleaseAsset,
} from "./llamaRelease";

/** The real asset list of release b10472, trimmed to the Windows x64 entries. */
const REAL_ASSETS: ReleaseAsset[] = [
  { name: "cudart-llama-bin-win-cuda-12.4-x64.zip", url: "u1", size: 391_000_000 },
  { name: "llama-b10472-bin-win-cpu-x64.zip", url: "u2", size: 18_454_937, digest: "sha256:abc" },
  { name: "llama-b10472-bin-win-cuda-12.4-x64.zip", url: "u3", size: 250_000_000 },
  { name: "llama-b10472-bin-win-vulkan-x64.zip", url: "u4", size: 34_800_000 },
  { name: "llama-b10472-bin-win-rocm-7.14-x64.zip", url: "u5", size: 196_000_000 },
  { name: "llama-b10472-bin-macos-arm64.zip", url: "u6", size: 10_000_000 },
];

describe("parseRelease", () => {
  it("takes the tag and the download URLs, ignoring everything else", () => {
    const r = parseRelease({
      tag_name: "b10472",
      html_url: "ignored",
      assets: [{ name: "a.zip", browser_download_url: "https://x/a.zip", size: 12, digest: "sha256:d", other: 1 }],
    });
    expect(r.tag).toBe("b10472");
    expect(r.assets).toEqual([{ name: "a.zip", url: "https://x/a.zip", size: 12, digest: "sha256:d" }]);
  });

  it("survives a response with no assets rather than throwing", () => {
    expect(parseRelease({}).assets).toEqual([]);
  });
});

describe("pickRuntimeAsset", () => {
  it("finds the CPU build", () => {
    expect(pickRuntimeAsset(REAL_ASSETS, "cpu")?.name).toBe("llama-b10472-bin-win-cpu-x64.zip");
  });

  it("finds the CUDA build and not the CUDA redistributable", () => {
    // `cudart-…` is NVIDIA's runtime DLLs, not llama.cpp. Installing it gives a
    // runtime folder with no server in it.
    expect(pickRuntimeAsset(REAL_ASSETS, "cuda")?.name).toBe("llama-b10472-bin-win-cuda-12.4-x64.zip");
  });

  it("finds the Vulkan build", () => {
    expect(pickRuntimeAsset(REAL_ASSETS, "vulkan")?.name).toBe("llama-b10472-bin-win-vulkan-x64.zip");
  });

  it("never returns a build for another platform", () => {
    const macOnly = REAL_ASSETS.filter((a) => a.name.includes("macos"));
    expect(pickRuntimeAsset(macOnly, "cpu")).toBeNull();
  });

  it("is null when the release has no matching flavour", () => {
    const noVulkan = REAL_ASSETS.filter((a) => !a.name.includes("vulkan"));
    expect(pickRuntimeAsset(noVulkan, "vulkan")).toBeNull();
  });
});

describe("describeAsset", () => {
  it("names the file and its size, so the confirmation is specific", () => {
    expect(describeAsset(REAL_ASSETS[1])).toBe("llama-b10472-bin-win-cpu-x64.zip · 17.6 MB");
  });
});
