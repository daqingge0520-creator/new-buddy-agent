# Pi 源码学习笔记

## 2026-10-17

### 1. 一次请求的完整路线（先看这张地图）
来源：Cursor Chat，`packages/agent/src/agent.ts`、`packages/agent/src/agent-loop.ts`

```
agent.prompt("帮我看看项目")
  → 已经在跑？报错，改用 steer() / followUp()
  → normalizePromptInput：字符串/消息统一变成 AgentMessage[]
  → runPromptMessages
    → runWithLifecycle：准备取消信号 signal、设 streaming 状态，出错/结束时清理
      → runAgentLoop（agent-loop.ts:102-126）
          → declareToolChanges：对齐工具名单（本地计算，不调模型）
          → emit agent_start / turn_start / message_start / message_end
          → runLoop：这里才真正调用模型、跑工具、可能多轮
```
结论：读代码要先从入口顺着这条线走，弄清「这次请求走哪条分支」，再看某一段细节。从函数中间开始看，上下文接不上。

### 2. TS 语法（对照 Java）
- `agent.ts:370-381` 方法重载：前两行是给调用方看的签名（传消息，或传字符串加可选图片），第三行才是实现。作用是让 `prompt(msg, images)` 这种不合理的组合在类型上就报错。
- `agent.ts:432-447` `runPromptMessages`：
  - `name: Type` 类型写在名字后面，和 Java 相反。
  - `options: { skipInitialSteeringPoll?: boolean } = {}`：内联对象类型，`?` 表示可选字段，`= {}` 是默认参数（Java 只能靠重载实现）。
  - `async` / `await` ≈ `CompletableFuture`，但不阻塞线程。
  - 箭头函数 `(x) => { ... }` ≈ Java lambda `x -> { ... }`。
  - `(event) => this.processEvents(event)` ≈ `this::processEvents`。写成箭头函数是为了不丢 `this`。
  - 箭头函数里能用外层的 `messages`、`options`、`this`，这叫闭包。
- `??`：左边是 null/undefined 时用右边，例如 `streamFn ?? getDefaultStreamFn()`。
- `...` 展开：拷贝出新数组/新对象，≈ `new ArrayList<>(old); addAll(...)`。

### 3. 回调：「传进去」和「谁调用」不在同一处
- 传函数时只是把一段还没执行的代码交出去，**调用点在接收方的函数体里**，所以在传参那一行看不到调用。
- `event` 从哪来：`(event) => this.processEvents(event)` 传给 `runAgentLoop` 后，在那边叫 `emit`。`agent-loop.ts:117-121` 的 `await emit({ type: "agent_start" })` 执行时，`event` 就是 `{ type: "agent_start" }`。
- `signal` 从哪来：`agent.ts:507-508` 中 `executor: (signal: AbortSignal) => Promise<void>` 的意思是「executor 是一个函数，接收 signal，返回 Promise」，不是说 executor 是 signal。真正的调用在 `agent.ts:524` 的 `await executor(abortController.signal)`。
- 规律：谁调用 `emit(...)` / `executor(...)`，谁就负责提供参数的值。

### 4. runAgentLoop 启动段（`agent-loop.ts:102-126`）
1. `declareToolChanges(context, prompts)`：得到这次要追加的消息 `initialMessages`，必要时多一条声明工具变更的 system 消息。
2. `newMessages` 只记这次 run 新产生的消息，最后作为返回值；`currentContext` = 旧消息 + 新消息，给模型用。
3. 发出 agent_start、turn_start 和每条消息的 start/end 事件，通知 Agent 和 UI。
4. `runLoop(...)` 真正调用模型、跑工具；返回 `newMessages`。
- `runAgentLoopContinue` 不再加新 prompt，所以没有 `declareToolChanges` 这一步。

### 5. 工具名单对齐（`agent-loop.ts:323-365`，`declareToolChanges`）
- 有两份工具名单：
  - **B**：`context.tools`，Agent 注册时挂上的、程序真正能执行的工具（由配置决定）。
  - **A**：`getCurrentTools`（`packages/ai/src/utils/transcript.ts:58-65`）把对话记录里所有 system 消息的 `toolsAdded` / `toolsRemoved` 字段按时间重放一遍，得到「记录认为现在有哪些工具」。只看结构化字段，不解析系统提示词或 Skill 里的文字。
