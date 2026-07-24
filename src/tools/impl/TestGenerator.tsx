import { AiPromptTool } from "@/components/AiPromptTool";

export function TestGenerator() {
  return (
    <AiPromptTool
      toolId="test-generator"
      title="Test Case Generator"
      description="Describe a requirement or paste code; get test scenarios."
      inputLabel="Requirement or code"
      placeholder="Describe the feature/endpoint, or paste the function to test…"
      systemPrompt="You are a QA engineer. Generate thorough test scenarios grouped as: Positive, Negative, Validation, Security, Edge cases. Where code is given, suggest concrete unit-test skeletons in the appropriate framework. Be specific and practical."
      buildUserPrompt={(input) => `Generate test cases for the following:\n\n${input}`}
    />
  );
}
