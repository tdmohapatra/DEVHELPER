import { AiPromptTool } from "@/components/AiPromptTool";

export function ErrorExplainer() {
  return (
    <AiPromptTool
      toolId="error-explainer"
      title="Error Explainer"
      description="Paste an error or exception; get a root-cause explanation and suggested fix."
      inputLabel="Error / exception / stack trace"
      placeholder="Paste the error message or stack trace…"
      systemPrompt="You are a senior software engineer. Explain errors concisely and practically. Always answer with sections: Root cause, Explanation, Suggested fix, Verification steps. Be specific and avoid filler."
      buildUserPrompt={(input) => `Explain this error and how to fix it:\n\n${input}`}
      sample={"System.NullReferenceException: Object reference not set to an instance of an object.\n   at OrderService.Process(Order o) in C:\\app\\OrderService.cs:line 42"}
      capture={(input) => ({
        source: "exception",
        status: "error",
        title: input.trim().split("\n")[0].slice(0, 100) || "Exception",
        error: input.slice(0, 1500),
      })}
    />
  );
}