- 函数做的事：比较 A 和 B，B 多出来的写进 `toolsAdded`，B 没有的写进 `toolsRemoved`，作为一条 system 消息加进这次的消息里（已有 pending system 就改那条，没有就新插一条）。
- 这是纯本地的对齐算法，**不调用模型**，也不决定权限。哪些工具能用是别处配置好的。
- **每次 `runAgentLoop` 开跑都会进这个函数**，而且在调用模型之前：
  - 第一轮：A 为空，B 已有工具，于是把全部工具首次登记进去。
  - 之后每轮：工具配置没变就几乎什么都不做；只有程序中途改了 `context.tools`（加载/卸载工具等）才补增删。
  - 增删的依据是 `context.tools` 变没变，不是模型说要用什么，也不是轮数多了就会变。
- baseline：pending system 上原来写的工具变更只算「草稿」，计算差量前先清空，避免重复叠加。
- 比喻：B 是厨房白板（今天真能做的菜），A 是点菜单历史本（顾客只看这个）。白板一变，就在历史本上补一条「菜单更新」公告。

### 6. 读代码的方法（我自己的体会）
- 让 AI 讲代码时，先要求它讲「从哪进来、这一次最常见走哪条分支、和前后谁衔接」，再拆细节。
- 我容易把顺序搞反（以为模型调用后才写工具名单），以后要先确认调用顺序。
- 补充：只讲「整体结构 + 分块注释」不够；要能回答这五问才算懂一段代码：
  1. 关键部分的输入是什么？
  2. 输出是什么？
  3. 逻辑怎么流转？
  4. 有哪些分支、条件怎么判？
  5. 异常/特殊情况怎么处理？
  讲解顺序保持「先整体再分开」，但分开时要用流水线步骤 + 分支表 + 带变量值的路径例子，避免东一块西一块。

### 7. runLoop：输入、输出、双循环（`agent-loop.ts:160-321`）
来源：Cursor Chat，接着第 4 节启动段往下读。

#### 7.1 谁调用它、进门时状态是什么
```
runAgentLoop / runAgentLoopContinue
  → 已 declareToolChanges（仅 prompt 路径）
  → 已 emit agent_start、turn_start（以及 prompt 消息的 message_*）
  → runLoop(...)          ← 这里还没调模型
       → …多次「准备 → 调模型 → 工具 → 调度」…
       → emit agent_end
```
进门时：对话里已经有用户消息；第一次 `turn_start` 已经发过；`lastCompletedTurn` 在函数里还是空的。

#### 7.2 整个函数的输入 / 输出
**输入（参数）：**

| 参数 | 含义 | 进门时常见状态 |
|------|------|----------------|
| `initialContext` | 对话 `messages` + `tools` | 已含历史 + 本次用户消息 |
| `newMessages` | 外面创建好的数组，这里往里 push | prompt 路径已有对齐消息+用户消息；continue 路径是 `[]` |
| `initialConfig` | 模型、钩子、`convertToLlm`、队列回调 | 来自 Agent |
| `signal` | 取消令牌 | 用户停止时 abort |
| `emit` | 发事件回调 | UI / Agent 状态 |
| `streamFunction` | 真正打模型的函数 | 默认流式请求 |

Java 对照：`newMessages` 像按引用传入的 `List`，函数内 `push` 外面看得到；返回类型是 `Promise<void>`，业务结果不靠 return 值。

**输出（真正的产出）：**
1. 改 `currentContext.messages`（对话变长）
2. 往 `newMessages` 里 push（这次 run 新增消息）
3. 通过 `emit` 发事件
4. 结束时一定有 `agent_end`（正常 break 或中途 return）

**一句话职责：** 反复做「（可选：塞消息）→ 调模型 →（可选：跑工具）→ 看还要不要再来」，直到没有理由继续。

