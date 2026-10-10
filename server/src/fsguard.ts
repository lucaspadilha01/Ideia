import { promises as fs } from "node:fs";
import path from "node:path";

export class GuardError extends Error {}

const DENY_NAMES = [/^\.env(\..*)?$/i, /^id_(rsa|ed25519|ecdsa|dsa)(\.pub)?$/, /\.(pem|key|p12|pfx)$/i, /^\.npmrc$/, /^\.netrc$/, /^credentials(\.json)?$/i];
const DENY_SEGMENTS = [".git", ".ssh", ".aws", ".gnupg"];

export interface Entry { name: string; type: "file" | "dir"; size?: number }

export class FsGuard {
  constructor(private maxFileBytes: number) {}

  /** Resolve `rel` dentro de `root`, seguindo symlinks, e garante que continua dentro. */
  async resolve(root: string, rel: string): Promise<string> {
    if (rel.includes("\0")) throw new GuardError("caminho inválido");
    const realRoot = await fs.realpath(root);
    const target = path.resolve(realRoot, rel.replace(/^[/\\]+/, ""));
    let real: string;
    try {
      real = await fs.realpath(target);
    } catch {
      throw new GuardError("não encontrado");
    }
    if (real !== realRoot && !real.startsWith(realRoot + path.sep)) throw new GuardError("fora do projeto");
    this.assertNotSensitive(path.relative(realRoot, real));
    return real;
  }

  private assertNotSensitive(rel: string): void {
    const parts = rel.split(path.sep).filter(Boolean);
    if (parts.some((p) => DENY_SEGMENTS.includes(p))) throw new GuardError("caminho bloqueado");
    const base = parts[parts.length - 1];
    if (base && DENY_NAMES.some((re) => re.test(base))) throw new GuardError("arquivo sensível bloqueado");
  }

  async list(root: string, rel = "."): Promise<Entry[]> {
    const dir = await this.resolve(root, rel);
    const out: Entry[] = [];
    for (const d of await fs.readdir(dir, { withFileTypes: true })) {
      if (DENY_SEGMENTS.includes(d.name) || d.name === "node_modules" || DENY_NAMES.some((re) => re.test(d.name))) continue;
      if (d.isDirectory()) out.push({ name: d.name, type: "dir" });
      else if (d.isFile()) out.push({ name: d.name, type: "file", size: (await fs.stat(path.join(dir, d.name))).size });
    }
    return out.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1));
  }

  async read(root: string, rel: string): Promise<string> {
    const file = await this.resolve(root, rel);
    const st = await fs.stat(file);
    if (!st.isFile()) throw new GuardError("não é arquivo");
    if (st.size > this.maxFileBytes) throw new GuardError(`arquivo maior que ${this.maxFileBytes} bytes`);
    const buf = await fs.readFile(file);
    if (buf.includes(0)) throw new GuardError("arquivo binário");
    return buf.toString("utf8");
  }
}
