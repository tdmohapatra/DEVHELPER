import { useMemo, useRef, useState } from "react";
import { FolderOpen, Search } from "lucide-react";
import { ToolShell } from "@/components/ToolShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { invokeNative, isTauri } from "@/lib/platform";
import { toast } from "@/components/ui/toast";

const LEVELS = ["ERROR", "WARN", "INFO", "DEBUG"] as const;
type Level = (typeof LEVELS)[number];

function levelOf(line: string): Level | null {
  const u = line.toUpperCase();
  if (u.includes("ERROR") || u.includes("FATAL") || u.includes("EXCEPTION")) return "ERROR";
  if (u.includes("WARN")) return "WARN";
  if (u.includes("DEBUG") || u.includes("TRACE")) return "DEBUG";
  if (u.includes("INFO")) return "INFO";
  return null;
}

const LEVEL_COLOR: Record<Level, string> = {
  ERROR: "text-destructive",
  WARN: "text-warning",
  INFO: "text-foreground",
  DEBUG: "text-muted-foreground",
};

export function LogViewer() {
  const [content, setContent] = useState("");
  const [path, setPath] = useState("");
  const [search, setSearch] = useState("");
  const [active, setActive] = useState<Record<Level, boolean>>({ ERROR: true, WARN: true, INFO: true, DEBUG: true });
  const fileRef = useRef<HTMLInputElement>(null);

  const openNative = async () => {
    if (!path.trim()) return toast.error("Enter a file path");
    try {
      setContent(await invokeNative<string>("read_text_file", { path: path.trim(), maxBytes: 2_000_000 }));
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const onFile = (f?: File) => {
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => setContent(String(reader.result));
    reader.readAsText(f);
  };

  const lines = useMemo(() => content.split(/\r?\n/), [content]);
  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return lines
      .map((text, i) => ({ text, i, level: levelOf(text) }))
      .filter((l) => (l.level ? active[l.level] : true))
      .filter((l) => !q || l.text.toLowerCase().includes(q));
  }, [lines, active, search]);

  const counts = useMemo(() => {
    const c: Record<Level, number> = { ERROR: 0, WARN: 0, INFO: 0, DEBUG: 0 };
    lines.forEach((l) => { const lv = levelOf(l); if (lv) c[lv]++; });
    return c;
  }, [lines]);

  return (
    <ToolShell toolId="log-viewer" title="Log Viewer" description="Open a log file, filter by level and search.">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {isTauri() ? (
          <>
            <Input className="max-w-md font-mono text-xs" placeholder="C:\logs\app.log" value={path} onChange={(e) => setPath(e.target.value)} onKeyDown={(e) => e.key === "Enter" && openNative()} />
            <Button size="sm" onClick={openNative}><FolderOpen /> Open</Button>
          </>
        ) : (
          <>
            <input ref={fileRef} type="file" accept=".log,.txt,text/*" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
            <Button size="sm" onClick={() => fileRef.current?.click()}><FolderOpen /> Open file…</Button>
          </>
        )}
        <div className="relative">
          <Search className="absolute left-2 top-2.5 size-4 text-muted-foreground" />
          <Input className="w-56 pl-8" placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="ml-auto flex gap-1">
          {LEVELS.map((lv) => (
            <button
              key={lv}
              onClick={() => setActive((a) => ({ ...a, [lv]: !a[lv] }))}
              className={cn("rounded-md border px-2 py-1 text-xs", active[lv] ? "border-primary bg-primary/10" : "border-border opacity-50", LEVEL_COLOR[lv])}
            >
              {lv} {counts[lv]}
            </button>
          ))}
        </div>
      </div>

      <div className="h-[calc(100vh-300px)] overflow-auto rounded-md border border-border bg-muted/20">
        {content ? (
          <table className="w-full font-mono text-[12px]">
            <tbody>
              {filtered.map((l) => (
                <tr key={l.i} className="align-top hover:bg-secondary/40">
                  <td className="w-12 select-none px-2 py-0.5 text-right text-muted-foreground">{l.i + 1}</td>
                  <td className={cn("whitespace-pre-wrap px-2 py-0.5", l.level && LEVEL_COLOR[l.level])}>{l.text || " "}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="p-4 text-sm text-muted-foreground">Open a .log or .txt file to view it.</p>
        )}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{filtered.length} / {lines.length} lines shown</p>
    </ToolShell>
  );
}
