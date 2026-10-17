# Pi 源码学习笔记

## 2026-10-17
- `packages/agent/src/agent-loop.ts:102-126`：这里是 Agent 主循环的入口，读代码要从入口顺着流程往下看，不要从中间某个函数切进去。
- `packages/agent/src/agent-loop.ts:323-365`：工具（B）是 Agent 注册时挂上的；经过模型调用后，后续多轮里可能需要新增或删减部分工具。第一轮不一定走到这里，多轮之后才会出现。
- 疑问：A（每轮实际要用的那组工具）具体是怎么算出来的，是否和系统提示词或 Skill 有关？
- 疑问：`packages/agent/src/agent.ts:507-508` 里的 `event` 是谁调用时传进来的？