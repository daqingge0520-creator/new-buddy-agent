import { pathToFileURL } from "node:url";
import { startApp } from "./server.js";
import { postChat, type SseEvent } from "./sse.js";

/** Offline tour: POST /v1/chat → scaffold tool → SQLite → SSE. Always faux. */
export async function main(): Promise<void> {
  if (process.env.DEEPSEEK_API_KEY?.trim()) {
    console.log("DEEPSEEK_API_KEY is set. This demo still uses faux. npm start calls DeepSeek.");
  }
  const app = await startApp({ port: 0, host: "127.0.0.1", mode: "faux", dbPath: ":memory:" });
  console.log(`demo ${app.baseUrl} mode=${app.mode}`);
  try {
    const events = await postChat({
      baseUrl: app.baseUrl,
      content: "你好",
      onEvent: printEvent,
    });
    const sessionId = sessionOf(events);
    const text = deltas(events);
    if (!text.includes("scaffold:你好")) throw new Error(`Missing scaffold echo: ${text}`);
    if (events.filter((event) => event.event === "message.delta").length < 2) {
      throw new Error("Expected more than one SSE text chunk");
    }
    const stored = app.store.loadMessages(sessionId);
    const roles = stored.map((message) => message.role).join(",");
    if (roles !== "user,assistant,toolResult,assistant") throw new Error(`Unexpected transcript: ${roles}`);
    const firstCommit = events.findIndex((event) => event.event === "message.committed");
    const firstDelta = events.findIndex((event) => event.event === "message.delta");
    if (firstCommit < 0 || firstDelta < 0 || firstCommit > firstDelta) {
      throw new Error("User message was not committed before streamed text");
    }
    console.log(`persisted ${stored.length} messages in ${sessionId}`);
  } finally {
    await app.close();
  }
  console.log("demo ok");
}

function printEvent(event: SseEvent): void {
  if (event.event === "message.delta" && isRecord(event.data) && typeof event.data.delta === "string") {
    process.stdout.write(event.data.delta);
    return;
  }
  if (event.event !== "message.delta") console.log(`\n[${event.event}] ${JSON.stringify(event.data)}`);
}

function sessionOf(events: SseEvent[]): string {
  const session = events.find((event) => event.event === "session");
  if (!session || !isRecord(session.data) || typeof session.data.sessionId !== "string") {
    throw new Error("Missing session event");
  }
  return session.data.sessionId;
}

function deltas(events: SseEvent[]): string {
  return events
    .filter((event) => event.event === "message.delta" && isRecord(event.data) && typeof event.data.delta === "string")
    .map((event) => (event.data as { delta: string }).delta)
    .join("");
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
