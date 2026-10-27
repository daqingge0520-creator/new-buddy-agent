# Buddy Agent

门店客服框架的最小切片，跑在 [Pi](https://github.com/earendil-works/pi) 上。只用 `@earendil-works/pi-ai` 和 `@earendil-works/pi-agent-core`，**锁定 v1.2.0**。不用 `pi-coding-agent`。

```
POST /v1/chat
  Pi Agent（无 key：faux；有 DEEPSEEK_API_KEY：DeepSeek OpenAI Chat Completions）
  scaffold 占位工具
  message_end 写入 SQLite 之后才发 message.committed
  message.delta 流式输出
```

## 运行

Node.js **>= 22.19**。不要把密钥写进仓库。

```bash
npm install
npm run demo    # 固定 faux，不消耗 key
npm test
npm start       # 有 DEEPSEEK_API_KEY 才走 DeepSeek
```

```bash
curl -N -X POST http://127.0.0.1:8787/v1/chat \
  -H "Content-Type: application/json" \
  -d '{"content":"你好"}'
```

继续同一会话时带上返回的 `sessionId`。数据库文件默认 `data/buddy.sqlite`（`BUDDY_DB` 可改）。`DEEPSEEK_BASE_URL` 覆盖模型地址，默认 `https://api.deepseek.com`。`DEEPSEEK_MODEL` 默认 `deepseek-flash`。`HOST` / `PORT` 默认 `127.0.0.1:8787`。

`npm run demo` 即使环境里有 key 也走 faux。真实模型用 `npm start`。

## API

`GET /health` → `{ "ok": true, "mode": "faux" | "deepseek" }`

`POST /v1/chat`

```json
{ "content": "你好", "sessionId": "可选" }
```

`text/event-stream`：

| 事件 | 含义 |
|---|---|
| `session` | 会话已写入。`{ "sessionId" }` |
| `message.delta` | 未落库的文本片段 |
| `message.committed` | 该条消息已写入 SQLite 之后才发送 |
| `tool.done` | `scaffold` 执行结束 |
| `done` | 本轮结束 |
| `error` | 本轮失败 |

## 范围内

- Pi 循环与 `POST /v1/chat` SSE
- 一个占位工具 `scaffold`（回显参数，不是门店业务）
- SQLite 会话消息。`message_end` 的监听器先写入，再发 `message.committed`；Pi 会等这个监听器结束
- 无 key 用 faux；有 key 用 DeepSeek 的 OpenAI 兼容接口

## 这次不做

- 鉴权与 `beforeToolCall`
- 网关、多租户、MySQL、生产部署
- 真实门店工具和公司数据
- `pi-coding-agent`、Claude Agent SDK

导读在 [docs/pi-source-guide.md](docs/pi-source-guide.md)，其中的多租户设计不是这个切片。
