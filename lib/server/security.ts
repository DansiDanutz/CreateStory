import { timingSafeEqual } from "node:crypto";

const attempts = new Map<string, { count: number; resetAt: number }>();

export function authorize(request: Request): boolean {
  const expected = process.env.STORYLAB_ACCESS_CODE;
  if (!expected) return process.env.NODE_ENV !== "production";
  if (process.env.NODE_ENV === "production" && expected.length < 32) return false;
  const supplied = request.headers.get("x-storylab-access-code") || "";
  const left = Buffer.from(expected);
  const right = Buffer.from(supplied);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function enforceRateLimit(request: Request, max = 3, windowMs = 10 * 60_000, bucket = "default"): { allowed: boolean; retryAfter: number } {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const key = `${bucket}:${forwarded || request.headers.get("x-real-ip") || "local"}`;
  const now = Date.now();
  const current = attempts.get(key);
  if (!current || current.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfter: 0 };
  }
  if (current.count >= max) return { allowed: false, retryAfter: Math.ceil((current.resetAt - now) / 1000) };
  current.count += 1;
  return { allowed: true, retryAfter: 0 };
}
