import "dotenv/config";
import { parseAllowedApiKeys } from "./security.js";

export const config = {
  port: Number(process.env.PORT ?? 3028),
  openRouterApiKey: process.env.OPENROUTER_API_KEY ?? "",
  openRouterModel: process.env.OPENROUTER_MODEL ?? "deepseek/deepseek-v4-pro",
  allowedApiKeys: parseAllowedApiKeys(process.env.STELLA_API_KEYS),
  rateLimitMaxRequests: Number(process.env.RATE_LIMIT_MAX_REQUESTS ?? 10),
  rateLimitWindowMs: Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000),
  mintlifyApiKey: process.env.MINTLIFY_API_KEY ?? "",
  mintlifyDomain: process.env.MINTLIFY_DOMAIN ?? "stellardevelopmentfoundation",
  stellarDocsRoot: process.env.STELLAR_DOCS_ROOT ?? "stellar-docs/docs",
  stellarDocsBaseUrl:
    process.env.STELLAR_DOCS_BASE_URL ?? "https://developers.stellar.org/docs",
  docsContextMaxChars: Number(process.env.DOCS_CONTEXT_MAX_CHARS ?? 16_000),
  customContextPath: process.env.CUSTOM_CONTEXT_PATH ?? "context/system.md",
  maxFiles: Number(process.env.MAX_FILES ?? 5),
  maxFileBytes: Number(process.env.MAX_FILE_BYTES ?? 8 * 1024 * 1024)
};
