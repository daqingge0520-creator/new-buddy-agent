import { Agent, type AgentMessage } from "@earendil-works/pi-agent-core";
import { createTurnRuntime, type ModelMode } from "./model.js";
import type { SessionStore } from "./store.js";
import { scaffoldTool } from "./tools.js";

const SYSTEM_PROMPT = "你是门店客服框架的占位助手。需要外部信息时调用 scaffold，并只根据工具结果回答。";

export type SseEmit = (event: string, data: unknown) => void;

export interface TurnOptions {
  content: string;
  sessionId: string;
  history: AgentMessage[];
  store: SessionStore;
  mode: ModelMode;
  emit: SseEmit;
  env?: NodeJS.ProcessEnv;
}

export interface RunningTurn {
  abort: () => void;
  done: Promise<void>;
}

/**
 * Pi loop for one chat turn.
 * `message_end` writes SQLite before `message.committed`. The agent awaits that listener,
 * so the next model step does not start until the row is stored.
 */
export function startTurn(options: TurnOptions): RunningTurn {
  const runtime = createTurnRuntime({ mode: options.mode, userText: options.content, env: options.env });
  const agent = new Agent({
    initialState: {
      systemPrompt: SYSTEM_PROMPT,
      model: runtime.model,
      tools: [scaffoldTool],
      messages: options.history,
    },
    streamFn: runtime.streamFn,
    ...(runtime.getApiKey ? { getApiKey: runtime.getApiKey } : {}),
  });
  agent.subscribe(async (event) => {
    if (event.type === "message_end") {
      const seq = options.store.appendMessage(options.sessionId, event.message);
      options.emit("message.committed", { sessionId: options.sessionId, seq, role: event.message.role });
      return;
    }
    if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
      if (event.assistantMessageEvent.delta) options.emit("message.delta", { delta: event.assistantMessageEvent.delta });
      return;
    }
    if (event.type === "tool_execution_end") {
      options.emit("tool.done", { tool: event.toolName, isError: event.isError });
      return;
    }
    if (event.type === "agent_end") {
      options.emit("done", { sessionId: options.sessionId, stopReason: lastStopReason(agent.state.messages) });
    }
  });
  return { abort: () => agent.abort(), done: agent.prompt(options.content).then(() => undefined) };
}

function lastStopReason(messages: readonly AgentMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "assistant") return message.stopReason;
  }
  return "stop";
}
