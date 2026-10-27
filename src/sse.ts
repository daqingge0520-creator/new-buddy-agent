export interface SseEvent {
  event: string;
  data: unknown;
}

export function formatSse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function parseSseBlock(block: string): SseEvent | undefined {
  let event = "message";
  const dataLines: string[] = [];
  for (const line of block.split("\n")) {
    if (!line || line.startsWith(":")) continue;
    if (line.startsWith("event:")) event = line.slice("event:".length).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice("data:".length).trim());
  }
  if (dataLines.length === 0) return undefined;
  return { event, data: JSON.parse(dataLines.join("\n")) as unknown };
}

/** Incremental parser for an SSE byte stream. */
export class SseDecoder {
  private buffer = "";

  push(chunk: string): SseEvent[] {
    this.buffer += chunk;
    const events: SseEvent[] = [];
    while (true) {
      const splitAt = this.buffer.indexOf("\n\n");
      if (splitAt < 0) break;
      const raw = this.buffer.slice(0, splitAt);
      this.buffer = this.buffer.slice(splitAt + 2);
      const parsed = parseSseBlock(raw);
      if (parsed) events.push(parsed);
    }
    return events;
  }

  flush(): SseEvent[] {
    const tail = this.buffer.trim();
    this.buffer = "";
    if (!tail) return [];
    const parsed = parseSseBlock(tail);
    return parsed ? [parsed] : [];
  }
}

export async function postChat(options: {
  baseUrl: string;
  token: string;
  content: string;
  onEvent?: (event: SseEvent) => void;
}): Promise<SseEvent[]> {
  const response = await fetch(`${options.baseUrl}/v1/chat`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.token}`,
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify({ content: options.content }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`POST /v1/chat failed: HTTP ${response.status} ${body}`);
  }
  if (!response.body) throw new Error("POST /v1/chat returned an empty body");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const sse = new SseDecoder();
  const events: SseEvent[] = [];
  const emit = (event: SseEvent) => {
    events.push(event);
    options.onEvent?.(event);
  };
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    for (const event of sse.push(decoder.decode(value, { stream: true }))) emit(event);
  }
  for (const event of sse.push(decoder.decode())) emit(event);
  for (const event of sse.flush()) emit(event);
  return events;
}
