/**
 * Database schema migration system using PRAGMA user_version.
 * Manages schema evolution with idempotent migrations.
 */

import type Database from 'better-sqlite3';
import { logger } from '../shared/logger.js';

/**
 * Run schema migrations to bring database to current version.
 * @param db - Database instance to migrate
 */
export function migrateSchema(db: Database.Database): void {
  // Read current schema version
  const currentVersion = db.pragma('user_version', { simple: true }) as number;
  logger.info({ currentVersion }, 'Database schema version check');

  // Define migrations (version 0 -> 1, etc.)
  const migrations = [
    // Migration 1: Initial schema with request logs, materialized aggregation tables, and triggers
    () => {
      db.exec(`
        -- Request logs table (raw request data)
        CREATE TABLE IF NOT EXISTS request_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          timestamp INTEGER NOT NULL,
          chain_name TEXT NOT NULL,
          provider_id TEXT NOT NULL,
          model TEXT NOT NULL,
          prompt_tokens INTEGER NOT NULL DEFAULT 0,
          completion_tokens INTEGER NOT NULL DEFAULT 0,
          total_tokens INTEGER NOT NULL DEFAULT 0,
          latency_ms INTEGER NOT NULL,
          http_status INTEGER NOT NULL,
          attempts INTEGER NOT NULL
        );

        -- Materialized aggregation table for provider usage
        CREATE TABLE IF NOT EXISTS usage_by_provider (
          provider_id TEXT PRIMARY KEY,
          total_requests INTEGER NOT NULL DEFAULT 0,
          total_tokens INTEGER NOT NULL DEFAULT 0,
          total_prompt_tokens INTEGER NOT NULL DEFAULT 0,
          total_completion_tokens INTEGER NOT NULL DEFAULT 0,
          last_request_timestamp INTEGER
        );

        -- Materialized aggregation table for chain usage
        CREATE TABLE IF NOT EXISTS usage_by_chain (
          chain_name TEXT PRIMARY KEY,
          total_requests INTEGER NOT NULL DEFAULT 0,
          total_tokens INTEGER NOT NULL DEFAULT 0,
          total_prompt_tokens INTEGER NOT NULL DEFAULT 0,
          total_completion_tokens INTEGER NOT NULL DEFAULT 0,
          last_request_timestamp INTEGER
        );

        -- Indexes for efficient queries
        CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON request_logs(timestamp DESC);
        CREATE INDEX IF NOT EXISTS idx_logs_provider ON request_logs(provider_id, model);
        CREATE INDEX IF NOT EXISTS idx_logs_chain ON request_logs(chain_name);

        -- Trigger to update provider usage on new request
        CREATE TRIGGER IF NOT EXISTS update_provider_usage
        AFTER INSERT ON request_logs
        BEGIN
          INSERT INTO usage_by_provider (
            provider_id,
            total_requests,
            total_tokens,
            total_prompt_tokens,
            total_completion_tokens,
            last_request_timestamp
          )
          VALUES (
            NEW.provider_id,
            1,
            NEW.total_tokens,
            NEW.prompt_tokens,
            NEW.completion_tokens,
            NEW.timestamp
          )
          ON CONFLICT(provider_id) DO UPDATE SET
            total_requests = total_requests + 1,
            total_tokens = total_tokens + NEW.total_tokens,
            total_prompt_tokens = total_prompt_tokens + NEW.prompt_tokens,
            total_completion_tokens = total_completion_tokens + NEW.completion_tokens,
            last_request_timestamp = MAX(last_request_timestamp, NEW.timestamp);
        END;

        -- Trigger to update chain usage on new request
        CREATE TRIGGER IF NOT EXISTS update_chain_usage
        AFTER INSERT ON request_logs
        BEGIN
          INSERT INTO usage_by_chain (
            chain_name,
            total_requests,
            total_tokens,
            total_prompt_tokens,
            total_completion_tokens,
            last_request_timestamp
          )
          VALUES (
            NEW.chain_name,
            1,
            NEW.total_tokens,
            NEW.prompt_tokens,
            NEW.completion_tokens,
            NEW.timestamp
          )
          ON CONFLICT(chain_name) DO UPDATE SET
            total_requests = total_requests + 1,
            total_tokens = total_tokens + NEW.total_tokens,
            total_prompt_tokens = total_prompt_tokens + NEW.prompt_tokens,
            total_completion_tokens = total_completion_tokens + NEW.completion_tokens,
            last_request_timestamp = MAX(last_request_timestamp, NEW.timestamp);
        END;
      `);
    },
    // Migration 2: Add error_message column to request_logs for failed request tracking
    () => {
      db.exec(`
        ALTER TABLE request_logs ADD COLUMN error_message TEXT;
      `);
    },
  ];

  // Run migrations from current version to latest
  for (let i = currentVersion; i < migrations.length; i++) {
    const targetVersion = i + 1;
    logger.info({ from: currentVersion, to: targetVersion }, 'Running database migration');
    migrations[i]();
    db.pragma(`user_version = ${targetVersion}`);
  }

  if (currentVersion < migrations.length) {
    logger.info({ version: migrations.length }, 'Database migrations complete');
  }
}
