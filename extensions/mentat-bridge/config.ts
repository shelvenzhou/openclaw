/**
 * Configuration schema for the mentat-bridge plugin.
 */

export type MentatBridgeConfig = {
  /** Base URL of the Mentat sidecar HTTP server. */
  baseUrl: string;
  /** Connection and read timeout in ms. */
  timeoutMs: number;
  /** Auto-index tool results from these tool names (glob patterns). */
  autoIndexTools: string[];
  /** Minimum content length (chars) to index — skip tiny payloads. */
  minContentLength: number;
  /** Maximum content length (chars) to send in a single index request. */
  maxContentLength: number;
};

export const DEFAULT_CONFIG: MentatBridgeConfig = {
  baseUrl: "http://127.0.0.1:7832",
  timeoutMs: 10_000,
  autoIndexTools: [
    "web_fetch",
    "browser",
    "read",
    // Match all Composio tools — detected by MCP origin at runtime
    "COMPOSIO_*",
  ],
  minContentLength: 100,
  maxContentLength: 500_000,
};

export function resolveConfig(pluginConfig?: Record<string, unknown>): MentatBridgeConfig {
  const raw = pluginConfig ?? {};
  return {
    baseUrl: typeof raw.baseUrl === "string" && raw.baseUrl ? raw.baseUrl : DEFAULT_CONFIG.baseUrl,
    timeoutMs:
      typeof raw.timeoutMs === "number" && raw.timeoutMs > 0
        ? raw.timeoutMs
        : DEFAULT_CONFIG.timeoutMs,
    autoIndexTools: Array.isArray(raw.autoIndexTools)
      ? (raw.autoIndexTools as string[])
      : DEFAULT_CONFIG.autoIndexTools,
    minContentLength:
      typeof raw.minContentLength === "number"
        ? raw.minContentLength
        : DEFAULT_CONFIG.minContentLength,
    maxContentLength:
      typeof raw.maxContentLength === "number"
        ? raw.maxContentLength
        : DEFAULT_CONFIG.maxContentLength,
  };
}

/**
 * Config schema exported for OpenClaw plugin validation.
 */
export const mentatBridgeConfigSchema = {
  parse(value: unknown): MentatBridgeConfig {
    return resolveConfig(value as Record<string, unknown>);
  },
  safeParse(value: unknown) {
    try {
      return { success: true as const, data: resolveConfig(value as Record<string, unknown>) };
    } catch (err) {
      return {
        success: false as const,
        error: { issues: [{ path: [], message: String(err) }] },
      };
    }
  },
};
