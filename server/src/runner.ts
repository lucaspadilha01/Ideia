import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { PROFILE_FLAGS, type Config, type Profile } from "./config.js";

export type RunEvent =
  | { type: "text"; text: string }
  | { type: "tool"; name: string; input: string }
  | { type: "result"; text: string; isError: boolean; costUsd?: number }
  | { type: "error"; message: string }
  | { type: "end"; status: RunStatus };

export type RunStatus = "queued" | "running" | "done" | "error" | "cancelled" | "timeout";

/** Converte uma linha do `--output-format stream-json` do Claude Code em eventos neutros. */
export function parseStreamLine(line: string): RunEvent[] {
  let msg: any;
  try {
    msg = JSON.parse(line);
  } catch {
    return [];
  }
  const out: RunEvent[] = [];
  if (msg.type === "stream_event") {
    const d = msg.event?.delta;
    if (msg.event?.type === "content_block_delta" && d?.type === "text_delta" && typeof d.text === "string") {
      out.push({ type: "text", text: d.text });
    }
  } else if (msg.type === "assistant") {
    for (const c of msg.message?.content ?? []) {
      if (c.type === "tool_use") out.push({ type: "tool", name: String(c.name), input: JSON.stringify(c.input ?? {}).slice(0, 500) });
    }
  } else if (msg.type === "result") {
    out.push({ type: "result", text: String(msg.result ?? ""), isError: !!msg.is_error, costUsd: msg.total_cost_usd });
  }
  return out;
}

export class Run extends EventEmitter {
  readonly id = randomUUID();
  status: RunStatus = "queued";
  events: RunEvent[] = [];
  resultText = "";
  child?: ChildProcess;
  startedAt = Date.now();
  constructor(readonly sessionId: string, readonly project: string, readonly profile: Profile) {
    super();
    this.setMaxListeners(50);
  }
  push(e: RunEvent): void {
    this.events.push(e);
    if (e.type === "result") this.resultText = e.text;
    this.emit("event", e);
  }
  get finished(): boolean {
    return !["queued", "running"].includes(this.status);
  }
}

export interface StartOpts {
  cwd: string;
  prompt: string;
  resume: boolean;
  profile: Profile;
}

export class ClaudeRunner {
  constructor(private cfg: Pick<Config, "claudeBin" | "claudeBinArgs" | "runTimeoutMs">) {}

  /** Executa o claude -p. Prompt vai por stdin (nunca como argumento) e spawn não usa shell. */
  execute(run: Run, o: StartOpts): Promise<void> {
    return new Promise((resolve) => {
      const args = [
        ...this.cfg.claudeBinArgs,
        "-p",
        "--output-format", "stream-json",
        "--verbose",
        "--include-partial-messages",
        ...(o.resume ? ["--resume", run.sessionId] : ["--session-id", run.sessionId]),
        ...PROFILE_FLAGS[o.profile],
      ];
      run.status = "running";
      const child = spawn(this.cfg.claudeBin, args, { cwd: o.cwd, stdio: ["pipe", "pipe", "pipe"], shell: false });
      run.child = child;
      let buf = "";
      let stderr = "";
      let finalStatus: RunStatus | undefined;
      const timer = setTimeout(() => {
        finalStatus = "timeout";
        child.kill("SIGTERM");
        setTimeout(() => child.kill("SIGKILL"), 3000).unref();
      }, this.cfg.runTimeoutMs);

      const finish = (status: RunStatus) => {
        clearTimeout(timer);
        run.status = finalStatus ?? status;
        run.push({ type: "end", status: run.status });
        run.emit("end");
        resolve();
      };
      run.once("cancel", () => {
        finalStatus = "cancelled";
        child.kill("SIGTERM");
      });

      child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
        buf += chunk;
        let i: number;
        while ((i = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, i).trim();
          buf = buf.slice(i + 1);
          if (line) parseStreamLine(line).forEach((e) => run.push(e));
        }
      });
      child.stderr.setEncoding("utf8").on("data", (c: string) => (stderr = (stderr + c).slice(-2000)));
      child.on("error", (err) => {
        run.push({ type: "error", message: `falha ao iniciar claude: ${err.message}` });
        finish("error");
      });
      child.on("close", (code) => {
        if (buf.trim()) parseStreamLine(buf.trim()).forEach((e) => run.push(e));
        if (code !== 0 && !finalStatus) run.push({ type: "error", message: stderr.trim() || `claude saiu com código ${code}` });
        finish(code === 0 ? "done" : "error");
      });
      child.stdin.on("error", () => {});
      child.stdin.end(o.prompt);
    });
  }
}
