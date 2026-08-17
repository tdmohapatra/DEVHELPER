import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { KqlPad } from "./KqlPad";
import { AUDIENCE } from "@/tools/lib/kql";

const executeRequest = vi.hoisted(() => vi.fn());
vi.mock("@/lib/http", () => ({ executeRequest, corsLimited: () => false }));

/**
 * The KQL Pad, driven the way a person drives it.
 *
 * `kql.ts` is tested on its own; what this guards is the wiring — that the
 * linter's warnings reach the screen before a query is sent, that a rejected
 * credential is explained rather than dumped, and that a `dynamic` column
 * renders as JSON rather than [object Object].
 */
describe("KqlPad", () => {
  const WORKSPACE = "11111111-2222-3333-4444-555555555555";

  const reply = (status: number, body: unknown) =>
    executeRequest.mockResolvedValue({
      status,
      statusText: "",
      headers: {},
      body: JSON.stringify(body),
      timeMs: 12,
      sizeBytes: 0,
      ok: status >= 200 && status < 300,
    });

  const editor = () => screen.getAllByRole("textbox").find((el) => el.tagName === "TEXTAREA") as HTMLTextAreaElement;
  const type = (text: string) => fireEvent.change(editor(), { target: { value: text } });
  const fill = (label: RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

  // Braced: mockReset() returns the mock, and a beforeEach that returns a
  // function has handed vitest a cleanup hook to call after every test.
  beforeEach(() => {
    executeRequest.mockReset();
  });

  it("names the audience a token has to be for, and the command that mints one", () => {
    render(<KqlPad />);
    expect(screen.getAllByText(new RegExp(AUDIENCE.loganalytics.replace(/[/.]/g, "\\$&"))).length).toBeGreaterThan(0);
    expect(screen.getByText(/az account get-access-token/)).toBeInTheDocument();
  });

  it("warns about the query in the editor before anything is sent", () => {
    render(<KqlPad />);
    type("select * from AppRequests");
    expect(screen.getByText(/looks like SQL/)).toBeInTheDocument();
    expect(executeRequest).not.toHaveBeenCalled();
  });

  it("drops the SQL warning once the query is KQL", () => {
    render(<KqlPad />);
    type("select * from AppRequests");
    type("AppRequests | where TimeGenerated > ago(1h) | take 10");
    expect(screen.queryByText(/looks like SQL/)).not.toBeInTheDocument();
  });

  it("refuses to send without a credential, and says which one", async () => {
    render(<KqlPad />);
    fill(/Workspace id/, WORKSPACE);
    fireEvent.click(screen.getByText("Run"));
    await waitFor(() => expect(screen.getByText(/no API-key option|Paste a bearer token/)).toBeInTheDocument());
    expect(executeRequest).not.toHaveBeenCalled();
  });

  it("refuses a resource name in place of a workspace GUID", async () => {
    render(<KqlPad />);
    fill(/Workspace id/, "prod-logs");
    fill(/Bearer token/, "t");
    fireEvent.click(screen.getByText("Run"));
    await waitFor(() => expect(screen.getByText(/not a GUID/)).toBeInTheDocument());
    expect(executeRequest).not.toHaveBeenCalled();
  });

  it("renders the primary table, with a dynamic column as JSON", async () => {
    reply(200, {
      tables: [
        {
          name: "PrimaryResult",
          columns: [
            { name: "Name", type: "string" },
            { name: "Props", type: "dynamic" },
          ],
          rows: [["GET /orders", { retries: 2 }]],
        },
        { name: "QueryStatistics", columns: [], rows: [] },
      ],
    });
    render(<KqlPad />);
    fill(/Workspace id/, WORKSPACE);
    fill(/Bearer token/, "t");
    fireEvent.click(screen.getByText("Run"));

    await waitFor(() => expect(screen.getByText("GET /orders")).toBeInTheDocument());
    expect(screen.getByText('{"retries":2}')).toBeInTheDocument();
    expect(screen.getByText("1 rows")).toBeInTheDocument();
    expect(screen.getByText(/1 statistics table\(s\) not shown/)).toBeInTheDocument();
  });

  it("sends the picked time range as a timespan alongside the query", async () => {
    reply(200, { tables: [] });
    render(<KqlPad />);
    fill(/Workspace id/, WORKSPACE);
    fill(/Bearer token/, "t");
    fill(/Time range/, "1440");
    fireEvent.click(screen.getByText("Run"));
    await waitFor(() => expect(executeRequest).toHaveBeenCalled());
    expect(JSON.parse(executeRequest.mock.calls[0][0].body)).toMatchObject({ timespan: "P1D" });
  });

  it("explains a 401 by audience rather than printing the body", async () => {
    reply(401, { error: { message: "AuthorizationRequiredError" } });
    render(<KqlPad />);
    fill(/Workspace id/, WORKSPACE);
    fill(/Bearer token/, "wrong");
    fireEvent.click(screen.getByText("Run"));
    await waitFor(() => expect(screen.getByText(/management\.azure\.com/)).toBeInTheDocument());
  });

  it("surfaces the innermost syntax complaint from a 400", async () => {
    reply(400, {
      error: {
        message: "The request had some invalid properties",
        innererror: { message: "SyntaxError", innererror: { message: "Query could not be parsed at 'form' on line [2,7]" } },
      },
    });
    render(<KqlPad />);
    fill(/Workspace id/, WORKSPACE);
    fill(/Bearer token/, "t");
    fireEvent.click(screen.getByText("Run"));
    await waitFor(() => expect(screen.getByText(/could not be parsed at 'form'/)).toBeInTheDocument());
  });

  it("loads a snippet into the editor", () => {
    render(<KqlPad />);
    fireEvent.click(screen.getByText("Snippets"));
    fireEvent.click(screen.getByText("Latency percentiles over time"));
    expect(editor().value).toContain("percentiles(DurationMs");
  });

  it("offers the classic tables once the backend is Application Insights", () => {
    render(<KqlPad />);
    fill(/Backend/, "appinsights");
    fireEvent.click(screen.getByText("Snippets"));
    expect(screen.getByText(/classic App Insights tables/)).toBeInTheDocument();
    expect(screen.getByLabelText(/API key/)).toBeInTheDocument();
  });
});
