import { config } from "./config.js";
import type { ChatMessage } from "./types.js";

type MintlifyAssistantMessage = {
  id: string;
  role: "user" | "assistant";
  parts: Array<{ type: "text"; text: string }>;
};

type MintlifyAssistantEvent = {
  id?: string;
  type?: string;
  delta?: string;
  threadId?: string;
};

export function toMintlifyAssistantMessages(
  messages: ChatMessage[]
): MintlifyAssistantMessage[] {
  return messages
    .filter(
      (message): message is ChatMessage & { role: "user" | "assistant"; content: string } =>
        (message.role === "user" || message.role === "assistant") &&
        typeof message.content === "string" &&
        message.content.trim().length > 0
    )
    .map((message, index) => ({
      id: `message-${index + 1}`,
      role: message.role,
      parts: [{ type: "text", text: message.content }]
    }));
}

export function parseMintlifyAssistantEvent(payload: string): MintlifyAssistantEvent | null {
  if (!payload || payload === "[DONE]") {
    return null;
  }

  try {
    return JSON.parse(payload) as MintlifyAssistantEvent;
  } catch {
    return null;
  }
}

export async function streamMintlifyAssistant(
  messages: ChatMessage[],
  onDelta: (text: string) => void
): Promise<void> {
  if (!config.mintlifyApiKey) {
    throw new Error("MINTLIFY_API_KEY is not set");
  }

  const response = await fetch(
    `https://api.mintlify.com/discovery/v2/assistant/${config.mintlifyDomain}/message`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.mintlifyApiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        fp: "stella-web",
        messages: toMintlifyAssistantMessages(messages),
        threadId: null,
        retrievalPageSize: 5,
        filter: null,
        context: [],
        currentPath: "/"
      })
    }
  );

  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => "");
    throw new Error(`Mintlify assistant request failed (${response.status}): ${text}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line.startsWith("data:")) {
        continue;
      }

      const event = parseMintlifyAssistantEvent(line.slice(5).trim());
      if (event?.type === "text-delta" && event.delta) {
        onDelta(event.delta);
      }
    }
  }
}
