import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { dirname } from "node:path";
import type { AgentMessage } from "@earendil-works/pi-agent-core";

/** Minimal session transcript. Writes finish before the caller ACKs. */
export class SessionStore {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS messages (
        session_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        role TEXT NOT NULL,
        payload TEXT NOT NULL,
        PRIMARY KEY (session_id, seq)
      );
    `);
  }

  createSession(): string {
    const id = randomUUID();
    this.db.prepare("INSERT INTO sessions (id, created_at) VALUES (?, ?)").run(id, Date.now());
    return id;
  }

  hasSession(id: string): boolean {
    return this.db.prepare("SELECT 1 FROM sessions WHERE id = ?").get(id) !== undefined;
  }

  loadMessages(sessionId: string): AgentMessage[] {
    const rows = this.db
      .prepare("SELECT payload FROM messages WHERE session_id = ? ORDER BY seq")
      .all(sessionId) as { payload: string }[];
    return rows.map((row) => JSON.parse(row.payload) as AgentMessage);
  }

  appendMessage(sessionId: string, message: AgentMessage): number {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const row = this.db
        .prepare("SELECT COALESCE(MAX(seq), 0) AS seq FROM messages WHERE session_id = ?")
        .get(sessionId) as { seq: number };
      const seq = row.seq + 1;
      this.db
        .prepare("INSERT INTO messages (session_id, seq, role, payload) VALUES (?, ?, ?, ?)")
        .run(sessionId, seq, message.role, JSON.stringify(message));
      this.db.exec("COMMIT");
      return seq;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  close(): void {
    this.db.close();
  }
}
