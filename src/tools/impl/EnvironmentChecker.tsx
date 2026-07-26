import { useEffect, useMemo, useState } from "react";
import {
  RefreshCw,
  CheckCircle2,
  XCircle,
  Download,
  ExternalLink,
  Search,
  AlertTriangle,
  Loader2,
  Terminal,
} from "lucide-react";
import { ToolShell } from "@/components/ToolShell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { CopyButton } from "@/components/CopyButton";
import { NativeNotice } from "@/components/NativeNotice";
import { invokeNative, isTauri } from "@/lib/platform";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import {
  TOOL_CATALOG,
  GROUP_LABELS,
  GROUP_ORDER,
  buildRows,
  byGroup,
  filterRows,
  installCommand,
  probeSpecs,
  summarize,
  type ProbeResult,
  type StatusFilter,
  type ToolGroup,
  type ToolRow,
} from "@/tools/lib/toolchain";

/** Detect every tool in the catalog, show what it does, and install the missing ones. */
export function EnvironmentChecker() {
  const [results, setResults] = useState<ProbeResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [wingetOk, setWingetOk] = useState(true);
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState<ToolGroup | "all">("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  /** Tool id awaiting a second click to confirm the install. */
  const [confirming, setConfirming] = useState("");
  /** Tool id currently being installed by winget. */
  const [installing, setInstalling] = useState("");
  const [log, setLog] = useState<{ name: string; text: string; ok: boolean } | null>(null);

  const check = async () => {
    if (!isTauri()) return;
    setLoading(true);
    setError("");
    try {
      setResults(await invokeNative<ProbeResult[]>("toolchain_probe", { specs: probeSpecs() }));
      setWingetOk(await invokeNative<boolean>("toolchain_winget_available"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    check();
  }, []);

  const rows = useMemo(() => buildRows(TOOL_CATALOG, results), [results]);
  const summary = useMemo(() => summarize(rows), [rows]);
  const visible = useMemo(() => filterRows(rows, { query, group, status }), [rows, query, group, status]);
  const groups = useMemo(() => byGroup(visible), [visible]);

  /** Re-probe a single tool so a fresh install shows its version without a full sweep. */
  const recheck = async (id: string) => {
    const def = TOOL_CATALOG.find((t) => t.id === id);
    if (!def) return;
    try {
      const [r] = await invokeNative<ProbeResult[]>("toolchain_probe", { specs: probeSpecs([def]) });
      setResults((prev) => [...prev.filter((p) => p.id !== id), r]);
    } catch {
      /* the full re-check button remains available */
    }
  };

  const install = async (row: ToolRow) => {
    if (!row.wingetId) return;
    if (confirming !== row.id) {
      setConfirming(row.id);
      return;
    }
    setConfirming("");
    setInstalling(row.id);
    setLog(null);
    try {
      const text = await invokeNative<string>("toolchain_install", { packageId: row.wingetId });
      setLog({ name: row.name, text, ok: true });
      toast.success(`${row.name} installed`);
      await recheck(row.id);
    } catch (e) {
      const text = (e as Error).message;
      setLog({ name: row.name, text, ok: false });
      toast.error(`${row.name} install failed`);
    } finally {
      setInstalling("");
    }
  };

  const openUrl = async (url: string) => {
    if (!isTauri()) {
      window.open(url, "_blank", "noopener");
      return;
    }
    try {
      const { openUrl: open } = await import("@tauri-apps/plugin-opener");
      await open(url);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <ToolShell
      toolId="environment-checker"
      title="Toolchain Manager"
      description="Every tool your stack needs — what it does, whether it is installed, which version, and one-click install for what is missing."
      requiresNative
      actions={
        <Button size="sm" variant="outline" onClick={check} disabled={!isTauri() || loading}>
          <RefreshCw className={cn(loading && "animate-spin")} /> Re-check all
        </Button>
      }
    >
      {!isTauri() && <NativeNotice what="Tool detection and installation" />}
      {error && (
        <div className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive">{error}</div>
      )}
      {isTauri() && !wingetOk && (
        <div className="mb-3 flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-2 text-sm text-warning">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>winget was not found, so one-click install is disabled. Every tool still shows a vendor download link.</span>
        </div>
      )}

      {/* Headline counts */}
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Tools tracked" value={String(summary.total)} />
        <Stat label="Installed" value={String(summary.installed)} tone="success" />
        <Stat label="Missing" value={String(summary.missing)} tone={summary.missing ? "warning" : "success"} />
        <Stat
          label="Core stack"
          value={`${summary.essentialInstalled}/${summary.essentialTotal}`}
          tone={summary.essentialInstalled === summary.essentialTotal ? "success" : "warning"}
        />
      </div>

      {/* Search + status filter */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Search tools or capabilities (e.g. pub/sub, execution plans, queue)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="flex gap-1">
          {(["all", "installed", "missing"] as const).map((s) => (
            <Button key={s} size="sm" variant={status === s ? "default" : "outline"} className="capitalize" onClick={() => setStatus(s)}>
              {s}
              {s === "missing" && summary.missing > 0 ? ` (${summary.missing})` : ""}
            </Button>
          ))}
        </div>
      </div>

      {/* Category tabs */}
      <div className="mb-4 flex flex-wrap gap-1 border-b border-border">
        {(["all", ...GROUP_ORDER] as const).map((g) => {
          const active = group === g;
          const count = g === "all" ? rows.length : rows.filter((r) => r.group === g).length;
          return (
            <button
              key={g}
              onClick={() => setGroup(g as ToolGroup | "all")}
              className={cn(
                "px-3 py-1.5 text-sm",
                active ? "border-b-2 border-primary text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {g === "all" ? "All" : GROUP_LABELS[g as ToolGroup]}
              <span className="ml-1 text-xs text-muted-foreground">{count}</span>
            </button>
          );
        })}
      </div>

      {log && (
        <div className="mb-4 rounded-md border border-border">
          <div className="flex items-center justify-between border-b border-border px-3 py-1.5 text-sm">
            <span className="flex items-center gap-2">
              <Terminal className="size-4" />
              winget output — {log.name}
              <Badge variant={log.ok ? "success" : "destructive"}>{log.ok ? "succeeded" : "failed"}</Badge>
            </span>
            <Button size="sm" variant="ghost" onClick={() => setLog(null)}>
              Dismiss
            </Button>
          </div>
          <pre className="max-h-56 overflow-auto whitespace-pre-wrap p-3 font-mono text-xs text-muted-foreground">{log.text}</pre>
        </div>
      )}

      {visible.length === 0 && <p className="text-sm text-muted-foreground">No tools match this filter.</p>}

      <div className="space-y-6">
        {groups.map((bucket) => (
          <section key={bucket.group}>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {bucket.label} <span className="font-normal">· {bucket.rows.filter((r) => r.installed).length}/{bucket.rows.length} installed</span>
            </h2>
            <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
              {bucket.rows.map((row) => (
                <ToolCardRow
                  key={row.id}
                  row={row}
                  confirming={confirming === row.id}
                  installing={installing === row.id}
                  wingetOk={wingetOk}
                  native={isTauri()}
                  onInstall={() => install(row)}
                  onCancel={() => setConfirming("")}
                  onOpen={openUrl}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </ToolShell>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "success" | "warning" }) {
  return (
    <div className="rounded-md border border-border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={cn(
          "mt-0.5 text-xl font-semibold tabular-nums",
          tone === "success" && "text-success",
          tone === "warning" && "text-warning",
        )}
      >
        {value}
      </div>
    </div>
  );
}

interface CardProps {
  row: ToolRow;
  confirming: boolean;
  installing: boolean;
  wingetOk: boolean;
  native: boolean;
  onInstall: () => void;
  onCancel: () => void;
  onOpen: (url: string) => void;
}

function ToolCardRow({ row, confirming, installing, wingetOk, native, onInstall, onCancel, onOpen }: CardProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-md border p-3",
        row.installed ? "border-border" : "border-warning/40 bg-warning/5",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2">
          {row.installed ? (
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
          ) : (
            <XCircle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          )}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-sm font-medium">{row.name}</span>
              {row.essential && <Badge variant="outline">core</Badge>}
              {row.installed ? (
                <Badge variant="success" className="font-mono">{row.version || "installed"}</Badge>
              ) : (
                <Badge variant="warning">not installed</Badge>
              )}
            </div>
            {row.detail && (
              <div className="truncate font-mono text-[11px] text-muted-foreground" title={row.detail}>
                {row.source}: {row.detail}
              </div>
            )}
          </div>
        </div>
      </div>

      <ul className="flex flex-wrap gap-1">
        {row.capabilities.map((c) => (
          <li key={c} className="rounded bg-secondary px-1.5 py-0.5 text-[11px] text-secondary-foreground">
            {c}
          </li>
        ))}
      </ul>

      {row.note && (
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" />
          <span>{row.note}</span>
        </p>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        {row.wingetId && !row.installed && (
          <>
            {confirming ? (
              <>
                <Button size="sm" onClick={onInstall} disabled={installing}>
                  {installing ? <Loader2 className="animate-spin" /> : <Download />} Run winget install
                </Button>
                <Button size="sm" variant="ghost" onClick={onCancel} disabled={installing}>
                  Cancel
                </Button>
                <span className="text-xs text-muted-foreground">Installs the latest version; Windows may ask for admin rights.</span>
              </>
            ) : (
              <Button size="sm" onClick={onInstall} disabled={!native || !wingetOk || installing}>
                {installing ? <Loader2 className="animate-spin" /> : <Download />} Install latest
              </Button>
            )}
          </>
        )}
        {row.wingetId && row.installed && (
          <CopyButton size="sm" variant="ghost" value={`winget upgrade --id ${row.wingetId} -e`} label="Copy upgrade cmd" />
        )}
        {row.manualCmd && <CopyButton size="sm" variant="outline" value={row.manualCmd} label={row.manualCmd} />}
        {row.wingetId && !row.installed && <CopyButton size="sm" variant="ghost" value={installCommand(row.wingetId)} label="Copy command" />}
        {row.downloadUrl && (
          <Button size="sm" variant="ghost" onClick={() => onOpen(row.downloadUrl!)}>
            <ExternalLink /> Download page
          </Button>
        )}
      </div>
    </div>
  );
}
