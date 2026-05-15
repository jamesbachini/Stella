import "dotenv/config";

export const config = {
  port: Number(process.env.PORT ?? 3028),
  openRouterApiKey: process.env.OPENROUTER_API_KEY ?? "",
  openRouterModel: process.env.OPENROUTER_MODEL ?? "deepseek/deepseek-v4-pro",
  mintlifyMcpUrl:
    process.env.MINTLIFY_MCP_URL ??
    "https://stellardevelopmentfoundation.mintlify.app/mcp",
  customContextPath: process.env.CUSTOM_CONTEXT_PATH ?? "context/system.md",
  maxFiles: Number(process.env.MAX_FILES ?? 5),
  maxFileBytes: Number(process.env.MAX_FILE_BYTES ?? 8 * 1024 * 1024)
};
