import { mkdtempSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/api.js";
import { generateToken } from "../src/auth.js";
import { parseConfig } from "../src/config.js";
import { Service } from "../src/service.js";

const fake = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "fake-claude.mjs");
const { token, sha256 } = generateToken();
const proj = mkdtempSync(path.join(tmpdir(), "proj-"));
writeFileSync(path.join(proj, "hello.txt"), "conteúdo");
let base = "";
let server: ReturnType<typeof createApp>;
const auth = { authorization: `Bearer ${token}`, "content-type": "application/json" };

beforeAll(async () => {
  const cfg = parseConfig({
    tokenSha256: sha256, port: 0, maxProfile: "edit", projects: [{ name: "p", path: proj }],
    claudeBin: process.execPath, claudeBinArgs: [fake], dataDir: mkdtempSync(path.join(tmpdir(), "data-")), runTimeoutMs: 30000,
    rateLimit: { maxFailures: 3, windowMs: 60000 },
  });
  server = createApp(new Service(cfg), "/nonexistent");
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => { server.close(); });

describe("API", () => {
  it("rejeita sem token", async () => expect((await fetch(`${base}/api/projects`)).status).toBe(401));
  it("healthz é público", async () => expect((await fetch(`${base}/healthz`)).status).toBe(200));
  it("rejeita perfil acima do teto", async () => {
    const r = await fetch(`${base}/api/runs`, { method: "POST", headers: auth, body: JSON.stringify({ prompt: "x", project: "p", profile: "full" }) });
    expect(r.status).toBe(403);
  });
  it("bloqueia path traversal", async () => {
    const r = await fetch(`${base}/api/file?project=p&path=../../etc/passwd`, { headers: auth });
    expect(r.status).toBe(403);
  });
  it("lê arquivo e lista", async () => {
    expect((await (await fetch(`${base}/api/file?project=p&path=hello.txt`, { headers: auth })).json()).content).toBe("conteúdo");
  });
  it("run com stream SSE, depois resume na mesma sessão", async () => {
    const r = await fetch(`${base}/api/runs`, { method: "POST", headers: auth, body: JSON.stringify({ prompt: "ping", project: "p" }) });
    const { runId, sessionId } = await r.json();
    const s = await fetch(`${base}/api/runs/${runId}/stream`, { headers: auth });
    const body = await s.text();
    expect(body).toContain('"text":"olá "');
    expect(body).toContain("eco: ping");
    expect(body).toContain("--session-id " + sessionId);
    expect(body).toContain('"status":"done"');
    const r2 = await fetch(`${base}/api/runs`, { method: "POST", headers: auth, body: JSON.stringify({ prompt: "de novo", sessionId }) });
    const { runId: id2 } = await r2.json();
    const body2 = await (await fetch(`${base}/api/runs/${id2}/stream`, { headers: auth })).text();
    expect(body2).toContain("--resume " + sessionId);
  });
  it("cancela run em andamento", async () => {
    const { runId } = await (await fetch(`${base}/api/runs`, { method: "POST", headers: auth, body: JSON.stringify({ prompt: "SLEEP", project: "p" }) })).json();
    await new Promise((r) => setTimeout(r, 300));
    await fetch(`${base}/api/runs/${runId}/cancel`, { method: "POST", headers: auth });
    const body = await (await fetch(`${base}/api/runs/${runId}/stream`, { headers: auth })).text();
    expect(body).toContain('"status":"cancelled"');
  });
  it("bloqueia IP após falhas repetidas", async () => {
    for (let i = 0; i < 3; i++) await fetch(`${base}/api/projects`, { headers: { authorization: "Bearer errado" } });
    expect((await fetch(`${base}/api/projects`, { headers: auth })).status).toBe(429);
  });
});
