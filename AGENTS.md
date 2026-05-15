# Repository Guidelines

## Project Structure & Module Organization
This is a standalone Stellar AI chatbot served by an Express backend with a React/Vite frontend.

- `server/`: TypeScript backend code for Express routes, OpenRouter streaming, Mintlify MCP retrieval, file extraction, and prompt/context assembly.
- `client/src/`: React UI, chat state helpers, and styles.
- `client/index.html`: Vite HTML entrypoint.
- `context/system.md`: Editable custom system/context prompt loaded by the server.
- `tests/`: Vitest unit tests for shared behavior.
- `dist/`: Generated build output; do not edit manually.

## Build, Test, and Development Commands
- `npm run dev`: Starts Vite on `http://localhost:5173` and the Express API on `http://localhost:3000`.
- `npm run build`: Compiles the backend with `tsc` and builds the frontend into `dist/client`.
- `npm start`: Runs the production Express server from `dist/server`.
- `npm test`: Runs Vitest using `vitest.config.ts`.

Use `.env.example` as the template for local configuration. `OPENROUTER_API_KEY` is required for real chat responses.

## Coding Style & Naming Conventions
Use TypeScript for both server and client code. Keep modules small and behavior-focused.

- Use 2-space indentation.
- Prefer named exports for utilities and service functions.
- Use `camelCase` for variables/functions, `PascalCase` for React components and types, and descriptive file names such as `openrouter.ts` or `context.test.ts`.
- Keep server-only secrets and API calls in `server/`; the browser must not receive API keys.
- There is no formatter or linter configured yet, so follow the style already present in the repository.

## Testing Guidelines
Vitest is the test framework. Place tests in `tests/` and name files `*.test.ts`.

Focus tests on behavior that can regress: prompt assembly, message sanitization, file handling, streaming parsing, and local conversation helpers. Run `npm test` before submitting changes. Add or update tests when changing backend request assembly, MCP retrieval, file extraction, or chat state logic.

## Commit & Pull Request Guidelines
No Git history is available in this workspace, so use clear, conventional commit messages such as `feat: add source citations` or `fix: handle pdf extraction errors`.

Pull requests should include:

- A short summary of user-visible changes.
- Test/build results, especially `npm test` and `npm run build`.
- Screenshots or screen recordings for UI changes.
- Notes for configuration changes, new environment variables, or security-sensitive behavior.

## Security & Configuration Tips
Do not commit `.env` or real OpenRouter keys. Keep custom behavior in `context/system.md` unless it must be enforced in code. Validate file uploads server-side and preserve the existing size/type limits when extending attachment support.
