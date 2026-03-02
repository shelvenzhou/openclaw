/**
 * Mentat Bridge Plugin Tests
 *
 * Tests the plugin configuration, extractors, and registration.
 * No live Mentat sidecar required — HTTP calls are not made.
 */

import { describe, test, expect } from "vitest";

// ── Config Tests ────────────────────────────────────────────────────

describe("mentat-bridge config", () => {
  test("resolveConfig returns defaults for empty input", async () => {
    const { resolveConfig, DEFAULT_CONFIG } = await import("./config.js");
    const cfg = resolveConfig({});
    expect(cfg.baseUrl).toBe(DEFAULT_CONFIG.baseUrl);
    expect(cfg.timeoutMs).toBe(DEFAULT_CONFIG.timeoutMs);
    expect(cfg.minContentLength).toBe(DEFAULT_CONFIG.minContentLength);
    expect(cfg.maxContentLength).toBe(DEFAULT_CONFIG.maxContentLength);
    expect(cfg.autoIndexTools).toEqual(DEFAULT_CONFIG.autoIndexTools);
  });

  test("resolveConfig overrides baseUrl", async () => {
    const { resolveConfig } = await import("./config.js");
    const cfg = resolveConfig({ baseUrl: "http://mentat:9999" });
    expect(cfg.baseUrl).toBe("http://mentat:9999");
  });

  test("resolveConfig overrides timeoutMs", async () => {
    const { resolveConfig } = await import("./config.js");
    const cfg = resolveConfig({ timeoutMs: 5000 });
    expect(cfg.timeoutMs).toBe(5000);
  });

  test("resolveConfig ignores invalid timeoutMs", async () => {
    const { resolveConfig, DEFAULT_CONFIG } = await import("./config.js");
    const cfg = resolveConfig({ timeoutMs: -1 });
    expect(cfg.timeoutMs).toBe(DEFAULT_CONFIG.timeoutMs);
  });

  test("resolveConfig overrides autoIndexTools", async () => {
    const { resolveConfig } = await import("./config.js");
    const cfg = resolveConfig({ autoIndexTools: ["web_fetch"] });
    expect(cfg.autoIndexTools).toEqual(["web_fetch"]);
  });

  test("configSchema.parse returns resolved config", async () => {
    const { mentatBridgeConfigSchema } = await import("./config.js");
    const cfg = mentatBridgeConfigSchema.parse({ baseUrl: "http://custom:1234" });
    expect(cfg.baseUrl).toBe("http://custom:1234");
  });

  test("configSchema.safeParse succeeds for valid input", async () => {
    const { mentatBridgeConfigSchema } = await import("./config.js");
    const result = mentatBridgeConfigSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.baseUrl).toBeDefined();
    }
  });
});

// ── Extractor Tests ─────────────────────────────────────────────────

