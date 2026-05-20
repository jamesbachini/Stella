import { timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";

export const apiKeyHeaderName = "x-stella-api-key";

export type RateLimitOptions = {
  maxRequests: number;
  windowMs: number;
  now?: () => number;
};

export function parseAllowedApiKeys(value: string | undefined): string[] {
  const raw = value?.trim();
  if (!raw) {
    return [];
  }

  if (raw.startsWith("[")) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed
          .filter((item): item is string => typeof item === "string")
          .map((item) => item.trim())
          .filter(Boolean);
      }
    } catch {
      return [];
    }
  }

  return raw
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean);
}

export function isAllowedApiKey(candidate: string | undefined, allowedKeys: string[]): boolean {
  if (!candidate || allowedKeys.length === 0) {
    return false;
  }

  return allowedKeys.some((allowedKey) => {
    const candidateBuffer = Buffer.from(candidate);
    const allowedBuffer = Buffer.from(allowedKey);
    return (
      candidateBuffer.length === allowedBuffer.length &&
      timingSafeEqual(candidateBuffer, allowedBuffer)
    );
  });
}

export function createApiKeyMiddleware(allowedKeys: string[]): RequestHandler {
  return (req, res, next) => {
    if (allowedKeys.length === 0) {
      res.status(503).json({ error: "API access is not configured" });
      return;
    }

    if (!isAllowedApiKey(req.get(apiKeyHeaderName), allowedKeys)) {
      res.status(401).json({ error: "Invalid API key" });
      return;
    }

    next();
  };
}

export function createGlobalRateLimitMiddleware({
  maxRequests,
  windowMs,
  now = () => Date.now()
}: RateLimitOptions): RequestHandler {
  let windowStartedAt = now();
  let requestCount = 0;

  return (_req, res, next) => {
    const currentTime = now();
    if (currentTime - windowStartedAt >= windowMs) {
      windowStartedAt = currentTime;
      requestCount = 0;
    }

    if (requestCount >= maxRequests) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((windowStartedAt + windowMs - currentTime) / 1000)
      );
      res.setHeader("Retry-After", String(retryAfterSeconds));
      res.status(429).json({ error: "Rate limit exceeded" });
      return;
    }

    requestCount += 1;
    next();
  };
}
