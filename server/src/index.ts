import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateToken } from "./auth.js";
import { createApp } from "./api.js";
import { loadConfig } from "./config.js";
import { Service } from "./service.js";

if (process.argv.includes("--gen-token")) {
  const { token, sha256 } = generateToken();
  console.log(`Token (guarde no iPhone, NÃO commite): ${token}\ntokenSha256 (cole em config.json): ${sha256}`);
  process.exit(0);
}

const cfg = loadConfig();
const here = path.dirname(fileURLToPath(import.meta.url));
// src/ (tsx) e dist/src/ (build) ficam em profundidades diferentes
const clientDir = [path.resolve(here, "../../client"), path.resolve(here, "../../../client")].find((d) => existsSync(d)) ?? path.resolve(here, "../../client");
const server = createApp(new Service(cfg), clientDir);
server.listen(cfg.port, cfg.host, () => console.log(`claude-remote em http://${cfg.host}:${cfg.port} (MCP em /mcp)`));
if (!["127.0.0.1", "::1", "localhost"].includes(cfg.host)) console.warn("AVISO: servidor não está preso a localhost; use túnel/TLS.");
