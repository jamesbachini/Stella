export type ChatRole = "user" | "assistant" | "system";

export type ChatMessage = {
  role: ChatRole;
  content: string;
};

export type DocsSource = {
  title?: string;
  url: string;
};

export type RetrievedDocs = {
  context: string;
  sources: DocsSource[];
};

export type ExtractedFile = {
  name: string;
  mimeType: string;
  text: string;
};
