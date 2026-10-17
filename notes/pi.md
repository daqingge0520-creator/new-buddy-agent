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

### 下一步
- 精读 `streamAssistantResponse`（`agent-loop.ts:381-469`）：partial 消息怎么边流边推进 context、事件怎么发。
- 再读 `executeToolCalls` 及 parallel/sequential 分支。
