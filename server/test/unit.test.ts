import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { bearerFrom, clientIp, FailureLimiter, generateToken, verifyToken } from "../src/auth.js";
import { PROFILE_FLAGS } from "../src/config.js";
import { FsGuard } from "../src/fsguard.js";
import { parseStreamLine } from "../src/runner.js";

describe("auth", () => {
  it("aceita só o token correto", () => {
    const { token, sha256 } = generateToken();
    expect(verifyToken(token, sha256)).toBe(true);
    expect(verifyToken(token + "x", sha256)).toBe(false);
    expect(verifyToken(undefined, sha256)).toBe(false);
  });
  it("extrai bearer", () => {
    expect(bearerFrom("Bearer abc")).toBe("abc");
    expect(bearerFrom("Basic abc")).toBeUndefined();
  });
  it("bloqueia após N falhas e libera após a janela", () => {
    let t = 0;
    const l = new FailureLimiter(2, 1000, () => t);
    l.recordFailure("ip"); l.recordFailure("ip");
    expect(l.isBlocked("ip")).toBe(true);
    t = 2000;
    expect(l.isBlocked("ip")).toBe(false);
  });
});

describe("fsguard", () => {
  const root = mkdtempSync(path.join(tmpdir(), "proj-"));
  const outside = mkdtempSync(path.join(tmpdir(), "out-"));
  writeFileSync(path.join(root, "a.txt"), "oi");
  writeFileSync(path.join(root, ".env"), "SECRET=1");
  writeFileSync(path.join(outside, "x.txt"), "fora");
  mkdirSync(path.join(root, ".git"));
  symlinkSync(path.join(outside, "x.txt"), path.join(root, "link.txt"));
  const g = new FsGuard(100);

  it("lê arquivo normal", async () => expect(await g.read(root, "a.txt")).toBe("oi"));
  it("bloqueia ../", async () => { await expect(g.read(root, "../" + path.basename(outside) + "/x.txt")).rejects.toThrow(); });
  it("bloqueia symlink para fora", async () => { await expect(g.read(root, "link.txt")).rejects.toThrow(/fora/); });
  it("bloqueia .env e .git", async () => {
    await expect(g.read(root, ".env")).rejects.toThrow(/sens/);
    await expect(g.list(root, ".git")).rejects.toThrow();
  });
  it("lista sem arquivos sensíveis", async () => {
    const names = (await g.list(root)).map((e) => e.name);
    expect(names).toContain("a.txt");
    expect(names).not.toContain(".env");
    expect(names).not.toContain(".git");
  });
});

describe("parseStreamLine", () => {
  it("converte eventos", () => {
    expect(parseStreamLine('{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"a"}}}')).toEqual([{ type: "text", text: "a" }]);
    expect(parseStreamLine('{"type":"result","result":"fim","is_error":false}')[0]).toMatchObject({ type: "result", text: "fim" });
    expect(parseStreamLine("lixo")).toEqual([]);
  });
});

describe("clientIp", () => {
  it("usa X-Forwarded-For só quando a conexão é loopback", () => {
    expect(clientIp("127.0.0.1", "9.9.9.9, 100.64.0.5")).toBe("100.64.0.5");
    expect(clientIp("::ffff:127.0.0.1", undefined)).toBe("::ffff:127.0.0.1");
    expect(clientIp("203.0.113.7", "1.2.3.4")).toBe("203.0.113.7");
  });
});

describe("perfis", () => {
  it("todo perfil nega leitura de segredos", () => {
    for (const flags of Object.values(PROFILE_FLAGS)) {
      const deny = flags[flags.indexOf("--disallowedTools") + 1]!;
      expect(deny).toContain("Read(**/.env*)");
    }
  });
});
