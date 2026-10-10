import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export function generateToken(): { token: string; sha256: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, sha256: sha256Hex(token) };
}

export function sha256Hex(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

/** Comparação em tempo constante do hash do token apresentado com o configurado. */
export function verifyToken(presented: string | undefined, expectedSha256: string): boolean {
  if (!presented) return false;
  const a = Buffer.from(sha256Hex(presented), "hex");
  const b = Buffer.from(expectedSha256, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function bearerFrom(header: string | undefined): string | undefined {
  const m = /^Bearer\s+(\S+)$/i.exec(header ?? "");
  return m?.[1];
}

/** Bloqueia um IP após N falhas dentro da janela. */
export class FailureLimiter {
  private fails = new Map<string, number[]>();
  constructor(private max: number, private windowMs: number, private now: () => number = Date.now) {}

  private recent(key: string): number[] {
    const t = this.now();
    const list = (this.fails.get(key) ?? []).filter((x) => t - x < this.windowMs);
    this.fails.set(key, list);
    return list;
  }
  isBlocked(key: string): boolean {
    return this.recent(key).length >= this.max;
  }
  recordFailure(key: string): void {
    this.recent(key).push(this.now());
  }
  reset(key: string): void {
    this.fails.delete(key);
  }
}
