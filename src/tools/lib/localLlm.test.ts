import { describe, expect, it } from "vitest";
import {
  describeModel,
  formatModelSize,
  isGguf,
  localBaseUrl,
  localHealthUrl,
  localModelAlias,
  guessModelKind,
  hubHint,
  modelsFromScan,
  offlineProblem,
  parseModelName,
  runtimeCandidates,
  serverArgs,
  type LocalModel,
  type ScannedFile,
} from "./localLlm";

const file = (path: string, size = 1024 ** 3): ScannedFile => ({
  path,
  name: path.split("/").pop()!,
  isDir: false,
  size,
});

describe("isGguf", () => {
  it("accepts .gguf in any case and nothing else", () => {
    expect(isGguf("model.gguf")).toBe(true);
    expect(isGguf("Model.GGUF")).toBe(true);
    expect(isGguf("model.safetensors")).toBe(false);
    expect(isGguf("model.gguf.part")).toBe(false);
  });
});

describe("parseModelName", () => {
  it("pulls the quant out of a dash-separated name", () => {
    expect(parseModelName("Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf")).toEqual({
      name: "Meta-Llama-3.1-8B-Instruct",
      quant: "Q4_K_M",
      params: "8B",
    });
  });

  it("handles lower case and a dot-separated quant", () => {
    expect(parseModelName("Mixtral-8x7B-v0.1.IQ3_XS.gguf")).toEqual({
      name: "Mixtral-8x7B-v0.1",
      quant: "IQ3_XS",
      params: "8X7B",
    });
  });

  it("upper-cases a lower-case quant but leaves the name alone", () => {
    const r = parseModelName("qwen2.5-coder-7b-instruct-q5_k_m.gguf");
    expect(r.quant).toBe("Q5_K_M");
    expect(r.name).toBe("qwen2.5-coder-7b-instruct");
  });

  it("recognises unquantised weights", () => {
    expect(parseModelName("phi-3-mini-f16.gguf").quant).toBe("F16");
    expect(parseModelName("phi-3-mini-BF16.gguf").quant).toBe("BF16");
  });

  it("keeps the whole name when nothing matches", () => {
    expect(parseModelName("my-finetune.gguf")).toEqual({
      name: "my-finetune",
      quant: null,
      params: null,
    });
  });

  it("drops the shard suffix before parsing", () => {
    expect(parseModelName("DeepSeek-V2-Q4_K_M-00001-of-00003.gguf").name).toBe("DeepSeek-V2");
  });

  it("does not mistake a version for a quant", () => {
    // v0.1 must not read as a quant, and 3.1 must not read as parameters.
    const r = parseModelName("Mistral-7B-v0.1-Q8_0.gguf");
    expect(r.quant).toBe("Q8_0");
    expect(r.name).toBe("Mistral-7B-v0.1");
  });
});

describe("modelsFromScan", () => {
  it("ignores directories and non-gguf files", () => {
    const out = modelsFromScan([
      { path: "C:/hub/sub", name: "sub", isDir: true, size: 0 },
      file("C:/hub/notes.txt"),
      file("C:/hub/llama-8b-Q4_K_M.gguf"),
    ]);
    expect(out.map((m) => m.file)).toEqual(["llama-8b-Q4_K_M.gguf"]);
  });

  it("collapses a shard set to the first shard and sums the size", () => {
    const out = modelsFromScan([
      file("C:/hub/big-Q4_K_M-00002-of-00003.gguf", 10),
      file("C:/hub/big-Q4_K_M-00001-of-00003.gguf", 20),
      file("C:/hub/big-Q4_K_M-00003-of-00003.gguf", 30),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].file).toBe("big-Q4_K_M-00001-of-00003.gguf");
    expect(out[0].size).toBe(60);
    expect(out[0].shards).toBe(3);
    expect(out[0].problem).toBeNull();
  });

  it("reports an incomplete shard set instead of hiding it", () => {
    const out = modelsFromScan([
      file("C:/hub/big-00001-of-00003.gguf"),
      file("C:/hub/big-00002-of-00003.gguf"),
    ]);
    expect(out[0].problem).toBe("2 of 3 shards present");
  });

  it("says so when the first shard — the only one llama.cpp is given — is absent", () => {
    const out = modelsFromScan([
      file("C:/hub/big-00002-of-00003.gguf"),
      file("C:/hub/big-00003-of-00003.gguf"),
    ]);
    expect(out[0].problem).toBe("first shard (00001-of-00003) is missing");
  });

  it("keeps two split models in different folders apart", () => {
    const out = modelsFromScan([
      file("C:/hub/a/big-00001-of-00002.gguf"),
      file("C:/hub/a/big-00002-of-00002.gguf"),
      file("C:/hub/b/big-00001-of-00002.gguf"),
      file("C:/hub/b/big-00002-of-00002.gguf"),
    ]);
    expect(out).toHaveLength(2);
    expect(out.every((m) => m.problem === null)).toBe(true);
  });

  it("sorts by name then quant so the same model's sizes sit together", () => {
    const out = modelsFromScan([
      file("C:/hub/zeta-Q4_K_M.gguf"),
      file("C:/hub/alpha-Q8_0.gguf"),
      file("C:/hub/alpha-Q4_K_M.gguf"),
    ]);
    expect(out.map((m) => m.file)).toEqual([
      "alpha-Q4_K_M.gguf",
      "alpha-Q8_0.gguf",
      "zeta-Q4_K_M.gguf",
    ]);
  });
});

