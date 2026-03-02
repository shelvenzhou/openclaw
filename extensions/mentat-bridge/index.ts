/**
 * OpenClaw Mentat Bridge Plugin
 *
 * Integrates Mentat (Agentic RAG) as the memory and content retrieval system:
 *
 * 1. **Memory tools**: search_memory, read_segment, get_summary, index_memory,
 *    memory_status — replace built-in memory_search/memory_get with Mentat's
 *    two-step retrieval protocol for token-efficient access.
 *
 * 2. **Auto-indexing**: Intercepts tool results (web_fetch, browser, read,
 *    Composio tools) via the after_tool_call hook and indexes content into
 *    Mentat in the background for future recall.
 *
 * Requires a Mentat sidecar running (FastAPI on port 7832 by default).
 */

import { Type } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { resolveConfig, mentatBridgeConfigSchema } from "./config.js";
import { extractFromToolResult } from "./extractors.js";
import { MentatClient } from "./mentat-client.js";

const mentatBridgePlugin = {
  id: "mentat-bridge",
  name: "Mentat Bridge",
  description: "Token-efficient memory & auto-indexing via Mentat RAG sidecar",
  kind: "memory" as const,
  configSchema: mentatBridgeConfigSchema,

  register(api: OpenClawPluginApi) {
    const cfg = resolveConfig(api.pluginConfig);
    const client = new MentatClient({
      baseUrl: cfg.baseUrl,
      timeoutMs: cfg.timeoutMs,
      logger: api.logger,
    });

    api.logger.info(`mentat-bridge: registered (sidecar: ${cfg.baseUrl})`);

    // ========================================================================
    // Memory Tools (replace built-in memory_search / memory_get)
    // ========================================================================

    // --- search_memory: Two-step protocol step 1 ---
    api.registerTool(
      {
        name: "search_memory",
        label: "Search Memory",
        description:
          "Search indexed documents, memory files, and previously accessed content. " +
          "Use toc_only=true for discovery (step 1: returns summaries + section names). " +
          "Use toc_only=false to get full chunk content. " +
          "Use source to filter by origin (e.g. 'composio:gmail', 'web_fetch', 'browser').",
        parameters: Type.Object({
          query: Type.String({ description: "Natural language search query" }),
          top_k: Type.Optional(Type.Number({ description: "Maximum results (default: 5)" })),
          toc_only: Type.Optional(
            Type.Boolean({
              description:
                "If true, return document summaries + matched sections (step 1). " +
                "If false, return full chunk content.",
            }),
          ),
          source: Type.Optional(
            Type.String({
              description:
                "Filter by content source: 'web_fetch', 'browser', 'read', " +
                "'composio:gmail', 'composio:notion', 'composio:*' (all Composio), etc.",
            }),
          ),
          collection: Type.Optional(
            Type.String({ description: "Optional collection name to scope search" }),
          ),
        }),
        async execute(_toolCallId, params) {
          const {
            query,
            top_k = 5,
            toc_only = true,
            source,
            collection,
          } = params as {
            query: string;
            top_k?: number;
            toc_only?: boolean;
            source?: string;
            collection?: string;
          };

          try {
            const results = await client.search({
              query,
              top_k,
              toc_only,
              source: source || undefined,
              collection: collection || undefined,
            });

            api.logger.info(
              `mentat-bridge: search_memory query=${JSON.stringify(query)} ` +
                `toc_only=${toc_only} source=${source || "*"} → ${results.length} result(s)` +
                (results.length > 0
                  ? ` [${results.map((r) => `${r.doc_id}:${r.filename}(${r.score?.toFixed(3)})`).join(", ")}]`
                  : ""),
            );

            if (results.length === 0) {
              return {
                content: [{ type: "text", text: "No results found." }],
                details: { count: 0 },
              };
            }

            // Format results for the agent
            const lines = results.map((r, i) => {
              if (toc_only) {
                const sections = r.section ? ` | Sections: ${r.section}` : "";
                const src = r.source ? ` [${r.source}]` : "";
                const meta = r.metadata as Record<string, unknown> | undefined;
                const origPath = meta?.path ? ` (${meta.path})` : "";
                // Show concise ToC if available (up to 8 entries)
                let tocHint = "";
                if (r.toc_entries && r.toc_entries.length > 0) {
                  const tocLines = r.toc_entries.slice(0, 8).map((e) => {
                    const indent = "  ".repeat(Math.max(0, ((e.level as number) || 1) - 1));
                    return `${indent}· ${e.title}`;
                  });
                  const more =
                    r.toc_entries.length > 8 ? `\n     ... +${r.toc_entries.length - 8} more` : "";
                  tocHint = `\n   ToC:\n     ${tocLines.join("\n     ")}${more}`;
                }
                return (
                  `${i + 1}. **${r.filename}**${src}${origPath} (doc_id: ${r.doc_id})\n` +
                  `   ${r.brief_intro}${sections}${tocHint}`
                );
              }
              const src = r.source ? ` [${r.source}]` : "";
              return (
                `${i + 1}. **${r.filename}**${src} §${r.section || "(root)"} ` +
                `(doc_id: ${r.doc_id})\n` +
                `${r.summary || r.content.slice(0, 300)}`
              );
            });

            return {
              content: [
                {
                  type: "text",
                  text:
                    `Found ${results.length} result(s):\n\n${lines.join("\n\n")}` +
                    (toc_only
                      ? "\n\nUse read_segment(doc_id, section_path) to read specific sections."
                      : ""),
                },
              ],
              details: {
                count: results.length,
                results: results.map((r) => ({
                  doc_id: r.doc_id,
                  filename: r.filename,
                  section: r.section,
                  source: r.source,
                  score: r.score,
                  brief_intro: r.brief_intro,
                })),
              },
            };
          } catch (err) {
            api.logger.warn(
              `mentat-bridge: search_memory FAILED query=${JSON.stringify(query)}: ${err instanceof Error ? err.message : String(err)}`,
            );
            return {
              content: [
                {
                  type: "text",
                  text: `Memory search failed: ${err instanceof Error ? err.message : String(err)}`,
                },
              ],
              details: { error: String(err) },
            };
          }
        },
      },
      { name: "search_memory" },
    );

    // --- read_segment: Two-step protocol step 2 ---
    api.registerTool(
      {
        name: "read_segment",
        label: "Read Segment",
        description:
          "Read a specific section from an indexed document (step 2 of two-step protocol). " +
          "Use doc_id and section name from search_memory results.",
        parameters: Type.Object({
          doc_id: Type.String({ description: "Document ID from search results" }),
          section_path: Type.String({
            description: "Section name to read (case-insensitive match)",
          }),
          include_summary: Type.Optional(
            Type.Boolean({ description: "Include chunk summaries (default: true)" }),
          ),
        }),
        async execute(_toolCallId, params) {
          const {
            doc_id,
            section_path,
            include_summary = true,
          } = params as {
            doc_id: string;
            section_path: string;
            include_summary?: boolean;
          };

          try {
            const result = await client.readSegment({
              doc_id,
              section_path,
              include_summary,
            });

            api.logger.info(
              `mentat-bridge: read_segment doc_id=${doc_id} section="${section_path}" → ` +
                `${result.chunks?.length ?? 0} chunks, ~${result.token_estimate ?? "?"} tokens` +
                (result.note ? ` (note: ${result.note})` : ""),
            );

            if (!result.chunks || result.chunks.length === 0) {
              return {
                content: [
                  {
                    type: "text",
                    text:
                      result.note ||
                      `No chunks found for section "${section_path}" in ${result.filename}. ` +
                        "Use search_memory(toc_only=true) to discover available sections.",
                  },
                ],
                details: result,
              };
            }

            const chunkTexts = result.chunks.map((c) => {
              const header = c.section ? `### ${c.section}` : "";
              const summary = include_summary && c.summary ? `> Summary: ${c.summary}\n` : "";
              return `${header}\n${summary}${c.content}`;
            });

            return {
              content: [
                {
                  type: "text",
                  text:
                    `**${result.filename}** — §${section_path}\n\n` +
                    chunkTexts.join("\n\n---\n\n") +
                    `\n\n(${result.token_estimate} tokens)`,
                },
              ],
              details: {
                doc_id: result.doc_id,
                filename: result.filename,
                chunks: result.chunks.length,
                token_estimate: result.token_estimate,
              },
            };
          } catch (err) {
            api.logger.warn(
              `mentat-bridge: read_segment FAILED doc_id=${doc_id} section="${section_path}": ${err instanceof Error ? err.message : String(err)}`,
            );
            return {
              content: [
                {
                  type: "text",
                  text: `Read segment failed: ${err instanceof Error ? err.message : String(err)}`,
                },
              ],
              details: { error: String(err) },
            };
          }
        },
      },
      { name: "read_segment" },
    );

    // --- get_summary: Full document overview ---
    api.registerTool(
      {
        name: "get_summary",
        label: "Get Summary",
        description:
          "Get the full structured overview of an indexed document " +
          "(ToC, brief intro, instructions, processing status).",
        parameters: Type.Object({
          doc_id: Type.String({ description: "Document ID to inspect" }),
        }),
        async execute(_toolCallId, params) {
          const { doc_id } = params as { doc_id: string };

          try {
            const info = await client.getSummary(doc_id);
            if (!info) {
              return {
                content: [{ type: "text", text: `Document not found: ${doc_id}` }],
                details: { error: "not_found" },
              };
            }

            const filename = (info.filename as string) || "unknown";
            const intro = (info.brief_intro as string) || "";
            const instruction = (info.instruction as string) || "";
            const source = (info.source as string) || "";
            const sourceTag = source ? ` [${source}]` : "";
            const metadata = (info.metadata as Record<string, unknown>) || {};
            const origPath = metadata.path ? ` (${metadata.path})` : "";

            // Extract ToC from probe data for a useful overview
            const probe = (info.probe as Record<string, unknown>) || {};
            const structure = (probe.structure as Record<string, unknown>) || {};
            const toc = (structure.toc as Array<Record<string, unknown>>) || [];

            let tocText = "";
            if (toc.length > 0) {
              const tocLines = toc.map((entry) => {
                const level = (entry.level as number) || 1;
                const title = (entry.title as string) || "";
                const preview = entry.preview ? ` — ${entry.preview}` : "";
                const annotation = entry.annotation ? ` (${entry.annotation})` : "";
                const indent = "  ".repeat(level - 1);
                return `${indent}- ${title}${annotation}${preview}`;
              });
              tocText = `\n\nTable of Contents:\n${tocLines.join("\n")}`;
            }

            // Extract processing status
            const status = info.chunk_summaries
              ? `\n\nStatus: completed (${(info.chunk_summaries as unknown[]).length} chunks indexed)`
              : "";

            return {
              content: [
                {
                  type: "text",
                  text: `**${filename}**${sourceTag}${origPath}\n\n${intro}${tocText}${status}\n\n${instruction}`,
                },
              ],
              details: info,
            };
          } catch (err) {
            return {
              content: [
                {
                  type: "text",
                  text: `Get summary failed: ${err instanceof Error ? err.message : String(err)}`,
                },
              ],
              details: { error: String(err) },
            };
          }
        },
      },
      { name: "get_summary" },
    );

    // --- index_memory: Manually index a file ---
    api.registerTool(
      {
        name: "index_memory",
        label: "Index Memory",
        description:
          "Index a file into the memory system for future retrieval. " +
          "Returns immediately; processing happens in the background.",
        parameters: Type.Object({
          path: Type.String({ description: "File path to index" }),
          source: Type.Optional(
            Type.String({ description: "Origin tag (e.g. 'upload', 'workspace')" }),
          ),
        }),
        async execute(_toolCallId, params) {
          const { path, source = "manual" } = params as {
            path: string;
            source?: string;
          };

          try {
            const docId = await client.indexFile({ path, source });
            if (!docId) {
              return {
                content: [{ type: "text", text: `Failed to index: ${path}` }],
                details: { error: "index_failed" },
              };
            }
            return {
              content: [
                {
                  type: "text",
                  text: `Indexed: ${path} → ${docId} (processing in background)`,
                },
              ],
              details: { doc_id: docId, path },
            };
          } catch (err) {
            return {
              content: [
                {
                  type: "text",
                  text: `Index failed: ${err instanceof Error ? err.message : String(err)}`,
                },
              ],
              details: { error: String(err) },
            };
          }
        },
      },
      { name: "index_memory" },
    );

    // --- memory_status: Check processing status ---
    api.registerTool(
      {
        name: "memory_status",
        label: "Memory Status",
        description:
          "Check the processing status of an indexed document " +
          "(pending, processing, completed, or failed).",
        parameters: Type.Object({
          doc_id: Type.String({ description: "Document ID to check" }),
        }),
        async execute(_toolCallId, params) {
          const { doc_id } = params as { doc_id: string };

          try {
            const status = await client.getStatus(doc_id);
            if (!status) {
              return {
                content: [{ type: "text", text: `Document not found: ${doc_id}` }],
                details: { error: "not_found" },
              };
            }
            return {
              content: [
                {
                  type: "text",
                  text: `Status for ${doc_id}: ${status.status ?? "unknown"}`,
                },
              ],
              details: status,
            };
          } catch (err) {
            return {
              content: [
                {
                  type: "text",
                  text: `Status check failed: ${err instanceof Error ? err.message : String(err)}`,
                },
              ],
              details: { error: String(err) },
            };
          }
        },
      },
      { name: "memory_status" },
    );

    // ========================================================================
    // Auto-Indexing Hook: intercept tool results and index into Mentat
    // ========================================================================

    api.on(
      "after_tool_call",
      async (event) => {
        // Skip if no result or errored
        if (!event.result || event.error) return;

        // Skip tools we don't care about
        if (!shouldAutoIndex(event.toolName, cfg.autoIndexTools)) return;

        const extracted = extractFromToolResult(event.toolName, event.params ?? {}, event.result);
        if (!extracted) return;

        // Apply length filters
        if (extracted.content.length < cfg.minContentLength) return;
        if (extracted.content.length > cfg.maxContentLength) {
          extracted.content = extracted.content.slice(0, cfg.maxContentLength);
        }

        // Fire-and-forget: index in background, don't block the agent
        client
          .indexContent({
            content: extracted.content,
            filename: extracted.filename,
            source: extracted.source,
            metadata: extracted.metadata,
          })
          .then((docId) => {
            if (docId) {
              api.logger.info(
                `mentat-bridge: auto-indexed ${extracted.source}:${extracted.filename} → ${docId}`,
              );
            }
          })
          .catch(() => {
            // Already logged inside client
          });
      },
      { priority: 50 },
    );

    // ========================================================================
    // System prompt injection: teach the agent about Mentat
    // ========================================================================

    api.on("before_prompt_build", async () => {
      return {
        prependContext: MENTAT_SYSTEM_PROMPT,
      };
    });

    // ========================================================================
    // Service lifecycle
    // ========================================================================

    api.registerService({
      id: "mentat-bridge",
      async start() {
        const healthy = await client.isHealthy();
        if (healthy) {
          api.logger.info("mentat-bridge: sidecar is healthy");
        } else {
          api.logger.warn(
            `mentat-bridge: sidecar not reachable at ${cfg.baseUrl} — tools will fail until it starts`,
          );
        }
      },
      stop() {
        api.logger.info("mentat-bridge: stopped");
      },
    });
  },
};

