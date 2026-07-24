import { describe, it, expect } from "vitest";
import { parseStackTrace, rootFrame } from "./stacktrace";

const DOTNET = `System.NullReferenceException: Object reference not set to an instance of an object.
   at OrderService.CalculateTotal(Order order) in C:\\app\\OrderService.cs:line 87
   at System.Web.Mvc.ActionMethodDispatcher.Execute()
 ---> System.InvalidOperationException: Sequence contains no elements`;

const JAVA = `java.lang.NullPointerException: oops
	at com.example.OrderService.calc(OrderService.java:42)
	at jdk.internal.reflect.Method.invoke(Method.java:566)`;

describe("parseStackTrace", () => {
  it("parses .NET exception + frames + inner", () => {
    const p = parseStackTrace(DOTNET);
    expect(p.exceptionType).toBe("System.NullReferenceException");
    expect(p.frames[0].file).toContain("OrderService.cs");
    expect(p.frames[0].line).toBe(87);
    expect(p.inner[0].exceptionType).toBe("System.InvalidOperationException");
  });
  it("marks framework frames as non-user code", () => {
    const p = parseStackTrace(DOTNET);
    expect(p.frames[0].isUserCode).toBe(true);
    expect(p.frames[1].isUserCode).toBe(false);
  });
  it("parses Java frames", () => {
    const p = parseStackTrace(JAVA);
    expect(p.exceptionType).toBe("java.lang.NullPointerException");
    expect(p.frames[0].line).toBe(42);
  });
  it("rootFrame prefers user code", () => {
    expect(rootFrame(parseStackTrace(DOTNET))?.method).toContain("OrderService.CalculateTotal");
  });
});
