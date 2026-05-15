import type { ChatMessage } from "./types.js";
import { config } from "./config.js";
import { fetchUrlContent, fetchedUrlSources } from "./urlFetch.js";
import type { DocsSource } from "./types.js";

const FETCH_URL_TOOL = {
  type: "function",
  function: {
    name: "fetch_url",
    description:
      "Fetch the text content of a specific public URL when current information is needed and the URL is known.",
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "The public http or https URL to fetch."
        }
      },
      required: ["url"],
      additionalProperties: false
    }
  }
} as const;

type ToolCall = NonNullable<ChatMessage["tool_calls"]>[number];

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: ToolCall[];
    };
  }>;
};

function parseToolArguments(argumentsText: string): { url?: string } {
  try {
    const parsed = JSON.parse(argumentsText) as unknown;
    if (parsed && typeof parsed === "object") {
      const url = (parsed as { url?: unknown }).url;
      return typeof url === "string" ? { url } : {};
    }
  } catch {
    return {};
  }
  return {};
}

export async function addUrlFetchToolContext(
  messages: ChatMessage[]
): Promise<{ messages: ChatMessage[]; sources: DocsSource[] }> {
  if (!config.openRouterApiKey) {
    throw new Error("OPENROUTER_API_KEY is not set");
  }

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.openRouterApiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://ai.stellar.org",
      "X-Title": "Stellar AI"
    },
    body: JSON.stringify({
      model: config.openRouterModel,
      messages,
      tools: [FETCH_URL_TOOL],
      tool_choice: "auto",
      stream: false,
      temperature: 0.2,
      max_completion_tokens: 600
    })
  });

  if (!response.ok) {
    return { messages, sources: [] };
  }

  let parsed: ChatCompletionResponse;
  try {
    parsed = (await response.json()) as ChatCompletionResponse;
  } catch {
    return { messages, sources: [] };
  }
  const assistantMessage = parsed.choices?.[0]?.message;
  const toolCalls = assistantMessage?.tool_calls ?? [];
  if (toolCalls.length === 0) {
    return { messages, sources: [] };
  }

  const limitedToolCalls = toolCalls
    .filter((toolCall) => toolCall.function.name === "fetch_url")
    .slice(0, 3);

  if (limitedToolCalls.length === 0) {
    return { messages, sources: [] };
  }

  const fetchedByUrl = new Map<string, Awaited<ReturnType<typeof fetchUrlContent>>>();
  const toolMessages: ChatMessage[] = [];

  for (const toolCall of limitedToolCalls) {
    const { url } = parseToolArguments(toolCall.function.arguments);
    if (!url) {
      toolMessages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        name: "fetch_url",
        content: "fetch_url failed: missing required url argument."
      });
      continue;
    }

    try {
      const fetched = fetchedByUrl.get(url) ?? (await fetchUrlContent(url));
      fetchedByUrl.set(url, fetched);
      toolMessages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        name: "fetch_url",
        content: [
          `Fetched URL: ${fetched.url}`,
          fetched.title ? `Title: ${fetched.title}` : "",
          "Content:",
          fetched.content
        ]
          .filter(Boolean)
          .join("\n")
      });
    } catch (error) {
      const messageText = error instanceof Error ? error.message : "Unknown fetch error";
      toolMessages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        name: "fetch_url",
        content: `fetch_url failed for ${url}: ${messageText}`
      });
    }
  }

  return {
    messages: [
      ...messages,
      {
        role: "assistant",
        content: assistantMessage?.content ?? null,
        tool_calls: limitedToolCalls
      },
      ...toolMessages
    ],
    sources: fetchedUrlSources([...fetchedByUrl.values()])
  };
}

export async function streamOpenRouter(
  messages: ChatMessage[],
  onDelta: (text: string) => void
): Promise<void> {
  if (!config.openRouterApiKey) {
    throw new Error("OPENROUTER_API_KEY is not set");
  }

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.openRouterApiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://ai.stellar.org",
      "X-Title": "Stellar AI"
    },
    body: JSON.stringify({
      model: config.openRouterModel,
      messages,
      stream: true,
      temperature: 0.2,
      max_completion_tokens: 4000
    })
  });

  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => "");
    throw new Error(`OpenRouter request failed (${response.status}): ${text}`);
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

      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") {
        continue;
      }

      const parsed = JSON.parse(payload) as {
        choices?: Array<{ delta?: { content?: string }; message?: { content?: string } }>;
      };
      const delta =
        parsed.choices?.[0]?.delta?.content ??
        parsed.choices?.[0]?.message?.content ??
        "";
      if (delta) {
        onDelta(delta);
      }
    }
  }
}
