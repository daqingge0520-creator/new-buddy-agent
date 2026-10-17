# pi 学习指南
新开 Chat 时 @ 这个文件。AI 讲解前先读完本文件，并按「讲解规则」来讲。

## 讲解规则
- 先讲从哪进来、这一次最常见走哪条分支、和前后谁衔接，再拆细节；不要从函数中间开始讲。
- 我只有 Java 基础，没有 TS 基础：语法用 Java 对照解释。
- 多用具体小例子和生活比喻；我说没懂时，换个角度从整体重新讲。
- 结论要以代码为准，不确定就先查代码再回答。
- 分开讲细节时不要只给结构概览：每段要能回答「输入 / 输出 / 怎么流转 / 有哪些分支、条件怎么判 / 异常怎么处理」。用流水线步骤 + 分支表 + 带变量值的路径例子，避免东一块西一块。

## 项目地图
仓库：`D:\workspace\GITHUB\pi`（Pi 官方仓库 earendil-works/pi 的本地克隆，只读学习）

主流程（一次请求从进门到多轮结束）：
```
agent.prompt(...)                      packages/agent/src/agent.ts:370-381
  → normalizePromptInput               把字符串/消息统一成 AgentMessage[]
  → runPromptMessages                  agent.ts:432-447
    → runWithLifecycle                 准备 signal、streaming 状态；agent.ts:524 调用 executor
      → runAgentLoop                   packages/agent/src/agent-loop.ts:102-126
          → declareToolChanges         agent-loop.ts:323-365，对齐工具名单（不调模型）
          → emit 生命周期事件          agent_start / turn_start / message_*
          → runLoop                    agent-loop.ts:160-321
              外层：follow-up / 强制 continue
              内层：每次迭代 = 一次调模型
                →（非首轮）prepareNextTurn + turn_start
                → 写入 pending + declareToolChanges
                → prepareRequest
                → streamAssistantResponse   ★ 调模型
                → 可选 executeToolCalls / 截断则故意失败
                → finishTurn → turn_end
              → agent_end
```

关键文件：
- `packages/agent/src/agent.ts`：Agent 类，对外入口（prompt / steer / followUp）、生命周期、事件处理；steeringQueue / followUpQueue 在这里 drain。
- `packages/agent/src/agent-loop.ts`：主循环，启动段、工具名单对齐、runLoop、streamAssistantResponse、executeToolCalls。
- `packages/agent/src/types.ts`：FinishTurn、PrepareRequest、PrepareNextTurn、队列回调等类型与注释。
- `packages/ai/src/utils/transcript.ts`：对话记录工具函数，如 `getCurrentTools`（重放 system 消息算出当前工具集）。

## 学习进度
### 已经懂了
- 主流程从 `agent.prompt` 走到 `runLoop`，模型在 `runLoop` 里的 `streamAssistantResponse` 才被调用。
- TS 基础语法：方法重载、类型后置、可选字段、默认参数、async/await、箭头函数、闭包、`??`、`...`、可选调用 `?.()`。
- 回调：传进去的地方看不到调用，调用点在接收方函数体里（`emit(...)`、`executor(...)`）。
- 工具名单对齐：B = `context.tools`（注册的可执行工具），A = 重放对话记录里 `toolsAdded`/`toolsRemoved` 得到的工具集；`runAgentLoop` 启动时做一次，`runLoop` 每轮写入 pending 前还会做。
- `runLoop` 双循环：内层一次 = 一次调模型；工具在同轮模型返回后跑；外层处理 follow-up / `finishTurn` 强制 continue。
- 四个开关：`lastCompletedTurn`、`hasMoreToolCalls`、`pendingMessages`、`explicitContinuation`；停下来的决策顺序见笔记 §7.5。
- 第一次跳过 prepareNextTurn / 二次 turn_start；从有 `lastCompletedTurn` 起才走那段。
- steering（内层回合末捞）vs follow-up（内层退出后捞）的时机差别。

### 理解错过
- 误区：多轮对话以后才会进 `declareToolChanges`。正确：每次 `runAgentLoop` 开跑都会进，第一轮负责首次登记全部工具；`runLoop` 写入 pending 前也会再对齐。
- 误区：模型调用以后才把工具写进去。正确：在调用模型之前写进去。
- 误区：A 来自系统提示词或 Skill 里的文字。正确：只来自 system 消息的结构化字段。
- 误区：讲代码时「整体 + 分块」就够。正确：还要能说清输入输出、分支条件、异常路径，并用带变量的路径例子走通。

### 疑问
（暂无）

### 下一步
- 精读 `streamAssistantResponse`（`agent-loop.ts:381-469`）：partial 怎么边流边推进 context、事件序列。
- 再读 `executeToolCalls` 的 parallel / sequential 与 terminate。

## 详细笔记
见同目录的 `pi.md`。
