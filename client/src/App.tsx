import { FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Conversation,
  Message,
  Source,
  clearStoredData,
  createId,
  loadConversations,
  saveConversations,
  summarizeTitle
} from "./chat";
import stellarLogo from "../stellar_logo.svg";
import stellaAvatar from "../stella.svg";
import userAvatar from "../user.svg";

type StreamEvent =
  | { type: "sources"; sources: Source[] }
  | { type: "delta"; text: string }
  | { type: "done"; sources: Source[] }
  | { type: "error"; error: string };

type ChatModel = "mintlify-ai" | "stella-v2";

function emptyConversation(): Conversation {
  return {
    id: createId(),
    title: "New chat",
    updatedAt: Date.now(),
    messages: []
  };
}

function parseEvents(buffer: string): { events: StreamEvent[]; rest: string } {
  const lines = buffer.split("\n");
  const rest = lines.pop() ?? "";
  const events = lines
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as StreamEvent);
  return { events, rest };
}

function MarkdownMessage({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ children, ...props }) => (
          <a {...props} target="_blank" rel="noreferrer">
            {children}
          </a>
        )
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

function MessageBubble({ message, isThinking = false }: { message: Message; isThinking?: boolean }) {
  const avatar = message.role === "user" ? userAvatar : stellaAvatar;
  const shouldRenderMarkdown = message.role === "assistant" && !isThinking;

  return (
    <div className={`message message-${message.role}`}>
      <div className="message-avatar" aria-hidden="true">
        <img src={avatar} alt="" />
      </div>
      <div className="message-body">
        <div className="message-role">{message.role === "user" ? "You" : "Stellar AI"}</div>
        <div
          className={`message-content ${isThinking ? "message-thinking" : ""}`}
          aria-live={isThinking ? "polite" : undefined}
        >
          {isThinking ? (
            "thinking..."
          ) : shouldRenderMarkdown ? (
            <MarkdownMessage content={message.content} />
          ) : (
            message.content
          )}
        </div>
      </div>
    </div>
  );
}

