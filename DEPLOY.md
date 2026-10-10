# Deployment

## 1. Instalar e configurar (no computador com Claude Code, já logado via `claude`)
```bash
cd server && npm ci && npm run build
npm run gen-token         # guarde o token; cole o hash em config.json
cp config.example.json config.json && chmod 600 config.json
```
Defina `projects` (caminhos absolutos) e, ao usar Tailscale, `allowedHosts: ["meu-mac.tailnet-xyz.ts.net"]`.

## 2. Acesso do iPhone (recomendado: Tailscale)
1. Instale Tailscale no computador e no iPhone (mesma tailnet).
2. `tailscale serve --bg --https=443 http://127.0.0.1:8787` → URL `https://<maquina>.<tailnet>.ts.net` com TLS válido, visível só na sua tailnet.
3. No Safari do iPhone abra a URL, cole o token, e use *Compartilhar → Adicionar à Tela de Início*.

Alternativa: Cloudflare Tunnel + Cloudflare Access (adiciona SSO na frente). **Não** use `tailscale funnel`/portas abertas sem uma camada extra de autenticação.

## 3. Manter rodando
- macOS (launchd) / Linux (systemd): rode `node dist/src/index.js` com `CLAUDE_REMOTE_CONFIG=/caminho/config.json`, `WorkingDirectory=server`, usuário comum (nunca root).
- Exemplo systemd: `ExecStart=/usr/bin/node dist/src/index.js`, `Restart=on-failure`, `NoNewPrivileges=true`.

## 4. Operação
- Rotacionar token: `npm run gen-token`, atualizar `tokenSha256`, reiniciar, colar o novo token no iPhone.
- Auditoria: `data/audit.jsonl`. Revisar `auth_fail`.
- Escalar: o estado fica em `data/`; para múltiplos usuários/máquinas, troque `SessionStore` por banco e coloque um token por usuário (v2).

## 5. Checklist de verificação
`npm test` · `curl` sem token → 401 · `read_file ../../etc/passwd` → 403 · `tailscale serve status` · celular fora do Wi‑Fi de casa consegue abrir a URL.
