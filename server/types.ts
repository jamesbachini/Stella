export type ChatRole = "user" | "assistant" | "system" | "tool";

export type ChatMessage = {
  role: ChatRole;
  content: string | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: {
      name: string;
      arguments: string;
    };
  }>;
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
