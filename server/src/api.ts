import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { bearerFrom, clientIp, FailureLimiter, verifyToken } from "./auth.js";
import { createMcpServer } from "./mcp.js";
import type { RunEvent } from "./runner.js";
import { Service, ServiceError } from "./service.js";
import type { Profile } from "./config.js";

const MAX_BODY = 64 * 1024;
const STATIC: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".json": "application/json", ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml" };

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > MAX_BODY) throw new HttpError(413, "corpo grande demais");
    chunks.push(c as Buffer);
  }
  if (!size) return undefined;
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "JSON inválido");
  }
}

export function createApp(svc: Service, clientDir: string): Server {
  const cfg = svc.cfg;
  const limiter = new FailureLimiter(cfg.rateLimit.maxFailures, cfg.rateLimit.windowMs);

  const handler = async (req: IncomingMessage, res: ServerResponse) => {
    res.setHeader("x-content-type-options", "nosniff");
    res.setHeader("cache-control", "no-store");
    res.setHeader("content-security-policy", "default-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'");
    const url = new URL(req.url ?? "/", "http://x");
    const ip = clientIp(req.socket.remoteAddress, req.headers["x-forwarded-for"]);

    // Host/Origin: mitiga DNS rebinding e CSRF de outras páginas.
    const host = (req.headers.host ?? "").toLowerCase();
    if (cfg.allowedHosts.length && !cfg.allowedHosts.map((h) => h.toLowerCase()).includes(host)) throw new HttpError(403, "host não permitido");
    const origin = req.headers.origin;
    if (origin && req.method !== "GET" && req.method !== "HEAD") {
      const ok = cfg.allowedOrigins.includes(origin) || new URL(origin).host.toLowerCase() === host;
      if (!ok) throw new HttpError(403, "origin não permitido");
    }

    if (url.pathname === "/healthz") return json(res, 200, { ok: true });

    if (!url.pathname.startsWith("/api/") && url.pathname !== "/mcp") return serveStatic(url.pathname, clientDir, res);

    // ---- a partir daqui tudo exige token ----
    if (limiter.isBlocked(ip)) throw new HttpError(429, "muitas tentativas; aguarde");
    if (!verifyToken(bearerFrom(req.headers.authorization), cfg.tokenSha256)) {
      limiter.recordFailure(ip);
      svc.audit({ event: "auth_fail", ip, path: url.pathname });
      throw new HttpError(401, "não autorizado");
    }
    limiter.reset(ip);

    if (url.pathname === "/mcp") {
      const body = req.method === "POST" ? await readBody(req) : undefined;
      const server = createMcpServer(svc);
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      res.on("close", () => { void transport.close(); void server.close(); });
      await server.connect(transport);
      return transport.handleRequest(req, res, body);
    }

    const m = (re: RegExp) => re.exec(url.pathname);
    if (req.method === "GET" && url.pathname === "/api/projects") return json(res, 200, svc.projects());
    if (req.method === "GET" && url.pathname === "/api/sessions") return json(res, 200, svc.sessions.list());
    if (req.method === "GET" && url.pathname === "/api/files") {
      return json(res, 200, await svc.listFiles(url.searchParams.get("project") ?? "", url.searchParams.get("path") ?? "."));
    }
    if (req.method === "GET" && url.pathname === "/api/file") {
      const content = await svc.readFile(url.searchParams.get("project") ?? "", url.searchParams.get("path") ?? "");
      return json(res, 200, { content });
    }
    if (req.method === "POST" && url.pathname === "/api/runs") {
      const b = await readBody(req);
      const { run, session } = svc.startRun({ prompt: b?.prompt, project: b?.project, sessionId: b?.sessionId, profile: b?.profile as Profile | undefined });
      return json(res, 202, { runId: run.id, sessionId: session.id });
    }
    let r = m(/^\/api\/runs\/([\w-]+)\/stream$/);
    if (req.method === "GET" && r) return sse(svc, r[1]!, req, res);
    r = m(/^\/api\/runs\/([\w-]+)\/cancel$/);
    if (req.method === "POST" && r) {
      svc.cancel(r[1]!);
      return json(res, 200, { ok: true });
    }
    throw new HttpError(404, "não encontrado");
  };

  return createServer((req, res) => {
    handler(req, res).catch((e) => {
      const status = e instanceof HttpError || e instanceof ServiceError ? e.status : 500;
      if (status === 500) console.error(e);
      if (res.headersSent) return res.end();
      json(res, status, { error: status === 500 ? "erro interno" : (e as Error).message });
    });
  });
}

/** Server-Sent Events; reenvia o histórico do run e depois segue ao vivo. Auth via header (cliente usa fetch). */
function sse(svc: Service, runId: string, req: IncomingMessage, res: ServerResponse): void {
  const run = svc.getRun(runId);
  res.writeHead(200, { "content-type": "text/event-stream", connection: "keep-alive", "x-accel-buffering": "no" });
  const send = (e: RunEvent) => res.write(`data: ${JSON.stringify(e)}\n\n`);
  run.events.forEach(send);
  if (run.finished) return void res.end();
  const onEvent = (e: RunEvent) => {
    send(e);
    if (e.type === "end") res.end();
  };
  run.on("event", onEvent);
  const ping = setInterval(() => res.write(": ping\n\n"), 15_000);
  req.on("close", () => { clearInterval(ping); run.off("event", onEvent); });
}

async function serveStatic(pathname: string, dir: string, res: ServerResponse): Promise<void> {
  const rel = pathname === "/" ? "index.html" : pathname.slice(1);
  const file = path.resolve(dir, rel);
  if (!file.startsWith(path.resolve(dir) + path.sep)) throw new HttpError(404, "não encontrado");
  try {
    const data = await readFile(file);
    res.writeHead(200, { "content-type": STATIC[path.extname(file)] ?? "application/octet-stream" });
    res.end(data);
  } catch {
    throw new HttpError(404, "não encontrado");
  }
}
