import assert from "node:assert/strict";
import test from "node:test";
import { decideToolCall, grantForCaller } from "../src/auth.js";
import { findFaq, findMember } from "../src/fixtures.js";
import { createTurnRuntime, selectModelMode } from "../src/model.js";
import { startTurn } from "../src/run-turn.js";
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
  assert.equal(runtime.mode, "deepseek");
  assert.equal(runtime.model.provider, "deepseek");
  assert.equal(runtime.model.api, "openai-completions");
  assert.equal(runtime.model.id, "deepseek-flash");
  assert.equal(runtime.model.baseUrl, "https://example.test/v1");
  assert.equal(runtime.getApiKey?.("deepseek"), "sk-test");
});

test("fixture tools answer member and FAQ lookups", () => {
  assert.match(findMember("13800000000").text, /张三/);
  assert.match(findMember("13800000000").text, /320/);
  assert.match(findMember("10000000000").text, /未找到/);
  assert.match(findFaq("你们营业时间是几点").text, /10:00/);
  assert.match(findFaq("明天天气").text, /没有匹配/);
});

test("beforeToolCall decision blocks a missing grant and a tool outside the allowlist", () => {
  assert.equal(decideToolCall(undefined, "lookup_member").allowed, false);
  const limited = { subject: "limited", allowedTools: new Set(["search_faq"]) };
  assert.equal(decideToolCall(limited, "lookup_member").allowed, false);
  assert.equal(decideToolCall(grantForCaller(), "lookup_member").allowed, true);
  assert.equal(decideToolCall(grantForCaller(), "search_faq").allowed, true);
});

test("hook blocks member lookup before the fixture runs", async () => {
  const events: SseEvent[] = [];
  const turn = startTurn({
    content: "帮我查一下 13800000000 这个会员",
    grant: { subject: "limited", allowedTools: new Set(["search_faq"]) },
    mode: "faux",
    emit: (event, data) => events.push({ event, data }),
  });
  await turn.done;
  const text = deltas(events);
  assert.equal(record(events, "tool.auth").allowed, false);
  assert.equal(record(events, "tool.done").isError, true);
  assert.equal(text.includes("张三"), false);
  assert.match(text, /不能调用 lookup_member/);
});

test("POST /v1/chat streams a member answer and an FAQ answer", async () => {
  const app = await startApp({ port: 0, host: "127.0.0.1", mode: "faux", token: "demo", env: {} });
  try {
    const health = await fetch(`${app.baseUrl}/health`);
    assert.equal(health.status, 200);
    const healthBody = (await health.json()) as { ok: boolean; mode: string };
    assert.equal(healthBody.ok, true);
    assert.equal(healthBody.mode, "faux");

    const denied = await fetch(`${app.baseUrl}/v1/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "你好" }),
    });
    assert.equal(denied.status, 401);

    const member = await postChat({
      baseUrl: app.baseUrl,
      token: "demo",
      content: "帮我查一下 13800000000 这个会员",
    });
    assert.equal(record(member, "tool.auth").tool, "lookup_member");
    assert.equal(record(member, "tool.auth").allowed, true);
    assert.equal(record(member, "tool.done").isError, false);
    assert.match(deltas(member), /张三/);
    assert.ok(member.filter((event) => event.event === "message.delta").length >= 2);
    assert.equal(record(member, "done").stopReason, "stop");

    const faq = await postChat({
      baseUrl: app.baseUrl,
      token: "demo",
      content: "积分怎么抵扣？",
    });
    assert.equal(record(faq, "tool.auth").tool, "search_faq");
    assert.match(deltas(faq), /100 积分可抵 1 元/);
  } finally {
    await app.close();
  }
});

function deltas(events: SseEvent[]): string {
  return events
    .filter((event) => event.event === "message.delta")
    .map((event) => {
      const data = event.data as { delta?: string };
      return data.delta ?? "";
    })
    .join("");
}

function record(events: SseEvent[], name: string): Record<string, unknown> {
  const found = events.find((event) => event.event === name);
  assert.ok(found, `missing ${name}`);
  assert.equal(typeof found.data, "object");
  assert.ok(found.data);
  return found.data as Record<string, unknown>;
}