describe("mentat-bridge extractors", () => {
  test("extractFromToolResult returns null for unknown tool", async () => {
    const { extractFromToolResult } = await import("./extractors.js");
    const result = extractFromToolResult("unknown_tool", {}, "some text");
    expect(result).toBeNull();
  });

  test("extractFromToolResult returns null for empty result", async () => {
    const { extractFromToolResult } = await import("./extractors.js");
    expect(extractFromToolResult("web_fetch", {}, null)).toBeNull();
    expect(extractFromToolResult("web_fetch", {}, "")).toBeNull();
  });

  // -- web_fetch extractor --

  test("web_fetch extractor produces correct output", async () => {
    const { extractFromToolResult } = await import("./extractors.js");
    const result = extractFromToolResult(
      "web_fetch",
      { url: "https://docs.example.com/guide/intro" },
      {
        text: "A".repeat(100),
        title: "Example Guide",
        fetchedAt: "2025-01-01T00:00:00Z",
      },
    );
    expect(result).not.toBeNull();
    expect(result!.source).toBe("web_fetch");
    expect(result!.filename).toContain("docs.example.com");
    expect(result!.metadata.url).toBe("https://docs.example.com/guide/intro");
    expect(result!.metadata.title).toBe("Example Guide");
  });

  test("web_fetch strips security wrappers", async () => {
    const { extractFromToolResult } = await import("./extractors.js");
    const wrapped =
      "<<<EXTERNAL_UNTRUSTED_CONTENT>>>\n" +
      "A".repeat(100) +
      "\n<<<END_EXTERNAL_UNTRUSTED_CONTENT>>>";
    const result = extractFromToolResult(
      "web_fetch",
      { url: "https://example.com" },
      { text: wrapped },
    );
    expect(result).not.toBeNull();
    expect(result!.content).not.toContain("EXTERNAL_UNTRUSTED_CONTENT");
    expect(result!.content.length).toBeGreaterThan(50);
  });

  test("web_fetch rejects tiny content", async () => {
    const { extractFromToolResult } = await import("./extractors.js");
    const result = extractFromToolResult(
      "web_fetch",
      { url: "https://example.com" },
      { text: "tiny" },
    );
    expect(result).toBeNull();
  });

  // -- browser extractor --

  test("browser extractor produces correct output", async () => {
    const { extractFromToolResult } = await import("./extractors.js");
    const result = extractFromToolResult(
      "browser",
      {},
      { url: "https://app.example.com/dashboard", text: "B".repeat(100) },
    );
    expect(result).not.toBeNull();
    expect(result!.source).toBe("browser");
    expect(result!.filename).toContain("app.example.com");
  });

  // -- read extractor --

  test("read extractor produces correct output for large files", async () => {
    const { extractFromToolResult } = await import("./extractors.js");
    const result = extractFromToolResult(
      "read",
      { file_path: "/home/user/project/README.md" },
      "C".repeat(600),
    );
    expect(result).not.toBeNull();
    expect(result!.source).toBe("read");
    expect(result!.filename).toBe("file:README.md");
    expect(result!.metadata.path).toBe("/home/user/project/README.md");
  });

  test("read extractor skips small files", async () => {
    const { extractFromToolResult } = await import("./extractors.js");
    const result = extractFromToolResult("read", { file_path: "/home/user/tiny.txt" }, "small");
    expect(result).toBeNull();
  });

  test("read extractor skips binary content", async () => {
    const { extractFromToolResult } = await import("./extractors.js");
    const result = extractFromToolResult(
      "read",
      { file_path: "/home/user/image.png" },
      "data:image/" + "A".repeat(600),
    );
    expect(result).toBeNull();
  });

  test("read extractor accepts path param", async () => {
    const { extractFromToolResult } = await import("./extractors.js");
    const result = extractFromToolResult(
      "read",
      { path: "/home/user/docs/large-file.md" },
      "D".repeat(600),
    );
    expect(result).not.toBeNull();
    expect(result!.metadata.path).toBe("/home/user/docs/large-file.md");
  });

  // -- Composio extractor --

  test("Composio tool GMAIL_READ_EMAIL is detected", async () => {
    const { extractFromToolResult } = await import("./extractors.js");
    const result = extractFromToolResult(
      "GMAIL_READ_EMAIL",
      { subject: "Meeting Notes" },
      "E".repeat(50),
    );
    expect(result).not.toBeNull();
    expect(result!.source).toBe("composio:gmail");
    expect(result!.filename).toContain("gmail");
    expect(result!.filename).toContain("Meeting Notes");
    expect(result!.metadata.tool).toBe("GMAIL_READ_EMAIL");
    expect(result!.metadata.action).toBe("read_email");
  });

  test("Composio tool NOTION_GET_PAGE is detected", async () => {
    const { extractFromToolResult } = await import("./extractors.js");
    const result = extractFromToolResult(
      "NOTION_GET_PAGE",
      { title: "Project Plan" },
      "F".repeat(50),
    );
    expect(result).not.toBeNull();
    expect(result!.source).toBe("composio:notion");
    expect(result!.filename).toContain("Project Plan");
  });

  test("Composio extractor falls back to action name", async () => {
    const { extractFromToolResult } = await import("./extractors.js");
    const result = extractFromToolResult("SLACK_SEND_MESSAGE", {}, "G".repeat(50));
    expect(result).not.toBeNull();
    expect(result!.filename).toBe("slack:send_message");
  });

  test("Composio rejects tiny content", async () => {
    const { extractFromToolResult } = await import("./extractors.js");
    const result = extractFromToolResult("GMAIL_READ_EMAIL", {}, "tiny");
    expect(result).toBeNull();
  });

  // -- extractTextFromResult --

  test("extracts text from content blocks", async () => {
    const { extractFromToolResult } = await import("./extractors.js");
    // web_fetch with content block format
    const result = extractFromToolResult(
      "web_fetch",
      { url: "https://example.com" },
      {
        content: [{ type: "text", text: "H".repeat(100) }],
      },
    );
    expect(result).not.toBeNull();
  });

  test("extracts text from JSON object", async () => {
    const { extractFromToolResult } = await import("./extractors.js");
    const result = extractFromToolResult(
      "GITHUB_GET_ISSUE",
      {},
      { title: "Bug report", body: "There is a bug in the login flow", id: 123 },
    );
    expect(result).not.toBeNull();
    expect(result!.content).toContain("Bug report");
  });
});

