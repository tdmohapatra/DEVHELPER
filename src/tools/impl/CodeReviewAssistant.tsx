import { useMemo, useState } from "react";
import { AlertTriangle, ListChecks, ScanText, Sparkles } from "lucide-react";
import { ToolShell } from "@/components/ToolShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { CopyButton } from "@/components/CopyButton";
import { Markdown } from "@/components/Markdown";
import { cn } from "@/lib/utils";
import { aiChat, AiNotConfiguredError, PhiBlockedError, activePolicy } from "@/lib/ai";
import { useAiStore } from "@/stores/useAiStore";
import {
  AI_SYSTEM_PROMPT,
  buildAiPrompt,
  CHECKLIST,
  detectLanguage,
  review,
  tally,
  toComments,
  type Language,
  type Severity,
} from "@/tools/lib/codeReview";

const SEVERITY_CLASS: Record<Severity, string> = {
  high: "text-destructive",
  medium: "text-warning",
  low: "text-muted-foreground",
};

const SAMPLE = [
  "public async Task<Result> HandleAsync(OrderMessage message)",
  "{",
  "    var client = new HttpClient();",
  '    _logger.LogInformation("received {Body}", message.Body);',
  "    var receivedAt = DateTime.Now;",
  "",
  "    var fields = message.Raw.Split('|');",
  "    var mrn = fields[3];",
  "",
  '    var sql = "SELECT * FROM Orders WHERE Mrn = \'" + mrn + "\'";',
  "",
  "    try",
  "    {",
  "        var response = client.PostAsync(_url, content).Result;",
  "    }",
  "    catch (Exception) { }",
  "",
  "    return Result.Ok();",
  "}",
].join("\n");

