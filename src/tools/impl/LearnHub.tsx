import { useMemo, useRef, useState } from "react";
import {
  BookOpen,
  Bookmark,
  Check,
  ChevronDown,
  ChevronRight,
  Download,
  Eye,
  EyeOff,
  Pencil,
  Plus,
  RotateCcw,
  Star,
  Trash2,
  Upload,
  MessageSquareQuote,
} from "lucide-react";
import { StarStories } from "@/tools/impl/StarStories";
import { ToolShell } from "@/components/ToolShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { CopyButton } from "@/components/CopyButton";
import { Markdown } from "@/components/Markdown";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { useLearnStore } from "@/stores/useLearnStore";
import {
  BUILT_IN_QUESTIONS,
  LEVELS,
  TOPICS,
  exportQuestions,
  filterQuestions,
  groupBySubtopic,
  importQuestions,
  overallProgress,
  reviseOrder,
  topicStats,
  type Level,
  type Question,
  type TopicId,
} from "@/tools/lib/learn";

type Mode = "browse" | "revise" | "stories";

export function LearnHub() {
  const custom = useLearnStore((s) => s.custom);
  const progress = useLearnStore((s) => s.progress);
  const bookmarks = useLearnStore((s) => s.bookmarks);
  const hidden = useLearnStore((s) => s.hidden);
  const mark = useLearnStore((s) => s.mark);
  const toggleBookmark = useLearnStore((s) => s.toggleBookmark);
  const deleteQuestion = useLearnStore((s) => s.deleteQuestion);
  const importIntoStore = useLearnStore((s) => s.importQuestions);
  const resetProgress = useLearnStore((s) => s.resetProgress);

  const [topic, setTopic] = useState<TopicId | "all">("all");
  const [level, setLevel] = useState<Level | "all">("all");
  const [search, setSearch] = useState("");
  const [mustKnowOnly, setMustKnowOnly] = useState(false);
  const [bookmarkedOnly, setBookmarkedOnly] = useState(false);
  const [mode, setMode] = useState<Mode>("browse");
  const [editing, setEditing] = useState<Question | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [reviseIndex, setReviseIndex] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  const hiddenSet = useMemo(() => new Set(hidden), [hidden]);
  const all = useMemo(
    () => [...BUILT_IN_QUESTIONS, ...custom].filter((q) => !hiddenSet.has(q.id)),
    [custom, hiddenSet],
  );

  const filtered = useMemo(
    () =>
      filterQuestions(all, {
        topic,
        level,
        search,
        mustKnowOnly,
        ids: bookmarkedOnly ? new Set(bookmarks) : undefined,
      }),
    [all, topic, level, search, mustKnowOnly, bookmarkedOnly, bookmarks],
  );

  const grouped = useMemo(() => groupBySubtopic(filtered), [filtered]);
  const stats = useMemo(() => topicStats(all, progress), [all, progress]);
  const overall = useMemo(() => overallProgress(all, progress), [all, progress]);

  const deck = useMemo(() => reviseOrder(filtered, progress), [filtered, progress]);
  const card = deck[Math.min(reviseIndex, Math.max(deck.length - 1, 0))];

  const selected = useMemo(
    () => filtered.find((q) => q.id === selectedId) ?? filtered[0],
    [filtered, selectedId],
  );

  const answer = (state: "known" | "review") => {
    if (!card) return;
    mark(card.id, state);
    setRevealed(false);
    setReviseIndex((i) => Math.min(i + 1, deck.length - 1));
  };

  const doExport = () => {
    const mine = custom;
    if (mine.length === 0) return toast.error("You have not added any questions yet");
    const blob = new Blob([exportQuestions(mine)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "devhelper-learn.json";
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${mine.length} question${mine.length === 1 ? "" : "s"}`);
  };

  return (
    <ToolShell
      toolId="learn-hub"
      title="Interview Prep"
      description="Question bank with examples, diagrams and follow-ups. Browse to learn, revise to test yourself."
      actions={
        <div className="flex items-center gap-1">
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const reader = new FileReader();
              reader.onload = () => {
                try {
                  const n = importIntoStore(importQuestions(String(reader.result)));
                  toast.success(`Imported ${n} question${n === 1 ? "" : "s"}`);
                } catch (err) {
                  toast.error((err as Error).message);
                }
              };
              reader.readAsText(file);
              e.target.value = "";
            }}
          />
          <Button size="sm" variant="ghost" onClick={() => fileRef.current?.click()} title="Import questions"><Upload /></Button>
          <Button size="sm" variant="ghost" onClick={doExport} title="Export your questions"><Download /></Button>
          <Button size="sm" onClick={() => setEditing(blankQuestion(topic))}><Plus /> Add</Button>
        </div>
      }
    >
      {editing ? (
        <QuestionEditor
          initial={editing}
          onCancel={() => setEditing(null)}
          onSaved={() => setEditing(null)}
        />
      ) : (
        <div className="flex flex-col gap-3">
          {/* Controls */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 rounded-md border border-border p-0.5">
              <ModeBtn active={mode === "browse"} onClick={() => setMode("browse")} icon={<BookOpen className="size-3.5" />} label="Browse" />
              <ModeBtn active={mode === "revise"} onClick={() => { setMode("revise"); setReviseIndex(0); setRevealed(false); }} icon={<RotateCcw className="size-3.5" />} label="Revise" />
              <ModeBtn active={mode === "stories"} onClick={() => setMode("stories")} icon={<MessageSquareQuote className="size-3.5" />} label="STAR stories" />
            </div>

            <Input
              className="h-8 w-64 text-xs"
              placeholder="Search questions, tags, answers…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <select className="h-8 rounded-md border border-input bg-transparent px-2 text-xs" value={topic} onChange={(e) => setTopic(e.target.value as TopicId | "all")}>
              <option value="all">All topics</option>
              {TOPICS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
            <select className="h-8 rounded-md border border-input bg-transparent px-2 text-xs" value={level} onChange={(e) => setLevel(e.target.value as Level | "all")}>
              <option value="all">All levels</option>
              {LEVELS.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
            </select>
            <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground">
              <input type="checkbox" checked={mustKnowOnly} onChange={(e) => setMustKnowOnly(e.target.checked)} />
              Must-know only
            </label>
            <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground">
              <input type="checkbox" checked={bookmarkedOnly} onChange={(e) => setBookmarkedOnly(e.target.checked)} />
              Bookmarked
            </label>

            <div className="ml-auto flex items-center gap-2 text-[11px] text-muted-foreground">
              <span>{overall.known}/{overall.total} known</span>
              <div className="h-1.5 w-24 overflow-hidden rounded-full bg-secondary">
                <div className="h-full bg-success transition-all" style={{ width: `${overall.percent}%` }} />
              </div>
              <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => resetProgress()} title="Reset all progress">
                Reset
              </Button>
            </div>
          </div>

          {mode === "stories" ? (
            <StarStories />
          ) : mode === "revise" ? (
            <ReviseCard
              card={card}
              index={reviseIndex}
              total={deck.length}
              revealed={revealed}
              onReveal={() => setRevealed(true)}
              onAnswer={answer}
              onSkip={() => { setRevealed(false); setReviseIndex((i) => Math.min(i + 1, deck.length - 1)); }}
              onRestart={() => { setReviseIndex(0); setRevealed(false); }}
            />
          ) : (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-[300px_1fr]">
              {/* List */}
              <div className="flex flex-col gap-2">
                <TopicProgress stats={stats} active={topic} onPick={setTopic} />
                <div className="h-[calc(100vh-400px)] min-h-64 overflow-auto rounded-md border border-border">
                  {filtered.length === 0 ? (
                    <p className="p-3 text-xs text-muted-foreground">No questions match these filters.</p>
                  ) : (
                    grouped.map((group) => (
                      <div key={group.subtopic}>
                        <div className="sticky top-0 bg-secondary/60 px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground backdrop-blur">
                          {group.subtopic}
                        </div>
                        {group.questions.map((q) => (
                          <button
                            key={q.id}
                            onClick={() => setSelectedId(q.id)}
                            className={cn(
                              "flex w-full items-start gap-2 border-b border-border/40 px-2 py-1.5 text-left text-xs hover:bg-muted/50",
                              selected?.id === q.id && "bg-muted",
                            )}
                          >
                            <span className={cn("mt-1 size-1.5 shrink-0 rounded-full",
                              progress[q.id] === "known" ? "bg-success" : progress[q.id] === "review" ? "bg-warning" : "bg-muted-foreground/30")} />
                            <span className="min-w-0 flex-1">{q.question}</span>
                            {q.mustKnow && <Star className="mt-0.5 size-3 shrink-0 fill-warning text-warning" />}
                          </button>
                        ))}
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Detail */}
              <div className="h-[calc(100vh-340px)] min-h-64 overflow-auto rounded-md border border-border p-4">
                {selected ? (
                  <QuestionDetail
                    question={selected}
                    state={progress[selected.id]}
                    bookmarked={bookmarks.includes(selected.id)}
                    isCustom={custom.some((c) => c.id === selected.id)}
                    onMark={(s) => mark(selected.id, progress[selected.id] === s ? null : s)}
                    onBookmark={() => toggleBookmark(selected.id)}
                    onEdit={() => setEditing(selected)}
                    onDelete={() => { deleteQuestion(selected.id); setSelectedId(null); }}
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">Select a question.</p>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </ToolShell>
  );
}

function ModeBtn({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className={cn("flex items-center gap-1 rounded px-2 py-1 text-xs", active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
    >
      {icon} {label}
    </button>
  );
}

function TopicProgress({
  stats,
  active,
  onPick,
}: {
  stats: { topic: TopicId; total: number; known: number }[];
  active: TopicId | "all";
  onPick: (t: TopicId | "all") => void;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      <button
        onClick={() => onPick("all")}
        className={cn("rounded border px-2 py-0.5 text-[11px]", active === "all" ? "border-primary text-primary" : "border-border text-muted-foreground hover:text-foreground")}
      >
        All
      </button>
      {TOPICS.map((t) => {
        const s = stats.find((x) => x.topic === t.id);
        if (!s) return null;
        return (
          <button
            key={t.id}
            onClick={() => onPick(t.id)}
            title={t.description}
            className={cn("rounded border px-2 py-0.5 text-[11px]", active === t.id ? "border-primary text-primary" : "border-border text-muted-foreground hover:text-foreground")}
          >
            {t.label} <span className="opacity-60">{s.known}/{s.total}</span>
          </button>
        );
      })}
    </div>
  );
}

function QuestionDetail({
  question,
  state,
  bookmarked,
  isCustom,
  onMark,
  onBookmark,
  onEdit,
  onDelete,
}: {
  question: Question;
  state?: "known" | "review";
  bookmarked: boolean;
  isCustom: boolean;
  onMark: (s: "known" | "review") => void;
  onBookmark: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [showFollowUps, setShowFollowUps] = useState(true);

  return (
    <article className="flex flex-col gap-3">
      <header className="flex flex-wrap items-start gap-2">
        <h2 className="min-w-0 flex-1 text-base font-semibold leading-snug">{question.question}</h2>
        <div className="flex shrink-0 items-center gap-1">
          <Button size="sm" variant={state === "known" ? "default" : "outline"} className="h-7 px-2 text-[11px]" onClick={() => onMark("known")}>
            <Check className="size-3" /> Known
          </Button>
          <Button size="sm" variant={state === "review" ? "default" : "outline"} className="h-7 px-2 text-[11px]" onClick={() => onMark("review")}>
            <RotateCcw className="size-3" /> Review
          </Button>
          <Button size="sm" variant="ghost" className="h-7 px-2" onClick={onBookmark} title="Bookmark">
            <Bookmark className={cn("size-3.5", bookmarked && "fill-primary text-primary")} />
          </Button>
          {isCustom && (
            <>
              <Button size="sm" variant="ghost" className="h-7 px-2" onClick={onEdit} title="Edit"><Pencil className="size-3.5" /></Button>
              <Button size="sm" variant="ghost" className="h-7 px-2" onClick={onDelete} title="Delete"><Trash2 className="size-3.5 text-destructive" /></Button>
            </>
          )}
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="secondary" className="text-[10px]">{TOPICS.find((t) => t.id === question.topic)?.label}</Badge>
        <Badge variant="outline" className="text-[10px]">{question.subtopic}</Badge>
        <Badge variant="outline" className="text-[10px]">{question.level}</Badge>
        {question.mustKnow && <Badge variant="warning" className="gap-1 text-[10px]"><Star className="size-2.5" /> must know</Badge>}
        {question.tags.map((t) => <span key={t} className="text-[10px] text-muted-foreground">#{t}</span>)}
      </div>

      <Markdown content={question.answer} />

      {question.diagram && (
        <div className="rounded-md border border-border bg-secondary/40">
          <div className="flex items-center justify-between border-b border-border px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
            Diagram
            <CopyButton value={question.diagram} className="h-5 px-1.5 text-[10px]" />
          </div>
          <pre className="mono overflow-x-auto p-3 text-[11px] leading-relaxed">{question.diagram}</pre>
        </div>
      )}

      {question.code && (
        <div className="group relative rounded-md border border-border bg-secondary/40">
          <div className="flex items-center justify-between border-b border-border px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
            {question.language ?? "code"}
            <CopyButton value={question.code} className="h-5 px-1.5 text-[10px]" />
          </div>
          <pre className="mono overflow-x-auto p-3 text-xs leading-relaxed">{question.code}</pre>
        </div>
      )}

      {question.followUps && question.followUps.length > 0 && (
        <section className="rounded-md border border-border">
          <button className="flex w-full items-center gap-1.5 px-3 py-2 text-xs font-medium" onClick={() => setShowFollowUps((v) => !v)}>
            {showFollowUps ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
            Follow-up questions ({question.followUps.length})
          </button>
          {showFollowUps && (
            <div className="divide-y divide-border border-t border-border">
              {question.followUps.map((f, i) => (
                <div key={i} className="px-3 py-2">
                  <p className="text-xs font-medium">{f.question}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{f.answer}</p>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </article>
  );
}

function ReviseCard({
  card,
  index,
  total,
  revealed,
  onReveal,
  onAnswer,
  onSkip,
  onRestart,
}: {
  card?: Question;
  index: number;
  total: number;
  revealed: boolean;
  onReveal: () => void;
  onAnswer: (s: "known" | "review") => void;
  onSkip: () => void;
  onRestart: () => void;
}) {
  if (!card) {
    return (
      <div className="grid h-64 place-items-center rounded-md border border-border text-sm text-muted-foreground">
        Nothing to revise with these filters.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <span>Card {index + 1} of {total}</span>
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-secondary">
          <div className="h-full bg-primary transition-all" style={{ width: `${((index + 1) / total) * 100}%` }} />
        </div>
        <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={onRestart}>Restart</Button>
      </div>

      <div className="min-h-[300px] rounded-md border border-border p-6">
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          <Badge variant="secondary" className="text-[10px]">{TOPICS.find((t) => t.id === card.topic)?.label}</Badge>
          <Badge variant="outline" className="text-[10px]">{card.level}</Badge>
          {card.mustKnow && <Badge variant="warning" className="text-[10px]">must know</Badge>}
        </div>

        <h2 className="text-lg font-semibold leading-snug">{card.question}</h2>

        {!revealed ? (
          <div className="mt-6 flex flex-col items-start gap-3">
            <p className="text-xs text-muted-foreground">Answer it out loud first — then reveal and compare.</p>
            <Button onClick={onReveal}><Eye /> Reveal answer</Button>
          </div>
        ) : (
          <div className="mt-4 flex flex-col gap-3">
            <Markdown content={card.answer} />
            {card.diagram && <pre className="mono overflow-x-auto rounded-md border border-border bg-secondary/40 p-3 text-[11px]">{card.diagram}</pre>}
            {card.code && <pre className="mono overflow-x-auto rounded-md border border-border bg-secondary/40 p-3 text-xs">{card.code}</pre>}
            {card.followUps?.map((f, i) => (
              <div key={i} className="rounded border border-border px-3 py-2">
                <p className="text-xs font-medium">{f.question}</p>
                <p className="mt-1 text-xs text-muted-foreground">{f.answer}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" onClick={() => onAnswer("review")}><RotateCcw /> Needs review</Button>
        <Button onClick={() => onAnswer("known")}><Check /> I knew it</Button>
        <Button variant="ghost" onClick={onSkip}><EyeOff /> Skip</Button>
      </div>
    </div>
  );
}

function blankQuestion(topic: TopicId | "all"): Question {
  return {
    id: "",
    topic: topic === "all" ? "csharp" : topic,
    subtopic: "My questions",
    level: "intermediate",
    question: "",
    answer: "",
    tags: [],
  };
}

function QuestionEditor({
  initial,
  onCancel,
  onSaved,
}: {
  initial: Question;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const addQuestion = useLearnStore((s) => s.addQuestion);
  const updateQuestion = useLearnStore((s) => s.updateQuestion);
  const [q, setQ] = useState<Question>(initial);
  const patch = (p: Partial<Question>) => setQ((cur) => ({ ...cur, ...p }));

  const save = () => {
    if (!q.question.trim() || !q.answer.trim()) return toast.error("A question and an answer are required");
    if (q.id) updateQuestion(q);
    else addQuestion(q);
    toast.success("Saved");
    onSaved();
  };

  return (
    <div className="max-w-3xl">
      <h3 className="mb-3 text-sm font-semibold">{q.id ? "Edit" : "New"} question</h3>
      <div className="flex flex-col gap-3">
        <Field label="Question">
          <Input value={q.question} onChange={(e) => patch({ question: e.target.value })} placeholder="What is …?" />
        </Field>

        <div className="grid grid-cols-3 gap-2">
          <Field label="Topic">
            <select className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm" value={q.topic} onChange={(e) => patch({ topic: e.target.value as TopicId })}>
              {TOPICS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </Field>
          <Field label="Subtopic">
            <Input value={q.subtopic} onChange={(e) => patch({ subtopic: e.target.value })} placeholder="Collections" />
          </Field>
          <Field label="Level">
            <select className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm" value={q.level} onChange={(e) => patch({ level: e.target.value as Level })}>
              {LEVELS.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
            </select>
          </Field>
        </div>

        <Field label="Answer (Markdown: ## heading, - list, **bold**, `code`)">
          <Textarea className="min-h-40" value={q.answer} onChange={(e) => patch({ answer: e.target.value })} />
        </Field>

        <div className="grid grid-cols-[140px_1fr] gap-2">
          <Field label="Language">
            <Input value={q.language ?? ""} onChange={(e) => patch({ language: e.target.value })} placeholder="csharp" />
          </Field>
          <Field label="Code example (optional)">
            <Textarea mono className="min-h-32 text-xs" value={q.code ?? ""} onChange={(e) => patch({ code: e.target.value })} />
          </Field>
        </div>

        <Field label="ASCII diagram (optional)">
          <Textarea mono className="min-h-24 text-xs" value={q.diagram ?? ""} onChange={(e) => patch({ diagram: e.target.value })} />
        </Field>

        <Field label="Tags (comma separated)">
          <Input
            value={q.tags.join(", ")}
            onChange={(e) => patch({ tags: e.target.value.split(",").map((t) => t.trim()).filter(Boolean) })}
            placeholder="async, threading"
          />
        </Field>

        <FollowUpEditor
          followUps={q.followUps ?? []}
          onChange={(followUps) => patch({ followUps })}
        />

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={!!q.mustKnow} onChange={(e) => patch({ mustKnow: e.target.checked })} />
          Mark as must-know
        </label>

        <div className="flex gap-2">
          <Button size="sm" onClick={save}>Save</Button>
          <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
        </div>
      </div>
    </div>
  );
}

function FollowUpEditor({
  followUps,
  onChange,
}: {
  followUps: { question: string; answer: string }[];
  onChange: (f: { question: string; answer: string }[]) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-medium text-muted-foreground">Follow-up questions</span>
      {followUps.map((f, i) => (
        <div key={i} className="flex flex-col gap-1 rounded border border-border p-2">
          <div className="flex items-center gap-2">
            <Input
              className="h-8 text-xs"
              value={f.question}
              onChange={(e) => onChange(followUps.map((x, j) => (j === i ? { ...x, question: e.target.value } : x)))}
              placeholder="Follow-up question"
            />
            <button className="text-muted-foreground hover:text-destructive" aria-label="Remove follow-up" onClick={() => onChange(followUps.filter((_, j) => j !== i))}>
              <Trash2 className="size-3.5" />
            </button>
          </div>
          <Textarea
            className="min-h-16 text-xs"
            value={f.answer}
            onChange={(e) => onChange(followUps.map((x, j) => (j === i ? { ...x, answer: e.target.value } : x)))}
            placeholder="Short answer"
          />
        </div>
      ))}
      <Button size="sm" variant="outline" className="self-start" onClick={() => onChange([...followUps, { question: "", answer: "" }])}>
        <Plus /> Add follow-up
      </Button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
