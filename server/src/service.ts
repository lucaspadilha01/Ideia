import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { PROFILES, profileRank, type Config, type Profile } from "./config.js";
import { FsGuard, GuardError } from "./fsguard.js";
import { ClaudeRunner, Run } from "./runner.js";
import { SessionStore, type Session } from "./sessions.js";

export class ServiceError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

/** Núcleo compartilhado pela API REST/SSE e pela camada MCP. */
export class Service {
  readonly sessions: SessionStore;
  readonly guard: FsGuard;
  private runner: ClaudeRunner;
  private runs = new Map<string, Run>();
  private waiting: Array<() => void> = [];
  private active = 0;
  private auditFile: string;

  constructor(readonly cfg: Config, runner?: ClaudeRunner) {
    this.sessions = new SessionStore(cfg.dataDir);
    this.guard = new FsGuard(cfg.maxFileBytes);
    this.runner = runner ?? new ClaudeRunner(cfg);
    mkdirSync(cfg.dataDir, { recursive: true, mode: 0o700 });
    this.auditFile = path.join(cfg.dataDir, "audit.jsonl");
  }

  audit(entry: Record<string, unknown>): void {
    try {
      appendFileSync(this.auditFile, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n", { mode: 0o600 });
    } catch {
      /* auditoria nunca derruba o serviço */
    }
  }

  projects() {
    return this.cfg.projects.map((p) => ({ name: p.name }));
  }

  private projectPath(name: string): string {
    const p = this.cfg.projects.find((x) => x.name === name);
    if (!p) throw new ServiceError("projeto desconhecido", 404);
    return p.path;
  }

  private effectiveProfile(requested?: Profile): Profile {
    const want = requested ?? this.cfg.defaultProfile;
    if (!PROFILES.includes(want)) throw new ServiceError("perfil inválido");
    if (profileRank(want) > profileRank(this.cfg.maxProfile)) {
      throw new ServiceError(`perfil '${want}' acima do permitido ('${this.cfg.maxProfile}')`, 403);
    }
    return want;
  }

  /** Inicia um run; cria sessão nova se `sessionId` não for dado. */
  startRun(o: { prompt: string; project?: string; sessionId?: string; profile?: Profile }): { run: Run; session: Session } {
    if (!o.prompt?.trim()) throw new ServiceError("prompt vazio");
    if (o.prompt.length > 20_000) throw new ServiceError("prompt grande demais");
    let session: Session;
    if (o.sessionId) {
      const s = this.sessions.get(o.sessionId);
      if (!s) throw new ServiceError("sessão desconhecida", 404);
      session = s;
      if (o.profile) this.effectiveProfile(o.profile);
    } else {
      if (!o.project) throw new ServiceError("project obrigatório");
      this.projectPath(o.project);
      session = this.sessions.create(o.project, this.effectiveProfile(o.profile), o.prompt);
    }
    const cwd = this.projectPath(session.project);
    const profile = this.effectiveProfile(o.profile ?? session.profile);
    const run = new Run(session.id, session.project, profile);
    this.runs.set(run.id, run);
    this.audit({ event: "run", runId: run.id, session: session.id, project: session.project, profile, promptChars: o.prompt.length });
    const resume = session.started;
    void this.acquire().then(async () => {
      try {
        if (run.status === "cancelled") return;
        this.sessions.touch(session.id);
        await this.runner.execute(run, { cwd, prompt: o.prompt, resume, profile });
      } finally {
        this.release();
      }
    });
    return { run, session };
  }

  private acquire(): Promise<void> {
    if (this.active < this.cfg.maxConcurrentRuns) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise((res) => this.waiting.push(() => { this.active++; res(); }));
  }
  private release(): void {
    this.active--;
    this.waiting.shift()?.();
  }

  getRun(id: string): Run {
    const r = this.runs.get(id);
    if (!r) throw new ServiceError("run desconhecido", 404);
    return r;
  }

  cancel(id: string): void {
    const r = this.getRun(id);
    if (r.finished) return;
    this.audit({ event: "cancel", runId: id });
    if (r.status === "queued") {
      r.status = "cancelled";
      r.push({ type: "end", status: "cancelled" });
      r.emit("end");
    } else r.emit("cancel");
  }

  waitFor(run: Run): Promise<Run> {
    return run.finished ? Promise.resolve(run) : new Promise((res) => run.once("end", () => res(run)));
  }

  async listFiles(project: string, rel = ".") {
    return this.guarded(() => this.guard.list(this.projectPath(project), rel));
  }
  async readFile(project: string, rel: string) {
    this.audit({ event: "read_file", project, path: rel });
    return this.guarded(() => this.guard.read(this.projectPath(project), rel));
  }
  private async guarded<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof GuardError) throw new ServiceError(e.message, 403);
      throw e;
    }
  }
}
