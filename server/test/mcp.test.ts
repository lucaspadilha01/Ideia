import { mkdtempSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createApp } from "../src/api.js";
import { generateToken } from "../src/auth.js";
import { parseConfig } from "../src/config.js";
import { Service } from "../src/service.js";

const fake = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "fake-claude.mjs");
const { token, sha256 } = generateToken();
const proj = mkdtempSync(path.join(tmpdir(), "proj-"));
writeFileSync(path.join(proj, "hello.txt"), "conteúdo");
let server: ReturnType<typeof createApp>;
let url: URL;

beforeAll(async () => {
  const cfg = parseConfig({ tokenSha256: sha256, projects: [{ name: "p", path: proj }], claudeBin: process.execPath, claudeBinArgs: [fake], dataDir: mkdtempSync(path.join(tmpdir(), "data-")) });
  server = createApp(new Service(cfg), "/nonexistent");
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  url = new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`);
});
afterAll(() => { server.close(); });

async function connect(tok: string) {
  const client = new Client({ name: "t", version: "1" });
  await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers: { authorization: `Bearer ${tok}` } } }));
  return client;
}

it("MCP: lista tools e executa run_prompt/read_file", async () => {
  const c = await connect(token);
  const names = (await c.listTools()).tools.map((t) => t.name);
  expect(names).toEqual(expect.arrayContaining(["run_prompt", "read_file", "list_files", "list_sessions", "cancel_run", "list_projects"]));
  const r: any = await c.callTool({ name: "run_prompt", arguments: { prompt: "oi", project: "p" } });
  expect(JSON.parse(r.content[0].text).result).toContain("eco: oi");
  const f: any = await c.callTool({ name: "read_file", arguments: { project: "p", path: "hello.txt" } });
  expect(f.content[0].text).toBe("conteúdo");
  const bad: any = await c.callTool({ name: "read_file", arguments: { project: "p", path: "../x" } });
  expect(bad.isError).toBe(true);
  await c.close();
});

it("MCP: sem token é recusado", async () => {
  await expect(connect("errado")).rejects.toThrow();
});
