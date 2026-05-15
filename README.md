# Stella

Stella is a Stellar-focused AI chat assistant with a React/Vite frontend and an Express backend. It streams responses from OpenRouter, retrieves relevant Stellar Developer Docs through the Mintlify MCP endpoint, and can include uploaded text or PDF files as extra context for each chat turn.

## Features

- Streaming chat responses over newline-delimited JSON.
- Stellar Developer Docs retrieval through Mintlify MCP.
- Editable system/context prompt in `context/system.md`.
- Local browser conversation history.
- File attachments for text-like files and PDFs.
- Source links surfaced in the chat UI when retrieved docs include URLs.
- Vitest coverage for chat helpers and prompt/context assembly.

## Tech Stack

- React 19 and Vite for the client.
- Express 5 and TypeScript for the server.
- OpenRouter chat completions for model responses.
- Model Context Protocol SDK for Stellar docs retrieval.
- Multer and `pdf-parse` for attachment handling.
- Vitest for tests.

## Getting Started

### Prerequisites

- Node.js 20 or newer is recommended.
- An OpenRouter API key.

### Install

```bash
npm install
```

### Configure

Create a local `.env` file from the example:

```bash
cp .env.example .env
```

Then set at least:

```bash
OPENROUTER_API_KEY=your_openrouter_key
```

The default `.env.example` values are:

| Variable | Purpose | Default |
| --- | --- | --- |
| `OPENROUTER_API_KEY` | Required for real chat responses. | empty |
| `PORT` | Express server port. | `3028` |
| `OPENROUTER_MODEL` | OpenRouter model id. | `deepseek/deepseek-v4-pro` |
| `MINTLIFY_MCP_URL` | Stellar docs MCP endpoint. | `https://stellardevelopmentfoundation.mintlify.app/mcp` |
| `CUSTOM_CONTEXT_PATH` | Path to the editable system/context prompt. | `context/system.md` |
| `MAX_FILES` | Maximum attachments per message. | `5` |
| `MAX_FILE_BYTES` | Maximum bytes per uploaded file. | `8388608` |

## Development

Start the frontend and backend together:

```bash
npm run dev
```

This runs Express with `tsx watch server/index.ts` on `http://localhost:3028`.
In development, Express mounts Vite as middleware, so the frontend and `/api`
routes share the same port. In production, the server uses `PORT` from `.env`
or falls back to `3028`.

## Available Scripts

```bash
npm run dev
npm run build
npm start
npm test
```

- `npm run dev` starts the TypeScript server watcher with Vite middleware.
- `npm run build` compiles the server and builds the client into `dist/`.
- `npm start` runs the built server from `dist/server`.
- `npm test` runs the Vitest test suite.

## Project Structure

```text
server/
  index.ts       Express app, routes, streaming response handling
  openrouter.ts  OpenRouter streaming client
  mintlify.ts    Stellar docs retrieval through MCP
  files.ts       Text and PDF extraction for attachments
  context.ts     Prompt assembly and message sanitization
  config.ts      Environment configuration

client/src/
  App.tsx        Main chat UI
  chat.ts        Conversation storage and helper functions
  styles.css     Application styles

context/
  system.md      Custom system/context prompt loaded by the server

tests/
  *.test.ts      Vitest tests
```

## API Overview

### `GET /api/health`

Returns:

```json
{ "ok": true }
```

### `POST /api/chat`

Accepts `multipart/form-data`:

- `message`: required user message.
- `messages`: optional JSON-encoded chat history.
- `files`: optional uploaded attachments.

The response is streamed as newline-delimited JSON events:

```json
{ "type": "sources", "sources": [] }
{ "type": "delta", "text": "Partial response text" }
{ "type": "done", "sources": [] }
```

If an error occurs, the stream includes:

```json
{ "type": "error", "error": "Message" }
```

## Attachment Support

Stella accepts PDFs and common text-like files, including:

- `.txt`, `.md`, `.mdx`, `.json`, `.csv`
- TypeScript, JavaScript, CSS, HTML, XML
- YAML, TOML, Python, Go, Rust, Java, Solidity, shell scripts

Each extracted file is truncated to 40,000 characters before being added to the prompt. Uploaded file count and size are controlled by `MAX_FILES` and `MAX_FILE_BYTES`.

## Custom Context

Edit `context/system.md` to change Stella's baseline behavior without changing code. The server loads this file for every chat request and combines it with retrieved Stellar docs context.

If the file is missing or empty, the server falls back to a built-in Stellar-focused assistant prompt.

## Testing

Run:

```bash
npm test
```

Current tests cover:

- Chat title/id helpers.
- Chat history sanitization.
- File context insertion.
- System prompt assembly with retrieved docs.

Add or update tests when changing prompt assembly, streaming parsing, retrieval behavior, file extraction, or conversation helpers.

## Production Build

Build the app:

```bash
npm run build
```

Run the compiled server:

```bash
npm start
```

The production Express server serves the built frontend from `dist/client` and exposes the API routes from the same process.

## Security Notes

- Do not commit `.env` or real API keys.
- Keep OpenRouter access server-side only.
- Preserve upload size and type checks when extending attachment support.
- Treat `context/system.md` as application behavior configuration, not a place for secrets.
