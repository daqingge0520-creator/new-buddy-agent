/** In-memory store data. Not a tenant database and not real customer records. */

export interface MemberRecord {
  phone: string;
  name: string;
  level: string;
  balance: number;
  points: number;
}

export const MEMBERS: readonly MemberRecord[] = [
  { phone: "13800000000", name: "张三", level: "金卡", balance: 320, points: 1280 },
  { phone: "13900000000", name: "李四", level: "银卡", balance: 50, points: 240 },
];

export interface FaqRecord {
  id: string;
  keywords: readonly string[];
  question: string;
  answer: string;
}

export const FAQS: readonly FaqRecord[] = [
  {
    id: "hours",
    keywords: ["营业", "时间", "开门", "几点"],
    question: "营业时间",
    answer: "每天 10:00–22:00，法定节假日以门店当日通知为准。",
  },
  {
    id: "points",
    keywords: ["积分", "抵扣", "兑换"],
    question: "积分怎么用",
    answer: "100 积分可抵 1 元，在收银台结账时使用。",
  },
  {
    id: "refund",
    keywords: ["退", "换货", "退款"],
    question: "退换货",
    answer: "未使用商品 7 天内凭小票退换。定制类商品不支持无理由退换。",
  },
];

export function findMember(phone: string): { text: string; member?: MemberRecord } {
  const member = MEMBERS.find((item) => item.phone === phone);
  if (!member) return { text: `未找到手机号 ${phone} 的会员。` };
  return {
    member,
    text: `${member.phone} ${member.name} ${member.level} 余额${member.balance}元 积分${member.points}`,
  };
}

export function findFaq(query: string): { text: string; hits: FaqRecord[] } {
  const normalized = query.toLowerCase();
  const hits = FAQS.map((item) => ({
    item,
    score: item.keywords.filter((word) => normalized.includes(word.toLowerCase())).length,
  }))
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((hit) => hit.item);
  if (hits.length === 0) return { text: "知识库里没有匹配的常见问题。", hits: [] };
  const top = hits.slice(0, 2);
  return {
    hits: top,
    text: top.map((item) => `${item.question}：${item.answer}`).join("\n"),
  };
}
