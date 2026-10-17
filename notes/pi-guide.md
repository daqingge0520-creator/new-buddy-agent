# pi 学习指南
新开 Chat 时 @ 这个文件。AI 讲解前先读完本文件，并按「讲解规则」来讲。

## 讲解规则
- 先讲从哪进来、这一次最常见走哪条分支、和前后谁衔接，再拆细节；不要从函数中间开始讲。
- 我只有 Java 基础，没有 TS 基础：语法用 Java 对照解释。
- 多用具体小例子和生活比喻；我说没懂时，换个角度从整体重新讲。
- 结论要以代码为准，不确定就先查代码再回答。
- 分开讲细节时不要只给结构概览：每段要能回答「输入 / 输出 / 怎么流转 / 有哪些分支、条件怎么判 / 异常怎么处理」。用流水线步骤 + 分支表 + 带变量值的路径例子，避免东一块西一块。
- **先结论、再说人话、再补细节**：不要一上来堆术语或长故事；先用几句让人听懂「是什么 / 干什么 / 何时触发」，再展开。比喻要服务理解，不为生动而生动。
- **机制讲清后补真实场景**：例如 before/after 常做什么、谁在生产里挂钩子，帮助记得住。
- 我说「太复杂」时：砍到最小模型（几句话 + 一张对照表），确认懂了再加一层。

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
                    → prepare → validate → before → execute → after
                    → toolResult 回填 context
                → finishTurn → turn_end
              → agent_end
```

工具单次调用流水线（模型发起，主循环内）：
```
prepareToolCallArguments（可选，工具自带）
  → validateToolArguments（packages/ai）
  → beforeToolCall（Agent 级钩子，可选）
  → executePreparedToolCall → tool.execute（各工具文件）
  → finalizeExecutedToolCall（afterToolCall）
  → tool_execution_end + toolResult 消息
  → runLoop push 进 context
```

嵌套调用（脚本/工具内再调工具，**不**经主循环 executeToolCalls）：
```
ctx.executeTool / codemode 脚本
  → runToolCall（同一套 prepare/execute/finalize，不写历史）
```

关键文件：
- `packages/agent/src/agent.ts`：Agent 类，对外入口；把 beforeToolCall/afterToolCall 传入 loop config。
- `packages/agent/src/agent-loop.ts`：主循环；工具执行、parallel/sequential、`runToolCall` 导出。
- `packages/agent/src/types.ts`：AgentTool、Before/AfterToolCall、terminate 语义。
- `packages/ai/src/utils/validation.ts`：`validateToolArguments`。
- `packages/coding-agent/src/core/agent-session.ts`：挂 before/after → 扩展 tool_call/tool_result；嵌套 `ctx.executeTool`。
- `packages/coding-agent/src/core/tools/*.ts`：各工具 `execute`；edit 有 `prepareArguments`。
- `packages/agent/examples/mcp-codemode/tools.ts`：`runToolCall` 嵌套示例。
- `packages/ai/src/utils/transcript.ts`：`getCurrentTools` 等。

## 学习进度
### 已经懂了
- 主流程从 `agent.prompt` 走到 `runLoop`，模型在 `streamAssistantResponse` 才被调用。
- TS 基础语法与回调「传进去 / 谁调用」分离。
- 工具名单对齐 declareToolChanges；runLoop 双循环与四个开关。
- steering vs follow-up 时机。
- **工具执行与回填**：runLoop 里调 executeToolCalls，结果 push 进 context；失败变 toolResult 不炸循环。
- **prepareArguments**：可选、工具自带；edit 兼容旧参数形状；不是每个工具都必须有。
- **AgentTool 外壳 vs 各工具自己的 parameters schema** 是两层。
- **钩子**：框架插口；before = 校验后、执行前放行/拦截；after = 执行后改结果。
- **before 调用在 prepareToolCall；业务实现在 AgentSession/扩展**，不在 loop 里写死策略。
- **executePreparedToolCall / acceptingUpdates**：进度有有效期，settle 后关门再等已发进度。
- **parallel**：preflight 串行、execute 并行；end 按完成序、toolResult 按源序。
- **runToolCall**：嵌套调用入口，不是模型主路径；脚本组合 MCP/API 可省上下文（像 workflow）。

### 理解错过
- 误区：多轮以后才 declareToolChanges / 模型调用后才写工具。正确：开跑与每轮请求前对齐。
- 误区：A 来自提示词文字。正确：system 消息结构化字段。
- 误区：讲代码「整体+分块」够。正确：还要输入输出、分支、带变量路径。
- 误区：Pi 工具都必须按 edit 的 `edits[]` 格式。正确：那只是 edit 的 schema。
- 误区：每个工具都要写 prepareArguments。正确：可选；多数没有。
- 误区：在 agent-loop 里找 before 的业务拦截逻辑。正确：loop 只调钩子；实现挂在外面。
- 误区：runToolCall 是模型每次调工具的必经之路。正确：主循环不走它；嵌套才走。
- 误区：runToolCall = 把 MCP 协议又简化一层。正确：模型侧编排变简单；内部仍走完整流水线与权限。

### 疑问
（暂无）

### 下一步
- 精读 `streamAssistantResponse`（`agent-loop.ts:381-469`）：partial 怎么边流边推进 context、事件序列。
- （可选）bash 内部进度节流与框架 `acceptingUpdates` 如何对上。

## 详细笔记
见同目录的 `pi.md`。