describe("guessModelKind", () => {
  it("spots the embedding models people actually download", () => {
    // All three of these were sitting in a real hub folder next to nothing that
    // could hold a conversation.
    expect(guessModelKind("Qwen3-Embedding-0.6B-f16.gguf")).toBe("embedding");
    expect(guessModelKind("bge-m3-Q4_K_M.gguf")).toBe("embedding");
    expect(guessModelKind("nomic-embed-text-v1.5.f16.gguf")).toBe("embedding");
    expect(guessModelKind("multilingual-e5-large-q8_0.gguf")).toBe("embedding");
    expect(guessModelKind("all-MiniLM-L6-v2.gguf")).toBe("embedding");
  });

  it("leaves chat models alone", () => {
    expect(guessModelKind("Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf")).toBe("chat");
    expect(guessModelKind("qwen2.5-coder-7b-instruct-q5_k_m.gguf")).toBe("chat");
    expect(guessModelKind("Mixtral-8x7B-v0.1.IQ3_XS.gguf")).toBe("chat");
  });

  it("assumes chat when the name says nothing", () => {
    expect(guessModelKind("my-finetune.gguf")).toBe("chat");
  });
});

describe("formatModelSize", () => {
  it("uses GB for models and MB below that", () => {
    expect(formatModelSize(4.6 * 1024 ** 3)).toBe("4.6 GB");
    expect(formatModelSize(24 * 1024 ** 3)).toBe("24 GB");
    expect(formatModelSize(500 * 1024 ** 2)).toBe("500 MB");
    expect(formatModelSize(1000)).toBe("1 MB");
  });
});

describe("describeModel", () => {
  const base: LocalModel = {
    path: "C:/hub/m.gguf", file: "m.gguf", name: "Llama-3.1-8B",
    quant: "Q4_K_M", params: "8B", kind: "chat", size: 4.6 * 1024 ** 3, shards: 1, problem: null,
  };

  it("reads as one line", () => {
    expect(describeModel(base)).toBe("Llama-3.1-8B · Q4_K_M · 4.6 GB");
  });

  it("says when a model makes vectors rather than answers", () => {
    expect(describeModel({ ...base, kind: "embedding" })).toContain("embedding");
  });

  it("omits an unknown quant and mentions shards", () => {
    expect(describeModel({ ...base, quant: null, shards: 3 })).toBe("Llama-3.1-8B · 4.6 GB · 3 shards");
  });
});

describe("hubHint", () => {
  const model = (name: string, kind: "chat" | "embedding", problem: string | null = null): LocalModel => ({
    path: `C:/hub/${name}`, file: name, name, quant: null, params: null,
    kind, size: 1, shards: 1, problem,
  });

  it("names the folder and a real filename when the folder is empty", () => {
    const hint = hubHint([], "C:/TDM/TDM_OFFLINE_LLMHUB/");
    expect(hint).toContain("C:/TDM/TDM_OFFLINE_LLMHUB");
    expect(hint).toContain("Instruct");
    // No trailing slash duplicated into the message.
    expect(hint).not.toContain("LLMHUB/.");
  });

  it("says so when the folder holds only embedding models", () => {
    // The state a real hub folder was in: three embedding models, nothing that
    // could answer a question.
    const hint = hubHint([model("bge-m3.gguf", "embedding"), model("nomic-embed.gguf", "embedding")], "C:/hub");
    expect(hint).toContain("2 embedding models and no chat model");
    expect(hint).toContain("vectors, not answers");
  });

  it("is silent once one chat model is present", () => {
    expect(hubHint([model("qwen-instruct.gguf", "chat")], "C:/hub")).toBeNull();
  });

  it("still prompts when the only chat model is an incomplete download", () => {
    const broken = model("big.gguf", "chat", "2 of 3 shards present");
    expect(hubHint([broken], "C:/hub")).toContain("Add an instruct or chat model");
  });
});

