import { pathToFileURL } from "node:url";
import { startApp } from "./server.js";
import { postChat, type SseEvent } from "./sse.js";

const MEMBER_QUESTION = "帮我查一下 13800000000 这个会员";
const FAQ_QUESTION = "你们营业时间是几点？";

/**
 * Offline tour of the host: question → beforeToolCall → fixture tool → SSE text.
 * Always uses the faux provider so the scripted tool call stays deterministic.
 * `npm start` is the path that uses DeepSeek when DEEPSEEK_API_KEY is set.
 */
export async function main(): Promise<void> {
  if (process.env.DEEPSEEK_API_KEY?.trim()) {
    console.log(
      "DEEPSEEK_API_KEY is set. This demo still uses the faux provider. Run npm start and POST /v1/chat to call DeepSeek.",
    );
  }
  const app = await startApp({ port: 0, host: "127.0.0.1", mode: "faux", token: "demo" });
  console.log(`demo ${app.baseUrl} mode=${app.mode}`);
  try {
    await runPrintedTurn(app.baseUrl, MEMBER_QUESTION, (events, text) => {
      assertAuth(events, "lookup_member", true);
      assertToolDone(events, "lookup_member", false);
      if (!text.includes("张三") || !text.includes("320")) {
        throw new Error(`Member answer did not include the fixture record: ${text}`);
      }
      assertChunked(events);
    });
    await runPrintedTurn(app.baseUrl, FAQ_QUESTION, (events, text) => {
      assertAuth(events, "search_faq", true);
      assertToolDone(events, "search_faq", false);
      if (!text.includes("10:00")) throw new Error(`FAQ answer did not include store hours: ${text}`);
      assertChunked(events);
    });
  } finally {
    await app.close();
  }
  console.log("demo ok");
}

async function runPrintedTurn(
  baseUrl: string,
  content: string,
  check: (events: SseEvent[], text: string) => void,
): Promise<void> {
  console.log(`\nPOST /v1/chat  ${content}`);
  let inline = false;
  const events = await postChat({
    baseUrl,
    token: "demo",
    content,
    onEvent: (event) => {
      if (event.event === "message.delta") {
        const delta = deltaText(event);
        if (!delta) return;
        process.stdout.write(delta);
        inline = true;
        return;
      }
      if (inline) {
        process.stdout.write("\n");
        inline = false;
      }
      console.log(`[${event.event}] ${JSON.stringify(event.data)}`);
    },
  });
  if (inline) process.stdout.write("\n");
  const text = events
    .filter((event) => event.event === "message.delta")
    .map((event) => deltaText(event))
    .join("");
  const done = events.find((event) => event.event === "done");
  if (!done || !isRecord(done.data) || done.data.stopReason !== "stop") {
    throw new Error(`Turn did not finish with stop: ${JSON.stringify(done?.data ?? null)}`);
  }
  check(events, text);
}

function assertAuth(events: SseEvent[], tool: string, allowed: boolean): void {
  const auth = events.find((event) => event.event === "tool.auth" && isRecord(event.data) && event.data.tool === tool);
  if (!auth || !isRecord(auth.data) || auth.data.allowed !== allowed) {
    throw new Error(`Missing tool.auth for ${tool}: ${JSON.stringify(events)}`);
  }
}

function assertToolDone(events: SseEvent[], tool: string, isError: boolean): void {
  const done = events.find((event) => event.event === "tool.done" && isRecord(event.data) && event.data.tool === tool);
  if (!done || !isRecord(done.data) || done.data.isError !== isError) {
    throw new Error(`Missing tool.done for ${tool}: ${JSON.stringify(events)}`);
  }
}

function assertChunked(events: SseEvent[]): void {
  const deltas = events.filter((event) => event.event === "message.delta");
  if (deltas.length < 2) throw new Error(`Expected streamed chunks, got ${deltas.length} delta event(s)`);
}

function deltaText(event: SseEvent): string {
  if (!isRecord(event.data) || typeof event.data.delta !== "string") return "";
  return event.data.delta;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
