import { describe, it, expect } from "vitest";
import { WS_SAMPLES, sampleById, sampleSettings } from "./wsSamples";
import { findAutoReply, normalizeInterval, DEFAULT_HEARTBEAT } from "./wsHeartbeat";
import { normalizeWsUrl } from "./wsSession";

describe("sample catalogue", () => {
  it("has unique ids and names", () => {
    expect(new Set(WS_SAMPLES.map((s) => s.id)).size).toBe(WS_SAMPLES.length);
    expect(new Set(WS_SAMPLES.map((s) => s.name)).size).toBe(WS_SAMPLES.length);
  });

  it("uses secure URLs the connector accepts unchanged", () => {
    for (const s of WS_SAMPLES) {
      expect(s.url.startsWith("wss://"), s.id).toBe(true);
      expect(normalizeWsUrl(s.url)).toEqual({ url: s.url });
    }
  });

  it("describes what each feed delivers", () => {
    for (const s of WS_SAMPLES) expect(s.description.length, s.id).toBeGreaterThan(30);
  });

  it("keeps subscribe messages valid JSON where one is sent", () => {
    for (const s of WS_SAMPLES) {
      if (!s.subscribe) continue;
      expect(() => JSON.parse(s.subscribe!), s.id).not.toThrow();
    }
  });

  it("gives every heartbeat a server-safe interval", () => {
    for (const s of WS_SAMPLES) {
      if (!s.heartbeat) continue;
      expect(normalizeInterval(s.heartbeat.intervalMs), s.id).toBe(s.heartbeat.intervalMs);
    }
  });
});

describe("individual samples", () => {
  it("streams Binance trades without a subscribe message", () => {
    const s = sampleById("binance-trades")!;
    expect(s.subscribe).toBeUndefined();
    expect(s.url).toContain("btcusdt@trade");
  });

  it("subscribes Kraken to the ticker channel", () => {
    const parsed = JSON.parse(sampleById("kraken-ticker")!.subscribe!);
    expect(parsed).toMatchObject({ method: "subscribe", params: { channel: "ticker" } });
  });

  it("subscribes Coinbase with a product and channel", () => {
    const parsed = JSON.parse(sampleById("coinbase-ticker")!.subscribe!);
    expect(parsed.product_ids).toEqual(["BTC-USD"]);
    expect(parsed.channels).toEqual(["ticker"]);
  });

  it("turns on the heartbeat blockchain.info expects", () => {
    const s = sampleById("blockchain-tx")!;
    expect(JSON.parse(s.subscribe!)).toMatchObject({ op: "unconfirmed_sub" });
    expect(s.heartbeat).toMatchObject({ enabled: true, useProtocolPing: false });
    expect(JSON.parse(s.heartbeat!.message)).toMatchObject({ op: "ping" });
  });

  it("arms the echo server's auto-reply so the demo answers itself once", () => {
    const { rules } = sampleSettings(sampleById("echo")!);
    expect(findAutoReply(rules, "ping")?.reply).toBe("pong");
    // The reply must not match its own rule, or the echo would loop forever.
    expect(findAutoReply(rules, "pong")).toBeNull();
  });

  it("marks the event-driven feed as quiet", () => {
    expect(sampleById("seismic")!.quiet).toBe(true);
  });
});

describe("sampleSettings", () => {
  it("gives rules stable ids derived from the sample", () => {
    const { rules } = sampleSettings(sampleById("echo")!);
    expect(rules[0].id).toBe("echo-0");
  });

  it("falls back to the default heartbeat when a sample needs none", () => {
    expect(sampleSettings(sampleById("binance-trades")!).heartbeat).toEqual(DEFAULT_HEARTBEAT);
    expect(sampleSettings(sampleById("binance-trades")!).rules).toEqual([]);
  });

  it("returns nothing for an unknown id", () => {
    expect(sampleById("nope")).toBeUndefined();
  });
});
