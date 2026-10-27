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

const DEFAULT_DEEPSEEK_MODEL = "deepseek-flash";

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
  faux.setResponses(scriptedReplies(userText));
  return {
    mode: "faux",
    model: faux.getModel(),
    streamFn: (model, context, streamOptions) => models.streamSimple(model, context, streamOptions),
  };
}

/**
 * DeepSeek's pi-ai provider speaks OpenAI Chat Completions.
 * The HTTP client uses `model.baseUrl`, so DEEPSEEK_BASE_URL overrides the catalog URL.
 */
function createDeepSeekRuntime(env: NodeJS.ProcessEnv): TurnRuntime {
  const models = createModels();
  models.setProvider(deepseekProvider());
  const modelId = env.DEEPSEEK_MODEL?.trim() || DEFAULT_DEEPSEEK_MODEL;
  const found = models.getModel("deepseek", modelId);
  if (!found) {
    throw new Error(`Unknown DeepSeek model "${modelId}". Expected a model id from the pi-ai deepseek catalog.`);
  }
  const baseUrl = env.DEEPSEEK_BASE_URL?.trim().replace(/\/$/, "");
  const model = baseUrl ? { ...found, baseUrl } : found;
  return {
    mode: "deepseek",
    model,
    streamFn: (nextModel, context, streamOptions) => models.streamSimple(nextModel, context, streamOptions),
    getApiKey: (provider) => (provider === "deepseek" ? env.DEEPSEEK_API_KEY : undefined),
  };
}

function scriptedReplies(userText: string) {
  const phone = userText.match(/1\d{10}/)?.[0];
  if (phone) {
    return [
      fauxAssistantMessage([fauxToolCall("lookup_member", { phone })], { stopReason: "toolUse" }),
      (ctx: TranscriptContext) => fauxAssistantMessage([fauxText(replyFromTool(ctx, "member"))]),
    ];
  }
  const query = userText.slice(0, 80);
  return [
    fauxAssistantMessage([fauxToolCall("search_faq", { query })], { stopReason: "toolUse" }),
    (ctx: TranscriptContext) => fauxAssistantMessage([fauxText(replyFromTool(ctx, "faq"))]),
  ];
}

function replyFromTool(ctx: TranscriptContext, kind: "member" | "faq"): string {
  const result = latestToolResult(ctx);
  if (result.isError || !result.text) return result.text || "工具没有返回结果。";
  if (result.text.startsWith("未找到") || result.text.startsWith("知识库里没有")) return result.text;
  if (kind === "member") return `查到了：${result.text}。还有什么可以帮您？`;
  return result.text;
}

function latestToolResult(ctx: TranscriptContext): { text: string; isError: boolean } {
  for (let index = ctx.messages.length - 1; index >= 0; index -= 1) {
    const message = ctx.messages[index];
    if (!message || message.role !== "toolResult") continue;
    const text = message.content.map((part) => (part.type === "text" ? part.text : "")).join("");
    return { text, isError: message.isError };
  }
  return { text: "", isError: true };
}
