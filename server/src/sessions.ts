import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Profile } from "./config.js";

export interface Session {
  id: string; // também é o session-id do Claude Code
  project: string;
  profile: Profile;
  title: string;
  createdAt: string;
  updatedAt: string;
  started: boolean; // já houve ao menos um run (usar --resume)
}

export class SessionStore {
  private sessions = new Map<string, Session>();
  private file: string;
  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    this.file = path.join(dataDir, "sessions.json");
    if (existsSync(this.file)) {
      for (const s of JSON.parse(readFileSync(this.file, "utf8")) as Session[]) this.sessions.set(s.id, s);
    }
  }
  private save(): void {
    writeFileSync(this.file, JSON.stringify([...this.sessions.values()], null, 2), { mode: 0o600 });
  }
  create(project: string, profile: Profile, title: string): Session {
    const now = new Date().toISOString();
    const s: Session = { id: randomUUID(), project, profile, title: title.slice(0, 80), createdAt: now, updatedAt: now, started: false };
    this.sessions.set(s.id, s);
    this.save();
    return s;
  }
  get(id: string): Session | undefined {
    return this.sessions.get(id);
  }
  touch(id: string): void {
    const s = this.sessions.get(id);
    if (!s) return;
    s.started = true;
    s.updatedAt = new Date().toISOString();
    this.save();
  }
  list(): Session[] {
    return [...this.sessions.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
}
