import { create } from "zustand";
import type { ChatMessage } from "@/lib/ai";

/**
 * The AI Chat conversation.
 *
 * In memory only, and deliberately so. A chat with an AI about production
 * problems is the single most likely place for a patient identifier, a
 * connection string or a bearer token to be pasted, and writing that to local
 * storage would put it in the workspace backup as well. The conversation lives
 * as long as the app does; `docs`-worthy answers can be copied into Notes,
 * which is a place the user chose.
 */
export interface ChatTurn extends ChatMessage {
  id: string;
  /** Wall clock, for the timestamp under each message. */
  at: number;
  /** Which destination answered — a reply is only meaningful with its model. */
  via?: string;
}

interface ChatState {
  turns: ChatTurn[];
  /** The system prompt, editable so the assistant can be pointed at a domain. */
  systemPrompt: string;
  add: (turn: Omit<ChatTurn, "id" | "at">) => ChatTurn;
  /** Replace the last assistant turn's content — used while streaming is faked. */
  clear: () => void;
  setSystemPrompt: (prompt: string) => void;
}

export const DEFAULT_SYSTEM_PROMPT =
  "You are a senior integration engineer helping with .NET, Azure, HL7/FHIR and SQL. " +
  "Answer concretely and briefly. Show code when code is the answer. Say when you are unsure.";

let seq = 0;

export const useChatStore = create<ChatState>()((set) => ({
  turns: [],
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  add: (turn) => {
    // A counter, not a timestamp: two turns added in the same millisecond would
    // collide as React keys, and the assistant reply often lands in the same
    // tick as the error path that also adds one.
    const full: ChatTurn = { ...turn, id: `t${++seq}`, at: Date.now() };
    set((s) => ({ turns: [...s.turns, full] }));
    return full;
  },
  clear: () => set({ turns: [] }),
  setSystemPrompt: (systemPrompt) => set({ systemPrompt }),
}));
