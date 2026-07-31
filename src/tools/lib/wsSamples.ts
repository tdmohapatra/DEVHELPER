/**
 * Public WebSocket endpoints for trying the tool out.
 *
 * Each was connected to and verified to deliver data; the subscribe message and any
 * keep-alive settings are the ones that endpoint actually needs, so clicking one is a
 * working session rather than a starting point to debug.
 *
 * All are public, unauthenticated, read-only market or event feeds.
 */

import { DEFAULT_HEARTBEAT, type AutoReplyRule, type HeartbeatConfig } from "./wsHeartbeat";

export type WsCategory = "Markets" | "Blockchain" | "Earth" | "Echo";

export interface WsSample {
  id: string;
  name: string;
  category: WsCategory;
  url: string;
  /** What arrives, and roughly how often. */
  description: string;
  /** Sent once, immediately after the connection opens. */
  subscribe?: string;
  heartbeat?: HeartbeatConfig;
  rules?: Omit<AutoReplyRule, "id">[];
  /** Set when the feed is event-driven and may stay silent for a long time. */
  quiet?: boolean;
}

export const WS_SAMPLES: WsSample[] = [
  {
    id: "binance-trades",
    name: "Binance · BTC trades",
    category: "Markets",
    url: "wss://stream.binance.com:9443/ws/btcusdt@trade",
    description: "Every BTC/USDT trade, several per second. Streams immediately with no subscribe message.",
  },
  {
    id: "kraken-ticker",
    name: "Kraken · BTC ticker",
    category: "Markets",
    url: "wss://ws.kraken.com/v2",
    description: "Ticker updates plus the server's own heartbeat frames — useful for watching a keep-alive arrive.",
    subscribe: JSON.stringify({ method: "subscribe", params: { channel: "ticker", symbol: ["BTC/USD"] } }),
  },
  {
    id: "coinbase-ticker",
    name: "Coinbase · BTC ticker",
    category: "Markets",
    url: "wss://ws-feed.exchange.coinbase.com",
    description: "Ticker updates for BTC-USD. Answers the subscribe with a confirmation frame first.",
    subscribe: JSON.stringify({ type: "subscribe", product_ids: ["BTC-USD"], channels: ["ticker"] }),
  },
  {
    id: "blockchain-tx",
    name: "Blockchain.info · Bitcoin transactions",
    category: "Blockchain",
    url: "wss://ws.blockchain.info/inv",
    description: "Unconfirmed Bitcoin transactions as they are broadcast. Expects a periodic ping, so the heartbeat is on.",
    subscribe: JSON.stringify({ op: "unconfirmed_sub" }),
    heartbeat: { enabled: true, intervalMs: 20_000, message: JSON.stringify({ op: "ping" }), useProtocolPing: false },
  },
  {
    id: "echo",
    name: "Echo server · auto-reply demo",
    category: "Echo",
    url: "wss://echo.websocket.org",
    description:
      'Reflects whatever you send. The "ping" rule is enabled, so sending ping comes back and is answered with pong — the shortest way to see automatic replies work.',
    rules: [{ enabled: true, label: "pong", kind: "contains", value: "ping", reply: "pong" }],
  },
  {
    id: "gemini-btc",
    name: "Gemini · BTC market data",
    category: "Markets",
    url: "wss://api.gemini.com/v1/marketdata/BTCUSD",
    description: "Order book changes and trades, streamed on connect. The initial snapshot is large.",
  },
  {
    id: "postman-echo",
    name: "Postman Echo · raw",
    category: "Echo",
    url: "wss://ws.postman-echo.com/raw",
    description: "A second echo server, useful when echo.websocket.org hits its ten-minute idle timeout.",
  },
  {
    id: "seismic",
    name: "Seismic Portal · earthquakes",
    category: "Earth",
    url: "wss://www.seismicportal.eu/standing_order/websocket",
    description: "Global earthquake events. Connects instantly but stays silent until one happens — often many minutes.",
    quiet: true,
  },
];

export const WS_CATEGORIES: WsCategory[] = ["Markets", "Blockchain", "Earth", "Echo"];

export function sampleById(id: string): WsSample | undefined {
  return WS_SAMPLES.find((s) => s.id === id);
}

/** Settings a sample implies, with the defaults filled in. */
export function sampleSettings(sample: WsSample): { heartbeat: HeartbeatConfig; rules: AutoReplyRule[] } {
  return {
    heartbeat: sample.heartbeat ?? DEFAULT_HEARTBEAT,
    rules: (sample.rules ?? []).map((r, i) => ({ ...r, id: `${sample.id}-${i}` })),
  };
}
