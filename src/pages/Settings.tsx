import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Moon, Sun, Trash2, Bot, Volume2, VolumeX, Download, Upload, ShieldAlert, HardDriveDownload, RefreshCw, KeyRound, Keyboard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CopyButton } from "@/components/CopyButton";
import { useAppStore } from "@/stores/useAppStore";
import { useAiStore, aiKeyRemembered, forgetAiKey, rememberAiKey } from "@/stores/useAiStore";
import { secretsAvailable } from "@/lib/secrets";
import { useSoundStore, playSound } from "@/lib/sound";
import { isTauri } from "@/lib/platform";
import { aiChat } from "@/lib/ai";
import { toast } from "@/components/ui/toast";
import {
  APP_VERSION,
  clearWorkspace,
  exportWorkspace,
  formatBytes,
  parseWorkspace,
  presentStores,
  restoreWorkspace,
  storageFootprint,
  STORES,
} from "@/lib/workspace";
import { checkForUpdate, installUpdate, type UpdateState } from "@/lib/updates";
import { getTool, TOOLS } from "@/tools/registry";
import { cn } from "@/lib/utils";
import {
  APP_COMMANDS,
  DEFAULT_BINDINGS,
  actionId,
  actionLabel,
  comboFromEvent,
  comboProblem,
  findConflicts,
  formatCombo,
  resolveBindings,
  type BindingAction,
} from "@/lib/keybindings";

