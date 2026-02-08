/**
 * Request logger for fire-and-forget insertion of request logs.
 * Uses prepared statements for efficient batch insertion.
 */

import type Database from 'better-sqlite3';

/**
 * Request log entry data structure.
 */
export interface RequestLogEntry {
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
  errorMessage?: string;
}

/**
 * RequestLogger handles insertion of request logs into SQLite.
 * Uses prepared statements for efficient writes.
 */
export class RequestLogger {
  private insertStmt: Database.Statement;

  constructor(db: Database.Database) {
    this.insertStmt = db.prepare(`
      INSERT INTO request_logs (
        timestamp,
        chain_name,
        provider_id,
        model,
        prompt_tokens,
        completion_tokens,
        total_tokens,
        latency_ms,
        http_status,
        attempts,
        error_message
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
  }

  /**
   * Log a request entry to the database.
   * Fire-and-forget: does not return result, triggers update aggregation tables.
   */
  logRequest(entry: RequestLogEntry): void {
    this.insertStmt.run(
      entry.timestamp,
      entry.chainName,
      entry.providerId,
      entry.model,
      entry.promptTokens,
      entry.completionTokens,
      entry.totalTokens,
      Math.round(entry.latencyMs),
      entry.httpStatus,
      entry.attempts,
      entry.errorMessage ?? null
    );
  }
}
