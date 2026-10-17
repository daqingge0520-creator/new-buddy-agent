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

### 下一步
- 看 `runLoop` 里第一次是怎么调到模型的：流式拿助手回复 → 执行工具 → 进入下一轮。
