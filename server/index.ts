import express from "express";
import multer from "multer";
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
import { streamOpenRouter } from "./openrouter.js";
import type { ChatMessage } from "./types.js";

const app = express();
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

    writeEvent(res, { type: "sources", sources: docs.sources });

    await streamOpenRouter(messages, (text) => {
      writeEvent(res, { type: "delta", text });
    });

    writeEvent(res, { type: "done", sources: docs.sources });
    res.end();
  } catch (error) {
    const messageText = error instanceof Error ? error.message : "Unknown error";
    writeEvent(res, { type: "error", error: messageText });
    res.end();
  }
});

const __dirname = dirname(fileURLToPath(import.meta.url));
const clientDist = resolve(__dirname, "../client");
app.use(express.static(clientDist));
app.use((_req, res) => {
  res.sendFile(resolve(clientDist, "index.html"));
});

app.listen(config.port, () => {
  console.log(`Stellar AI chatbot listening on http://localhost:${config.port}`);
});
