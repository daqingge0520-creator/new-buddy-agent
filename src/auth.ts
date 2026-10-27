import { timingSafeEqual } from "node:crypto";
import { STORE_TOOL_NAMES } from "./tools.js";

/** Caller allowed to invoke a fixed tool set. The host passes this into beforeToolCall. */
export interface ToolGrant {
  subject: string;
  allowedTools: ReadonlySet<string>;
}

export interface ToolDecision {
  allowed: boolean;
  reason?: string;
}

/** Local bearer used when BUDDY_API_TOKEN is unset. Not a production credential. */
export const DEFAULT_API_TOKEN = "demo";

export function expectedApiToken(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.BUDDY_API_TOKEN?.trim();
  return configured ? configured : DEFAULT_API_TOKEN;
}

export function tokenMatches(presented: string, expected: string): boolean {
  const left = Buffer.from(presented);
  const right = Buffer.from(expected);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function bearerToken(authorization: string | undefined): string | undefined {
  if (!authorization) return undefined;
  const match = /^Bearer\s+(\S+)$/i.exec(authorization.trim());
  return match?.[1];
}

/** Grant for an HTTP caller that already passed the bearer check. */
export function grantForCaller(subject = "local"): ToolGrant {
  return { subject, allowedTools: new Set(STORE_TOOL_NAMES) };
}

/**
 * Host check that runs after schema validation and before tool execution.
 * Returning allowed:false becomes beforeToolCall `{ block: true }`.
 */
export function decideToolCall(grant: ToolGrant | undefined, toolName: string): ToolDecision {
  if (!grant) return { allowed: false, reason: "缺少工具授权" };
  if (!grant.allowedTools.has(toolName)) return { allowed: false, reason: `当前身份不能调用 ${toolName}` };
  return { allowed: true };
}
