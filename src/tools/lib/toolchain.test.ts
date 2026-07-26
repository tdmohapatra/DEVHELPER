import { describe, it, expect } from "vitest";
import {
  TOOL_CATALOG,
  GROUP_LABELS,
  probeSpecs,
  cleanVersion,
  buildRows,
  filterRows,
  summarize,
  byGroup,
  isValidWingetId,
  installCommand,
  type ProbeResult,
} from "./toolchain";

const results: ProbeResult[] = [
  { id: "node", installed: true, version: "v25.8.1", source: "cli", detail: "node --version" },
  { id: "git", installed: true, version: "git version 2.52.0.windows.1", source: "cli", detail: "git --version" },
  { id: "ollama", installed: false, version: "", source: "", detail: "" },
];

describe("catalog integrity", () => {
  it("has unique ids", () => {
    const ids = TOOL_CATALOG.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("gives every tool a known group, capabilities and at least one check", () => {
    for (const t of TOOL_CATALOG) {
      expect(GROUP_LABELS[t.group], t.id).toBeTruthy();
      expect(t.capabilities.length, t.id).toBeGreaterThan(0);
      expect(t.checks.length, t.id).toBeGreaterThan(0);
    }
  });
  it("gives every tool a way to obtain it (winget, download page or manual command)", () => {
    for (const t of TOOL_CATALOG) {
      expect(Boolean(t.wingetId || t.downloadUrl || t.manualCmd), t.id).toBe(true);
    }
  });
  it("only uses winget ids the native validator will accept", () => {
    for (const t of TOOL_CATALOG) {
      if (t.wingetId) expect(isValidWingetId(t.wingetId), t.wingetId).toBe(true);
    }
  });
  it("emits one probe spec per tool", () => {
    expect(probeSpecs()).toHaveLength(TOOL_CATALOG.length);
    expect(probeSpecs([TOOL_CATALOG[0]])[0]).toEqual({
      id: TOOL_CATALOG[0].id,
      checks: TOOL_CATALOG[0].checks,
    });
  });
});

describe("cleanVersion", () => {
  it("extracts dotted versions from noisy output", () => {
    expect(cleanVersion("v25.8.1")).toBe("25.8.1");
    expect(cleanVersion("git version 2.52.0.windows.1")).toBe("2.52.0.windows.1");
    expect(cleanVersion("Python 3.11.9")).toBe("3.11.9");
    expect(cleanVersion("Docker version 29.4.1, build 055a478")).toBe("29.4.1");
  });
  it("uses only the first line", () => {
    expect(cleanVersion("PostgreSQL 18.3\nmore text 9.9")).toBe("18.3");
  });
  it("falls back to trimmed text when there is no version number", () => {
    expect(cleanVersion("  installed  ")).toBe("installed");
    expect(cleanVersion("")).toBe("");
  });
  it("truncates very long fallbacks", () => {
    expect(cleanVersion("x".repeat(100))).toHaveLength(46);
  });
});

describe("buildRows", () => {
  it("merges probe results onto the catalog", () => {
    const rows = buildRows(TOOL_CATALOG, results);
    const node = rows.find((r) => r.id === "node")!;
    expect(node.installed).toBe(true);
    expect(node.version).toBe("25.8.1");
    expect(node.source).toBe("cli");
  });
  it("treats tools with no result as missing", () => {
    const rows = buildRows(TOOL_CATALOG, []);
    expect(rows.every((r) => !r.installed)).toBe(true);
  });
  it("marks winget-backed tools installable", () => {
    const rows = buildRows(TOOL_CATALOG, results);
    expect(rows.find((r) => r.id === "ollama")!.installable).toBe(true);
    expect(rows.find((r) => r.id === "visual-studio")!.installable).toBe(false);
  });
});

describe("filterRows", () => {
  const rows = buildRows(TOOL_CATALOG, results);
  it("filters by status", () => {
    expect(filterRows(rows, { status: "installed" }).map((r) => r.id).sort()).toEqual(["git", "node"]);
    expect(filterRows(rows, { status: "missing" }).some((r) => r.id === "node")).toBe(false);
  });
  it("filters by group", () => {
    expect(filterRows(rows, { group: "vcs" }).every((r) => r.group === "vcs")).toBe(true);
  });
  it("searches name, id and capabilities", () => {
    expect(filterRows(rows, { query: "pub/sub" }).map((r) => r.id)).toContain("nats-server");
    expect(filterRows(rows, { query: "REDIS" }).length).toBeGreaterThan(1);
  });
  it("combines filters", () => {
    const out = filterRows(rows, { group: "vcs", status: "installed", query: "branch" });
    expect(out.map((r) => r.id)).toEqual(["git"]);
  });
});

describe("summarize", () => {
  it("counts totals, missing and essentials", () => {
    const s = summarize(buildRows(TOOL_CATALOG, results));
    expect(s.total).toBe(TOOL_CATALOG.length);
    expect(s.installed).toBe(2);
    expect(s.missing).toBe(s.total - 2);
    expect(s.essentialTotal).toBeGreaterThan(0);
    expect(s.essentialInstalled).toBe(2); // node + git are both essential
    expect(s.installableMissing).toBeLessThanOrEqual(s.missing);
  });
});

describe("byGroup", () => {
  it("buckets in display order and drops empty groups", () => {
    const buckets = byGroup(buildRows(TOOL_CATALOG, results).filter((r) => r.group === "vcs"));
    expect(buckets).toHaveLength(1);
    expect(buckets[0].label).toBe(GROUP_LABELS.vcs);
  });
});

describe("install command", () => {
  it("rejects ids that could smuggle arguments", () => {
    expect(isValidWingetId("Git.Git")).toBe(true);
    expect(isValidWingetId("Oven-sh.Bun")).toBe(true);
    expect(isValidWingetId("")).toBe(false);
    expect(isValidWingetId("--force")).toBe(false);
    expect(isValidWingetId("a b")).toBe(false);
    expect(isValidWingetId("a&calc")).toBe(false);
    expect(isValidWingetId("a;b")).toBe(false);
  });
  it("shows the exact command that will run", () => {
    expect(installCommand("Ollama.Ollama")).toBe(
      "winget install --id Ollama.Ollama --exact --source winget --accept-package-agreements --accept-source-agreements",
    );
  });
});
