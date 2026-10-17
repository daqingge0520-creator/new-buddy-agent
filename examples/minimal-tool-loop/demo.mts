import { createModels, fauxProvider, fauxAssistantMessage, fauxText, fauxToolCall, Type } from "@earendil-works/pi-ai";
import { Agent, type AgentTool } from "@earendil-works/pi-agent-core";

// 1) 模型层：无 key 用 faux；有 DEEPSEEK_API_KEY 时换成 deepseekProvider()
const models = createModels();
let model;
if (process.env.DEEPSEEK_API_KEY) {
  const { deepseekProvider } = await import("@earendil-works/pi-ai/providers/deepseek");
  models.setProvider(deepseekProvider());
  model = models.getModel("deepseek", "deepseek-flash")!;
} else {
  const faux = fauxProvider({ tokensPerSecond: 200 });
  models.setProvider(faux.provider);
  model = faux.getModel();
  faux.setResponses([
    fauxAssistantMessage([fauxToolCall("lookup_member", { phone: "13800000000" })], { stopReason: "toolUse" }),
    (ctx) => { // 第二轮：根据回填的 toolResult 生成答案
      const tr = ctx.messages.findLast((m) => m.role === "toolResult")!;
      const t = (tr.content as any[]).map((c) => c.text).join("");
      return fauxAssistantMessage([fauxText(`查到了：${t}。还有什么可以帮您？`)]);
    },
  ]);
}

// 2) 假工具：查会员
const MemberParams = Type.Object({ phone: Type.String() });
const lookupMember: AgentTool<typeof MemberParams> = {
  name: "lookup_member", label: "查会员", description: "按手机号查询门店会员",
  parameters: MemberParams,
  async execute(_id, { phone }) {
    const m = { name: "张三", level: "金卡", balance: 320 };
    return { content: [{ type: "text", text: `${phone} ${m.name} ${m.level} 余额${m.balance}元` }], details: m };
  },
};

// 3) Agent：宿主层钩子插在这里
const agent = new Agent({
  initialState: { systemPrompt: "你是门店智能客服。", model, tools: [lookupMember] },
  streamFn: (m, ctx, opts) => models.streamSimple(m, ctx, opts),
  beforeToolCall: async ({ toolCall }) => { console.log(`\n[鉴权] ${toolCall.name} ok`); return undefined; },
});
agent.subscribe((e) => {
  if (e.type === "message_update" && e.assistantMessageEvent.type === "text_delta") process.stdout.write(e.assistantMessageEvent.delta);
  if (e.type === "tool_execution_end") console.log(`[工具完成] ${e.toolName} isError=${e.isError}`);
  if (e.type === "agent_end") console.log(`\n[agent_end] 新消息 ${e.messages.length} 条`);
});
await agent.prompt("帮我查一下 13800000000 这个会员");
const last = agent.state.messages.at(-1) as any;
console.log("stopReason:", last.stopReason, "usage:", JSON.stringify(last.usage));
console.log("roles:", agent.state.messages.map((m: any) => m.role).join(","));
console.log("可序列化:", JSON.stringify(agent.state.messages).length, "bytes");
