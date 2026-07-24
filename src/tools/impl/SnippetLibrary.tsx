import { useMemo, useState } from "react";
import { Plus, Star, Trash2, Search, Save } from "lucide-react";
import { ToolShell } from "@/components/ToolShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { CopyButton } from "@/components/CopyButton";
import { cn } from "@/lib/utils";
import { toast } from "@/components/ui/toast";
import { useSnippetStore, SNIPPET_LANGUAGES, type Snippet } from "@/stores/useSnippetStore";

const blank = (): Snippet => ({ id: "", title: "", language: "C#", code: "", tags: [], favorite: false, updatedAt: 0 });

export function SnippetLibrary() {
  const { snippets, upsert, remove, toggleFavorite } = useSnippetStore();
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState<Snippet>(blank());
  const [tagsInput, setTagsInput] = useState("");

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return snippets
      .filter((s) => !q || s.title.toLowerCase().includes(q) || s.code.toLowerCase().includes(q) || s.tags.some((t) => t.toLowerCase().includes(q)))
      .sort((a, b) => Number(b.favorite) - Number(a.favorite) || b.updatedAt - a.updatedAt);
  }, [snippets, search]);

  const load = (s: Snippet) => { setDraft({ ...s }); setTagsInput(s.tags.join(", ")); };
  const newSnippet = () => { setDraft(blank()); setTagsInput(""); };

  const save = () => {
    if (!draft.title.trim()) return toast.error("Title required");
    const tags = tagsInput.split(",").map((t) => t.trim()).filter(Boolean);
    const id = upsert({ id: draft.id || undefined, title: draft.title, language: draft.language, code: draft.code, tags, favorite: draft.favorite });
    setDraft((d) => ({ ...d, id }));
    toast.success("Saved");
  };

  return (
    <ToolShell toolId="snippet-library" title="Snippet Library" description="Save and search reusable code snippets, locally.">
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[300px_1fr]">
        <div className="flex flex-col gap-2">
          <div className="flex gap-1">
            <div className="relative flex-1">
              <Search className="absolute left-2 top-2.5 size-4 text-muted-foreground" />
              <Input className="h-9 pl-8" placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <Button size="icon" className="h-9 w-9" title="New" onClick={newSnippet}><Plus className="size-4" /></Button>
          </div>
          <div className="h-[calc(100vh-320px)] overflow-auto rounded-md border border-border">
            {filtered.map((s) => (
              <div key={s.id} className={cn("group flex items-center gap-2 border-b border-border px-2 py-1.5", draft.id === s.id && "bg-primary/10")}>
                <button onClick={() => toggleFavorite(s.id)}><Star className={cn("size-3.5", s.favorite ? "fill-warning text-warning" : "text-muted-foreground")} /></button>
                <button className="min-w-0 flex-1 text-left" onClick={() => load(s)}>
                  <div className="truncate text-sm">{s.title}</div>
                  <div className="flex items-center gap-1"><Badge variant="secondary" className="text-[10px]">{s.language}</Badge>{s.tags.slice(0, 2).map((t) => <span key={t} className="text-[10px] text-muted-foreground">#{t}</span>)}</div>
                </button>
                <button onClick={() => { remove(s.id); if (draft.id === s.id) newSnippet(); }}><Trash2 className="size-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive" /></button>
              </div>
            ))}
            {filtered.length === 0 && <p className="p-3 text-xs text-muted-foreground">No snippets. Create one →</p>}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <Input className="flex-1" placeholder="Title" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
            <select className="h-9 rounded-md border border-input bg-transparent px-2 text-sm" value={draft.language} onChange={(e) => setDraft({ ...draft, language: e.target.value })}>
              {SNIPPET_LANGUAGES.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
          <Input placeholder="tags, comma, separated" value={tagsInput} onChange={(e) => setTagsInput(e.target.value)} />
          <Textarea mono className="h-[calc(100vh-400px)] min-h-56" placeholder="// code…" value={draft.code} onChange={(e) => setDraft({ ...draft, code: e.target.value })} />
          <div className="flex gap-2">
            <Button onClick={save}><Save /> Save</Button>
            <CopyButton value={draft.code} />
          </div>
        </div>
      </div>
    </ToolShell>
  );
}
