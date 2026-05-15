export type ChatRole = "user" | "assistant";

export type Message = {
  id: string;
  role: ChatRole;
  content: string;
};

export type Conversation = {
  id: string;
  title: string;
  updatedAt: number;
  messages: Message[];
};

export type Source = {
  title?: string;
  url: string;
};

export function createId(): string {
  return crypto.randomUUID();
}

export function summarizeTitle(text: string): string {
  const words = text
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);

  if (words.length === 0) {
    return "New chat";
  }

  const title = words.slice(0, 8).join(" ");
  return words.length > 8 ? `${title}...` : title;
}

export function loadConversations(): Conversation[] {
  try {
    const raw = localStorage.getItem("stellar-ai-conversations");
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as Conversation[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveConversations(conversations: Conversation[]): void {
  if (conversations.length === 0) {
    localStorage.removeItem("stellar-ai-conversations");
    return;
  }

  localStorage.setItem(
    "stellar-ai-conversations",
    JSON.stringify(conversations.slice(0, 40))
  );
}

export function clearStoredData(): void {
  localStorage.clear();
}