#### 7.3 推动流转的四个开关 + 两层循环
| 变量 | 作用 |
|------|------|
| `lastCompletedTurn` | 空=还没完成过一轮；有值=至少跑完过一次助手回合（含工具结果） |
| `hasMoreToolCalls` | 本轮是否还要因「工具流程」再进内层 |
| `pendingMessages` | 下一轮调模型**之前**必须先写入对话的消息（steering / follow-up / prepareNextTurn 带来的） |
| `explicitContinuation` | `finishTurn` 是否要求「保证再请求一次模型」 |

另有工作副本：`currentContext`、`config`（循环里可能被钩子改掉）。

```
外层 while(true)                         // 整次 agent 还要不要再开一轮
  hasMoreToolCalls = true                // 故意：保证至少进内层一次 → 至少调一次模型
  内层 while(有工具要续 || 有 pending)
      【一轮流水线】见 7.4
  内层退出
  有 follow-up？ → pending=followUp，外层 continue
  要强制 continue？ → 外层 continue（不塞新消息）
  否则 break → agent_end
```

关键结论：**内层一次迭代 = 对模型发起一次请求。** 工具在同一次迭代里、模型返回后立刻跑；跑完用 `hasMoreToolCalls` 决定要不要再开一次内层（再调模型）。

比喻：
- **内层**：厨师还在这顿里炒菜——有工具要跑，或用户中途插话（steering）。
- **外层**：这顿本该结账了——还有「做完再说」的 follow-up，或 `finishTurn` 要求再来一轮。
- **steering**：炒菜时探头说「少放盐」。
- **follow-up**：结完账再说「再来一份饭」。

#### 7.4 内层一轮流水线（每步的输入 / 判断 / 输出）

**步骤 A（185–208）下一回合准备**  
- 判断：`if (lastCompletedTurn)` —— 第一次为空，整步跳过。  
- 第二次及以后：`prepareNextTurn`（可改 context/config、拿出 `preparedMessages`）→ pending 空则再捞 steering → `emit(turn_start)`。  
- 为什么第一次跳过：外面 `runAgentLoop` 已发过 `turn_start`；这里只给后续回合用。  
- 注释要点：`prepareNextTurn` 可能很慢（如压缩），期间用户又打字；只有 `pendingMessages.length === 0` 才再捞，避免「一次只处理一条」模式一次塞两条。

**步骤 B（210–217）写入排队消息**  
- 输入：`preparedMessages + pendingMessages`。  
- 再跑一次 `declareToolChanges`，然后每条 `message_start/end` + push 进 context 和 newMessages；清空 pending。  
- 第一次常见：两边都空 → for 0 次。  
- 语法：`[...a, ...b]` ≈ Java `new ArrayList<>(a); addAll(b)`。

**步骤 C（219–239）`prepareRequest`**  
- 每次请求前最后一刀，可改 context/model/thinking；**不捞队列**。无钩子则跳过。

**步骤 D（241–243）调模型 ★**  
```
const message = await streamAssistantResponse(...);
newMessages.push(message);
```
- `streamAssistantResponse` 内部流式请求并把助手消息推进 `currentContext.messages`。  
- **第一次调到模型就是走到这一行**（前面 A 跳过、B 常为空）。

**步骤 E（245–256）硬退出：error / aborted**  
- 判断：`stopReason === "error" || "aborted"`。  
- 为真：记 lastCompletedTurn（toolResults=[]）→ finishTurn → turn_end → agent_end → **`return` 出整个函数**。  
- 不跑工具，不看 steering/follow-up。

**步骤 F（258–278）工具**  
```
先 hasMoreToolCalls = false
若有 toolCall：
  stopReason=="length" → failToolCallsFromTruncatedMessage（全部故意失败，不真执行）
  否则 → executeToolCalls
  hasMoreToolCalls = !executedToolBatch.terminate
  每条 toolResult push 进 context / newMessages
```
- 截断时参数可能半截，执行不安全，所以全部报错给模型重发；`fail...` 返回 `terminate: false`，故通常仍 `hasMoreToolCalls=true`。  
- `.filter(c => c.type === "toolCall")` ≈ Java Stream filter。