export function App() {
  const [conversations, setConversations] = useState<Conversation[]>(() =>
    loadConversations()
  );
  const [activeId, setActiveId] = useState<string>(() => conversations[0]?.id ?? createId());
  const [draft, setDraft] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [selectedModel, setSelectedModel] = useState<ChatModel>("mintlify-ai");
  const scrollRef = useRef<HTMLDivElement>(null);

  const activeConversation = useMemo(() => {
    return (
      conversations.find((conversation) => conversation.id === activeId) ?? {
        ...emptyConversation(),
        id: activeId
      }
    );
  }, [activeId, conversations]);
  const hasMessages = activeConversation.messages.length > 0;
  const modelLabel = selectedModel === "mintlify-ai" ? "Mintlify AI" : "Stella v2";

  useEffect(() => {
    saveConversations(conversations);
  }, [conversations]);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth"
    });
  }, [activeConversation.messages, isSending]);

  function upsertConversation(next: Conversation) {
    setConversations((current) => {
      const others = current.filter((conversation) => conversation.id !== next.id);
      return [next, ...others].sort((a, b) => b.updatedAt - a.updatedAt);
    });
  }

  function startNewChat() {
    const conversation = emptyConversation();
    setActiveId(conversation.id);
    setSources([]);
    upsertConversation(conversation);
  }

  function deleteData() {
    clearStoredData();
    setConversations([]);
    setActiveId(createId());
    setDraft("");
    setFiles([]);
    setSources([]);
  }

  async function sendMessage(event?: FormEvent) {
    event?.preventDefault();
    const content = draft.trim();
    if (!content || isSending) {
      return;
    }

    const userMessage: Message = { id: createId(), role: "user", content };
    const assistantMessage: Message = { id: createId(), role: "assistant", content: "" };
    const title =
      activeConversation.messages.length === 0
        ? summarizeTitle(content)
        : activeConversation.title;
    const nextConversation: Conversation = {
      ...activeConversation,
      title,
      updatedAt: Date.now(),
      messages: [...activeConversation.messages, userMessage, assistantMessage]
    };

    upsertConversation(nextConversation);
    setDraft("");
    setSources([]);
    setIsSending(true);

    try {
      const formData = new FormData();
      formData.set("message", content);
      formData.set("model", selectedModel);
      formData.set(
        "messages",
        JSON.stringify(
          activeConversation.messages.map(({ role, content: messageContent }) => ({
            role,
            content: messageContent
          }))
        )
      );
      for (const file of files) {
        formData.append("files", file);
      }

      const response = await fetch("/api/chat", {
        method: "POST",
        body: formData
      });

      if (!response.body) {
        throw new Error("The server did not return a stream.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let assistantContent = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const parsed = parseEvents(buffer);
        buffer = parsed.rest;

        for (const streamEvent of parsed.events) {
          if (streamEvent.type === "sources") {
            setSources(streamEvent.sources);
          }

          if (streamEvent.type === "delta") {
            assistantContent += streamEvent.text;
            setConversations((current) =>
              current.map((conversation) =>
                conversation.id === nextConversation.id
                  ? {
                      ...conversation,
                      messages: conversation.messages.map((message) =>
                        message.id === assistantMessage.id
                          ? { ...message, content: assistantContent }
                          : message
                      )
                    }
                  : conversation
              )
            );
          }

          if (streamEvent.type === "done") {
            setSources(streamEvent.sources);
          }

          if (streamEvent.type === "error") {
            throw new Error(streamEvent.error);
          }
        }
      }

      setFiles([]);
    } catch (error) {
      const errorText = error instanceof Error ? error.message : "Request failed";
      setConversations((current) =>
        current.map((conversation) =>
          conversation.id === nextConversation.id
            ? {
                ...conversation,
                messages: conversation.messages.map((message) =>
                  message.id === assistantMessage.id
                    ? { ...message, content: `Error: ${errorText}` }
                    : message
                )
              }
            : conversation
        )
      );
    } finally {
      setIsSending(false);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendMessage();
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-top">
          <div className="brand">
            <img className="brand-logo" src={stellarLogo} alt="Stellar AI" />
          </div>
          <div className="brand-card" aria-label="Stellar knowledge status">
            <span className="eyebrow">Docs intelligence</span>
            <strong>Build on Stellar</strong>
            <p>Grounded answers from developer docs, github repos and custom context.</p>
            <label className="model-picker">
              <span>Choose your model</span>
              <select
                value={selectedModel}
                onChange={(event) => setSelectedModel(event.target.value as ChatModel)}
                disabled={isSending}
              >
                <option value="mintlify-ai">Mintlify AI</option>
                <option value="stella-v2">Stella v2</option>
              </select>
            </label>
          </div>
        </div>
        <div className="sidebar-actions">
          <button className="new-chat" onClick={startNewChat}>
            <span aria-hidden="true">+</span>
            New chat
          </button>
        </div>
        <div className="history-block">
          <div className="section-label">Recent</div>
          <nav className="conversation-list" aria-label="Recent queries">
            {conversations.map((conversation) => (
              <button
                key={conversation.id}
                className={`conversation-item ${
                  conversation.id === activeConversation.id ? "active" : ""
                }`}
                onClick={() => {
                  setActiveId(conversation.id);
                  setSources([]);
                }}
              >
                <span>{conversation.title}</span>
              </button>
            ))}
          </nav>
        </div>
        <div className="sidebar-footer">
          <button className="delete-data" onClick={deleteData} type="button">
            Delete Data
          </button>
        </div>
      </aside>

      <main className={`chat-panel ${hasMessages ? "has-chat" : "empty-chat"}`}>
        <div className="chat-header">
          <div>
            <span className="eyebrow">Stellar workspace</span>
            <h2>{activeConversation.title}</h2>
          </div>
          <div className={`status-pill ${isSending ? "busy" : ""}`}>
            <span aria-hidden="true" />
            {isSending ? "Responding" : modelLabel}
          </div>
        </div>

        <div className="messages" ref={scrollRef}>
          {!hasMessages ? (
            <div className="empty-state">
              <h2>Ask Stella</h2>
              <h3>Your AI Assistant For Stellar</h3>
              <p className="version">Stella v2.0.1</p>
              <p>
                Get answers and information from Stella, The agentic AI chatbot integrated with Stellar documentation and resources
              </p>
            </div>
          ) : (
            activeConversation.messages.map((message, index) => (
              <MessageBubble
                key={message.id}
                message={message}
                isThinking={
                  isSending &&
                  message.role === "assistant" &&
                  message.content.length === 0 &&
                  index === activeConversation.messages.length - 1
                }
              />
            ))
          )}
        </div>

        {sources.length > 0 && (
          <div className="sources">
            {sources.map((source) => (
              <a key={source.url} href={source.url} target="_blank" rel="noreferrer">
                <span>Source</span>
                {source.title ?? source.url.replace("https://developers.stellar.org", "")}
              </a>
            ))}
          </div>
        )}

        <form className="composer" onSubmit={sendMessage}>
          {files.length > 0 && (
            <div className="attachments">
              {files.map((file) => (
                <span key={`${file.name}-${file.size}`}>{file.name}</span>
              ))}
            </div>
          )}
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask Stellar AI about docs, code, architecture, or attached notes..."
            rows={1}
          />
          <div className="composer-actions">
            <label className="file-button">
              <span aria-hidden="true">+</span>
              Attach
              <input
                type="file"
                multiple
                onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
              />
            </label>
            <button type="submit" disabled={isSending || !draft.trim()}>
              Send
              <span aria-hidden="true">-&gt;</span>
            </button>
          </div>
        </form>
      </main>
    </div>
  );
}
