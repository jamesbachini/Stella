import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { config } from "./config.js";
import type { DocsSource, RetrievedDocs } from "./types.js";

type TransportWithClose = StreamableHTTPClientTransport | SSEClientTransport;

async function connectClient(): Promise<{ client: Client; transport: TransportWithClose }> {
  const url = new URL(config.mintlifyMcpUrl);

  try {
    const client = new Client({ name: "stellar-ai-chatbot", version: "0.1.0" });
    const transport = new StreamableHTTPClientTransport(url);
    await client.connect(transport);
    return { client, transport };
  } catch {
    const client = new Client({ name: "stellar-ai-chatbot", version: "0.1.0" });
    const transport = new SSEClientTransport(url);
    await client.connect(transport);
    return { client, transport };
  }
}

function toolText(result: Awaited<ReturnType<Client["callTool"]>>): string {
  const content = Array.isArray(result.content) ? result.content : [];
  return content
    .map((part: unknown) => {
      if (!part || typeof part !== "object") {
        return "";
      }
      const typedPart = part as {
        type?: string;
        text?: string;
        resource?: { text?: string };
      };
      if (typedPart.type === "text") {
        return typedPart.text ?? "";
      }
      if (typedPart.type === "resource" && typedPart.resource?.text) {
        return typedPart.resource.text;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n\n");
}

function extractSources(text: string): DocsSource[] {
  const urls = new Set<string>();
  const urlPattern =
    /https:\/\/(?:developers\.stellar\.org|stellardevelopmentfoundation\.mintlify\.app)\/[^\s)]+/g;
  for (const match of text.matchAll(urlPattern)) {
    urls.add(match[0].replace(/[.,;]+$/, ""));
  }

  return [...urls].slice(0, 8).map((url) => ({ url }));
}

function compactQuery(message: string): string {
  return message.replace(/\s+/g, " ").trim().slice(0, 500);
}

export async function retrieveStellarDocs(message: string): Promise<RetrievedDocs> {
  const query = compactQuery(message);
  if (!query) {
    return { context: "", sources: [] };
  }

  let client: Client | undefined;
  let transport: TransportWithClose | undefined;

  try {
    const connected = await connectClient();
    client = connected.client;
    transport = connected.transport;

    const search = await client.callTool({
      name: "search_stellar_developer_docs",
      arguments: { query }
    });
    const searchText = toolText(search).slice(0, 16_000);
    return {
      context: searchText,
      sources: extractSources(searchText)
    };
  } catch (error) {
    const messageText =
      error instanceof Error ? error.message : "Unknown Mintlify MCP error";
    return {
      context: `Docs retrieval failed for this turn: ${messageText}`,
      sources: []
    };
  } finally {
    await transport?.close().catch(() => undefined);
    await client?.close().catch(() => undefined);
  }
}
