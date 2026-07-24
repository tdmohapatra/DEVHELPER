import { AiPromptTool } from "@/components/AiPromptTool";

export function CodeExplainer() {
  return (
    <AiPromptTool
      toolId="code-explainer"
      title="Code Explainer"
      description="Paste code; get a clear explanation of what it does."
      inputLabel="Code"
      placeholder="Paste a function, class, or snippet…"
      systemPrompt="You are a senior engineer and teacher. Explain code clearly: a one-line summary, a step-by-step walkthrough of what it does, and any notable edge cases, bugs, or improvements. Be concise."
      buildUserPrompt={(input) => `Explain this code:\n\n${input}`}
    />
  );
}
