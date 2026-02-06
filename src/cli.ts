#!/usr/bin/env node
/**
 * CLI entry point for 429chain.
 * Handles argument parsing, --init command, environment variable setup,
 * and delegates to the main application bootstrap.
 */

import { parseArgs } from 'node:util';
import { existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

// Parse CLI arguments
const { values } = parseArgs({
  options: {
    config: {
      type: 'string',
      short: 'c',
    },
    port: {
      type: 'string',
      short: 'p',
    },
    init: {
      type: 'boolean',
    },
    help: {
      type: 'boolean',
      short: 'h',
    },
  },
  strict: false, // Allow unknown args to pass through
});

// Handle --help
if (values.help) {
  console.log(`
429chain - OpenAI-compatible proxy with rate limit waterfall

Usage:
  429chain [options]

Options:
  -c, --config <path>   Path to config file (default: ./config/config.yaml)
  -p, --port <port>     Port to listen on (overrides config)
  --init                Initialize config file in current directory
  -h, --help            Show this help message

Examples:
  429chain                                  # Run with default config
  429chain --config /etc/429chain.yaml      # Run with custom config path
  429chain --init                           # Create config/config.yaml from example
  npx 429chain                              # Run via npx without install
`);
  process.exit(0);
}

// Handle --init
if (values.init) {
  const targetPath = resolve(process.cwd(), 'config', 'config.yaml');
  const targetDir = dirname(targetPath);

  // Determine source path using import.meta.url
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const sourcePath = join(__dirname, '..', 'config', 'config.example.yaml');

  // Check if target already exists
  if (existsSync(targetPath)) {
    console.error(`Error: Config file already exists at ${targetPath}`);
    process.exit(1);
  }

  // Check if source example exists
  if (!existsSync(sourcePath)) {
    console.error('Error: Example config not found (package may be corrupted)');
    process.exit(1);
  }

  // Create target directory
  mkdirSync(targetDir, { recursive: true });

  // Copy example to target
  copyFileSync(sourcePath, targetPath);

  console.log(`✓ Created config file: ${targetPath}`);
  console.log('');
  console.log('Next steps:');
  console.log('  1. Edit the config file with your API keys');
  console.log('  2. Run: 429chain');
  console.log('');

  process.exit(0);
}

// Set environment variables for the application
if (values.config) {
  process.env.CONFIG_PATH = values.config;
}
if (values.port) {
  process.env.PORT = values.port;
}

// Bootstrap the application
await import('./index.mjs');
