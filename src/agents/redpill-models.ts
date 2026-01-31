/**
 * Redpill AI GPU TEE Model Catalog
 *
 * Redpill AI provides access to AI models running in GPU-based Trusted Execution Environments (TEEs).
 * These models run inside secure hardware enclaves with cryptographic attestation, ensuring:
 * - Memory encryption and isolation
 * - Tamper-proof execution
 * - Verifiable computation
 * - Privacy-preserving inference
 *
 * Supported TEE providers:
 * - Phala Network (10 models)
 * - Tinfoil (4 models)
 * - Chutes (1 model)
 * - Near-AI (3 models)
 *
 * This catalog serves as the source of truth for available GPU TEE models.
 */

import type { ModelDefinitionConfig } from "../config/types.js";

/**
 * Redpill AI API base URL
 */
export const REDPILL_BASE_URL = "https://api.redpill.ai/v1";

/**
 * Default model for Redpill AI provider
 */
export const REDPILL_DEFAULT_MODEL = "deepseek/deepseek-v3.2";

/**
 * Default model reference (human-readable)
 */
export const REDPILL_DEFAULT_MODEL_REF = `redpill/${REDPILL_DEFAULT_MODEL}`;

/**
 * Cache for model list fetched from API
 */
let cachedModels: ModelDefinitionConfig[] | null = null;

/**
 * Timestamp of last cache update
 */
let cacheTimestamp: number | null = null;

/**
 * Cache TTL: 1 hour
 */
const CACHE_TTL_MS = 60 * 60 * 1000;

/**
 * Default cost structure (all zeros for GPU TEE models)
 */
const DEFAULT_COST = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
};

/**
 * GPU TEE model catalog entry
 */
export interface RedpillCatalogEntry {
  id: string;
  name: string;
  reasoning: boolean;
  input: ("text" | "image")[];
  contextWindow: number;
  maxTokens: number;
}

/**
 * Static catalog of verified GPU TEE models
 *
 * Sources:
 * - Phala Network: 10 models
 * - Tinfoil: 4 models
 * - Chutes: 1 model
 * - Near-AI: 3 models
 */