export function Settings() {
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);
  const ai = useAiStore();
  const sound = useSoundStore();
  const [testing, setTesting] = useState(false);

  const testAi = async () => {
    setTesting(true);
    try {
      await aiChat([{ role: "user", content: "Reply with the single word: ok" }]);
      toast.success("AI connection works");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl p-6">
      <h1 className="mb-6 text-2xl font-semibold">Settings</h1>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Bot className="size-4" /> AI (optional)</CardTitle>
          <CardDescription>DevHelper works fully without AI. Configure a provider to enable AI tools. Keys are stored locally.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Button size="sm" variant={ai.provider === "ollama" ? "default" : "outline"} onClick={() => ai.set({ provider: "ollama" })}>Ollama (local)</Button>
            <Button size="sm" variant={ai.provider === "openai" ? "default" : "outline"} onClick={() => ai.set({ provider: "openai" })}>OpenAI-compatible</Button>
          </div>
          {ai.provider === "ollama" ? (
            <div className="grid grid-cols-2 gap-2">
              <Labeled label="Ollama URL"><Input value={ai.ollamaUrl} onChange={(e) => ai.set({ ollamaUrl: e.target.value })} /></Labeled>
              <Labeled label="Model"><Input value={ai.ollamaModel} onChange={(e) => ai.set({ ollamaModel: e.target.value })} /></Labeled>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <Labeled label="Base URL"><Input value={ai.openaiBaseUrl} onChange={(e) => ai.set({ openaiBaseUrl: e.target.value })} /></Labeled>
              <Labeled label="Model"><Input value={ai.openaiModel} onChange={(e) => ai.set({ openaiModel: e.target.value })} /></Labeled>
              <Labeled label="API Key" full><Input type="password" placeholder="sk-…" value={ai.openaiKey} onChange={(e) => ai.set({ openaiKey: e.target.value })} /></Labeled>
              <div className="col-span-2"><RememberKey apiKey={ai.openaiKey} /></div>
            </div>
          )}
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={testAi} disabled={testing || !ai.isConfigured()}>{testing ? "Testing…" : "Test connection"}</Button>
            <Badge variant={ai.isConfigured() ? "success" : "secondary"}>{ai.isConfigured() ? "configured" : "not configured"}</Badge>
            {ai.provider === "openai" && <span className="text-xs text-muted-foreground">⚠ OpenAI sends data to an external server.</span>}
          </div>
        </CardContent>
      </Card>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>Appearance</CardTitle>
          <CardDescription>Choose how DevHelper looks.</CardDescription>
        </CardHeader>
        <CardContent className="flex gap-2">
          <Button variant={theme === "dark" ? "default" : "outline"} size="sm" onClick={() => setTheme("dark")}>
            <Moon /> Dark
          </Button>
          <Button variant={theme === "light" ? "default" : "outline"} size="sm" onClick={() => setTheme("light")}>
            <Sun /> Light
          </Button>
        </CardContent>
      </Card>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">{sound.enabled ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />} Sound</CardTitle>
          <CardDescription>Subtle audio cues for success, error and other meaningful state changes. Off by default.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <Button size="sm" variant={sound.enabled ? "default" : "outline"} onClick={() => { const next = !sound.enabled; sound.set({ enabled: next }); if (next) playSound("success"); }}>
            {sound.enabled ? "Enabled" : "Disabled"}
          </Button>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Volume
            <input type="range" min={0} max={1} step={0.05} value={sound.volume} disabled={!sound.enabled} onChange={(e) => sound.set({ volume: Number(e.target.value) })} onMouseUp={() => playSound("notification")} className="accent-primary" />
          </label>
        </CardContent>
      </Card>

      <ShortcutsCard />

      <WorkspaceCard />

      <Card>
        <CardHeader>
          <CardTitle>About</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <span>DevHelper {APP_VERSION}</span>
            <Badge variant={isTauri() ? "success" : "secondary"}>{isTauri() ? "Desktop app" : "Browser dev mode"}</Badge>
          </div>
          <p>Local-first developer toolbox. No data leaves your machine unless you enable AI.</p>
          <UpdateCheck />
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Rebinding keyboard shortcuts.
 *
 * The shipped bindings are only defaults. A combination the OS or another app
 * has already taken is otherwise simply unavailable, with nothing to be done
 * about it, and conflicts between two DevHelper bindings used to be decided by
 * iteration order — which is how a shortcut becomes something that works on
 * Tuesdays. Both are now visible and fixable.
 */
function ShortcutsCard() {
  const overrides = useAppStore((s) => s.keyOverrides);
  const setOverride = useAppStore((s) => s.setKeyOverride);
  const resetAll = useAppStore((s) => s.resetKeyOverrides);
  const [capturing, setCapturing] = useState<string | null>(null);
  const [problem, setProblem] = useState("");

  const bindings = useMemo(() => resolveBindings(DEFAULT_BINDINGS, overrides), [overrides]);
  const conflicts = useMemo(() => findConflicts(bindings), [bindings]);
  const conflicted = new Set(conflicts.map((c) => c.combo));
  const nameOf = (id: string) => getTool(id)?.name;

  // Every bindable action, whether or not it currently has a combination.
  const rows = useMemo(() => {
    const all = [
      ...APP_COMMANDS.map((c) => ({ action: { kind: "command", id: c.id } as BindingAction })),
      ...TOOLS.filter((t) => t.shortcut).map((t) => ({ action: { kind: "tool", toolId: t.id } as BindingAction })),
    ];
    return all.map(({ action }) => {
      const id = actionId(action);
      return {
        id,
        action,
        label: actionLabel(action, nameOf),
        combo: bindings.find((b) => actionId(b.action) === id)?.combo ?? "",
        overridden: overrides[id] !== undefined,
      };
    });
  }, [bindings, overrides]);

  const onCapture = (id: string) => (e: React.KeyboardEvent) => {
    e.preventDefault();
    if (e.key === "Escape") { setCapturing(null); setProblem(""); return; }
    const combo = comboFromEvent(e.nativeEvent);
    if (!combo) return; // a modifier on its own; keep waiting
    const issue = comboProblem(combo);
    if (issue) { setProblem(issue); return; }
    setOverride(id, combo);
    setCapturing(null);
    setProblem("");
  };

  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Keyboard className="size-4" /> Keyboard shortcuts</CardTitle>
        <CardDescription>
          Click a shortcut and press the keys you want. Escape cancels. Bindings match the physical key, so they do not
          move when the keyboard layout does.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {conflicts.length > 0 && (
          <div className="rounded-md border border-warning/40 bg-warning/5 p-2 text-[11px]">
            {conflicts.map((c) => (
              <p key={c.combo}>
                <ShieldAlert className="mr-1 inline size-3 text-warning" />
                <b>{formatCombo(c.combo)}</b> is bound to {c.actions.map((a) => actionLabel(a, nameOf)).join(" and ")} —
                which one wins is not defined.
              </p>
            ))}
          </div>
        )}

        <div className="divide-y divide-border rounded-md border border-border">
          {rows.map((row) => (
            <div key={row.id} className="flex items-center gap-2 px-2 py-1.5 text-sm">
              <span className="min-w-0 flex-1 truncate">{row.label}</span>
              {row.overridden && <Badge variant="outline" className="text-[10px]">changed</Badge>}
              <button
                onKeyDown={capturing === row.id ? onCapture(row.id) : undefined}
                onClick={() => { setCapturing(row.id); setProblem(""); }}
                onBlur={() => capturing === row.id && setCapturing(null)}
                className={cn(
                  "min-w-[9rem] rounded border px-2 py-0.5 text-center font-mono text-[11px]",
                  capturing === row.id
                    ? "border-primary bg-primary/10 text-primary"
                    : conflicted.has(row.combo)
                      ? "border-warning/50 text-warning"
                      : "border-border text-muted-foreground hover:bg-secondary",
                )}
              >
                {capturing === row.id ? "Press keys…" : row.combo ? formatCombo(row.combo) : "unbound"}
              </button>
              <button
                onClick={() => setOverride(row.id, "")}
                disabled={!row.combo}
                title="Unbind"
                className="text-muted-foreground hover:text-destructive disabled:opacity-30"
              >
                <Trash2 className="size-3.5" />
              </button>
              <button
                onClick={() => setOverride(row.id, null)}
                disabled={!row.overridden}
                title="Restore the default"
                className="text-muted-foreground hover:text-foreground disabled:opacity-30"
              >
                <RefreshCw className="size-3.5" />
              </button>
            </div>
          ))}
        </div>

        {problem && <p className="text-[11px] text-warning">{problem}</p>}
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={resetAll} disabled={Object.keys(overrides).length === 0}>
            Restore all defaults
          </Button>
          <span className="text-[11px] text-muted-foreground">
            Unbinding is remembered, so a key you deliberately freed stays free when a release changes its default.
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Opt-in storage of the API key in the OS credential store.
 *
 * The key is no longer written to local storage, so without this it is retyped
 * every launch. Remembering it puts it where the platform keeps credentials,
 * not in a file DevHelper's own backup would copy.
 */
function RememberKey({ apiKey }: { apiKey: string }) {
  const [available, setAvailable] = useState(false);
  const [remembered, setRemembered] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void (async () => {
      const can = await secretsAvailable();
      if (!live) return;
      setAvailable(can);
      if (can) setRemembered(await aiKeyRemembered());
    })();
    return () => { live = false; };
  }, []);

  if (!available) {
    return (
      <p className="text-[11px] text-muted-foreground">
        The key is kept in memory for this session only and is never written to DevHelper's storage.
        {!isTauri() && " Remembering it between launches needs the desktop app."}
      </p>
    );
  }

  const toggle = async () => {
    setBusy(true);
    try {
      if (remembered) {
        await forgetAiKey();
        setRemembered(false);
        toast.success("Key removed from the credential store");
      } else {
        if (!apiKey.trim()) return toast.error("Enter the key first");
        await rememberAiKey(apiKey);
        setRemembered(true);
        toast.success("Key saved to the OS credential store");
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant={remembered ? "secondary" : "outline"} onClick={toggle} disabled={busy}>
        <KeyRound /> {remembered ? "Remembered on this machine" : "Remember on this machine"}
      </Button>
      <span className="text-[11px] text-muted-foreground">
        {remembered
          ? "Stored in the Windows Credential Manager, not in DevHelper's own data — a workspace backup does not contain it."
          : "Otherwise the key is kept in memory for this session only and retyped next launch."}
      </span>
    </div>
  );
}

/** Version check. Honest about being unconfigured rather than silently idle. */
function UpdateCheck() {
  const [state, setState] = useState<UpdateState | null>(null);
  const [busy, setBusy] = useState(false);
  const [installing, setInstalling] = useState(false);

  const check = async () => {
    setBusy(true);
    setState(await checkForUpdate(APP_VERSION));
    setBusy(false);
  };

  const install = async () => {
    setInstalling(true);
    try {
      await installUpdate();
      toast.success("Update installed — DevHelper will restart");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setInstalling(false);
    }
  };

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={check} disabled={busy}>
          <RefreshCw className={busy ? "animate-spin" : undefined} /> {busy ? "Checking…" : "Check for updates"}
        </Button>
        {state?.kind === "current" && <Badge variant="success">up to date</Badge>}
        {state?.kind === "available" && (
          <>
            <Badge variant="warning">{state.version} available</Badge>
            <Button size="sm" onClick={install} disabled={installing}>
              {installing ? "Installing…" : "Install and restart"}
            </Button>
          </>
        )}
      </div>
      {state?.kind === "available" && state.notes && <p className="text-xs">{state.notes}</p>}
      {state && state.kind !== "current" && state.kind !== "available" && (
        <p className="text-xs">{state.message}</p>
      )}
    </div>
  );
}

/**
 * Backup, restore and delete — the three things you cannot do from anywhere else.
 *
 * Everything DevHelper saves lives in this app profile's local storage, which no
 * backup tool sees and which a webview reset wipes. This card is the only route
 * in and out.
 */
function WorkspaceCard() {
  const [restoreText, setRestoreText] = useState("");
  const [includeSecrets, setIncludeSecrets] = useState(false);
  const [showRestore, setShowRestore] = useState(false);

  // Read at render: after a restore, a reload is required anyway, so a stale
  // footprint here would be misleading rather than merely out of date.
  const present = presentStores(localStorage);
  const footprint = storageFootprint(localStorage);
  const totalBytes = footprint.reduce((n, f) => n + f.bytes, 0);
  const parsed = useMemo(() => (restoreText.trim() ? parseWorkspace(restoreText) : null), [restoreText]);

  const backup = () =>
    exportWorkspace(localStorage, {
      includeSecrets,
      appVersion: APP_VERSION,
      exportedAt: new Date().toISOString(),
    });

  const download = () => {
    const stamp = new Date().toISOString().slice(0, 10);
    const blob = new Blob([backup()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `devhelper-workspace-${stamp}${includeSecrets ? "-with-secrets" : ""}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Workspace downloaded");
  };

  const doRestore = () => {
    if (!parsed || parsed.known.length === 0) return;
    const names = parsed.known.map((s) => s.label).join(", ");
    if (!confirm(`Replace ${names} with the contents of this file? Current data in those areas is overwritten and cannot be recovered from inside DevHelper.`)) {
      return;
    }
    const result = restoreWorkspace(localStorage, parsed);
    toast.success(`Restored ${result.restored.length} store(s) — reload to apply`);
    setRestoreText("");
  };

  const doClear = () => {
    if (!confirm("Delete every saved request, environment, connection, snippet, project, debug session and preference? Export a backup first — this cannot be undone.")) {
      return;
    }
    const cleared = clearWorkspace(localStorage);
    toast.success(`Cleared ${cleared.length} store(s) — reload to apply`);
  };

  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><HardDriveDownload className="size-4" /> Workspace data</CardTitle>
        <CardDescription>
          Everything you have saved — requests, environments, connections, snippets, projects, debug sessions and
          preferences — is stored in this app profile only. It is not a file on disk, so nothing else backs it up.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <div className="mb-1 text-xs font-medium text-muted-foreground">
            {present.length} store(s) in use · {formatBytes(totalBytes)}
          </div>
          <div className="flex flex-wrap gap-1">
            {footprint.map((f) => {
              const spec = STORES.find((s) => s.key === f.key)!;
              return (
                <Badge key={f.key} variant="outline" className="text-[10px]" title={spec.describes}>
                  {spec.label} {formatBytes(f.bytes)}
                </Badge>
              );
            })}
            {footprint.length === 0 && <span className="text-xs text-muted-foreground">Nothing saved yet.</span>}
          </div>
        </div>

        <div className="space-y-2">
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={includeSecrets}
              onChange={(e) => setIncludeSecrets(e.target.checked)}
              className="accent-destructive"
            />
            Include secret values (currently just the AI API key)
          </label>
          {includeSecrets && (
            <p className="text-[11px] text-destructive">
              <ShieldAlert className="mr-1 inline size-3" />
              The file will contain your API key in plain text. Treat it as a credential.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={download} disabled={present.length === 0}>
              <Download /> Back up workspace
            </Button>
            <CopyButton value={backup()} label="JSON" />
            <Button size="sm" variant="outline" onClick={() => setShowRestore((v) => !v)}>
              <Upload /> Restore
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Database passwords are never included — they are held in memory for the session only and are not saved
            anywhere.
          </p>
        </div>

        {showRestore && (
          <div className="space-y-2 rounded-md border border-border p-3">
            <div className="text-sm font-medium">Restore from a backup</div>
            <textarea
              className="mono h-32 w-full rounded-md border border-input bg-transparent p-2 text-[11px]"
              placeholder="Paste a devhelper-workspace-….json file here."
              value={restoreText}
              onChange={(e) => setRestoreText(e.target.value)}
            />
            {parsed && (
              <div className="space-y-1 text-[11px]">
                <p className="text-muted-foreground">
                  {parsed.known.length} store(s) readable
                  {parsed.appVersion && ` · written by ${parsed.appVersion}`}
                  {parsed.exportedAt && ` · ${parsed.exportedAt.slice(0, 10)}`}
                  {parsed.secretsRedacted && " · exported without secrets, so the AI key will restore empty"}.
                </p>
                {parsed.known.length > 0 && (
                  <p className="text-muted-foreground">Replaces: {parsed.known.map((s) => s.label).join(", ")}.</p>
                )}
                {parsed.problems.map((p, i) => (
                  <p key={i} className="text-warning">{p}</p>
                ))}
              </div>
            )}
            <Button size="sm" onClick={doRestore} disabled={!parsed || parsed.known.length === 0}>
              <Upload /> Replace these stores
            </Button>
            <p className="text-[11px] text-muted-foreground">
              A restore replaces whole stores rather than merging — a half-merged collection is a state neither the
              backup nor your current data describes. Reload the app afterwards.
            </p>
          </div>
        )}

        <div className="border-t border-border pt-3">
          <Button variant="destructive" size="sm" onClick={doClear} disabled={present.length === 0}>
            <Trash2 /> Delete all workspace data
          </Button>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Removes all {present.length} store(s), not just preferences. Back up first.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function Labeled({ label, children, full }: { label: string; children: ReactNode; full?: boolean }) {
  return (
    <label className={full ? "col-span-2 flex flex-col gap-1" : "flex flex-col gap-1"}>
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
