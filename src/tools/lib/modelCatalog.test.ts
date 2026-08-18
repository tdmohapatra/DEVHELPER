import { describe, expect, it } from "vitest";
import {
  catalogModel,
  describeCatalogModel,
  downloadLabel,
  downloadPercent,
  modelDestination,
  MODEL_CATALOG,
  suggestedModel,
} from "./modelCatalog";
import { guessModelKind, parseModelName } from "./localLlm";

describe("MODEL_CATALOG", () => {
  it("offers only files the offline picker will accept as chat models", () => {
    // The catalogue and the scanner have to agree, or DevHelper downloads a file
    // and then refuses to run it. Both go through the same filename rules.
    for (const m of MODEL_CATALOG) {
      expect(guessModelKind(m.file)).toBe("chat");
      expect(m.file.endsWith(".gguf")).toBe(true);
    }
  });

  it("names a quant the scanner can read back off the filename", () => {
    for (const m of MODEL_CATALOG) {
      expect(parseModelName(m.file).quant).toBe(m.quant);
    }
  });

  it("downloads only over https from Hugging Face", () => {
    // Rust checks this again before fetching; this keeps a typo out of the list
    // in the first place.
    for (const m of MODEL_CATALOG) {
      expect(m.url.startsWith("https://huggingface.co/")).toBe(true);
    }
  });

  it("has unique ids and filenames", () => {
    expect(new Set(MODEL_CATALOG.map((m) => m.id)).size).toBe(MODEL_CATALOG.length);
    expect(new Set(MODEL_CATALOG.map((m) => m.file)).size).toBe(MODEL_CATALOG.length);
  });

  it("states a real size for every entry", () => {
    for (const m of MODEL_CATALOG) {
      expect(m.size).toBeGreaterThan(500 * 1024 ** 2);
    }
  });
});

describe("catalogModel", () => {
  it("finds one and returns null for an unknown id", () => {
    expect(catalogModel("qwen2.5-3b-instruct-q4km")?.params).toBe("3B");
    expect(catalogModel("nope")).toBeNull();
  });
});

describe("suggestedModel", () => {
  it("offers the small one when RAM is unknown or tight", () => {
    expect(suggestedModel(null).params).toBe("3B");
    expect(suggestedModel(8).params).toBe("3B");
  });

  it("offers 7B once there is room for it", () => {
    expect(suggestedModel(32).params).toBe("7B");
  });
});

describe("describeCatalogModel", () => {
  it("reads as one line with a real size", () => {
    expect(describeCatalogModel(MODEL_CATALOG[0])).toBe("Qwen2.5 3B Instruct · Q4_K_M · 1.8 GB");
  });
});

describe("modelDestination", () => {
  it("puts the file in the hub, whatever the folder's trailing slash", () => {
    expect(modelDestination("C:/TDM/TDM_OFFLINE_LLMHUB/", MODEL_CATALOG[0]))
      .toBe("C:/TDM/TDM_OFFLINE_LLMHUB/Qwen2.5-3B-Instruct-Q4_K_M.gguf");
    expect(modelDestination("C:\\hub\\", MODEL_CATALOG[0]))
      .toBe("C:\\hub/Qwen2.5-3B-Instruct-Q4_K_M.gguf");
  });
});

describe("downloadPercent", () => {
  it("is null when the server did not say how big the file is", () => {
    expect(downloadPercent(1000, 0)).toBeNull();
  });

  it("rounds and clamps", () => {
    expect(downloadPercent(500, 1000)).toBe(50);
    expect(downloadPercent(0, 1000)).toBe(0);
    // A server that under-reports its own length must not produce 103%.
    expect(downloadPercent(1200, 1000)).toBe(100);
  });
});

describe("downloadLabel", () => {
  it("shows both numbers, or just the one it has", () => {
    expect(downloadLabel(1024 ** 3, 2 * 1024 ** 3)).toBe("1.0 GB of 2.0 GB");
    expect(downloadLabel(1024 ** 3, 0)).toBe("1.0 GB");
  });
});