**步骤 G（280–298）收尾 + 调度**（顺序固定）  
1. `lastCompletedTurn = { message, toolResults, context, newMessages }`  
2. `decision = finishTurn?(...)`  
3. `emit(turn_end)`  
4. `decision.action === "end"` → agent_end → **return**  
5. `explicitContinuation = (decision.action === "continue")`（否则 false）  
6. 再捞 steering → `pendingMessages`  
7. 若 `hasMoreToolCalls || pending 非空` → 把 `explicitContinuation` 清成 false（下一轮自然会发生，不必再记「强制多跑」）  
然后回内层 while 条件。

**步骤 H（301–317）外层**（内层已认为可停）  
1. follow-up 非空 → pending=followUp，外层 continue  
2. 否则若 `explicitContinuation` → 清标志，外层 continue（**不塞新消息**，但外层会再把 `hasMoreToolCalls=true`，内层再调一次模型）  
3. 否则 break → `agent_end`

#### 7.5 分支总表
| 条件 | 动作 | 下一站 |
|------|------|--------|
| `lastCompletedTurn == null` | 跳过 A | B |
| `lastCompletedTurn != null` | prepareNextTurn + 可能再捞 steering + turn_start | B |
| `stopReason` 为 error/aborted | turn_end + agent_end | **函数结束** |
| 无 toolCall | `hasMoreToolCalls=false` | G |
| 有 toolCall 且 `length` | 全部失败结果，不执行 | G，通常仍要续 |
| 有 toolCall 且正常 | `executeToolCalls` | G，`hasMoreToolCalls=!terminate` |
| `finishTurn → end` | agent_end | **函数结束** |
| 有工具要续或有 steering | 清强制 continue；内层再转 | A |
| 无工具、无 steering | 出内层 | H |
| follow-up 非空 | pending=followUp；外层 continue | 新内层（先塞消息） |
| 无 follow-up 但强制 continue | 外层 continue | 新内层（不塞消息） |
| 都没有 | break | **正常 agent_end** |

停下来的决策顺序（钉死）：error/abort → 跑工具 → finishTurn(end) →（工具续跑 / steering）撑内层 → 内层空了再看 follow-up → 再看强制 continue → 否则 agent_end。

#### 7.6 三条带变量的路径（钩子未配置、队列为空时）

**路径 1：只回文字（最常见）**  
`lastCompletedTurn=null`，pending=[] → 外层把 hasMoreToolCalls=true → 进内层 → 跳过 A → B 空 → D 调模型一次 → 无工具 → G 后内层条件假 → H 无 follow-up/continue → break → agent_end。  
**调模型 1 次。**

**路径 2：一次工具再回答**  
第 1 次内层：D 返回带 toolCall → F 执行并 append 结果，`hasMoreToolCalls=true` → 内层再进。  
第 2 次内层：A 因有 lastCompletedTurn 而走（新 turn_start）→ D 再调模型（纯文字）→ 无工具 → H 结束。  
**调模型 2 次。** 第二次才走 prepareNextTurn / 二次 turn_start。

**路径 3：内层停了但有 follow-up**  
H 把 followUp 塞进 pending，外层 continue → 新内层因 pending 进入 → A 有 lastCompletedTurn → B 写入用户后续消息 → D 再调模型。

#### 7.7 特殊 / 异常
| 情况 | 处理 |
|------|------|
| error / aborted | 硬 return，不跑工具、不看队列 |
| length + toolCall | 不执行，全部错误 toolResult，通常仍续一轮让模型重发 |
| finishTurn → end | 本轮工具已在 F 跑完；发 turn_end 后硬停 |
| finishTurn → continue | 若已有工具续跑或 steering 则清掉标志；只有两边都没有时，外层再开一轮空消息请求 |
| 工具 batch terminate | `hasMoreToolCalls=false`，不因工具再进内层 |

#### 7.8 相关语法（本段新见到的）
- `config.getSteeringMessages?.()`：函数存在才调用，否则整段 undefined；再 `|| []`。≈ Java 先判 null 再 call。  
- `thinkingLevel === "off" ? undefined : level`：配置里用 `undefined` 表示关思考，和字面 `"off"` 在这里统一。  
- `decision?.action === "end"`：decision 为空则短路为假。

