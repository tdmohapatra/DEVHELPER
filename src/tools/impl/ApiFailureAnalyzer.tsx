import { AiPromptTool } from "@/components/AiPromptTool";

export function ApiFailureAnalyzer() {
  return (
    <AiPromptTool
      toolId="api-failure-analyzer"
      title="API Failure Analyzer"
      description="Paste request + response + logs; get likely root cause and next steps."
      inputLabel="Request / response / headers / logs"
      placeholder={"Paste the failing request, the response (status, headers, body), and any relevant logs…"}
      systemPrompt="You are an API/integration debugging expert. Given a request, response and logs, identify the likely root cause. Answer with sections: Likely root cause, Evidence, Investigation steps, Suggested fix. Be specific about status codes, headers and payloads."
      buildUserPrompt={(input) => `Analyze this API failure:\n\n${input}`}
      sample={"POST /api/orders → 500\nRequest: {\"userId\": null, \"items\": []}\nResponse: {\"error\":\"Internal Server Error\"}\nLog: SqlException: Cannot insert NULL into column 'UserId'"}
    />
  );
}
