/**
 * Studio API Client
 *
 * HTTP client for Studio API communication
 */

import type { Manifest } from '../../types.js';

export interface ApiOptions {
  apiUrl: string;
  serviceKey: string;
  tenantId: string;
}

export interface Prompt {
  promptName: string;
  category: string;
  description: string;
  enabled: boolean;
  systemMessage: string;
  userMessage: string;
  variables: any[];
  toolDefs: any[];
  scenarios: any[];
  models: any[];
  modelSampling: boolean;
  multiStep: boolean;
  metadata: Record<string, any>;
  etag: string;
  publishedEtag: string | null;
  publishedVersion: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PromptListItem {
  promptName: string;
  category: string;
  description: string;
  enabled: boolean;
  updatedAt: string;
}

export interface ListPromptsResponse {
  data: PromptListItem[];
  page: number;
  per_page: number;
  has_more: boolean;
}

export interface ExportResponse {
  data: {
    manifest: Manifest;
    etag: string;
    exportedAt: string;
  };
}

export interface Block {
  blockName: string;
  content?: string;
  description: string;
  usedByPrompts: string[];
  createdAt: string;
  updatedAt: string;
}

export interface BlocksResponse {
  data: Block[];
  page: number;
  per_page: number;
  has_more: boolean;
}

export interface CreateBlockRequest {
  blockName: string;
  content: string;
  description: string;
}

export interface UpdateBlockRequest {
  content?: string;
  description?: string;
}

export interface SystemModel {
  modelId: string;
  provider: string;
  displayName: string;
  description?: string;
  pricing: {
    inputTokensPer1M: number;
    outputTokensPer1M: number;
    currency: string;
  };
  capabilities: string[];
  contextWindow: number;
  enabled: boolean;
}

export interface SystemModelsResponse {
  models: SystemModel[];
  has_more: boolean;
}

export interface TenantModel {
  provider: string;
  name: string;
  displayName: string;
  pricing: {
    inputTokensPer1M: number;
    outputTokensPer1M: number;
    currency: string;
  };
  capabilities: string[];
  contextWindow: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TenantModelsResponse {
  data: TenantModel[];
  page: number;
  per_page: number;
  has_more: boolean;
}

export interface Trace {
  traceId: string;
  tenantId: string;
  promptName?: string;
  model: string;
  provider: string;
  status: string;
  startTime: string;
  endTime?: string;
  duration?: number;
  totalTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  cost?: number;
  metadata?: Record<string, any>;
  spans?: any[];
  error?: any;
}

export interface TracesResponse {
  data: Trace[];
  page: number;
  per_page: number;
  has_more: boolean;
}

export interface CreatePromptRequest {
  promptName: string;
  category?: string;
  description?: string;
  systemMessage?: string;
  userMessage?: string;
  variables?: any[];
  toolDefs?: any[];
  models?: any[];
}

export interface UpdatePromptRequest {
  category?: string;
  description?: string;
  systemMessage?: string;
  userMessage?: string;
  variables?: any[];
  toolDefs?: any[];
  models?: any[];
}

/**
 * Studio API Client
 */
export class StudioApiClient {
  private apiUrl: string;
  private serviceKey: string;
  private tenantId: string;

  constructor(options: ApiOptions) {
    this.apiUrl = options.apiUrl.replace(/\/$/, ''); // Remove trailing slash
    this.serviceKey = options.serviceKey;
    this.tenantId = options.tenantId;
  }

