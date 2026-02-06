/**
 * YAML config loading and Zod validation.
 * Reads a YAML file, validates it against the config schema,
 * and returns a fully typed Config object or throws a ConfigError.
 */

import { readFileSync, existsSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { ConfigSchema } from './schema.js';
import { ConfigError } from '../shared/errors.js';
import { logger } from '../shared/logger.js';
import type { Config } from './types.js';

/**
 * Load and validate a YAML config file.
 *
 * @param path - Absolute or relative path to the YAML config file
 * @returns A fully validated Config object
 * @throws ConfigError if the file cannot be read or validation fails
 */
export function loadConfig(path: string): Config {
  if (!existsSync(path)) {
    console.error(`\nConfig file not found: ${path}\n`);
    console.error('To create a config file, run:');
    console.error('  429chain --init\n');
    console.error('Or specify a custom config path:');
    console.error('  429chain --config /path/to/config.yaml\n');
    process.exit(1);
  }

  let raw: string;
  try {
    raw = readFileSync(path, 'utf-8');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new ConfigError(`Failed to read config file at "${path}": ${message}`);
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new ConfigError(`Failed to parse YAML in config file "${path}": ${message}`);
  }

  const result = ConfigSchema.safeParse(parsed);

  if (!result.success) {
    const prettyError = z.prettifyError(result.error);
    logger.error({ configPath: path }, 'Config validation failed');
    throw new ConfigError(`Config validation failed for "${path}":\n${prettyError}`);
  }

  logger.info(
    { configPath: path, providers: result.data.providers.length, chains: result.data.chains.length },
    'Config loaded successfully'
  );

  return result.data;
}

/**
 * Resolve the config file path from CLI args, env var, or default.
 *
 * Priority:
 * 1. --config CLI argument
 * 2. CONFIG_PATH environment variable
 * 3. ./config/config.yaml (default)
 */
export function resolveConfigPath(): string {
  // Check CLI args for --config
  const args = process.argv;
  const configArgIndex = args.indexOf('--config');
  if (configArgIndex !== -1 && configArgIndex + 1 < args.length) {
    return args[configArgIndex + 1]!;
  }

  // Check environment variable
  const envPath = process.env['CONFIG_PATH'];
  if (envPath) {
    return envPath;
  }

  // Default
  return './config/config.yaml';
}