### 下一步（本节当时）
- 精读 `streamAssistantResponse`（仍待做）。
- `executeToolCalls` 已在同日 §8–§14 补完。

### 8. 工具执行总览：从 runLoop 到回填（`agent-loop.ts:258-277`，`508-949`）
来源：Cursor Chat，接着 runLoop 内层流水线里「模型返回后跑工具」一段。

```
streamAssistantResponse → message（assistant）
  → 有无 toolCall？
       无 → toolResults=[]，hasMoreToolCalls=false
       有 → stopReason==="length"？
              是 → failToolCallsFromTruncatedMessage（故意全失败，不真跑）
              否 → executeToolCalls（真跑）
  → push toolResult 进 currentContext.messages / newMessages   ←「回填」
  → hasMoreToolCalls = !terminate
  → finishTurn → turn_end → 内层可能再调模型
```

回填代码（真正写历史在这里，不在小函数里）：

```ts
for (const result of toolResults) {
  currentContext.messages.push(result);
  newMessages.push(result);
}
```

单工具流水线（串行/并行共用）：

```
tool_execution_start
  → prepareToolCallArguments（可选）
  → validateToolArguments
  → beforeToolCall（可选钩子）
  → immediate？ → 跳过 execute
  → executePreparedToolCall
  → finalizeExecutedToolCall（afterToolCall）
  → tool_execution_end
  → 做成 toolResult → message_start/end
```

失败原则：工具失败不炸循环；一律变成 toolResult（或 immediate 错误）喂回模型。

### 9. prepareArguments / prepareToolCallArguments（`agent-loop.ts:694-706`，`edit.ts`）
涉及：`packages/agent/src/agent-loop.ts`，`packages/coding-agent/src/core/tools/edit.ts`

**做什么：** 校验**之前**，若该工具挂了可选的 `prepareArguments`，先把参数「整形」成符合 schema 的形状。

**不是** Pi 要求每个工具都实现；coding-agent 内置工具里目前主要是 **edit** 有。  
`agent-loop` 只判断：有就调，没有就原样往下。

```ts
const preparedArguments = tool.prepareArguments(toolCall.arguments);
// 同一引用 → 返回原 toolCall；新对象 → 只换 arguments
```

Java 对照：接口上可选的 `default` 规范化方法；多数实现不 override。

**真实例子（edit）：**  
schema 要 `{ path, edits: [{oldText,newText}] }`；模型常给旧顶层 `{ path, oldText, newText }`。  
`prepareEditArguments` 把顶层折进 `edits`，再交给校验。

**和 validate 分工：** prepare 改形状；validate 查类型/必填并可做 `"10"`→`10` 等强转。

**误区：** 以为 Pi 所有工具参数都必须是 `edits` 那种格式。  
**正确：** Pi 规定的是 `AgentTool` 外壳（name / parameters / execute / 可选 prepareArguments）；每个工具自己的 `parameters` 可以完全不同。

### 10. validateToolArguments（`packages/ai/src/utils/validation.ts:317-353`）
流水线：`argumentsError` 直接抛 → clone → `normalizeOptionalNulls`（可选字段上的假 null 删掉）→ TypeBox `Value.Convert` → 非 TypeBox 时再 `coerceWithJsonSchema` → `Check`，失败拼路径 throw。  
抛错被 `prepareToolCall` 的 catch 收成 immediate 错误结果。

### 11. beforeToolCall 钩子（`prepareToolCall` 728-756；实现挂在 Agent / Session）
**钩子 =** 框架在固定步骤留的插口：你挂上函数，到点框架调你；不挂则跳过。≈ Java Filter / 拦截器。

**before 时机：** 参数已校验通过，**尚未** execute。可返回 `{ block: true, reason }` 拦住。

**调用点（框架）：** `agent-loop.ts` `prepareToolCall` 里 `config.beforeToolCall(...)`。  
**传入：** `agent.ts` 把 `this.beforeToolCall` 塞进 loop config。  
**业务实现（coding-agent）：** `agent-session.ts` `_installAgentToolHooks` 赋值为 `_beforeToolCall` → 转发给扩展 `tool_call` 事件；没扩展则放行。