export function CodeReviewAssistant() {
  const [code, setCode] = useState(SAMPLE);
  const [file, setFile] = useState("OrderHandler.cs");
  const [language, setLanguage] = useState<Language | "auto">("auto");
  const [aiOutput, setAiOutput] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState("");
  const [checked, setChecked] = useState<Set<string>>(new Set());

  const configured = useAiStore((s) => s.isConfigured());
  const resolved: Language = language === "auto" ? detectLanguage(code) : language;
  const findings = useMemo(() => review(code, resolved), [code, resolved]);
  const counts = tally(findings);
  const policy = activePolicy();

  const runAi = async () => {
    setAiBusy(true);
    setAiError("");
    setAiOutput("");
    try {
      const answer = await aiChat(
        [
          { role: "system", content: AI_SYSTEM_PROMPT },
          { role: "user", content: buildAiPrompt(code, resolved, findings) },
        ],
        "code-review",
      );
      setAiOutput(answer);
    } catch (e) {
      if (e instanceof PhiBlockedError) setAiError(`The PHI gateway blocked this: ${e.message}`);
      else if (e instanceof AiNotConfiguredError) setAiError(e.message);
      else setAiError(e instanceof Error ? e.message : String(e));
    } finally {
      setAiBusy(false);
    }
  };

  const groups = useMemo(() => [...new Set(CHECKLIST.map((c) => c.group))], []);

  return (
    <ToolShell
      toolId="code-review"
      title="Code Review Assistant"
      description="The integration mistakes that compile cleanly, pass every test, and fail at three in the morning."
    >
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs text-muted-foreground">File</span>
          <Input className="mono h-8 w-56" value={file} onChange={(e) => setFile(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs text-muted-foreground">Language</span>
          <select
            className="h-8 rounded-md border border-border bg-background px-2 text-sm"
            value={language}
            onChange={(e) => setLanguage(e.target.value as Language | "auto")}
          >
            <option value="auto">detect ({detectLanguage(code)})</option>
            <option value="csharp">C#</option>
            <option value="typescript">TypeScript</option>
            <option value="sql">SQL</option>
          </select>
        </label>
        <Badge variant={counts.high ? "destructive" : "success"}>{counts.high} high</Badge>
        <Badge variant={counts.medium ? "warning" : "outline"}>{counts.medium} medium</Badge>
        <Badge variant="outline">{counts.low} low</Badge>
        <Button size="sm" variant="outline" onClick={() => setCode(SAMPLE)}>Sample</Button>
        {findings.length > 0 && <CopyButton value={toComments(findings, file)} />}
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">Code</label>
          <Textarea mono className="h-80" value={code} onChange={(e) => setCode(e.target.value)} spellCheck={false} />
          <p className="text-[11px] text-muted-foreground">
            Not a linter. A linter has opinions about braces; these are the patterns that compile cleanly, pass every
            test written against a happy path, and then take an interface down — or put a patient identifier into a log
            aggregator with a year of retention.
          </p>
        </div>

        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-muted-foreground">
              <ScanText className="mr-1 inline size-3.5" /> Findings
            </label>
            <span className="text-[11px] text-muted-foreground">{findings.length} from the pattern rules</span>
          </div>
          <div className="h-80 overflow-auto rounded-md border border-border">
            {findings.length === 0 ? (
              <p className="p-3 text-sm text-success">
                Nothing matched. That means none of these specific patterns are present — it is not a statement about
                whether the code is correct, which is what the checklist below is for.
              </p>
            ) : (
              <div className="divide-y divide-border">
                {findings.map((finding, i) => (
                  <div key={i} className="p-3">
                    <p className="text-sm">
                      <span className={cn("mr-1 font-medium", SEVERITY_CLASS[finding.severity])}>
                        {finding.severity === "high" ? "●" : finding.severity === "medium" ? "◆" : "○"}
                      </span>
                      <b>{finding.title}</b>
                      <span className="mono ml-2 text-[11px] text-muted-foreground">{file}:{finding.line}</span>
                    </p>
                    <pre className="mono mt-1 overflow-auto whitespace-pre-wrap rounded bg-muted/30 p-1.5 text-[10px]">{finding.excerpt}</pre>
                    <p className="mt-1 text-[11px] text-muted-foreground">{finding.why}</p>
                    <p className="mt-1 text-[11px]"><b>Instead:</b> {finding.fix}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-md border border-border p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium"><Sparkles className="mr-1 inline size-4" /> AI pass</span>
          <Button size="sm" onClick={runAi} disabled={aiBusy || !configured || !code.trim()}>
            {aiBusy ? "Reading…" : "Review with AI"}
          </Button>
          {!configured && <span className="text-[11px] text-warning">AI is not configured — Settings → AI.</span>}
          <Badge variant={policy.policy === "off" ? "warning" : "success"} className="text-[9px]">
            PHI policy: {policy.policy}
          </Badge>
          {aiOutput && <CopyButton className="ml-auto" value={aiOutput} />}
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">
          The prompt is narrow on purpose — it says what <i>not</i> to report, because a general "review this code"
          buries the one paragraph that matters under naming opinions. The rules above are passed along so the model does
          not repeat them. Code goes out through the PHI Gateway like every other prompt, which matters here: a code
          sample often carries a real message in a test fixture.
        </p>

        {aiError && (
          <div className="mt-2 whitespace-pre-wrap rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive">
            {aiError}
          </div>
        )}
        {aiOutput && (
          <div className="mt-2 max-h-96 overflow-auto rounded-md border border-border bg-muted/20 p-3">
            <Markdown content={aiOutput} />
          </div>
        )}
      </div>

      <div className="mt-4">
        <p className="mb-2 text-sm font-medium">
          <ListChecks className="mr-1 inline size-4" /> What a pattern cannot see
          <span className="ml-2 text-[11px] font-normal text-muted-foreground">
            {checked.size} of {CHECKLIST.length} answered
          </span>
        </p>
        {groups.map((group) => (
          <div key={group} className="mb-3">
            <p className="mb-1 text-xs font-medium text-muted-foreground">{group}</p>
            <div className="flex flex-col gap-1">
              {CHECKLIST.filter((c) => c.group === group).map((item) => (
                <label key={item.id} className="flex cursor-pointer items-start gap-2 rounded-md border border-border p-2 hover:bg-secondary/30">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={checked.has(item.id)}
                    onChange={(e) => {
                      const next = new Set(checked);
                      if (e.target.checked) next.add(item.id);
                      else next.delete(item.id);
                      setChecked(next);
                    }}
                  />
                  <span>
                    <span className="text-sm">{item.question}</span>
                    <span className="mt-0.5 block text-[11px] text-muted-foreground">{item.why}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
        ))}
        <p className="text-[11px] text-muted-foreground">
          <AlertTriangle className="mr-1 inline size-3 text-warning" />
          Ten questions rather than fifty, because a long checklist gets ticked wholesale. These are the ones where the
          answer is genuinely not in the diff.
        </p>
      </div>
    </ToolShell>
  );
}
