/**
 * Database initialization for SQLite observability persistence.
 * Sets up connection with WAL mode and performance pragmas.
 */

import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { logger } from '../shared/logger.js';

/**
 * Initialize SQLite database with WAL mode and performance pragmas.
 * @param dbPath - Path to SQLite database file
 * @returns Database instance ready for use
 */
export function initializeDatabase(dbPath: string): Database.Database {
  // Ensure parent directory exists
  mkdirSync(dirname(dbPath), { recursive: true });

  // Create database connection
  const db = new Database(dbPath);

  // Set performance pragmas
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('cache_size = -64000');
  db.pragma('temp_store = MEMORY');

  logger.info({ dbPath, journalMode: 'WAL' }, 'SQLite database initialized');

  return db;
}