describe("serverArgs", () => {
  it("binds the loopback interface and nothing else", () => {
    const args = serverArgs({ modelPath: "C:/hub/m.gguf", port: 8081 });
    expect(args).toContain("--host");
    expect(args[args.indexOf("--host") + 1]).toBe("127.0.0.1");
    expect(args.join(" ")).not.toContain("0.0.0.0");
  });

  it("passes model, port and the offload settings", () => {
    expect(serverArgs({ modelPath: "C:/m.gguf", port: 9000, ctxSize: 8192, gpuLayers: -1 })).toEqual([
      "--model", "C:/m.gguf",
      "--host", "127.0.0.1",
      "--port", "9000",
      "--ctx-size", "8192",
      "--n-gpu-layers", "-1",
    ]);
  });

  it("defaults to CPU-only, because no GPU default is right on every machine", () => {
    const args = serverArgs({ modelPath: "C:/m.gguf", port: 1 });
    expect(args[args.indexOf("--n-gpu-layers") + 1]).toBe("0");
  });

  it("adds threads and alias only when asked", () => {
    expect(serverArgs({ modelPath: "m", port: 1 }).join(" ")).not.toContain("--threads");
    const args = serverArgs({ modelPath: "m", port: 1, threads: 8, alias: "llama" });
    expect(args).toContain("--threads");
    expect(args[args.indexOf("--alias") + 1]).toBe("llama");
  });
});

describe("urls", () => {
  it("points at the loopback address, not localhost", () => {
    // A machine where localhost resolves to ::1 first would miss a server bound
    // to 127.0.0.1, which is the only interface serverArgs binds.
    expect(localBaseUrl(8081)).toBe("http://127.0.0.1:8081/v1");
    expect(localHealthUrl(8081)).toBe("http://127.0.0.1:8081/health");
  });
});

describe("localModelAlias", () => {
  it("joins name and quant, and has a fallback", () => {
    expect(localModelAlias({ name: "Llama-3.1-8B", quant: "Q4_K_M" })).toBe("Llama-3.1-8B-Q4_K_M");
    expect(localModelAlias({ name: "Llama", quant: null })).toBe("Llama");
    expect(localModelAlias(null)).toBe("local-model");
  });
});

describe("runtimeCandidates", () => {
  it("tries an explicit path first", () => {
    expect(runtimeCandidates("C:/hub", "D:/tools/llama-server.exe")[0]).toBe("D:/tools/llama-server.exe");
  });

  it("looks in the runtime subfolder and then the hub root", () => {
    expect(runtimeCandidates("C:/hub/")).toEqual([
      "C:/hub/runtime/llama-server.exe",
      "C:/hub/llama-server.exe",
    ]);
  });
});

describe("offlineProblem", () => {
  const model: LocalModel = {
    path: "C:/hub/m.gguf", file: "m.gguf", name: "m", quant: "Q4_K_M",
    params: null, kind: "chat", size: 1, shards: 1, problem: null,
  };
  const ok = { hubDir: "C:/hub", runtimePath: "C:/hub/runtime/llama-server.exe", modelPath: model.path, models: [model] };

  it("is silent when everything is in place", () => {
    expect(offlineProblem(ok)).toBeNull();
  });

  it("asks for the folder, then models, then a pick, in that order", () => {
    expect(offlineProblem({ ...ok, hubDir: "  " })).toBe("Set the model folder.");
    expect(offlineProblem({ ...ok, models: [] })).toContain("No .gguf files");
    expect(offlineProblem({ ...ok, modelPath: "" })).toBe("Pick a model.");
  });

  it("catches a model that was deleted after it was chosen", () => {
    expect(offlineProblem({ ...ok, modelPath: "C:/hub/gone.gguf" })).toContain("no longer in the folder");
  });

  it("refuses an incomplete download before blaming the runtime", () => {
    const broken = { ...model, problem: "2 of 3 shards present" };
    expect(offlineProblem({ ...ok, models: [broken], runtimePath: null })).toContain("incomplete");
  });

  it("refuses an embedding model for chat, and says why", () => {
    const embed = { ...model, kind: "embedding" as const, name: "bge-m3" };
    const msg = offlineProblem({ ...ok, models: [embed] });
    expect(msg).toContain("bge-m3");
    expect(msg).toContain("embedding model");
  });

  it("names the missing engine last, when the model side is settled", () => {
    // And points at the button that installs it, rather than at a file name the
    // user would have to go and find.
    expect(offlineProblem({ ...ok, runtimePath: null })).toContain("Set up engine");
  });
});
