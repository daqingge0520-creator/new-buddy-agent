# pi 学习指南
新开 Chat 时 @ 这个文件。AI 讲解前先读完本文件，并按「讲解规则」来讲。

## 讲解规则
- 先讲从哪进来、这一次最常见走哪条分支、和前后谁衔接，再拆细节；不要从函数中间开始讲。
- 我只有 Java 基础，没有 TS 基础：语法用 Java 对照解释。
- 多用具体小例子和生活比喻；我说没懂时，换个角度从整体重新讲。
- 结论要以代码为准，不确定就先查代码再回答。

## 项目地图
仓库：`D:\workspace\GITHUB\pi`（Pi 官方仓库 earendil-works/pi 的本地克隆，只读学习）

主流程（一次请求从进门到调用模型）：
```
agent.prompt(...)                      packages/agent/src/agent.ts:370-381
  → normalizePromptInput               把字符串/消息统一成 AgentMessage[]
  → runPromptMessages                  agent.ts:432-447
    → runWithLifecycle                 准备 signal、streaming 状态；agent.ts:524 调用 executor
      → runAgentLoop                   packages/agent/src/agent-loop.ts:102-126
          → declareToolChanges         agent-loop.ts:323-365，对齐工具名单（不调模型）
          → emit 生命周期事件          agent_start / turn_start / message_*
          → runLoop                    真正调用模型、执行工具、多轮
```

关键文件：
- `packages/agent/src/agent.ts`：Agent 类，对外入口（prompt / steer / followUp）、生命周期、事件处理。
- `packages/agent/src/agent-loop.ts`：主循环，启动段、工具名单对齐、runLoop。
- `packages/ai/src/utils/transcript.ts`：对话记录工具函数，如 `getCurrentTools`（重放 system 消息算出当前工具集）。

## 学习进度
### 已经懂了
- 主流程从 `agent.prompt` 走到 `runLoop`，模型在 `runLoop` 里才被调用。
- TS 基础语法：方法重载、类型后置、可选字段、默认参数、async/await、箭头函数、闭包、`??`、`...`。
- 回调：传进去的地方看不到调用，调用点在接收方函数体里（`emit(...)`、`executor(...)`）。
- 工具名单对齐：B = `context.tools`（注册的可执行工具），A = 重放对话记录里 `toolsAdded`/`toolsRemoved` 得到的工具集；每轮调用模型前比较 A 和 B，补上差量。

### 理解错过
- 误区：多轮对话以后才会进 `declareToolChanges`。正确：每次 `runAgentLoop` 开跑都会进，第一轮负责首次登记全部工具。
- 误区：模型调用以后才把工具写进去。正确：在调用模型之前写进去。
- 误区：A 来自系统提示词或 Skill 里的文字。正确：只来自 system 消息的结构化字段。

### 疑问
（暂无）

### 下一步
- 看 `runLoop`：第一次怎么调到模型，流式拿到回复后怎么执行工具，再进入下一轮。

## 详细笔记
见同目录的 `pi.md`。
