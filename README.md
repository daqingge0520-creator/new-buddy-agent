# Buddy Agent

门店智能客服（Buddy Agent）正在重写到 [Pi](https://github.com/earendil-works/pi) 运行时。运行时只用 `@earendil-works/pi-ai` 和 `@earendil-works/pi-agent-core`，**锁定 v1.2.0**。不用 `pi-coding-agent` 当运行时。

这一周的目标是把一条链路跑通：**一个问题 → 一次工具调用 → 流式回答**。本仓库目前只有源码导读和本地最小 demo，没有 HTTP / SSE、没有 MySQL、也没有多租户宿主层。

- 导读：[docs/pi-source-guide.md](docs/pi-source-guide.md)
- 示例：[examples/minimal-tool-loop/demo.mts](examples/minimal-tool-loop/demo.mts)

## 环境

优先使用 **Node.js >= 22.19**。`pi-ai` / `pi-agent-core` 的 `engines` 写的是 `node >= 22.19.0`。Node 20 上这个 demo 曾经跑通过，只适合本地看效果，不要拿来当生产运行时。

不需要 API key。默认走 faux provider 和假的「查会员」工具。不要把密钥写进仓库。

## 运行

```bash
npm install
npm run demo
```

类型检查：

```bash
npm run typecheck
```

默认输出里应能看到鉴权钩子、工具完成、逐 token 打出的会员答案，以及 `agent_end`。如果环境里已经设置了 `DEEPSEEK_API_KEY`，同一条 demo 会改走 DeepSeek；本仓库不提供、也不提交任何 key。
