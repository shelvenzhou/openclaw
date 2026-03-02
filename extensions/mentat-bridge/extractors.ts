/**
 * Content extractors for different tool types.
 *
 * Each extractor knows how to pull indexable text from a specific tool's
 * result payload and produce a Mentat-friendly {content, filename, source, metadata}.
 */

// Matches <<<EXTERNAL_UNTRUSTED_CONTENT>>> ... <<<END_EXTERNAL_UNTRUSTED_CONTENT>>>
const EXTERNAL_CONTENT_RE = /<<<EXTERNAL_UNTRUSTED_CONTENT>>>\s*(?:Source:\s*\w+\s*---\s*)?/g;
const EXTERNAL_CONTENT_END_RE = /<<<END_EXTERNAL_UNTRUSTED_CONTENT>>>/g;

function stripSecurityWrappers(text: string): string {
  return text.replace(EXTERNAL_CONTENT_RE, "").replace(EXTERNAL_CONTENT_END_RE, "").trim();
}

export type ExtractedContent = {
  content: string;
  filename: string;
  source: string;
  metadata: Record<string, unknown>;
};

/**
 * Extract indexable content from a tool result.
 * Returns null if the result doesn't contain useful content to index.
 */
export function extractFromToolResult(
  toolName: string,
  params: Record<string, unknown>,
  result: unknown,
): ExtractedContent | null {
  // Normalize result — may be a string, an object, or a tool result with content blocks
  const text = extractTextFromResult(result);
  if (!text) return null;

  // Route to tool-specific extractor
  if (toolName === "web_fetch") {
    return extractWebFetch(params, result, text);
  }
  if (toolName === "browser") {
    return extractBrowser(params, result, text);
  }
  if (toolName === "read") {
    return extractFileRead(params, text);
  }

  // Composio tools: any tool from MCP/Composio — detect by naming convention
  // Composio tool names typically contain the app name (e.g. GMAIL_READ_EMAIL)
  if (looksLikeComposioTool(toolName)) {
    return extractComposio(toolName, params, text);
  }

  return null;
}

// ---------------------------------------------------------------------------
// Tool-specific extractors
// ---------------------------------------------------------------------------

function extractWebFetch(
  params: Record<string, unknown>,
  rawResult: unknown,
  text: string,
): ExtractedContent | null {
  const url = (params.url as string) || "";
  const resultObj =
    rawResult && typeof rawResult === "object" ? (rawResult as Record<string, unknown>) : {};

  // The text field from web_fetch contains the extracted markdown/text
  const fetchedText =
    typeof resultObj.text === "string"
      ? stripSecurityWrappers(resultObj.text)
      : stripSecurityWrappers(text);

  if (!fetchedText || fetchedText.length < 50) return null;

  let hostname = "";
  try {
    hostname = new URL(url).hostname;
  } catch {
    // ignore
  }

  return {
    content: fetchedText,
    filename: `web:${hostname}${shortenPath(url)}`,
    source: "web_fetch",
    metadata: {
      url,
      title: resultObj.title ?? undefined,
      contentType: resultObj.contentType ?? undefined,
      fetchedAt: resultObj.fetchedAt ?? new Date().toISOString(),
    },
  };
}

function extractBrowser(
  params: Record<string, unknown>,
  rawResult: unknown,
  text: string,
): ExtractedContent | null {
  const stripped = stripSecurityWrappers(text);
  if (!stripped || stripped.length < 50) return null;

  const resultObj =
    rawResult && typeof rawResult === "object" ? (rawResult as Record<string, unknown>) : {};
  const url = (resultObj.url as string) || (params.url as string) || "";

  let hostname = "";
  try {
    hostname = new URL(url).hostname;
  } catch {
    // ignore
  }

  return {
    content: stripped,
    filename: `browser:${hostname}${shortenPath(url)}`,
    source: "browser",
    metadata: {
      url,
      format: resultObj.format ?? "ai",
    },
  };
}

