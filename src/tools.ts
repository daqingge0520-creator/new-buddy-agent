import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";

const Params = Type.Object({ text: Type.String() });

/** Placeholder so the tool loop runs. Not a store lookup. */
export const scaffoldTool: AgentTool<typeof Params> = {
  name: "scaffold",
  label: "scaffold",
  description: "Placeholder tool. Echoes the text argument.",
  parameters: Params,
  replay: "safe",
  async execute(_toolCallId, { text }) {
    return { content: [{ type: "text", text: `scaffold:${text}` }], details: { text } };
  },
};
