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
  FileText,
  BarChart3,
  Trash2,
  Upload,
  MessageSquareQuote,
  Map as MapIcon,
  ArrowRight,
  Wrench,
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
import { useAppStore } from "@/stores/useAppStore";
import { getTool } from "@/tools/registry";
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
import { SKILLS, TRACKS, bandLabel, nextSkill, type Band, type Skill } from "@/tools/lib/learn/roadmap";
import {
  GRADES,
  dueCards,
  previewIntervals,
  srsStats,
  streakDays,
  weakAreas,
  MATURE_DAYS,
  type Grade,
} from "@/tools/lib/learn/srs";

type Mode = "browse" | "revise" | "sheet" | "stats" | "stories" | "roadmap";

export function LearnHub() {
  const custom = useLearnStore((s) => s.custom);
  const progress = useLearnStore((s) => s.progress);
  const bookmarks = useLearnStore((s) => s.bookmarks);
  const hidden = useLearnStore((s) => s.hidden);
  const mark = useLearnStore((s) => s.mark);
  const reviews = useLearnStore((s) => s.reviews);
  const gradeCard = useLearnStore((s) => s.gradeCard);
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
  const topicCounts = useMemo(() => topicStats(all, progress), [all, progress]);
  const overall = useMemo(() => overallProgress(all, progress), [all, progress]);

  // Revision is driven by the schedule: due cards first, weakest of those first.
  const now = Date.now();
  const due = useMemo(() => dueCards(filtered, reviews, now), [filtered, reviews, now]);
  const deck = due.length > 0 ? due : reviseOrder(filtered, progress);
  const card = deck[Math.min(reviseIndex, Math.max(deck.length - 1, 0))];

  const srs = useMemo(() => srsStats(all, reviews, Date.now()), [all, reviews]);
  const streak = useMemo(() => streakDays(reviews, Date.now()), [reviews]);
  const weak = useMemo(
    () => weakAreas(all, reviews, (q) => q.topic, (key) => TOPICS.find((t) => t.id === key)?.label ?? key),
    [all, reviews],
  );
  const intervals = useMemo(() => (card ? previewIntervals(reviews[card.id], Date.now()) : null), [card, reviews]);

  const selected = useMemo(
    () => filtered.find((q) => q.id === selectedId) ?? filtered[0],
    [filtered, selectedId],
  );

  const answer = (grade: Grade) => {
    if (!card) return;
    gradeCard(card.id, grade);
    setRevealed(false);
    // "again" leaves the card due, so it returns later in the same session.
    setReviseIndex((i) => i + 1);
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
              <ModeBtn active={mode === "sheet"} onClick={() => setMode("sheet")} icon={<FileText className="size-3.5" />} label="Cheat sheet" />
              <ModeBtn active={mode === "stats"} onClick={() => setMode("stats")} icon={<BarChart3 className="size-3.5" />} label="Stats" />
              <ModeBtn active={mode === "roadmap"} onClick={() => setMode("roadmap")} icon={<MapIcon className="size-3.5" />} label="Roadmap" />
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

          {mode === "roadmap" ? (
            <RoadmapView
              questions={all}
              progress={progress}
              onStudy={(topic) => { setTopic(topic); setMode("revise"); setReviseIndex(0); setRevealed(false); }}
            />
          ) : mode === "stories" ? (
            <StarStories />
          ) : mode === "sheet" ? (
            <CheatSheet questions={filtered} />
          ) : mode === "stats" ? (
            <StatsView stats={srs} streak={streak} weak={weak} onPickTopic={(t) => { setTopic(t); setMode("revise"); setReviseIndex(0); }} />
          ) : mode === "revise" ? (
            <ReviseCard
              card={card}
              index={reviseIndex}
              total={deck.length}
              dueCount={due.length}
              intervals={intervals}
              revealed={revealed}
              onReveal={() => setRevealed(true)}
              onAnswer={answer}
              onSkip={() => { setRevealed(false); setReviseIndex((i) => i + 1); }}
              onRestart={() => { setReviseIndex(0); setRevealed(false); }}
            />
          ) : (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-[300px_1fr]">
              {/* List */}
              <div className="flex flex-col gap-2">
                <TopicProgress stats={topicCounts} active={topic} onPick={setTopic} />
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

      <PractiseIn tools={question.relatedTools} />
    </article>
  );
}

/**
 * The tools a card can be practised in.
 *
 * Reading that MLLP has no length prefix and watching a reader stall on a
 * missing one are different acts, and the second is where the understanding
 * is. The card knows which tool; this opens it.
 */
function PractiseIn({ tools }: { tools?: string[] }) {
  const openTool = useAppStore((s) => s.openTool);
  const available = (tools ?? []).map(getTool).filter((t): t is NonNullable<ReturnType<typeof getTool>> => !!t);
  if (!available.length) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5 border-t border-border pt-2">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Practise in</span>
      {available.map((tool) => (
        <Button key={tool.id} size="sm" variant="outline" className="h-6 gap-1 px-2 text-[11px]" onClick={() => openTool(tool.id)}>
          <tool.icon className="size-3" /> {tool.name}
        </Button>
      ))}
    </div>
  );
}

/**
 * The roadmap: what to learn next, in what order, and how far through you are.
 *
 * The browse and revise views answer "what exists" and "what is due". Neither
 * answers "what should I do this evening", which is the question that actually
 * stalls revision — so this one is ranked, shows progress against each rank,
 * and names the single next thing.
 */
function RoadmapView({
  questions,
  progress,
  onStudy,
}: {
  questions: Question[];
  progress: Record<string, "known" | "review">;
  onStudy: (topic: TopicId) => void;
}) {
  const openTool = useAppStore((s) => s.openTool);

  const byTopic = useMemo(() => {
    const totals = new Map<TopicId, { total: number; known: number }>();
    for (const q of questions) {
      const entry = totals.get(q.topic) ?? { total: 0, known: 0 };
      entry.total++;
      if (progress[q.id] === "known") entry.known++;
      totals.set(q.topic, entry);
    }
    return totals;
  }, [questions, progress]);

  const fraction = (topic: TopicId) => {
    const entry = byTopic.get(topic);
    return entry && entry.total ? entry.known / entry.total : 0;
  };

  const next = useMemo(() => nextSkill(fraction), [byTopic]);
  const bands: Band[] = ["critical", "important", "useful"];

  return (
    <div className="space-y-4">
      {next && (
        <section className="rounded-lg border border-primary/40 bg-primary/5 p-3">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Study next</div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className="text-base font-semibold">{next.rank}. {next.name}</span>
            <Badge variant="outline" className="text-[10px]">target {"★".repeat(next.target)}</Badge>
            <Badge variant="secondary" className="text-[10px]">{Math.round(fraction(next.topic) * 100)}% known</Badge>
            <Button size="sm" className="h-7 gap-1 px-2 text-xs" onClick={() => onStudy(next.topic)}>
              Revise <ArrowRight className="size-3" />
            </Button>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{next.why}</p>
        </section>
      )}

      {bands.map((band) => (
        <section key={band}>
          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {bandLabel(band)}
          </h3>
          <div className="space-y-1">
            {SKILLS.filter((s) => s.band === band).map((skill) => (
              <SkillRow
                key={skill.rank}
                skill={skill}
                known={fraction(skill.topic)}
                cards={byTopic.get(skill.topic)?.total ?? 0}
                onStudy={() => onStudy(skill.topic)}
                onOpenTool={openTool}
              />
            ))}
          </div>
        </section>
      ))}

      <section className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Checklists — say the line for every item and you can hold that conversation
        </h3>
        {TRACKS.map((track) => (
          <details key={track.id} className="rounded-lg border border-border">
            <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
              {track.label} <span className="text-xs font-normal text-muted-foreground">— {track.intent}</span>
            </summary>
            <div className="divide-y divide-border border-t border-border">
              {track.items.map((item) => (
                <div key={item.name} className="flex gap-2 px-3 py-1.5">
                  <span
                    className={cn(
                      "mt-1 size-1.5 shrink-0 rounded-full",
                      item.band === "critical" ? "bg-destructive" : item.band === "important" ? "bg-warning" : "bg-muted-foreground",
                    )}
                  />
                  <div className="min-w-0">
                    <div className="text-xs font-medium">{item.name}</div>
                    <div className="text-xs text-muted-foreground">{item.must}</div>
                  </div>
                </div>
              ))}
            </div>
          </details>
        ))}
      </section>
    </div>
  );
}

function SkillRow({
  skill,
  known,
  cards,
  onStudy,
  onOpenTool,
}: {
  skill: Skill;
  known: number;
  cards: number;
  onStudy: () => void;
  onOpenTool: (toolId: string) => void;
}) {
  const tools = (skill.tools ?? []).map(getTool).filter((t): t is NonNullable<ReturnType<typeof getTool>> => !!t);

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-border px-2.5 py-1.5">
      <span className="w-6 shrink-0 text-xs tabular-nums text-muted-foreground">{skill.rank}</span>
      <button className="min-w-0 flex-1 text-left" onClick={onStudy} disabled={!cards}>
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium">{skill.name}</span>
          <span className="text-[10px] text-warning">{"★".repeat(skill.target)}</span>
        </div>
        <div className="truncate text-[11px] text-muted-foreground">{skill.why}</div>
      </button>

      <div className="flex shrink-0 items-center gap-2">
        {cards > 0 ? (
          <>
            <div className="h-1.5 w-20 overflow-hidden rounded-full bg-secondary">
              <div className="h-full bg-primary" style={{ width: `${Math.round(known * 100)}%` }} />
            </div>
            <span className="w-9 text-right text-[10px] tabular-nums text-muted-foreground">{Math.round(known * 100)}%</span>
          </>
        ) : (
          <span className="text-[10px] text-muted-foreground">no cards yet</span>
        )}
        {tools.map((tool) => (
          <button
            key={tool.id}
            title={`Practise in ${tool.name}`}
            aria-label={`Practise in ${tool.name}`}
            onClick={() => onOpenTool(tool.id)}
            className="text-muted-foreground hover:text-foreground"
          >
            <Wrench className="size-3.5" />
          </button>
        ))}
      </div>
    </div>
  );
}

