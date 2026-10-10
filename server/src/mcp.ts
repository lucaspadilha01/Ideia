import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { PROFILES } from "./config.js";
import { Service, ServiceError } from "./service.js";

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });
const fail = (e: unknown) => {
  const m = e instanceof ServiceError ? e.message : "erro interno";
  return { isError: true, content: [{ type: "text" as const, text: m }] };
};
const wrap = <A>(fn: (a: A) => Promise<ReturnType<typeof text>>) => async (a: A) => {
  try {
    return await fn(a);
  } catch (e) {
    return fail(e);
  }
};

/** Cria um McpServer com as ferramentas expostas (uma instância por requisição HTTP: stateless). */
export function createMcpServer(svc: Service): McpServer {
  const s = new McpServer({ name: "claude-remote", version: "0.1.0" });

  s.registerTool("list_projects", { description: "Lista os projetos permitidos." }, wrap(async () => text(JSON.stringify(svc.projects()))));

  s.registerTool(
    "run_prompt",
    {
      description: "Envia um prompt ao Claude Code e aguarda a resposta final. Sem session_id cria uma sessão nova (project obrigatório).",
      inputSchema: {
        prompt: z.string().max(20000),
        project: z.string().optional(),
        session_id: z.string().uuid().optional(),
        profile: z.enum(PROFILES).optional(),
      },
    },
    wrap(async (a) => {
      const { run, session } = svc.startRun({ prompt: a.prompt, project: a.project, sessionId: a.session_id, profile: a.profile });
      await svc.waitFor(run);
      return text(JSON.stringify({ session_id: session.id, run_id: run.id, status: run.status, result: run.resultText, errors: run.events.filter((e) => e.type === "error") }));
    }),
  );

  s.registerTool("cancel_run", { description: "Cancela um run em andamento.", inputSchema: { run_id: z.string().uuid() } }, wrap(async (a) => {
    svc.cancel(a.run_id);
    return text("ok");
  }));

  s.registerTool("list_sessions", { description: "Lista sessões (mais recentes primeiro)." }, wrap(async () => text(JSON.stringify(svc.sessions.list()))));

  s.registerTool("list_files", { description: "Lista arquivos de um diretório do projeto.", inputSchema: { project: z.string(), path: z.string().default(".") } }, wrap(async (a) =>
    text(JSON.stringify(await svc.listFiles(a.project, a.path)))));

  s.registerTool("read_file", { description: "Lê um arquivo texto do projeto (limite de tamanho; arquivos sensíveis bloqueados).", inputSchema: { project: z.string(), path: z.string() } }, wrap(async (a) =>
    text(await svc.readFile(a.project, a.path))));

  return s;
}
