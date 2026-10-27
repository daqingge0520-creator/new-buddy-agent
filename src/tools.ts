import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import { findFaq, findMember } from "./fixtures.js";

const MemberParams = Type.Object({
  phone: Type.String({ minLength: 1, maxLength: 32 }),
});

const FaqParams = Type.Object({
  query: Type.String({ minLength: 1, maxLength: 200 }),
});

export const lookupMemberTool: AgentTool<typeof MemberParams> = {
  name: "lookup_member",
  label: "查会员",
  description: "按手机号查询门店会员的等级、余额和积分。",
  parameters: MemberParams,
  replay: "safe",
  async execute(_toolCallId, { phone }) {
    const found = findMember(phone);
    return {
      content: [{ type: "text", text: found.text }],
      details: found.member ?? { found: false, phone },
    };
  },
};

export const searchFaqTool: AgentTool<typeof FaqParams> = {
  name: "search_faq",
  label: "查常见问题",
  description: "查询门店常见问题，例如营业时间、积分和退换货。",
  parameters: FaqParams,
  replay: "safe",
  async execute(_toolCallId, { query }) {
    const found = findFaq(query);
    return {
      content: [{ type: "text", text: found.text }],
      details: { hits: found.hits.map((item) => item.id) },
    };
  },
};

export const storeTools = [lookupMemberTool, searchFaqTool];

export const STORE_TOOL_NAMES = storeTools.map((tool) => tool.name);
