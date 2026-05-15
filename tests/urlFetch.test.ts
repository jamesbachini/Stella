import { describe, expect, it } from "vitest";
import { fetchUrlContent } from "../server/urlFetch";

describe("url fetch tool", () => {
  it("rejects non-http URLs", async () => {
    await expect(fetchUrlContent("file:///etc/passwd")).rejects.toThrow(
      "Only http and https URLs"
    );
  });

  it("rejects local network URLs", async () => {
    await expect(fetchUrlContent("http://127.0.0.1:3028")).rejects.toThrow(
      "Private or local network URLs"
    );
  });
});
