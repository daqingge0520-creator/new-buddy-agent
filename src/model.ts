import type { StreamFn } from "@earendil-works/pi-agent-core";
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxToolCall,
  type Model,
  type TranscriptContext,
} from "@earendil-works/pi-ai";
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";

export type ModelMode = "faux" | "deepseek";

/** Key present: DeepSeek. No key: scripted faux provider. */
export function selectModelMode(env: NodeJS.ProcessEnv = process.env): ModelMode {
  return env.DEEPSEEK_API_KEY?.trim() ? "deepseek" : "faux";
}

export interface TurnRuntime {
  mode: ModelMode;
  model: Model<string>;
  streamFn: StreamFn;
  getApiKey?: (provider: string) => string | undefined;
}

export function createTurnRuntime(options: {
  mode: ModelMode;
  userText: string;
  env?: NodeJS.ProcessEnv;
}): TurnRuntime {
  if (options.mode === "deepseek") return createDeepSeekRuntime(options.env ?? process.env);
  return createFauxRuntime(options.userText);
}

function createFauxRuntime(userText: string): TurnRuntime {
  const models = createModels();
  const faux = fauxProvider({ tokensPerSecond: 200, tokenSize: { min: 1, max: 1 } });
  models.setProvider(faux.provider);
  faux.setResponses([
    fauxAssistantMessage([fauxToolCall("scaffold", { text: userText.slice(0, 200) })], { stopReason: "toolUse" }),
    (ctx: TranscriptContext) => fauxAssistantMessage([fauxText(latestToolText(ctx))]),
  ]);
  return {
    mode: "faux",
    model: faux.getModel(),
    streamFn: (model, context, streamOptions) => models.streamSimple(model, context, streamOptions),
  };
}

/** DeepSeek's provider speaks OpenAI Chat Completions. `model.baseUrl` is the request URL. */
function createDeepSeekRuntime(env: NodeJS.ProcessEnv): TurnRuntime {
  const models = createModels();
  models.setProvider(deepseekProvider());
  const modelId = env.DEEPSEEK_MODEL?.trim() || "deepseek-flash";
  const found = models.getModel("deepseek", modelId);
  if (!found) throw new Error(`Unknown DeepSeek model "${modelId}".`);
  const baseUrl = env.DEEPSEEK_BASE_URL?.trim().replace(/\/$/, "");
  return {
    mode: "deepseek",
    model: baseUrl ? { ...found, baseUrl } : found,
    streamFn: (model, context, streamOptions) => models.streamSimple(model, context, streamOptions),
    getApiKey: (provider) => (provider === "deepseek" ? env.DEEPSEEK_API_KEY : undefined),
  };
}

function latestToolText(ctx: TranscriptContext): string {
  for (let index = ctx.messages.length - 1; index >= 0; index -= 1) {
    const message = ctx.messages[index];
    if (message?.role !== "toolResult") continue;
    const text = message.content.map((part) => (part.type === "text" ? part.text : "")).join("");
    return text || "scaffold returned nothing";
  }
  return "scaffold returned nothing";
}
