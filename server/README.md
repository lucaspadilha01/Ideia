# Claude Remote — controle o Claude Code do iPhone

Servidor Node/TypeScript que roda no seu computador, executa o `claude` CLI e o expõe por **MCP** (`/mcp`) e por uma **API REST + SSE** usada pela PWA em `../client`.

## Como o MCP funciona aqui (para iniciantes)
MCP (Model Context Protocol) é um protocolo JSON-RPC em que um **servidor** publica *tools* (funções que o cliente pode chamar) e *resources* (dados legíveis); um **cliente** (app, IDE, outro agente) descobre e chama essas tools. Aqui o servidor publica:

| Tool | O que faz |
|---|---|
| `run_prompt` | Envia prompt ao Claude Code e devolve a resposta final (+ `session_id`). Com `session_id` continua a conversa (`--resume`). |
| `cancel_run` | Cancela um run. |
| `list_sessions` / `list_projects` | Sessões e projetos permitidos. |
| `list_files` / `read_file` | Estrutura e conteúdo (com jail e bloqueio de segredos). |

Transporte: *Streamable HTTP* em `POST /mcp` (stateless), sempre com `Authorization: Bearer <token>`.
A PWA usa a API REST/SSE (`/api/*`) porque precisa de saída token-a-token; ambas usam o mesmo núcleo (`src/service.ts`).

## Estrutura
`config` (validação zod) · `auth` (token SHA-256, tempo constante, bloqueio por IP) · `fsguard` (realpath + denylist) · `runner` (spawn `claude -p --output-format stream-json`) · `sessions` · `service` (núcleo + auditoria) · `api` (HTTP/SSE) · `mcp` (tools).

## Rodando
```bash
cd server && npm install
npm run gen-token            # imprime token (iPhone) e tokenSha256 (config)
cp config.example.json config.json   # edite tokenSha256 e projects
npm run dev                  # http://127.0.0.1:8787
npm test
```
Teste rápido: `curl -H "Authorization: Bearer $TOKEN" localhost:8787/api/projects`.
Inspecione o MCP com `npx @modelcontextprotocol/inspector` (URL `http://127.0.0.1:8787/mcp`, header Authorization).

## Segurança (resumo / threat model)
- Escuta só em `127.0.0.1`; acesso remoto via túnel com TLS (ver `../DEPLOY.md`). Config só guarda o **hash** do token.
- Perfis por run, limitados por `maxProfile`: `readonly` (Read/Glob/Grep), `edit` (+Edit/Write, sem Bash), `full` (+Bash). Nunca usa `bypassPermissions`. Padrão `edit` como teto; habilite `full` conscientemente — equivale a shell no seu computador.
- Prompt vai por stdin, `spawn` sem shell (sem injeção de comando). Projetos só da allowlist; `read_file`/`list_files` bloqueiam `..`, symlinks para fora, `.env`, chaves, `.git`.
- Anti-brute-force (429), checagem de Host/Origin, limite de corpo (64 KB), timeout e cancelamento de runs, auditoria em `data/audit.jsonl` (sem conteúdo dos prompts).
- Limitações v1: um único token/usuário; sem TOTP; sem aprovação interativa de ações (v2: canal de aprovação). O token fica no `localStorage` do navegador do iPhone — use um dispositivo com senha e rotacione o token se perder o aparelho.
