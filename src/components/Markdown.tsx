import { Fragment, type ReactNode } from "react";
import { parseMarkdown, parseInline, type Align } from "@/lib/markdown";
import { CopyButton } from "@/components/CopyButton";
import { cn } from "@/lib/utils";

export interface MarkdownProps {
  content: string;
  className?: string;
  /** Called with the source line when a rendered checkbox is clicked. Read-only without it. */
  onToggleTask?: (line: number) => void;
  /** Called with a `[[wiki link]]` target. Rendered as plain text without it. */
  onWikiLink?: (target: string) => void;
  /** Whether a `[[wiki link]]` target exists; a target that does not is shown muted. */
  wikiLinkExists?: (target: string) => boolean;
}

/** Render a subset of Markdown (as emitted by LLMs, and as written in notes) as styled, safe JSX — no raw HTML. */
export function Markdown({ content, className, onToggleTask, onWikiLink, wikiLinkExists }: MarkdownProps) {
  const blocks = parseMarkdown(content);
  const inline = (text: string) => renderInline(text, onWikiLink, wikiLinkExists);
  return (
    <div className={cn("text-sm leading-relaxed", className)}>
      {blocks.map((b, i) => {
        switch (b.type) {
          case "heading": {
            const size = b.level <= 1 ? "text-base" : b.level === 2 ? "text-sm" : "text-[13px]";
            return (
              <div key={i} className={cn("mb-1 mt-3 font-semibold tracking-tight first:mt-0", size)}>
                {inline(b.text)}
              </div>
            );
          }
          case "code":
            return (
              <div key={i} className="group relative my-2 rounded-md border border-border bg-secondary/40">
                <CopyButton value={b.code} className="absolute right-2 top-2 opacity-0 transition-opacity group-hover:opacity-100" />
                <pre className="mono overflow-x-auto p-3 pr-16 text-xs">{b.code}</pre>
              </div>
            );
          case "list": {
            const Tag = b.ordered ? "ol" : "ul";
            return (
              <Tag key={i} className={cn("my-1.5 space-y-0.5 pl-5", b.ordered ? "list-decimal" : "list-disc")}>
                {b.items.map((it, j) => <li key={j}>{inline(it)}</li>)}
              </Tag>
            );
          }
          case "tasks":
            return (
              <ul key={i} className="my-1.5 space-y-1">
                {b.items.map((it, j) => (
                  <li key={j} className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      checked={it.done}
                      disabled={!onToggleTask}
                      aria-label={it.text}
                      onChange={() => onToggleTask?.(it.line)}
                      className="mt-[3px] size-3.5 shrink-0 accent-primary"
                    />
                    <span className={cn("min-w-0", it.done && "text-muted-foreground line-through")}>{inline(it.text)}</span>
                  </li>
                ))}
              </ul>
            );
          case "table":
            return (
              <div key={i} className="my-2 overflow-x-auto rounded-md border border-border">
                <table className="w-full border-collapse text-xs">
                  <thead>
                    <tr className="bg-secondary/50">
                      {b.header.map((h, j) => (
                        <th key={j} className={cn("border-b border-border px-2 py-1.5 font-medium", alignClass(b.align[j]))}>{inline(h)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {b.rows.map((row, r) => (
                      <tr key={r} className="border-b border-border/50 last:border-0">
                        {row.map((cell, c) => (
                          <td key={c} className={cn("px-2 py-1.5 align-top", alignClass(b.align[c]))}>{inline(cell)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case "quote":
            return (
              <blockquote key={i} className="my-2 border-l-2 border-primary/40 py-0.5 pl-3 text-muted-foreground">
                <span className="whitespace-pre-wrap">{inline(b.text)}</span>
              </blockquote>
            );
          case "hr":
            return <hr key={i} className="my-3 border-border" />;
          case "para":
            return <p key={i} className="my-1.5 whitespace-pre-wrap first:mt-0">{inline(b.text)}</p>;
        }
      })}
    </div>
  );
}

const alignClass = (a: Align) => (a === "center" ? "text-center" : a === "right" ? "text-right" : "text-left");

function renderInline(
  text: string,
  onWikiLink?: (target: string) => void,
  wikiLinkExists?: (target: string) => boolean,
): ReactNode {
  return parseInline(text).map((t, i) => {
    switch (t.type) {
      case "bold": return <strong key={i} className="font-semibold">{t.value}</strong>;
      case "italic": return <em key={i}>{t.value}</em>;
      case "strike": return <s key={i} className="text-muted-foreground">{t.value}</s>;
      case "code": return <code key={i} className="mono rounded bg-secondary px-1 py-0.5 text-[0.85em]">{t.value}</code>;
      case "link": return <a key={i} href={t.href} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-2">{t.value}</a>;
      case "wikilink": {
        if (!onWikiLink) return <Fragment key={i}>{t.value}</Fragment>;
        const exists = wikiLinkExists ? wikiLinkExists(t.target) : true;
        return (
          <button
            key={i}
            type="button"
            onClick={() => onWikiLink(t.target)}
            title={exists ? `Open “${t.target}”` : `Create “${t.target}”`}
            className={cn(
              "underline decoration-dotted underline-offset-2",
              exists ? "text-primary" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t.value}
          </button>
        );
      }
      default: return <Fragment key={i}>{t.value}</Fragment>;
    }
  });
}
