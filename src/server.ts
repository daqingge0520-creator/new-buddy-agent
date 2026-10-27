import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { bearerToken, expectedApiToken, grantForCaller, tokenMatches } from "./auth.js";
import { createTurnRuntime, selectModelMode, type ModelMode } from "./model.js";
import { startTurn } from "./run-turn.js";
import { formatSse } from "./sse.js";

export interface AppOptions {
  port?: number;
  host?: string;
  /** Overrides BUDDY_API_TOKEN / the local demo token. */
  token?: string;
  /** Overrides key-based model selection. The offline demo pins faux. */
  mode?: ModelMode;
  env?: NodeJS.ProcessEnv;
}

export interface RunningApp {
  baseUrl: string;
  mode: ModelMode;
  close: () => Promise<void>;
}

export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

export async function startApp(options: AppOptions = {}): Promise<RunningApp> {
  const env = options.env ?? process.env;
  const mode = options.mode ?? selectModelMode(env);
  const token = options.token ?? expectedApiToken(env);
  if (mode === "deepseek") {
    createTurnRuntime({ mode, userText: "", env });
  }
  const host = options.host ?? env.HOST ?? "127.0.0.1";
  const port = options.port ?? Number(env.PORT ?? 8787);
  if (!Number.isInteger(port) || port < 0) throw new Error(`Invalid PORT: ${String(env.PORT ?? options.port)}`);

  const server = createServer((req, res) => {
    void handleRequest(req, res, { mode, token, env }).catch((error: unknown) => {
      if (res.headersSent) {
        if (!res.writableEnded && !res.destroyed) res.end();
        return;
      }
      const statusCode = error instanceof HttpError ? error.statusCode : 500;
      const message = statusCode === 500 ? "internal error" : error instanceof Error ? error.message : "error";
      sendJson(res, statusCode, { error: message });
    });
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once("error", onError);
    server.listen(port, host, () => {
      server.off("error", onError);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected a TCP listen address");
  const advertisedHost = host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
  return {
    mode,
    baseUrl: `http://${advertisedHost}:${address.port}`,
    close: () => closeServer(server),
  };
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: { mode: ModelMode; token: string; env: NodeJS.ProcessEnv },
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (req.method === "GET" && url.pathname === "/health") {
    sendJson(res, 200, { ok: true, mode: ctx.mode });
    return;
  }
  if (req.method === "POST" && url.pathname === "/v1/chat") {
    await handleChat(req, res, ctx);
    return;
  }
  sendJson(res, 404, { error: "not_found" });
}

async function handleChat(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: { mode: ModelMode; token: string; env: NodeJS.ProcessEnv },
): Promise<void> {
  const presented = bearerToken(headerString(req.headers.authorization));
  if (!presented || !tokenMatches(presented, ctx.token)) {
    sendJson(res, 401, { error: "unauthorized" });
    return;
  }

  const raw = await readBody(req);
  let parsed: unknown;
  try {
    parsed = raw.trim() ? (JSON.parse(raw) as unknown) : {};
  } catch {
    throw new HttpError(400, "invalid json");
  }
  const content = readContent(parsed);
  if (!content) throw new HttpError(400, "content is required");

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  let finished = false;
  const turn = startTurn({
    content,
    grant: grantForCaller(),
    mode: ctx.mode,
    env: ctx.env,
    emit: (event, data) => writeSse(res, event, data),
  });
  req.on("close", () => {
    if (!finished) turn.abort();
  });
  try {
    await turn.done;
  } catch (error) {
    writeSse(res, "error", { message: error instanceof Error ? error.message : String(error) });
  } finally {
    finished = true;
    if (!res.writableEnded && !res.destroyed) res.end();
  }
}

function readContent(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const content = (body as { content?: unknown }).content;
  if (typeof content !== "string") return undefined;
  const trimmed = content.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > 4000) throw new HttpError(400, "content is too long");
  return trimmed;
}

function headerString(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function writeSse(res: ServerResponse, event: string, data: unknown): void {
  if (res.writableEnded || res.destroyed) return;
  res.write(formatSse(event, data));
}

function sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function readBody(req: IncomingMessage, limit = 32_768): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        fail(new HttpError(413, "body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", (error) => fail(error));
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
