# Buddy Agent

门店智能客服的最小可运行切片，跑在 [Pi](https://github.com/earendil-works/pi) 上。运行时只用 `@earendil-works/pi-ai` 和 `@earendil-works/pi-agent-core`，**锁定 v1.2.0**。不用 `pi-coding-agent` 当运行时。

一条请求的路径：

```
POST /v1/chat
  HTTP Bearer 校验
  Pi Agent
    模型：无 key 时 faux；有 DEEPSEEK_API_KEY 时 DeepSeek（OpenAI Chat Completions）
    beforeToolCall：工具允许列表
    工具：lookup_member、search_faq（进程内固定数据）
  SSE：tool.auth → tool.done → message.delta… → done
```

## 环境

Node.js **>= 22.19**。不把密钥写进仓库。

| 变量 | 作用 |
|---|---|
| `DEEPSEEK_API_KEY` | 有值时 `npm start` 走 DeepSeek；没有则走 faux |
| `DEEPSEEK_BASE_URL` | 可选。覆盖模型上的 OpenAI 兼容地址，默认 `https://api.deepseek.com` |
| `DEEPSEEK_MODEL` | 可选，默认 `deepseek-flash` |
| `BUDDY_API_TOKEN` | 可选。请求头 `Authorization: Bearer …`。未设置时本地令牌是 `demo` |
| `HOST` / `PORT` | 可选，默认 `127.0.0.1:8787` |

`demo` 是本地开发令牌，只用于这条切片，不是生产凭证。

## 运行

```bash
npm install
npm run demo
```

`npm run demo` **固定走 faux**，这样脚本里的工具调用是确定的，不消耗 API key。即便环境里已经有 `DEEPSEEK_API_KEY`，demo 也不会发真实请求。它会打出两次 SSE：查会员 `13800000000`，以及营业时间。

带 key 跑真实模型：

```bash
export DEEPSEEK_API_KEY=sk-...   # 只放在环境里，不要提交
npm start
```

另一个终端：

```bash
curl -N -X POST http://127.0.0.1:8787/v1/chat \
  -H "Authorization: Bearer demo" \
  -H "Content-Type: application/json" \
  -d '{"content":"帮我查一下 13800000000 这个会员"}'
```

DeepSeek 自己决定是否调用工具。faux 路径会按问题里的手机号调用 `lookup_member`，否则调用 `search_faq`。

检查：

```bash
npm test
npm run typecheck
```

## API

`GET /health` → `{ "ok": true, "mode": "faux" | "deepseek" }`

`POST /v1/chat`

```json
{ "content": "帮我查一下 13800000000 这个会员" }
```

响应 `text/event-stream`：

| 事件 | 含义 |
|---|---|
| `tool.auth` | `beforeToolCall` 的结果。`allowed: false` 时工具不会执行 |
| `tool.done` | 工具结束。拦截也走这里，`isError: true` |
| `message.delta` | 回答的一个文本片段。`{ "delta": "…" }` |
| `done` | 本轮结束。`{ "stopReason": "stop" }` |
| `error` | 本轮抛错时才有 |

## 范围内

- Pi agent 循环（`pi-ai` + `pi-agent-core` 1.2.0）
- 两个内存工具：按手机号查会员，按关键词查常见问题
- `beforeToolCall` 允许列表
- 自建的最小 `/v1` SSE 宿主
- 无 key 用 faux；有 `DEEPSEEK_API_KEY` 用 DeepSeek 的 OpenAI 兼容接口

## 这次不做

- 网关产品，或另一层 gateway
- 会话 / 消息数据库，以及 persist-then-ACK
- 多租户、MySQL、生产部署
- 渠道适配（微信等）
- 与旧 Python 服务的功能对齐
- `pi-coding-agent` 或 Claude Agent SDK

Pi 源码导读仍在 [docs/pi-source-guide.md](docs/pi-source-guide.md)。那份笔记里的 MySQL / 多租户宿主是阅读材料，不是这个切片。

## 布局

| 路径 | 职责 |
|---|---|
| `src/server.ts` | HTTP：`/health`、`POST /v1/chat` |
| `src/run-turn.ts` | 组装 Agent、钩子，并把事件写成 SSE |
| `src/auth.ts` | Bearer 与 `beforeToolCall` 判定 |
| `src/tools.ts` / `src/fixtures.ts` | 会员和常见问题的固定数据 |
| `src/model.ts` | faux 或 DeepSeek |
| `src/demo.ts` | 离线 demo |
| `src/main.ts` | 常驻进程 |
