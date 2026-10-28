# Buddy Agent

门店客服框架的最小切片：Pi 跑一轮对话，经 SSE 流出，消息落入 SQLite。

## 技术栈

- Pi v1.2.0：`@earendil-works/pi-ai`、`@earendil-works/pi-agent-core`（不用 `pi-coding-agent`）
- TypeScript（strict）、Node `>=22.19`（`node:sqlite`）
- `POST /v1/chat` + SSE；默认库文件 `data/buddy.sqlite`

## 约定

- 有 `DEEPSEEK_API_KEY` 走 DeepSeek；否则 faux。`npm run demo` 始终 faux。
- `message_end` 先落库，再发 `message.committed`。
- 工具只有 `scaffold`（回显参数，不是门店业务）。
- 密钥不进仓库。审核规则见 `REVIEW.md`。

## 目标

能本地起服务、流式对话、会话可续写；CI 跑 typecheck 与 test。

## 本轮不做什么

- 不做鉴权、不做 `beforeToolCall`
- 工具只有 scaffold；不要接真实门店数据
- 不使用任何原雇主品牌名（禁用：茂日、mrkj、Maori）
- 不做网关、多租户、MySQL、生产部署
