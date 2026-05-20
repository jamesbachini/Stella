import { describe, expect, it, vi } from "vitest";
import {
  createApiKeyMiddleware,
  createGlobalRateLimitMiddleware,
  isAllowedApiKey,
  parseAllowedApiKeys
} from "../server/security";

function createResponse() {
  return {
    body: undefined as unknown,
    headers: new Map<string, string>(),
    statusCode: 200,
    json(body: unknown) {
      this.body = body;
      return this;
    },
    setHeader(name: string, value: string) {
      this.headers.set(name, value);
      return this;
    },
    status(statusCode: number) {
      this.statusCode = statusCode;
      return this;
    }
  };
}

describe("API key security", () => {
  it("parses JSON-array and comma-separated API keys", () => {
    expect(parseAllowedApiKeys('["alpha", " beta "]')).toEqual(["alpha", "beta"]);
    expect(parseAllowedApiKeys("alpha,beta")).toEqual(["alpha", "beta"]);
  });

  it("validates API keys from the allowed list", () => {
    expect(isAllowedApiKey("alpha", ["alpha", "beta"])).toBe(true);
    expect(isAllowedApiKey("gamma", ["alpha", "beta"])).toBe(false);
  });

  it("rejects requests with a missing or invalid API key", () => {
    const middleware = createApiKeyMiddleware(["alpha"]);
    const response = createResponse();
    const next = vi.fn();

    middleware({ get: () => undefined } as never, response as never, next);

    expect(response.statusCode).toBe(401);
    expect(response.body).toEqual({ error: "Invalid API key" });
    expect(next).not.toHaveBeenCalled();
  });
});

describe("global rate limiting", () => {
  it("blocks requests after the configured server-wide limit", () => {
    let currentTime = 0;
    const middleware = createGlobalRateLimitMiddleware({
      maxRequests: 2,
      windowMs: 60_000,
      now: () => currentTime
    });
    const next = vi.fn();

    middleware({} as never, createResponse() as never, next);
    middleware({} as never, createResponse() as never, next);

    const limitedResponse = createResponse();
    middleware({} as never, limitedResponse as never, next);

    expect(next).toHaveBeenCalledTimes(2);
    expect(limitedResponse.statusCode).toBe(429);
    expect(limitedResponse.body).toEqual({ error: "Rate limit exceeded" });

    currentTime = 60_000;
    const resetResponse = createResponse();
    middleware({} as never, resetResponse as never, next);

    expect(resetResponse.statusCode).toBe(200);
    expect(next).toHaveBeenCalledTimes(3);
  });
});
