import { Agent, type AgentMessage } from "@earendil-works/pi-agent-core";
import { decideToolCall, type ToolGrant } from "./auth.js";
import { createTurnRuntime, type ModelMode } from "./model.js";
import { SYSTEM_PROMPT } from "./prompt.js";
import { storeTools } from "./tools.js";

export type SseEmit = (event: string, data: unknown) => void;

export interface TurnOptions {
  content: string;
  grant: ToolGrant;
  mode: ModelMode;
  emit: SseEmit;
  env?: NodeJS.ProcessEnv;
}

export interface RunningTurn {
  abort: () => void;
  done: Promise<void>;
}

/** One store-CS turn: model, beforeToolCall, fixture tools, SSE projection. */
export function startTurn(options: TurnOptions): RunningTurn {
  const runtime = createTurnRuntime({
    mode: options.mode,
    userText: options.content,
    env: options.env,
  });
  const agent = new Agent({
    initialState: {
      systemPrompt: SYSTEM_PROMPT,
      model: runtime.model,
      tools: storeTools,
    },
    streamFn: runtime.streamFn,
    ...(runtime.getApiKey ? { getApiKey: runtime.getApiKey } : {}),
    beforeToolCall: async ({ toolCall }) => {
      const decision = decideToolCall(options.grant, toolCall.name);
      options.emit("tool.auth", {
        tool: toolCall.name,
        allowed: decision.allowed,
        ...(decision.reason ? { reason: decision.reason } : {}),
      });
      console.log(`[auth] ${toolCall.name} ${decision.allowed ? "allowed" : "blocked"}`);
      if (!decision.allowed) return { block: true, reason: decision.reason };
      return undefined;
    },
  });
  agent.subscribe((event) => {
    if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
      if (event.assistantMessageEvent.delta) {
        options.emit("message.delta", { delta: event.assistantMessageEvent.delta });
      }
      return;
    }
    if (event.type === "tool_execution_end") {
      options.emit("tool.done", { tool: event.toolName, isError: event.isError });
      return;
    }
    if (event.type === "agent_end") {
      options.emit("done", { stopReason: lastStopReason(agent.state.messages) });
    }
  });
  return {
    abort: () => agent.abort(),
    done: agent.prompt(options.content).then(() => undefined),
  };
}

function lastStopReason(messages: readonly AgentMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "assistant") return message.stopReason;
  }
  return "stop";
}
