/**
 * HTTP client for the Mentat sidecar (FastAPI).
 *
 * All methods are fire-and-forget safe — errors are caught and logged,
 * never thrown into the agent hot path.
 */

export type MentatIndexContentRequest = {
  content: string;
  filename: string;
  source?: string;
  metadata?: Record<string, unknown>;
  content_type?: string;
  wait?: boolean;
};

export type MentatIndexFileRequest = {
  path: string;
  source?: string;
  metadata?: Record<string, unknown>;
  wait?: boolean;
};

export type MentatSearchRequest = {
  query: string;
  top_k?: number;
  toc_only?: boolean;
  source?: string;
  collection?: string;
  hybrid?: boolean;
};

export type MentatReadSegmentRequest = {
  doc_id: string;
  section_path: string;
  include_summary?: boolean;
};

export type MentatSearchResult = {
  doc_id: string;
  chunk_id: string;
  filename: string;
  section?: string;
  content: string;
  summary: string;
  brief_intro: string;
  instructions: string;
  score: number;
  toc_entries: Array<Record<string, unknown>>;
  source: string;
  metadata: Record<string, unknown>;
};

export type MentatReadSegmentResult = {
  doc_id: string;
  filename: string;
  section_path: string;
  chunks: Array<{
    chunk_index: number;
    section: string;
    content: string;
    summary?: string;
  }>;
  toc_context: Array<Record<string, unknown>>;
  token_estimate: number;
  note?: string;
};

export class MentatClient {
  private baseUrl: string;
  private timeoutMs: number;
  private logger: { info: (msg: string) => void; warn: (msg: string) => void };

  constructor(options: {
    baseUrl: string;
    timeoutMs: number;
    logger: { info: (msg: string) => void; warn: (msg: string) => void };
  }) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs;
    this.logger = options.logger;
  }

  // ---------------------------------------------------------------------------
  // Health
  // ---------------------------------------------------------------------------

  async isHealthy(): Promise<boolean> {
    try {
      const res = await this.fetch("/health", { method: "GET" });
      return res.ok;
    } catch {
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Indexing
  // ---------------------------------------------------------------------------

  /**
   * Index raw text content. Fire-and-forget — does not block on processing.
   * Returns doc_id on success, null on failure.
   */
  async indexContent(req: MentatIndexContentRequest): Promise<string | null> {
    try {
      const res = await this.fetch("/index-content", {
        method: "POST",
        body: JSON.stringify({
          content: req.content,
          filename: req.filename,
          source: req.source ?? "",
          metadata: req.metadata ?? {},
          content_type: req.content_type ?? "text/plain",
          wait: req.wait ?? false,
        }),
      });
      if (!res.ok) {
        this.logger.warn(
          `mentat-bridge: indexContent failed (${res.status}): ${await res.text().catch(() => "")}`,
        );
        return null;
      }
      const data = (await res.json()) as { doc_id?: string };
      return data.doc_id ?? null;
    } catch (err) {
      this.logger.warn(`mentat-bridge: indexContent error: ${String(err)}`);
      return null;
    }
  }

  /**
   * Index a file by path on the Mentat server's filesystem.
   */
  async indexFile(req: MentatIndexFileRequest): Promise<string | null> {
    try {
      const res = await this.fetch("/index", {
        method: "POST",
        body: JSON.stringify({
          path: req.path,
          source: req.source ?? "",
          metadata: req.metadata ?? {},
          wait: req.wait ?? false,
        }),
      });
      if (!res.ok) {
        this.logger.warn(
          `mentat-bridge: indexFile failed (${res.status}): ${await res.text().catch(() => "")}`,
        );
        return null;
      }
      const data = (await res.json()) as { doc_id?: string };
      return data.doc_id ?? null;
    } catch (err) {
      this.logger.warn(`mentat-bridge: indexFile error: ${String(err)}`);
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Search & Read
  // ---------------------------------------------------------------------------

  async search(req: MentatSearchRequest): Promise<MentatSearchResult[]> {
    const res = await this.fetch("/search", {
      method: "POST",
      body: JSON.stringify({
        query: req.query,
        top_k: req.top_k ?? 5,
        toc_only: req.toc_only ?? false,
        source: req.source ?? null,
        collection: req.collection ?? null,
        hybrid: req.hybrid ?? false,
      }),
    });
    if (!res.ok) {
      throw new Error(`mentat search failed (${res.status})`);
    }
    const data = (await res.json()) as { results: MentatSearchResult[] };
    return data.results;
  }

  async readSegment(req: MentatReadSegmentRequest): Promise<MentatReadSegmentResult> {
    const res = await this.fetch("/read-segment", {
      method: "POST",
      body: JSON.stringify({
        doc_id: req.doc_id,
        section_path: req.section_path,
        include_summary: req.include_summary ?? true,
      }),
    });
    if (!res.ok) {
      throw new Error(`mentat read-segment failed (${res.status})`);
    }
    return (await res.json()) as MentatReadSegmentResult;
  }

  async getSummary(docId: string): Promise<Record<string, unknown> | null> {
    try {
      const res = await this.fetch(`/inspect/${encodeURIComponent(docId)}`, { method: "GET" });
      if (!res.ok) return null;
      return (await res.json()) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  async getStatus(docId: string): Promise<Record<string, unknown> | null> {
    try {
      const res = await this.fetch(`/status/${encodeURIComponent(docId)}`, { method: "GET" });
      if (!res.ok) return null;
      return (await res.json()) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  private async fetch(path: string, init: RequestInit): Promise<Response> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await globalThis.fetch(url, {
        ...init,
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          ...((init.headers as Record<string, string>) ?? {}),
        },
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}
