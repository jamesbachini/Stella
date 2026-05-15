import { describe, expect, it, vi } from "vitest";

vi.stubGlobal("crypto", { randomUUID: () => "id" });
vi.stubGlobal("localStorage", {
  getItem: () => null,
  setItem: () => undefined
});

describe("chat helpers", async () => {
  const { createId, summarizeTitle } = await import("../client/src/chat");

  it("summarizes recent query titles", () => {
    expect(
      summarizeTitle("How do I create and submit a Stellar transaction with Soroban?")
    ).toBe("How do I create and submit a Stellar...");
  });

  it("creates browser ids", () => {
    expect(createId()).toBe("id");
  });
});
