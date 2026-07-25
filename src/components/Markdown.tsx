import { Fragment, type ReactNode } from "react";
import { parseMarkdown, parseInline } from "@/lib/markdown";
import { CopyButton } from "@/components/CopyButton";
import { cn } from "@/lib/utils";

/** Render a subset of Markdown (as emitted by LLMs) as styled, safe JSX — no raw HTML. */
export function Markdown({ content, className }: { content: string; className?: string }) {
  const blocks = parseMarkdown(content);
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
          case "para":
            return <p key={i} className="my-1.5 whitespace-pre-wrap first:mt-0">{inline(b.text)}</p>;
        }
      })}
    </div>
  );
}

function inline(text: string): ReactNode {
  return parseInline(text).map((t, i) => {
    switch (t.type) {
      case "bold": return <strong key={i} className="font-semibold">{t.value}</strong>;
      case "italic": return <em key={i}>{t.value}</em>;
      case "code": return <code key={i} className="mono rounded bg-secondary px-1 py-0.5 text-[0.85em]">{t.value}</code>;
      case "link": return <a key={i} href={t.href} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-2">{t.value}</a>;
      default: return <Fragment key={i}>{t.value}</Fragment>;
    }
  });
}