// ── Plugin Registration Tests ───────────────────────────────────────

describe("mentat-bridge plugin", () => {
  test("plugin has correct metadata", async () => {
    const { default: plugin } = await import("./index.js");
    expect(plugin.id).toBe("mentat-bridge");
    expect(plugin.name).toBe("Mentat Bridge");
    expect(plugin.kind).toBe("memory");
    expect(plugin.configSchema).toBeDefined();
    // oxlint-disable-next-line typescript/unbound-method
    expect(plugin.register).toBeInstanceOf(Function);
  });

  test("plugin registers tools and hooks", async () => {
    const { default: plugin } = await import("./index.js");

    // oxlint-disable-next-line typescript/no-explicit-any
    const registeredTools: any[] = [];
    // oxlint-disable-next-line typescript/no-explicit-any
    const registeredServices: any[] = [];
    // oxlint-disable-next-line typescript/no-explicit-any
    const registeredHooks: Record<string, any[]> = {};
    const logs: string[] = [];

    const mockApi = {
      pluginConfig: {},
      logger: {
        info: (msg: string) => logs.push(`[info] ${msg}`),
        warn: (msg: string) => logs.push(`[warn] ${msg}`),
      },
      // oxlint-disable-next-line typescript/no-explicit-any
      registerTool: (tool: any, opts: any) => {
        registeredTools.push({ tool, opts });
      },
      // oxlint-disable-next-line typescript/no-explicit-any
      registerService: (service: any) => {
        registeredServices.push(service);
      },
      // oxlint-disable-next-line typescript/no-explicit-any
      on: (hookName: string, handler: any, opts?: any) => {
        if (!registeredHooks[hookName]) {
          registeredHooks[hookName] = [];
        }
        registeredHooks[hookName].push({ handler, opts });
      },
    };

    // oxlint-disable-next-line typescript/no-explicit-any
    plugin.register(mockApi as any);

    // Should register 5 tools
    const toolNames = registeredTools.map((t) => t.opts?.name);
    expect(toolNames).toContain("search_memory");
    expect(toolNames).toContain("read_segment");
    expect(toolNames).toContain("get_summary");
    expect(toolNames).toContain("index_memory");
    expect(toolNames).toContain("memory_status");
    expect(registeredTools.length).toBe(5);

    // Should register hooks
    expect(registeredHooks["after_tool_call"]).toBeDefined();
    expect(registeredHooks["after_tool_call"].length).toBe(1);
    expect(registeredHooks["before_prompt_build"]).toBeDefined();
    expect(registeredHooks["before_prompt_build"].length).toBe(1);

    // Should register a service
    expect(registeredServices.length).toBe(1);
    expect(registeredServices[0].id).toBe("mentat-bridge");

    // Should log registration
    expect(logs.some((l) => l.includes("mentat-bridge: registered"))).toBe(true);
  });

  test("configSchema parses valid config", async () => {
    const { default: plugin } = await import("./index.js");
    const result = plugin.configSchema.safeParse({
      baseUrl: "http://custom:8000",
      timeoutMs: 5000,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.baseUrl).toBe("http://custom:8000");
      expect(result.data.timeoutMs).toBe(5000);
    }
  });

  test("configSchema parses empty config with defaults", async () => {
    const { default: plugin } = await import("./index.js");
    const result = plugin.configSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.baseUrl).toBe("http://127.0.0.1:7832");
    }
  });
});
