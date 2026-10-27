import assert from "node:assert/strict";
import test from "node:test";
import { createTurnRuntime, selectModelMode } from "../src/model.js";
import { startApp } from "../src/server.js";
import { postChat, type SseEvent } from "../src/sse.js";

test("selectModelMode follows DEEPSEEK_API_KEY", () => {
  assert.equal(selectModelMode({}), "faux");
  assert.equal(selectModelMode({ DEEPSEEK_API_KEY: "   " }), "faux");
  assert.equal(selectModelMode({ DEEPSEEK_API_KEY: "sk-test" }), "deepseek");
});

test("DeepSeek runtime uses the OpenAI-compatible model and base URL override", () => {
  const runtime = createTurnRuntime({
    mode: "deepseek",
    userText: "你好",
    env: { DEEPSEEK_API_KEY: "sk-test", DEEPSEEK_BASE_URL: "https://example.test/v1/" },
  });
  assert.equal(runtime.model.provider, "deepseek");
  assert.equal(runtime.model.api, "openai-completions");
  assert.equal(runtime.model.baseUrl, "https://example.test/v1");
  assert.equal(runtime.getApiKey?.("deepseek"), "sk-test");
});

test("POST /v1/chat persists the transcript before the streamed answer and continues the session", async () => {
  const app = await startApp({ port: 0, host: "127.0.0.1", mode: "faux", dbPath: ":memory:", env: {} });
  try {
    const health = (await (await fetch(`${app.baseUrl}/health`)).json()) as { ok: boolean; mode: string };
    assert.equal(health.ok, true);
    assert.equal(health.mode, "faux");

    const missing = await fetch(`${app.baseUrl}/v1/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "" }),
    });
    assert.equal(missing.status, 400);

    const first = await postChat({ baseUrl: app.baseUrl, content: "你好" });
    const sessionId = field(first, "session", "sessionId");
    const commits = first.filter((event) => event.event === "message.committed");
    const firstDelta = first.findIndex((event) => event.event === "message.delta");
    const firstCommit = first.findIndex((event) => event.event === "message.committed");
    assert.ok(firstCommit >= 0 && firstCommit < firstDelta);
    assert.equal(commits[0] && record(commits[0]).role, "user");
    assert.equal(record(first.find((event) => event.event === "tool.done")!).tool, "scaffold");
    assert.equal(record(first.find((event) => event.event === "tool.done")!).isError, false);
    assert.match(deltas(first), /scaffold:你好/);
    assert.ok(first.filter((event) => event.event === "message.delta").length >= 2);
    assert.equal(field(first, "done", "stopReason"), "stop");
    assert.deepEqual(
      app.store.loadMessages(String(sessionId)).map((message) => message.role),
      ["user", "assistant", "toolResult", "assistant"],
    );

    const unknown = await fetch(`${app.baseUrl}/v1/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "再次", sessionId: "00000000-0000-4000-8000-000000000000" }),
    });
    assert.equal(unknown.status, 404);

    const second = await postChat({ baseUrl: app.baseUrl, content: "再次", sessionId: String(sessionId) });
    const secondCommits = second.filter((event) => event.event === "message.committed");
    assert.equal(record(secondCommits[0]!).seq, 5);
    assert.equal(app.store.loadMessages(String(sessionId)).length, 8);
    assert.match(deltas(second), /scaffold:再次/);
  } finally {
    await app.close();
  }
});

function deltas(events: SseEvent[]): string {
  return events
    .filter((event) => event.event === "message.delta")
    .map((event) => String(record(event).delta ?? ""))
    .join("");
}

function field(events: SseEvent[], name: string, key: string): unknown {
  const found = events.find((event) => event.event === name);
  assert.ok(found, `missing ${name}`);
  return record(found)[key];
}

function record(event: SseEvent | undefined): Record<string, unknown> {
  assert.ok(event);
  assert.equal(typeof event.data, "object");
  assert.ok(event.data);
  return event.data as Record<string, unknown>;
}