  /**
   * Make authenticated API request
   */
  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.apiUrl}${path}`;

    const response = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Bearer ${this.serviceKey}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`API Error (${response.status}): ${error}`);
    }

    return response.json() as Promise<T>;
  }

  /**
   * List all prompts for tenant
   */
  async listPrompts(filters?: { multiStep?: boolean; enabled?: boolean; page?: number }): Promise<ListPromptsResponse> {
    const params = new URLSearchParams();
    if (filters?.multiStep !== undefined) params.append('multiStep', String(filters.multiStep));
    if (filters?.enabled !== undefined) params.append('enabled', String(filters.enabled));
    if (filters?.page !== undefined) params.append('page', String(filters.page));
    const query = params.toString() ? `?${params.toString()}` : '';

    return this.request<ListPromptsResponse>(
      `/tenants/${this.tenantId}/prompts${query}`
    );
  }

  /**
   * List all prompts (fetches all pages)
   */
  async listAllPrompts(filters?: { multiStep?: boolean; enabled?: boolean }): Promise<PromptListItem[]> {
    const allPrompts: PromptListItem[] = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const response = await this.listPrompts({ ...filters, page });
      allPrompts.push(...response.data);
      hasMore = response.has_more;
      page++;
    }

    return allPrompts;
  }

  /**
   * Get single prompt by name
   */
  async getPrompt(promptName: string): Promise<Prompt> {
    return this.request<Prompt>(
      `/tenants/${this.tenantId}/prompts/${promptName}`
    );
  }

  /**
   * Export single prompt
   * @param promptName - Name of the prompt to export
   * @param createVersion - Whether to create version snapshot (default: true)
   */
  async exportPrompt(promptName: string, createVersion: boolean = true): Promise<ExportResponse> {
    const query = createVersion ? '' : '?createVersion=false';
    return this.request<ExportResponse>(
      `/tenants/${this.tenantId}/prompts/${promptName}/export${query}`
    );
  }

  /**
   * Bulk export all prompts as a zip file
   * Returns a Buffer containing the zip file with JSON files
   */
  async exportAllPrompts(): Promise<Buffer> {
    const url = `${this.apiUrl}/tenants/${this.tenantId}/export/prompts`;

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${this.serviceKey}`,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`API Error (${response.status}): ${error}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  /**
   * Test API connection
   */
  async testConnection(): Promise<boolean> {
    try {
      await this.listPrompts();
      return true;
    } catch (error) {
      return false;
    }
  }

  // ==================== Blocks API ====================

  /**
   * List all blocks for tenant
   */
  async listBlocks(options?: { page?: number; per_page?: number; search?: string }): Promise<BlocksResponse> {
    const params = new URLSearchParams();
    if (options?.page) params.append('page', String(options.page));
    if (options?.per_page) params.append('per_page', String(options.per_page));
    if (options?.search) params.append('search', options.search);

    const query = params.toString() ? `?${params.toString()}` : '';
    return this.request<BlocksResponse>(
      `/tenants/${this.tenantId}/blocks${query}`
    );
  }

  /**
   * Get single block by name
   */
  async getBlock(blockName: string): Promise<Block> {
    return this.request<Block>(
      `/tenants/${this.tenantId}/blocks/${blockName}`
    );
  }

  /**
   * Create a new block
   */
  async createBlock(data: CreateBlockRequest): Promise<Block> {
    return this.request<Block>(
      `/tenants/${this.tenantId}/blocks`,
      {
        method: 'POST',
        body: JSON.stringify(data),
      }
    );
  }

  /**
   * Update an existing block
   */
  async updateBlock(blockName: string, data: UpdateBlockRequest): Promise<Block> {
    return this.request<Block>(
      `/tenants/${this.tenantId}/blocks/${blockName}`,
      {
        method: 'PUT',
        body: JSON.stringify(data),
      }
    );
  }

  /**
   * Delete a block
   */
  async deleteBlock(blockName: string): Promise<{ message: string }> {
    return this.request<{ message: string }>(
      `/tenants/${this.tenantId}/blocks/${blockName}`,
      {
        method: 'DELETE',
      }
    );
  }

  // ==================== Models API ====================

  /**
   * List all system models (global catalog)
   */
  async listSystemModels(options?: { provider?: string }): Promise<SystemModelsResponse> {
    const params = new URLSearchParams();
    if (options?.provider) params.append('provider', options.provider);

    const query = params.toString() ? `?${params.toString()}` : '';
    return this.request<SystemModelsResponse>(
      `/models${query}`
    );
  }

  /**
   * List tenant-enabled models
   */
  async listTenantModels(options?: { page?: number; per_page?: number }): Promise<TenantModelsResponse> {
    const params = new URLSearchParams();
    if (options?.page) params.append('page', String(options.page));
    if (options?.per_page) params.append('per_page', String(options.per_page));

    const query = params.toString() ? `?${params.toString()}` : '';
    return this.request<TenantModelsResponse>(
      `/tenants/${this.tenantId}/models${query}`
    );
  }

  // ==================== Traces API ====================

  /**
   * List all traces for tenant
   */
  async listTraces(options?: { page?: number; per_page?: number; search?: string }): Promise<TracesResponse> {
    const params = new URLSearchParams();
    if (options?.page) params.append('page', String(options.page));
    if (options?.per_page) params.append('per_page', String(options.per_page));
    if (options?.search) params.append('search', options.search);

    const query = params.toString() ? `?${params.toString()}` : '';
    return this.request<TracesResponse>(
      `/tenants/${this.tenantId}/traces${query}`
    );
  }

  /**
   * Get single trace by ID
   */
  async getTrace(traceId: string): Promise<Trace> {
    return this.request<Trace>(
      `/tenants/${this.tenantId}/traces/${traceId}`
    );
  }

  // ==================== Extended Prompts API ====================

  /**
   * Create a new prompt
   */
  async createPrompt(data: CreatePromptRequest): Promise<Prompt> {
    return this.request<Prompt>(
      `/tenants/${this.tenantId}/prompts`,
      {
        method: 'POST',
        body: JSON.stringify(data),
      }
    );
  }

  /**
   * Update an existing prompt
   */
  async updatePrompt(promptName: string, data: UpdatePromptRequest): Promise<Prompt> {
    return this.request<Prompt>(
      `/tenants/${this.tenantId}/prompts/${promptName}`,
      {
        method: 'PUT',
        body: JSON.stringify(data),
      }
    );
  }

  /**
   * Delete a prompt
   */
  async deletePrompt(promptName: string): Promise<{ message: string }> {
    return this.request<{ message: string }>(
      `/tenants/${this.tenantId}/prompts/${promptName}`,
      {
        method: 'DELETE',
      }
    );
  }
}

/**
 * Create API client from config
 */
export function createApiClient(options: ApiOptions): StudioApiClient {
  return new StudioApiClient(options);
}
