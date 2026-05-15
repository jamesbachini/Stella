import express from "express";
import multer from "multer";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import {
  buildSystemPrompt,
  buildUserContent,
  loadCustomContext,
  sanitizeHistory
} from "./context.js";
import { extractFiles } from "./files.js";
import { retrieveStellarDocs } from "./mintlify.js";
import { addUrlFetchToolContext, streamOpenRouter } from "./openrouter.js";
import type { ChatMessage, DocsSource } from "./types.js";

const app = express();
const isDevelopment = process.env.NODE_ENV === "development";
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: config.maxFiles,
    fileSize: config.maxFileBytes
  }
});

function writeEvent(res: express.Response, event: unknown): void {
  res.write(`${JSON.stringify(event)}\n`);
}

function uniqueSources(sources: DocsSource[]): DocsSource[] {
  const seen = new Set<string>();
  return sources.filter((source) => {
    if (seen.has(source.url)) {
      return false;
    }
    seen.add(source.url);
    return true;
  });
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/api/chat", upload.array("files", config.maxFiles), async (req, res) => {
  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("X-Accel-Buffering", "no");

  try {
    const message = String(req.body.message ?? "").trim();
    if (!message) {
      res.status(400);
      writeEvent(res, { type: "error", error: "Message is required" });
      res.end();
      return;
    }

    const parsedMessages = req.body.messages
      ? JSON.parse(String(req.body.messages))
      : [];
    const history = sanitizeHistory(parsedMessages);
    const files = await extractFiles(req.files as Express.Multer.File[]);
    const docs = await retrieveStellarDocs(message);
    const customContext = await loadCustomContext();
    const userContent = buildUserContent(message, files);

    const messages: ChatMessage[] = [
      { role: "system", content: buildSystemPrompt(customContext, docs) },
      ...history,
      { role: "user", content: userContent }
    ];
    const withFetchedUrls = await addUrlFetchToolContext(messages);
    const sources = uniqueSources([...docs.sources, ...withFetchedUrls.sources]);

    writeEvent(res, { type: "sources", sources });

    await streamOpenRouter(withFetchedUrls.messages, (text) => {
      writeEvent(res, { type: "delta", text });
    });

    writeEvent(res, { type: "done", sources });
    res.end();
  } catch (error) {
    const messageText = error instanceof Error ? error.message : "Unknown error";
    writeEvent(res, { type: "error", error: messageText });
    res.end();
  }
});

if (isDevelopment) {
  const { createServer } = await import("vite");
  const vite = await createServer({
    root: "client",
    server: {
      middlewareMode: true
    },
    appType: "custom"
  });
  app.use(vite.middlewares);
  app.use(async (req, res, next) => {
    try {
      const indexPath = resolve(process.cwd(), "client/index.html");
      const template = await readFile(indexPath, "utf-8");
      const html = await vite.transformIndexHtml(req.originalUrl, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(html);
    } catch (error) {
      vite.ssrFixStacktrace(error as Error);
      next(error);
    }
  });
} else {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const clientDist = resolve(__dirname, "../client");
  app.use(express.static(clientDist));
  app.use((_req, res) => {
    res.sendFile(resolve(clientDist, "index.html"));
  });
}

app.listen(config.port, () => {
  console.log(`Stellar AI chatbot listening on http://localhost:${config.port}`);
});
