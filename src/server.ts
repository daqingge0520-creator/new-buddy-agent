import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createTurnRuntime, selectModelMode, type ModelMode } from "./model.js";
import { startTurn } from "./run-turn.js";
import { formatSse } from "./sse.js";
import { SessionStore } from "./store.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AppOptions {
  port?: number;
  host?: string;
  dbPath?: string;
  /** Pins faux or deepseek. Default follows DEEPSEEK_API_KEY. */
  mode?: ModelMode;
  env?: NodeJS.ProcessEnv;
}

export interface RunningApp {
  baseUrl: string;
  mode: ModelMode;
  store: SessionStore;
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
  if (mode === "deepseek") createTurnRuntime({ mode, userText: "", env });
  const host = options.host ?? env.HOST ?? "127.0.0.1";
  const port = options.port ?? Number(env.PORT ?? 8787);
  if (!Number.isInteger(port) || port < 0) throw new Error(`Invalid PORT: ${String(env.PORT ?? options.port)}`);
  const store = new SessionStore(options.dbPath ?? env.BUDDY_DB ?? "data/buddy.sqlite");

  const server = createServer((req, res) => {
    void handleRequest(req, res, { mode, env, store }).catch((error: unknown) => {
      if (res.headersSent) {
        if (!res.writableEnded && !res.destroyed) res.end();
        return;
      }
      const statusCode = error instanceof HttpError ? error.statusCode : 500;
      const message = statusCode === 500 ? "internal error" : error instanceof Error ? error.message : "error";
      sendJson(res, statusCode, { error: message });
    });
  });

  await listen(server, port, host);
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected a TCP listen address");
  const advertisedHost = host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
  return {
    mode,
    store,
    baseUrl: `http://${advertisedHost}:${address.port}`,
    close: async () => {
      await closeServer(server);
      store.close();
    },
  };
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: { mode: ModelMode; env: NodeJS.ProcessEnv; store: SessionStore },
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
  ctx: { mode: ModelMode; env: NodeJS.ProcessEnv; store: SessionStore },
): Promise<void> {
  const body = await readJson(req);
  const content = readContent(body);
  const requested = readSessionId(body);
  if (requested && !ctx.store.hasSession(requested)) throw new HttpError(404, "session not found");
  const sessionId = requested ?? ctx.store.createSession();
  const history = ctx.store.loadMessages(sessionId);

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  writeSse(res, "session", { sessionId });

  let finished = false;
  const turn = startTurn({
    content,
    sessionId,
    history,
    store: ctx.store,
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

function readContent(body: unknown): string {
  if (!body || typeof body !== "object") throw new HttpError(400, "content is required");
  const content = (body as { content?: unknown }).content;
  if (typeof content !== "string" || !content.trim()) throw new HttpError(400, "content is required");
  if (content.trim().length > 4000) throw new HttpError(400, "content is too long");
  return content.trim();
}

function readSessionId(body: unknown): string | undefined {
  if (!body || typeof body !== "object" || !("sessionId" in body)) return undefined;
  const sessionId = (body as { sessionId?: unknown }).sessionId;
  if (sessionId === undefined) return undefined;
  if (typeof sessionId !== "string" || !UUID.test(sessionId)) throw new HttpError(400, "invalid sessionId");
  return sessionId;
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const raw = await readBody(req);
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new HttpError(400, "invalid json");
  }
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

function listen(server: Server, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once("error", onError);
    server.listen(port, host, () => {
      server.off("error", onError);
      resolve();
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
