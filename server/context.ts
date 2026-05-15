import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ChatMessage, ExtractedFile, RetrievedDocs } from "./types.js";
import { config } from "./config.js";

const DEFAULT_CONTEXT =
  "You are Stellar AI, a focused assistant for Stellar. Use retrieved Stellar Developer Docs context when available and avoid unsupported claims.";

export async function loadCustomContext(): Promise<string> {
  try {
    const contextPath = resolve(process.cwd(), config.customContextPath);
    const text = await readFile(contextPath, "utf8");
    return text.trim() || DEFAULT_CONTEXT;
  } catch {
    return DEFAULT_CONTEXT;
  }
}

export function sanitizeHistory(messages: unknown): ChatMessage[] {
  if (!Array.isArray(messages)) {
    return [];
  }

  return messages
    .filter((message): message is ChatMessage => {
      if (!message || typeof message !== "object") {
        return false;
      }
      const candidate = message as Partial<ChatMessage>;
      return (
        (candidate.role === "user" || candidate.role === "assistant") &&
        typeof candidate.content === "string" &&
        candidate.content.trim().length > 0
      );
    })
    .slice(-20)
    .map((message) => ({
      role: message.role,
      content: message.content.slice(0, 24_000)
    }));
}

export function buildUserContent(message: string, files: ExtractedFile[]): string {
  const cleanMessage = message.trim();
  if (files.length === 0) {
    return cleanMessage;
  }

  const fileBlocks = files
    .map(
      (file) =>
        `### ${file.name} (${file.mimeType || "text/plain"})\n${file.text.trim()}`
    )
    .join("\n\n");

  return `${cleanMessage}\n\nAttached file context:\n\n${fileBlocks}`;
}

export function buildSystemPrompt(
  customContext: string,
  docs: RetrievedDocs
): string {
  const docsSection = docs.context.trim()
    ? `Retrieved Stellar Developer Docs context:\n${docs.context.trim()}`
    : "Retrieved Stellar Developer Docs context: No relevant docs were returned for this turn.";

  return [
    customContext.trim(),
    docsSection,
    "When using retrieved docs, cite source URLs in the answer. If the docs do not support a Stellar-specific claim, say so clearly."
  ]
    .filter(Boolean)
    .join("\n\n");
}
