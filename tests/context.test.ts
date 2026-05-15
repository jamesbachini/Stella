import { describe, expect, it } from "vitest";
import { buildSystemPrompt, buildUserContent, sanitizeHistory } from "../server/context";

describe("context assembly", () => {
  it("sanitizes chat history to user and assistant messages", () => {
    expect(
      sanitizeHistory([
        { role: "system", content: "ignore" },
        { role: "user", content: "hello" },
        { role: "assistant", content: "hi" },
        { role: "tool", content: "nope" }
      ])
    ).toEqual([
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi" }
    ]);
  });

  it("adds file text to the user turn", () => {
    expect(
      buildUserContent("Review this", [
        { name: "notes.md", mimeType: "text/markdown", text: "Stellar note" }
      ])
    ).toContain("### notes.md");
  });

  it("includes retrieved docs in the system prompt", () => {
    expect(
      buildSystemPrompt("Custom context", {
        context: "Docs snippet",
        sources: [{ url: "https://developers.stellar.org/docs" }]
      })
    ).toContain("Docs snippet");
  });
});
