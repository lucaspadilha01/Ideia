import { readFileSync, existsSync } from "node:fs";
import { z } from "zod";

export const PROFILES = ["readonly", "edit", "full"] as const;
export type Profile = (typeof PROFILES)[number];

/** Ferramentas do Claude Code liberadas por perfil (aplicado via flags do CLI). */
export const PROFILE_FLAGS: Record<Profile, string[]> = {
  readonly: ["--allowedTools", "Read Glob Grep", "--disallowedTools", "Bash Edit Write NotebookEdit", "--permission-mode", "default"],
  edit: ["--allowedTools", "Read Glob Grep Edit Write", "--disallowedTools", "Bash", "--permission-mode", "acceptEdits"],
  full: ["--allowedTools", "Read Glob Grep Edit Write Bash", "--permission-mode", "default"],
};

const ConfigSchema = z.object({
  host: z.string().default("127.0.0.1"),
  port: z.number().int().default(8787),
  /** SHA-256 (hex) do token bearer. Gere com `npm run gen-token`. */
  tokenSha256: z.string().regex(/^[a-f0-9]{64}$/),
  /** Perfil máximo que este token pode usar. */
  maxProfile: z.enum(PROFILES).default("edit"),
  defaultProfile: z.enum(PROFILES).default("readonly"),
  projects: z.array(z.object({ name: z.string().min(1), path: z.string().min(1) })).min(1),
  /** Se definido, o header Host precisa estar na lista (ex.: meu-mac.tailnet.ts.net). */
  allowedHosts: z.array(z.string()).default([]),
  allowedOrigins: z.array(z.string()).default([]),
  claudeBin: z.string().default("claude"),
  claudeBinArgs: z.array(z.string()).default([]),
  maxConcurrentRuns: z.number().int().min(1).default(2),
  runTimeoutMs: z.number().int().default(15 * 60_000),
  maxFileBytes: z.number().int().default(512 * 1024),
  dataDir: z.string().default("./data"),
  rateLimit: z.object({ maxFailures: z.number().default(5), windowMs: z.number().default(10 * 60_000) }).default({ maxFailures: 5, windowMs: 10 * 60_000 }),
});
export type Config = z.infer<typeof ConfigSchema>;

export function parseConfig(raw: unknown): Config {
  return ConfigSchema.parse(raw);
}

export function loadConfig(path = process.env.CLAUDE_REMOTE_CONFIG ?? "./config.json"): Config {
  if (!existsSync(path)) throw new Error(`Config não encontrada: ${path} (copie config.example.json)`);
  return parseConfig(JSON.parse(readFileSync(path, "utf8")));
}

export function profileRank(p: Profile): number {
  return PROFILES.indexOf(p);
}