function extractFileRead(params: Record<string, unknown>, text: string): ExtractedContent | null {
  const filePath = (params.path as string) || (params.file_path as string) || "";
  if (!filePath) return null;

  // Only index larger files — small reads aren't worth indexing
  if (text.length < 500) return null;

  // Skip binary content indicators
  if (text.includes("\0") || text.startsWith("data:image/")) return null;

  const basename = filePath.split("/").pop() || filePath;

  return {
    content: text,
    filename: `file:${basename}`,
    source: "read",
    metadata: {
      path: filePath,
    },
  };
}

function extractComposio(
  toolName: string,
  params: Record<string, unknown>,
  text: string,
): ExtractedContent | null {
  if (!text || text.length < 20) return null;

  // Parse Composio tool name: e.g. GMAIL_READ_EMAIL → app=gmail, action=read_email
  const parts = toolName.split("_");
  const app = (parts[0] || "composio").toLowerCase();
  const action = parts.slice(1).join("_").toLowerCase();

  // Try to extract a reasonable filename from the params or result
  const subject =
    (params.subject as string) || (params.title as string) || (params.name as string) || "";
  const filenameHint = subject ? `${app}:${subject.slice(0, 80)}` : `${app}:${action}`;

  return {
    content: text,
    filename: filenameHint,
    source: `composio:${app}`,
    metadata: {
      tool: toolName,
      action,
      ...pickDefined(params, [
        "subject",
        "title",
        "name",
        "email",
        "page_id",
        "repo",
        "issue_number",
      ]),
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Detect if a tool name looks like it came from Composio (MCP tool router).
 * Composio tools are typically SCREAMING_SNAKE_CASE with app prefix.
 */
function looksLikeComposioTool(name: string): boolean {
  // Composio tools: all uppercase with underscores (e.g. GMAIL_READ_EMAIL, NOTION_GET_PAGE)
  if (/^[A-Z][A-Z0-9_]+$/.test(name) && name.includes("_")) {
    return true;
  }
  // Also match lowercase composio-prefixed tools
  if (name.startsWith("composio_") || name.startsWith("COMPOSIO_")) {
    return true;
  }
  return false;
}

/**
 * Extract plain text from a tool result, handling various formats:
 * - String directly
 * - { content: [{ type: "text", text: "..." }] }
 * - { text: "..." }
 * - JSON object → stringify
 */
function extractTextFromResult(result: unknown): string | null {
  if (!result) return null;

  if (typeof result === "string") {
    return result;
  }

  if (typeof result !== "object") {
    return String(result);
  }

  const obj = result as Record<string, unknown>;

  // AgentToolResult format: { content: [{ type: "text", text: "..." }] }
  if (Array.isArray(obj.content)) {
    const texts: string[] = [];
    for (const block of obj.content) {
      if (
        block &&
        typeof block === "object" &&
        (block as Record<string, unknown>).type === "text" &&
        typeof (block as Record<string, unknown>).text === "string"
      ) {
        texts.push((block as Record<string, unknown>).text as string);
      }
    }
    if (texts.length > 0) return texts.join("\n");
  }

  // Direct text field
  if (typeof obj.text === "string" && obj.text) {
    return obj.text;
  }

  // JSON result — stringify for indexing
  try {
    const json = JSON.stringify(obj, null, 2);
    if (json.length > 50) return json;
  } catch {
    // ignore
  }

  return null;
}

function shortenPath(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname;
    if (!path || path === "/") return "";
    // Keep last 2 segments
    const segments = path.split("/").filter(Boolean);
    if (segments.length <= 2) return `/${segments.join("/")}`;
    return `/.../${segments.slice(-2).join("/")}`;
  } catch {
    return "";
  }
}

function pickDefined(obj: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== null && obj[key] !== "") {
      result[key] = obj[key];
    }
  }
  return result;
}