**真实场景：** 禁用 bash；按 path/命令做权限；UI 确认框；扩展拦截。

**误区：** 在 agent-loop 里找「拦 bash」的业务代码。  
**正确：** loop 只有插口；具体拦不拦在 Session/扩展/你赋值的函数里。

和 prepare 对比：prepare 挂在**某个工具**上改形状；before 挂在 **Agent 级**管所有工具的放行。

### 12. executePreparedToolCall 与 acceptingUpdates（`agent-loop.ts:821-857`）
**先懂三句：**
1. 工具跑时可边跑边报进度（→ `tool_execution_update`）。
2. `execute` 一结束，最终结果已定，进度通道该关。
3. `acceptingUpdates` = 还接不接新进度；settle 后立刻 `false`，晚到回调直接忽略。

函数步骤：调 `tool.execute` → 收进度入 `updateEvents` → settle → **关开关** → `Promise.all(updateEvents)` → 返回 `{ result, isError, durationMs }`。永不往上抛（catch 成错误结果）。

**为什么先关再 Promise.all：** 避免等的过程中又塞进新进度；并保证旧进度发完再进入 end。  
**真干活不在这里：** 这里只按按钮；`read.execute` / `bash.execute` 在各自工具文件里。

类型约定：`onUpdate` 只在本次 `execute()` 未结束前有效。

### 13. finalize / 出口 / after 真实场景（`859-949`）
**finalizeExecutedToolCall：** 可选 `afterToolCall` 按字段覆盖结果；钩子抛错 → 整份变错误。`durationMs` 不改。

**常做的真实事：**
- coding-agent：压图（`normalizeToolResultImages`）、扩展 `tool_result` 改 content/details  
- 成功后设 `terminate: true`（少打一次自动 follow-up LLM）  
- 脱敏、打审计标  

**出口：** `emitToolExecutionEnd`（停 UI 转圈）→ `createToolResultMessage` + `emitToolResultMessage`（给模型的回信事件）。  
push context 仍在 runLoop。

### 14. parallel 默认行为（`executeToolCallsParallel` 586-660）
**先记住：**
1. **preflight 顺序做**（start + prepare/before）  
2. **execute 并行**（`Promise.all`）  
3. **`tool_execution_end` 按完成快慢**  
4. **`toolResult` 消息按助手原始 call 顺序**统一发  

例子：read 慢、bash 快 → end 可能先 bash 后 read；消息仍先 read 后 bash。  
任一工具 `executionMode === "sequential"` 或 config 为 sequential → 整批串行。

`terminate`：本批**每一个** `result.terminate === true` 才为真。

截断：`failToolCallsFromTruncatedMessage`，`terminate: false`，让模型带错误结果再开一轮。

### 15. runToolCall（`811-818`）——嵌套调用入口
**不是主循环模型调工具的路径。** 主循环直接走 `executeToolCalls*`。

**一句话：** 代码里再调一个工具，并且要走校验 + before/after；结果 return 给调用方，不负责写入聊天记录。

**何时触发：** 只有业务主动调。典型：
- 模型先调 codemode（跑脚本）→ 脚本里再 `tools.read(...)` → `runToolCall`  
- coding-agent：`ctx.executeTool` → NestedToolCallRunner → `runToolCall`

**逻辑：** `prepare → execute → finalize`，与单工具相同；函数本身不 emit、不 push messages。

**和直接 `tool.execute`：** 后者跳过钩子；需要权限一致时用 `runToolCall`。

**场景理解（已确认）：** MCP 挂成百上千 SaaS API 时，可用脚本组合多次调用（像 workflow），中间结果不必每条都进模型上下文，省上下文、少轮次。  
更正表述：不是「把 MCP 又简化一层协议」，而是「模型侧接口变简单（写编排）；内部调用仍走完整流水线」。

例子：`packages/agent/examples/mcp-codemode/tools.ts` 的 `createNestedToolRunner`。
