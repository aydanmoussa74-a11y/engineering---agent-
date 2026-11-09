import { timingSafeEqual } from "node:crypto";

export function isAuthorizedBearer(
  authorization: string | undefined,
  expectedToken: string
): boolean {
  if (!authorization || !expectedToken) return false;
  const separator = authorization.indexOf(" ");
  if (separator < 0 || authorization.slice(0, separator).toLowerCase() !== "bearer") return false;
  const supplied = Buffer.from(authorization.slice(separator + 1), "utf8");
  const expected = Buffer.from(expectedToken, "utf8");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export function isAllowedHost(
  hostHeader: string | undefined,
  configuredHost: string
): boolean {
  const host = (hostHeader ?? "").toLowerCase();
  const expected = configuredHost.toLowerCase();
  if (expected) return host === expected;
  return host === "localhost" || host.startsWith("localhost:") ||
    host.startsWith("127.0.0.1:") || host.endsWith(".onrender.com");
}

type WindowState = { startedAt: number; count: number };

export function createFixedWindowRateLimiter(options: {
  limit: number;
  windowMs: number;
  maxKeys?: number;
}) {
  const { limit, windowMs, maxKeys = 1_000 } = options;
  if (!Number.isInteger(limit) || limit < 1) throw new Error("Rate limit must be a positive integer.");
  if (!Number.isInteger(windowMs) || windowMs < 1) throw new Error("Rate window must be a positive integer.");
  if (!Number.isInteger(maxKeys) || maxKeys < 1) throw new Error("Rate limiter key capacity must be a positive integer.");

  const windows = new Map<string, WindowState>();

  return (key: string, now = Date.now()): boolean => {
    const current = windows.get(key);
    if (!current || now - current.startedAt >= windowMs) {
      windows.set(key, { startedAt: now, count: 1 });
      if (windows.size > maxKeys) {
        for (const [candidate, state] of windows) {
          if (now - state.startedAt >= windowMs) windows.delete(candidate);
        }
        while (windows.size > maxKeys) {
          const oldest = windows.keys().next().value as string | undefined;
          if (oldest === undefined) break;
          windows.delete(oldest);
        }
      }
      return true;
    }
    current.count += 1;
    return current.count <= limit;
  };
}