function ReviseCard({
  card,
  index,
  total,
  dueCount,
  intervals,
  revealed,
  onReveal,
  onAnswer,
  onSkip,
  onRestart,
}: {
  card?: Question;
  index: number;
  total: number;
  dueCount: number;
  intervals: Record<Grade, string> | null;
  revealed: boolean;
  onReveal: () => void;
  onAnswer: (g: Grade) => void;
  onSkip: () => void;
  onRestart: () => void;
}) {
  if (!card) {
    return (
      <div className="grid h-64 place-items-center rounded-md border border-border text-center text-sm text-muted-foreground">
        <div>
          <p>Nothing due right now.</p>
          <p className="mt-1 text-xs">Everything with these filters is scheduled for later — come back tomorrow, or widen the filters.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <span>Card {index + 1} of {total}</span>
        {dueCount > 0 && <Badge variant="outline" className="text-[10px]">{dueCount} due</Badge>}
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

      {/* Grading drives the schedule, so each button shows when the card returns. */}
      <div className="flex flex-wrap items-center gap-2">
        {revealed ? (
          GRADES.map((g) => (
            <Button
              key={g.id}
              variant={g.id === "good" ? "default" : "outline"}
              title={g.hint}
              onClick={() => onAnswer(g.id)}
            >
              {g.label}
              {intervals && <span className="ml-1.5 text-[11px] opacity-70">{intervals[g.id]}</span>}
            </Button>
          ))
        ) : (
          <p className="text-xs text-muted-foreground">Reveal the answer to grade it.</p>
        )}
        <Button variant="ghost" onClick={onSkip}><EyeOff /> Skip</Button>
      </div>
    </div>
  );
}

/** A condensed one-pager: every question with the first line of its answer. */
function CheatSheet({ questions }: { questions: Question[] }) {
  const grouped = useMemo(() => groupBySubtopic(questions), [questions]);

  const text = useMemo(
    () =>
      grouped
        .map((g) => `## ${g.subtopic}\n` + g.questions.map((q) => `- ${q.question}\n  ${firstLine(q.answer)}`).join("\n"))
        .join("\n\n"),
    [grouped],
  );

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <p className="text-[11px] text-muted-foreground">
          {questions.length} questions condensed to one line each — for the morning of the interview.
        </p>
        <CopyButton value={text} label="Copy sheet" className="ml-auto h-7 px-2 text-[11px]" />
      </div>

      <div className="h-[calc(100vh-340px)] min-h-64 overflow-auto rounded-md border border-border p-4">
        {grouped.map((group) => (
          <section key={group.subtopic} className="mb-4">
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group.subtopic}</h3>
            <ul className="space-y-1.5">
              {group.questions.map((q) => (
                <li key={q.id} className="text-xs">
                  <span className="font-medium">{q.question}</span>
                  {q.mustKnow && <Star className="ml-1 inline size-2.5 fill-warning text-warning" />}
                  <span className="block text-muted-foreground">{firstLine(q.answer)}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

/** First meaningful line of a Markdown answer, with the formatting stripped. */
function firstLine(answer: string): string {
  const line = answer
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith("#") && !l.startsWith("|"));

  return (line ?? "")
    .replace(/^[-*]\s+/, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/`(.+?)`/g, "$1")
    .slice(0, 200);
}

function StatsView({
  stats,
  streak,
  weak,
  onPickTopic,
}: {
  stats: ReturnType<typeof srsStats>;
  streak: number;
  weak: ReturnType<typeof weakAreas>;
  onPickTopic: (t: TopicId) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Due now" value={stats.dueNow} accent={stats.dueNow > 0 ? "text-warning" : undefined} />
        <Stat label="Reviewed today" value={stats.reviewsToday} />
        <Stat label="Day streak" value={streak} accent={streak > 0 ? "text-success" : undefined} />
        <Stat label="Retention" value={`${stats.retention}%`} accent={stats.retention >= 85 ? "text-success" : stats.retention > 0 ? "text-warning" : undefined} />
        <Stat label={`Mature (${MATURE_DAYS}d+)`} value={stats.mature} />
        <Stat label="Not seen" value={stats.unseen} />
      </div>

      <div>
        <p className="mb-1 text-xs font-medium">Coverage</p>
        <div className="flex h-2 overflow-hidden rounded-full bg-secondary">
          <div className="bg-success" style={{ width: `${pct(stats.mature, stats.total)}%` }} title={`${stats.mature} mature`} />
          <div className="bg-warning" style={{ width: `${pct(stats.learning, stats.total)}%` }} title={`${stats.learning} learning`} />
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">
          {stats.mature} mature · {stats.learning} learning · {stats.unseen} unseen of {stats.total}
        </p>
      </div>

      <div>
        <p className="mb-1 text-xs font-medium">Where you are losing</p>
        <p className="mb-2 text-[11px] text-muted-foreground">
          Ranked by how often a card in that topic was graded “Again”. Click one to revise it.
        </p>
        <div className="flex flex-col gap-1">
          {weak.filter((w) => w.failureRate > 0 || w.weak > 0).length === 0 ? (
            <p className="text-xs text-muted-foreground">No failures recorded yet — grade some cards first.</p>
          ) : (
            weak
              .filter((w) => w.failureRate > 0 || w.weak > 0)
              .map((w) => (
                <button
                  key={w.key}
                  onClick={() => onPickTopic(w.key as TopicId)}
                  className="flex items-center gap-2 rounded border border-border px-2 py-1 text-left text-xs hover:bg-muted"
                >
                  <span className="w-32 shrink-0">{w.label}</span>
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary">
                    <div className="h-full bg-destructive" style={{ width: `${Math.min(w.failureRate, 100)}%` }} />
                  </div>
                  <span className="w-28 shrink-0 text-right text-muted-foreground">
                    {w.failureRate}% failed · {w.weak} weak
                  </span>
                </button>
              ))
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string | number; accent?: string }) {
  return (
    <div className="rounded-md border border-border p-2">
      <div className={cn("text-lg font-semibold", accent)}>{value}</div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}

function pct(n: number, total: number): number {
  return total === 0 ? 0 : Math.round((n / total) * 100);
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