export const REDPILL_GPU_TEE_CATALOG: RedpillCatalogEntry[] = [
  // Phala Network (10 models)
  {
    id: "z-ai/glm-4.7-flash",
    name: "GLM 4.7 Flash (GPU TEE)",
    reasoning: false,
    input: ["text"],
    contextWindow: 203_000,
    maxTokens: 128_000,
  },
  {
    id: "qwen/qwen3-embedding-8b",
    name: "Qwen3 Embedding 8B (GPU TEE)",
    reasoning: false,
    input: ["text"],
    contextWindow: 33_000,
    maxTokens: 512,
  },
  {
    id: "phala/uncensored-24b",
    name: "Uncensored 24B (GPU TEE)",
    reasoning: false,
    input: ["text"],
    contextWindow: 33_000,
    maxTokens: 8192,
  },
  {
    id: "deepseek/deepseek-v3.2",
    name: "DeepSeek v3.2 (GPU TEE)",
    reasoning: false,
    input: ["text"],
    contextWindow: 164_000,
    maxTokens: 8192,
  },
  {
    id: "qwen/qwen3-vl-30b-a3b-instruct",
    name: "Qwen3 VL 30B (GPU TEE)",
    reasoning: false,
    input: ["text", "image"],
    contextWindow: 128_000,
    maxTokens: 8192,
  },
  {
    id: "sentence-transformers/all-minilm-l6-v2",
    name: "All-MiniLM-L6-v2 (GPU TEE)",
    reasoning: false,
    input: ["text"],
    contextWindow: 512,
    maxTokens: 512,
  },
  {
    id: "qwen/qwen-2.5-7b-instruct",
    name: "Qwen 2.5 7B Instruct (GPU TEE)",
    reasoning: false,
    input: ["text"],
    contextWindow: 33_000,
    maxTokens: 8192,
  },
  {
    id: "google/gemma-3-27b-it",
    name: "Gemma 3 27B IT (GPU TEE)",
    reasoning: false,
    input: ["text"],
    contextWindow: 54_000,
    maxTokens: 8192,
  },
  {
    id: "openai/gpt-oss-120b",
    name: "GPT OSS 120B (GPU TEE)",
    reasoning: false,
    input: ["text"],
    contextWindow: 131_000,
    maxTokens: 8192,
  },
  {
    id: "openai/gpt-oss-20b",
    name: "GPT OSS 20B (GPU TEE)",
    reasoning: false,
    input: ["text"],
    contextWindow: 131_000,
    maxTokens: 8192,
  },

  // Tinfoil (4 models)
  {
    id: "moonshotai/kimi-k2-thinking",
    name: "Kimi K2 Thinking (GPU TEE)",
    reasoning: true,
    input: ["text"],
    contextWindow: 262_000,
    maxTokens: 8192,
  },
  {
    id: "deepseek/deepseek-r1-0528",
    name: "DeepSeek R1 (GPU TEE)",
    reasoning: true,
    input: ["text"],
    contextWindow: 164_000,
    maxTokens: 8192,
  },
  {
    id: "qwen/qwen3-coder-480b-a35b-instruct",
    name: "Qwen3 Coder 480B (GPU TEE)",
    reasoning: false,
    input: ["text"],
    contextWindow: 262_000,
    maxTokens: 8192,
  },
  {
    id: "meta-llama/llama-3.3-70b-instruct",
    name: "Llama 3.3 70B Instruct (GPU TEE)",
    reasoning: false,
    input: ["text"],
    contextWindow: 131_000,
    maxTokens: 8192,
  },

  // Chutes (1 model)
  {
    id: "minimax/minimax-m2.1",
    name: "MiniMax M2.1 (GPU TEE)",
    reasoning: false,
    input: ["text"],
    contextWindow: 197_000,
    maxTokens: 8192,
  },

  // Near-AI (3 models)
  {
    id: "deepseek/deepseek-chat-v3.1",
    name: "DeepSeek Chat v3.1 (GPU TEE)",
    reasoning: false,
    input: ["text"],
    contextWindow: 164_000,
    maxTokens: 8192,
  },
  {
    id: "qwen/qwen3-30b-a3b-instruct-2507",
    name: "Qwen3 30B Instruct (GPU TEE)",
    reasoning: false,
    input: ["text"],
    contextWindow: 262_000,
    maxTokens: 8192,
  },
  {
    id: "z-ai/glm-4.6",
    name: "GLM 4.6 (GPU TEE)",
    reasoning: false,
    input: ["text"],
    contextWindow: 203_000,
    maxTokens: 128_000,
  },
];

/**
 * Convert catalog entry to model definition
 */
function catalogEntryToModelDefinition(entry: RedpillCatalogEntry): ModelDefinitionConfig {
  return {
    id: entry.id,
    name: entry.name,
    contextWindow: entry.contextWindow,
    maxTokens: entry.maxTokens,
    cost: DEFAULT_COST,
    input: entry.input,
    reasoning: entry.reasoning,
  };
}

/**
 * Discover cached model list or convert from catalog
 */
export function discoverRedpillModels(): ModelDefinitionConfig[] {
  const now = Date.now();

  // Return cached models if still valid
  if (cachedModels && cacheTimestamp && now - cacheTimestamp < CACHE_TTL_MS) {
    return cachedModels;
  }

  // Convert catalog to model definitions
  const models = REDPILL_GPU_TEE_CATALOG.map(catalogEntryToModelDefinition);

  // Update cache
  cachedModels = models;
  cacheTimestamp = now;

  return models;
}

/**
 * Reset cache (useful for testing)
 */
export function resetRedpillModelCache(): void {
  cachedModels = null;
  cacheTimestamp = null;
}
