import { useMemo, useState } from "react";
import { AlertTriangle, Check, Eye, Plus, Trash2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { CopyButton } from "@/components/CopyButton";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { useLearnStore } from "@/stores/useLearnStore";
import {
  COMPETENCIES,
  STAR_PROMPTS,
  coverage,
  emptyStory,
  reviewStory,
  storyScore,
  storyToText,
  uncoveredPrompts,
  type StarPrompt,
  type StarStory,
} from "@/tools/lib/learn/star";

type View = "prompts" | "stories" | "practice";

/**
 * Behavioural preparation: the questions, your stories, and a practice mode.
 *
 * Kept separate from the question bank because the workflow is different — you write
 * these rather than read them, and the value is in the specificity of your own examples.
 */
export function StarStories() {
  const stories = useLearnStore((s) => s.stories);
  const saveStory = useLearnStore((s) => s.saveStory);
  const deleteStory = useLearnStore((s) => s.deleteStory);

  const [view, setView] = useState<View>("prompts");
  const [editing, setEditing] = useState<StarStory | null>(null);
  const [practiceIndex, setPracticeIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);

  const gaps = useMemo(() => coverage(stories), [stories]);
  const todo = useMemo(() => uncoveredPrompts(stories), [stories]);
  const answeredPromptIds = useMemo(() => new Set(stories.flatMap((s) => s.promptIds)), [stories]);

  const readiness = useMemo(() => {
    if (stories.length === 0) return 0;
    return Math.round(stories.reduce((n, s) => n + storyScore(s), 0) / stories.length);
  }, [stories]);

  if (editing) {
    return (
      <StoryEditor
        initial={editing}
        onCancel={() => setEditing(null)}
        onSave={(story) => {
          saveStory(story);
          toast.success("Story saved");
          setEditing(null);
        }}
      />
    );
  }

  const practiceDeck = stories.length > 0 ? stories : [];
  const practiceStory = practiceDeck[practiceIndex % Math.max(practiceDeck.length, 1)];
  const practicePrompt = practiceStory
    ? STAR_PROMPTS.find((p) => practiceStory.promptIds.includes(p.id))
    : undefined;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 rounded-md border border-border p-0.5">
          <Tab active={view === "prompts"} onClick={() => setView("prompts")} label={`Questions (${STAR_PROMPTS.length})`} />
          <Tab active={view === "stories"} onClick={() => setView("stories")} label={`My stories (${stories.length})`} />
          <Tab active={view === "practice"} onClick={() => { setView("practice"); setRevealed(false); }} label="Practice" />
        </div>

        <Button size="sm" onClick={() => setEditing(emptyStory(""))}><Plus /> New story</Button>

        {stories.length > 0 && (
          <div className="ml-auto flex items-center gap-2 text-[11px] text-muted-foreground">
            <span>Story quality {readiness}%</span>
            <div className="h-1.5 w-24 overflow-hidden rounded-full bg-secondary">
              <div
                className={cn("h-full transition-all", readiness >= 75 ? "bg-success" : readiness >= 50 ? "bg-warning" : "bg-destructive")}
                style={{ width: `${readiness}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {view === "prompts" && (
        <div className="flex flex-col gap-3">
          <div className="rounded-md border border-border bg-muted/20 p-3 text-xs">
            <p className="mb-1 font-medium">How to answer</p>
            <p className="text-muted-foreground">
              <b>Situation</b> — context in two sentences. <b>Task</b> — your specific responsibility, not the
              team's goal. <b>Action</b> — what <i>you</i> did, step by step, in the first person.
              <b> Result</b> — the outcome with a number. Then one line on what you would do differently.
              Six well-rehearsed stories cover almost every behavioural question, because most questions are
              the same story viewed from a different angle.
            </p>
          </div>

          {/* Coverage */}
          <div className="flex flex-wrap gap-1.5">
            {gaps.map((g) => {
              const meta = COMPETENCIES.find((c) => c.id === g.competency)!;
              return (
                <span
                  key={g.competency}
                  title={meta.description}
                  className={cn(
                    "rounded border px-2 py-0.5 text-[11px]",
                    g.covered === 0 ? "border-destructive/40 text-destructive" : "border-success/40 text-success",
                  )}
                >
                  {meta.label} {g.covered}/{g.prompts}
                </span>
              );
            })}
          </div>

          {todo.length > 0 && (
            <p className="text-[11px] text-muted-foreground">
              <Sparkles className="mr-1 inline size-3" />
              Write next: <b>{todo[0].question}</b> — it covers a competency you have nothing for.
            </p>
          )}

          <div className="flex flex-col divide-y divide-border rounded-md border border-border">
            {STAR_PROMPTS.map((prompt) => (
              <PromptRow
                key={prompt.id}
                prompt={prompt}
                answered={answeredPromptIds.has(prompt.id)}
                onWrite={() => setEditing(emptyStory("", prompt.id))}
              />
            ))}
          </div>
        </div>
      )}

      {view === "stories" && (
        <div className="flex flex-col gap-2">
          {stories.length === 0 ? (
            <div className="grid h-48 place-items-center rounded-md border border-border text-sm text-muted-foreground">
              No stories yet. Start from a question on the Questions tab.
            </div>
          ) : (
            stories.map((story) => {
              const issues = reviewStory(story);
              const score = storyScore(story);
              return (
                <div key={story.id} className="rounded-md border border-border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-sm">{story.title || "(untitled)"}</span>
                    <Badge variant={score >= 75 ? "success" : score >= 50 ? "warning" : "destructive"} className="text-[10px]">
                      {score}%
                    </Badge>
                    {story.promptIds.map((id) => {
                      const p = STAR_PROMPTS.find((x) => x.id === id);
                      return p ? <span key={id} className="text-[10px] text-muted-foreground">{p.question}</span> : null;
                    })}
                    <div className="ml-auto flex items-center gap-1">
                      <CopyButton value={storyToText(story)} label="Copy" className="h-6 px-2 text-[10px]" />
                      <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]" onClick={() => setEditing(story)}>Edit</Button>
                      <Button size="sm" variant="ghost" className="h-6 px-2" onClick={() => deleteStory(story.id)} title="Delete">
                        <Trash2 className="size-3.5 text-destructive" />
                      </Button>
                    </div>
                  </div>

                  {issues.length > 0 && (
                    <ul className="mt-2 space-y-0.5">
                      {issues.map((issue, i) => (
                        <li key={i} className={cn("flex items-start gap-1.5 text-[11px]", issue.severity === "error" ? "text-destructive" : "text-warning")}>
                          <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                          <span><b>{issue.field}</b> — {issue.message}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {view === "practice" && (
        <div className="flex flex-col gap-3">
          {!practiceStory ? (
            <div className="grid h-48 place-items-center rounded-md border border-border text-sm text-muted-foreground">
              Write a story first, then practise it here.
            </div>
          ) : (
            <>
              <div className="min-h-[260px] rounded-md border border-border p-6">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Interviewer asks</p>
                <h3 className="mt-1 text-lg font-semibold">
                  {practicePrompt?.question ?? practiceStory.title}
                </h3>
                {practicePrompt && (
                  <p className="mt-2 text-xs text-muted-foreground">Assessing: {practicePrompt.looksFor}</p>
                )}

                {!revealed ? (
                  <div className="mt-6 flex flex-col items-start gap-3">
                    <p className="text-xs text-muted-foreground">
                      Say the whole story out loud — aim for 90 seconds — then reveal and check you hit every part.
                    </p>
                    <Button onClick={() => setRevealed(true)}><Eye /> Reveal my story</Button>
                  </div>
                ) : (
                  <dl className="mt-4 space-y-2 text-sm">
                    {(["situation", "task", "action", "result", "reflection"] as const).map((field) =>
                      practiceStory[field] ? (
                        <div key={field} className="grid grid-cols-[90px_1fr] gap-2">
                          <dt className="text-xs uppercase tracking-wide text-muted-foreground">{field}</dt>
                          <dd className="whitespace-pre-wrap">{practiceStory[field]}</dd>
                        </div>
                      ) : null,
                    )}
                  </dl>
                )}
              </div>

              <div className="flex items-center gap-2">
                <Button variant="outline" onClick={() => { setPracticeIndex((i) => i + 1); setRevealed(false); }}>
                  Next story
                </Button>
                <span className="text-[11px] text-muted-foreground">
                  {(practiceIndex % practiceDeck.length) + 1} of {practiceDeck.length}
                </span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Tab({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={cn("rounded px-2 py-1 text-xs", active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
    >
      {label}
    </button>
  );
}

function PromptRow({ prompt, answered, onWrite }: { prompt: StarPrompt; answered: boolean; onWrite: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={cn("px-3 py-2", answered && "bg-success/5")}>
      <div className="flex items-start gap-2">
        <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", answered ? "bg-success" : "bg-muted-foreground/30")} />
        <button className="min-w-0 flex-1 text-left text-xs" onClick={() => setOpen((v) => !v)}>
          <span className="font-medium">{prompt.question}</span>
          <span className="ml-2 text-muted-foreground">
            {COMPETENCIES.find((c) => c.id === prompt.competency)?.label}
          </span>
        </button>
        {answered ? (
          <Badge variant="success" className="shrink-0 gap-1 text-[10px]"><Check className="size-2.5" /> covered</Badge>
        ) : (
          <Button size="sm" variant="ghost" className="h-6 shrink-0 px-2 text-[10px]" onClick={onWrite}>Write</Button>
        )}
      </div>

      {open && (
        <div className="mt-2 pl-4 text-[11px]">
          <p className="text-muted-foreground"><b>Assessing:</b> {prompt.looksFor}</p>
          <p className="mt-1 text-muted-foreground"><b>Also asked as:</b></p>
          <ul className="list-disc pl-4 text-muted-foreground">
            {prompt.variants.map((v) => <li key={v}>{v}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

function StoryEditor({
  initial,
  onCancel,
  onSave,
}: {
  initial: StarStory;
  onCancel: () => void;
  onSave: (s: StarStory) => void;
}) {
  const [story, setStory] = useState<StarStory>(initial);
  const patch = (p: Partial<StarStory>) => setStory((s) => ({ ...s, ...p }));
  const issues = reviewStory(story);
  const score = storyScore(story);

  const field = (name: "situation" | "task" | "action" | "result" | "reflection") =>
    issues.filter((i) => i.field === name);

  const HINTS = {
    situation: "Where, when, what was at stake. Two sentences.",
    task: "Your specific responsibility — not the team's objective.",
    action: "What you did, in order, in the first person. This is the longest section.",
    result: "Outcome with a number: latency, error rate, hours, revenue, users.",
    reflection: "What you would do differently, or what it changed in how you work.",
  } as const;

  return (
    <div className="max-w-3xl">
      <div className="mb-3 flex items-center gap-2">
        <h3 className="text-sm font-semibold">{initial.id ? "Edit" : "New"} story</h3>
        <Badge variant={score >= 75 ? "success" : score >= 50 ? "warning" : "destructive"} className="text-[10px]">{score}%</Badge>
      </div>

      <div className="flex flex-col gap-3">
        <Labelled label="Title (how you will recall it)">
          <Input value={story.title} onChange={(e) => patch({ title: e.target.value })} placeholder="The MSSQL outage nobody could reproduce" />
        </Labelled>

        <Labelled label="Answers these questions">
          <div className="flex max-h-40 flex-col gap-1 overflow-auto rounded-md border border-border p-2">
            {STAR_PROMPTS.map((p) => (
              <label key={p.id} className="flex cursor-pointer items-start gap-2 text-[11px]">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={story.promptIds.includes(p.id)}
                  onChange={(e) =>
                    patch({
                      promptIds: e.target.checked
                        ? [...story.promptIds, p.id]
                        : story.promptIds.filter((x) => x !== p.id),
                    })
                  }
                />
                <span>{p.question}</span>
              </label>
            ))}
          </div>
        </Labelled>

        {(["situation", "task", "action", "result", "reflection"] as const).map((name) => (
          <Labelled key={name} label={name[0].toUpperCase() + name.slice(1)}>
            <Textarea
              className={cn("min-h-24", name === "action" && "min-h-36")}
              value={story[name] ?? ""}
              onChange={(e) => patch({ [name]: e.target.value } as Partial<StarStory>)}
              placeholder={HINTS[name]}
            />
            <p className="text-[11px] text-muted-foreground">{HINTS[name]}</p>
            {field(name).map((issue, i) => (
              <p key={i} className={cn("text-[11px]", issue.severity === "error" ? "text-destructive" : "text-warning")}>
                {issue.message}
              </p>
            ))}
          </Labelled>
        ))}

        <Labelled label="Tags">
          <Input
            value={story.tags.join(", ")}
            onChange={(e) => patch({ tags: e.target.value.split(",").map((t) => t.trim()).filter(Boolean) })}
            placeholder="incident, sql server, ownership"
          />
        </Labelled>

        <div className="flex gap-2">
          <Button size="sm" onClick={() => onSave(story)}>Save</Button>
          <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
          <CopyButton value={storyToText(story)} label="Copy as text" className="ml-auto" />
        </div>
      </div>
    </div>
  );
}

function Labelled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
