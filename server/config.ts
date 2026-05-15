import "dotenv/config";

function defaultMintlifyDomain(): string {
  const mcpUrl = process.env.MINTLIFY_MCP_URL;
  if (!mcpUrl) {
    return "stellardevelopmentfoundation";
  }

  try {
    return new URL(mcpUrl).hostname.split(".")[0] || "stellardevelopmentfoundation";
  } catch {
    return "stellardevelopmentfoundation";
  }
}

export const config = {
  port: Number(process.env.PORT ?? 3028),
  openRouterApiKey: process.env.OPENROUTER_API_KEY ?? "",
  openRouterModel: process.env.OPENROUTER_MODEL ?? "deepseek/deepseek-v4-pro",
  mintlifyApiKey: process.env.MINTLIFY_API_KEY ?? "",
  mintlifyDomain: process.env.MINTLIFY_DOMAIN ?? defaultMintlifyDomain(),
  mintlifyMcpUrl:
    process.env.MINTLIFY_MCP_URL ??
    "https://stellardevelopmentfoundation.mintlify.app/mcp",
  customContextPath: process.env.CUSTOM_CONTEXT_PATH ?? "context/system.md",
  maxFiles: Number(process.env.MAX_FILES ?? 5),
  maxFileBytes: Number(process.env.MAX_FILE_BYTES ?? 8 * 1024 * 1024)
};
