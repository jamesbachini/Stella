import { describe, expect, it } from "vitest";
import {
  parseMintlifyAssistantEvent,
  toMintlifyAssistantMessages
} from "../server/mintlifyAssistant";

describe("mintlify assistant helpers", () => {
  it("converts chat history into AI SDK message parts", () => {
    expect(
      toMintlifyAssistantMessages([
        { role: "system", content: "ignore" },
        { role: "user", content: "hello" },
        { role: "assistant", content: "hi" },
        { role: "tool", content: "ignore", tool_call_id: "1" },
        { role: "user", content: "" }
      ])
    ).toEqual([
      {
        id: "message-1",
        role: "user",
        parts: [{ type: "text", text: "hello" }]
      },
      {
        id: "message-2",
        role: "assistant",
        parts: [{ type: "text", text: "hi" }]
      }
    ]);
  });

  it("parses text delta events from the assistant stream", () => {
    expect(
      parseMintlifyAssistantEvent(
        '{"type":"text-delta","id":"gen","delta":"Hello"}'
      )
    ).toEqual({ type: "text-delta", id: "gen", delta: "Hello" });
    expect(parseMintlifyAssistantEvent("[DONE]")).toBeNull();
  });
});
