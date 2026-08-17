import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ServiceBusTool } from "./ServiceBusTool";

const executeRequest = vi.hoisted(() => vi.fn());
vi.mock("@/lib/http", () => ({ executeRequest, corsLimited: () => false }));

/**
 * The Service Bus screen, driven the way a person drives it.
 *
 * `serviceBus.ts` is tested on its own; what this guards is the wiring, and one
 * behaviour that no unit test can assert because it lives in the component: a
 * peek must release every lock it took, and must never issue the DELETE that
 * would destroy the message.
 */
describe("ServiceBusTool", () => {
  const CONN = "Endpoint=sb://labs.servicebus.windows.net/;SharedAccessKeyName=Root;SharedAccessKey=a2V5";

  const feed = (title: string, active: number, dead: number) => `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <title type="text">${title}</title>
    <content type="application/xml">
      <QueueDescription xmlns="http://schemas.microsoft.com/netservices/2010/10/servicebus/connect">
        <LockDuration>PT1M</LockDuration>
        <MaxDeliveryCount>10</MaxDeliveryCount>
        <Status>Active</Status>
        <CountDetails xmlns:d2p1="http://schemas.microsoft.com/netservices/2011/06/servicebus">
          <d2p1:ActiveMessageCount>${active}</d2p1:ActiveMessageCount>
          <d2p1:DeadLetterMessageCount>${dead}</d2p1:DeadLetterMessageCount>
          <d2p1:ScheduledMessageCount>0</d2p1:ScheduledMessageCount>
          <d2p1:TransferMessageCount>0</d2p1:TransferMessageCount>
          <d2p1:TransferDeadLetterMessageCount>0</d2p1:TransferDeadLetterMessageCount>
        </CountDetails>
      </QueueDescription>
    </content>
  </entry>
</feed>`;

  const ok = (body: string, headers: Record<string, string> = {}, status = 200) => ({
    status,
    statusText: "",
    headers,
    body,
    timeMs: 5,
    sizeBytes: body.length,
    ok: status >= 200 && status < 300,
  });

  const EMPTY_FEED = `<feed xmlns="http://www.w3.org/2005/Atom"></feed>`;

  /** Answer each URL the tool asks for, so the order of the calls is not baked in. */
  const route = (handler: (method: string, url: string) => ReturnType<typeof ok> | null) =>
    executeRequest.mockImplementation(async (req: { method: string; url: string }) => {
      const answer = handler(req.method, req.url);
      if (answer) return answer;
      if (req.url.includes("$Resources/Queues")) return ok(feed("orders", 4, 3));
      if (req.url.includes("$Resources/Topics")) return ok(EMPTY_FEED);
      return ok("", {}, 204);
    });

  /** The tab and the row action are both called "Peek"; the tab is the first. */
  const openPeek = () => {
    fireEvent.click(screen.getAllByText("Peek")[0]);
    fireEvent.click(screen.getByText("Read messages"));
  };

  const connect = async () => {
    render(<ServiceBusTool />);
    fireEvent.change(screen.getByLabelText(/Connection string/), { target: { value: CONN } });
    fireEvent.click(screen.getByText("Connect"));
    await waitFor(() => expect(screen.getByText("orders")).toBeInTheDocument());
  };

  // Braced on purpose: mockReset() returns the mock, and a beforeEach that
  // returns a function has handed vitest a cleanup hook — which it then calls,
  // invoking the mock with no arguments after every test.
  beforeEach(() => {
    executeRequest.mockReset();
  });

  it("explains a connection string that carries a signed token instead of a key", async () => {
    render(<ServiceBusTool />);
    fireEvent.change(screen.getByLabelText(/Connection string/), {
      target: { value: "Endpoint=sb://labs.servicebus.windows.net/;SharedAccessSignature=SharedAccessSignature sr=x" },
    });
    fireEvent.click(screen.getByText("Connect"));
    await waitFor(() => expect(screen.getByText(/already-signed/)).toBeInTheDocument());
    expect(executeRequest).not.toHaveBeenCalled();
  });

  it("lists the namespace and signs every request with a SAS header", async () => {
    route(() => null);
    await connect();
    expect(screen.getByText("labs")).toBeInTheDocument();
    expect(screen.getByText(/1 queue, 0 topics, 0 subscriptions, 4 active, 3 dead-lettered/)).toBeInTheDocument();
    for (const [req] of executeRequest.mock.calls) {
      expect(req.headers.Authorization).toMatch(/^SharedAccessSignature sr=.*&sig=.*&se=\d+&skn=Root$/);
    }
  });

  it("flags the dead-letter backlog for what it costs", async () => {
    route(() => null);
    await connect();
    expect(screen.getByText(/dead-lettered message\(s\)/)).toBeInTheDocument();
    expect(screen.getByText(/size quota/)).toBeInTheDocument();
  });

  it("explains a 401 rather than leaving the namespace looking empty", async () => {
    executeRequest.mockResolvedValue(ok("", {}, 401));
    render(<ServiceBusTool />);
    fireEvent.change(screen.getByLabelText(/Connection string/), { target: { value: CONN } });
    fireEvent.click(screen.getByText("Connect"));
    await waitFor(() => expect(screen.getByText(/clock/)).toBeInTheDocument());
  });

  it("releases every lock it takes, and never issues the DELETE that would destroy a message", async () => {
    let peeked = 0;
    route((method, url) => {
      if (method === "POST" && url.includes("/messages/head")) {
        peeked++;
        if (peeked > 2) return ok("", {}, 204);
        return ok(`{"id":${peeked}}`, {
          BrokerProperties: JSON.stringify({ SequenceNumber: peeked, DeadLetterReason: "MaxDeliveryCountExceeded", DeliveryCount: 10 }),
          Location: `https://labs.servicebus.windows.net/orders/messages/${peeked}/lock-${peeked}`,
        });
      }
      return null;
    });

    await connect();
    openPeek();
    await waitFor(() => expect(screen.getByText('{"id":1}')).toBeInTheDocument());
    // The unlocks run in the peek's finally, after the messages are on screen.
    await waitFor(() => expect(executeRequest.mock.calls.filter(([r]) => r.method === "PUT")).toHaveLength(2));

    const unlocks = executeRequest.mock.calls.filter(([r]) => r.method === "PUT").map(([r]) => r.url);
    expect(unlocks).toEqual([
      "https://labs.servicebus.windows.net/orders/messages/1/lock-1",
      "https://labs.servicebus.windows.net/orders/messages/2/lock-2",
    ]);
    expect(executeRequest.mock.calls.some(([r]) => r.method === "DELETE")).toBe(false);
  });

  it("peeks the dead-letter sub-queue when that is where the messages are, and says why they died", async () => {
    let peeked = 0;
    route((method, url) => {
      if (method !== "POST" || !url.includes("$deadletterqueue/messages/head")) return null;
      // One message, then the sub-queue is empty — a 204, not an error.
      return peeked++ === 0
        ? ok("{}", { BrokerProperties: JSON.stringify({ DeadLetterReason: "MaxDeliveryCountExceeded" }) })
        : ok("", {}, 204);
    });
    await connect();
    openPeek();
    await waitFor(() => expect(screen.getByText(/consumer's own logs/)).toBeInTheDocument());
    expect(peeked).toBe(2);
  });

  it("releases the locks it already took even when a later peek fails", async () => {
    let peeked = 0;
    route((method, url) => {
      if (method === "POST" && url.includes("/messages/head")) {
        peeked++;
        if (peeked === 1) {
          return ok("{}", { BrokerProperties: "{}", Location: "https://labs.servicebus.windows.net/orders/messages/1/lock-1" });
        }
        return ok("", {}, 503);
      }
      return null;
    });

    await connect();
    openPeek();
    await waitFor(() => expect(executeRequest.mock.calls.some(([r]) => r.method === "PUT")).toBe(true));
    expect(executeRequest.mock.calls.filter(([r]) => r.method === "PUT")).toHaveLength(1);
  });
});
