/**
 * Usage aggregator for reading materialized usage statistics.
 * Provides O(1) reads from pre-computed aggregation tables.
 */

import type Database from 'better-sqlite3';

/**
 * Provider usage statistics (aggregated via trigger).
 */
export interface ProviderUsage {
  providerId: string;
  totalRequests: number;
  totalTokens: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  lastRequestTimestamp: number | null;
}

/**
 * Chain usage statistics (aggregated via trigger).
 */
export interface ChainUsage {
  chainName: string;
  totalRequests: number;
  totalTokens: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  lastRequestTimestamp: number | null;
}

/**
 * Raw request log row (for recent request display).
 */
export interface RequestLogRow {
  id: number;
  timestamp: number;
  chainName: string;
  providerId: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  latencyMs: number;
  httpStatus: number;
  attempts: number;
}

/**
 * UsageAggregator provides read access to aggregated usage statistics.
 * All data is pre-computed via SQLite triggers, so reads are fast O(1) lookups.
 */
export class UsageAggregator {
  private getAllProviderUsageStmt: Database.Statement;
  private getProviderUsageStmt: Database.Statement;
  private getAllChainUsageStmt: Database.Statement;
  private getChainUsageStmt: Database.Statement;
  private getRecentRequestsStmt: Database.Statement;

  constructor(db: Database.Database) {
    this.getAllProviderUsageStmt = db.prepare(`
      SELECT
        provider_id as providerId,
        total_requests as totalRequests,
        total_tokens as totalTokens,
        total_prompt_tokens as totalPromptTokens,
        total_completion_tokens as totalCompletionTokens,
        last_request_timestamp as lastRequestTimestamp
      FROM usage_by_provider
      ORDER BY last_request_timestamp DESC
    `);

    this.getProviderUsageStmt = db.prepare(`
      SELECT
        provider_id as providerId,
        total_requests as totalRequests,
        total_tokens as totalTokens,
        total_prompt_tokens as totalPromptTokens,
        total_completion_tokens as totalCompletionTokens,
        last_request_timestamp as lastRequestTimestamp
      FROM usage_by_provider
      WHERE provider_id = ?
    `);

    this.getAllChainUsageStmt = db.prepare(`
      SELECT
        chain_name as chainName,
        total_requests as totalRequests,
        total_tokens as totalTokens,
        total_prompt_tokens as totalPromptTokens,
        total_completion_tokens as totalCompletionTokens,
        last_request_timestamp as lastRequestTimestamp
      FROM usage_by_chain
      ORDER BY last_request_timestamp DESC
    `);

    this.getChainUsageStmt = db.prepare(`
      SELECT
        chain_name as chainName,
        total_requests as totalRequests,
        total_tokens as totalTokens,
        total_prompt_tokens as totalPromptTokens,
        total_completion_tokens as totalCompletionTokens,
        last_request_timestamp as lastRequestTimestamp
      FROM usage_by_chain
      WHERE chain_name = ?
    `);

    this.getRecentRequestsStmt = db.prepare(`
      SELECT
        id,
        timestamp,
        chain_name as chainName,
        provider_id as providerId,
        model,
        prompt_tokens as promptTokens,
        completion_tokens as completionTokens,
        total_tokens as totalTokens,
        latency_ms as latencyMs,
        http_status as httpStatus,
        attempts
      FROM request_logs
      ORDER BY timestamp DESC
      LIMIT ?
    `);
  }

  /**
   * Get usage statistics for all providers.
   */
  getAllProviderUsage(): ProviderUsage[] {
    return this.getAllProviderUsageStmt.all() as ProviderUsage[];
  }

  /**
   * Get usage statistics for a specific provider.
   */
  getProviderUsage(providerId: string): ProviderUsage | null {
    return (this.getProviderUsageStmt.get(providerId) as ProviderUsage | undefined) ?? null;
  }

  /**
   * Get usage statistics for all chains.
   */
  getAllChainUsage(): ChainUsage[] {
    return this.getAllChainUsageStmt.all() as ChainUsage[];
  }

  /**
   * Get usage statistics for a specific chain.
   */
  getChainUsage(chainName: string): ChainUsage | null {
    return (this.getChainUsageStmt.get(chainName) as ChainUsage | undefined) ?? null;
  }

  /**
   * Get recent request logs (useful for displaying request history).
   */
  getRecentRequests(limit: number = 50): RequestLogRow[] {
    return this.getRecentRequestsStmt.all(limit) as RequestLogRow[];
  }
}
