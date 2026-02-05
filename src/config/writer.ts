/**
 * Config writer: persists Config object to YAML file.
 * Used by admin API endpoints to save runtime config mutations.
 */

import { writeFileSync } from 'node:fs';
import { stringify as stringifyYaml } from 'yaml';
import type { Config } from './types.js';
import { logger } from '../shared/logger.js';

/**
 * Write a Config object to a YAML file.
 * Serializes the config to YAML and writes it atomically.
 *
 * @param configPath - Absolute or relative path to write the YAML file
 * @param config - The Config object to serialize
 * @throws Error if the write operation fails
 */
export function writeConfig(configPath: string, config: Config): void {
  try {
    const yaml = stringifyYaml(config, { indent: 2 });
    writeFileSync(configPath, yaml, 'utf-8');
    logger.info({ configPath }, 'Config written to disk');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ configPath, error: message }, 'Failed to write config');
    throw new Error(`Failed to write config to "${configPath}": ${message}`);
  }
}