// ============================================================================
// Helpers
// ============================================================================

function shouldAutoIndex(toolName: string, patterns: string[]): boolean {
  for (const pattern of patterns) {
    if (pattern.endsWith("*")) {
      const prefix = pattern.slice(0, -1);
      if (toolName.startsWith(prefix)) return true;
    } else if (pattern === toolName) {
      return true;
    }
  }
  // Also auto-index Composio tools (SCREAMING_SNAKE_CASE with app prefix)
  if (/^[A-Z][A-Z0-9_]+$/.test(toolName) && toolName.includes("_")) {
    return true;
  }
  return false;
}

const MENTAT_SYSTEM_PROMPT = `## Memory System (Mentat)

You have access to a structured memory system that indexes documents, web pages,
uploaded files, and external service content (Gmail, Notion, GitHub, etc.).

### Two-Step Retrieval Protocol
1. **Discover**: \`search_memory(query, toc_only=true)\` → returns document summaries
   and matched section names (cheap, ~200 tokens)
2. **Read**: \`read_segment(doc_id, section_path)\` → returns specific section content
   (targeted, only what you need)

### Source Filtering
Use the \`source\` parameter to scope searches:
- \`"web_fetch"\` — previously fetched web pages
- \`"browser"\` — pages visited via browser automation
- \`"read"\` — workspace files read during sessions
- \`"composio:gmail"\` — emails from Gmail
- \`"composio:notion"\` — Notion pages
- \`"composio:*"\` — all Composio sources
- Omit to search everything

### Guidelines
- Always search before reading — do not guess section names
- Prefer toc_only=true for discovery to minimize token usage
- Content from web_fetch, browser, and Composio tools is automatically indexed
- Use \`index_memory\` to manually index important files
- Previously accessed content persists across sessions`;

export default mentatBridgePlugin;
