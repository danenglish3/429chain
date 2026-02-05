import { describe, it, expect } from 'vitest';
import { loadConfig } from '../loader.js';
import { ConfigError } from '../../shared/errors.js';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const VALID_CONFIG = `
version: 1

settings:
  port: 3429
  apiKeys:
    - "test-key-123"
  defaultChain: "default"
  logLevel: info
  cooldownDefaultMs: 60000
  requestTimeoutMs: 30000

providers:
  - id: openrouter
    name: OpenRouter
    type: openrouter
    apiKey: "sk-or-v1-test"

  - id: groq
    name: Groq
    type: groq
    apiKey: "gsk_test"

chains:
  - name: default
    entries:
      - provider: openrouter
        model: "meta-llama/llama-3.1-8b-instruct:free"
      - provider: groq
        model: "llama-3.1-8b-instant"

  - name: fast
    entries:
      - provider: groq
        model: "llama-3.1-8b-instant"
`;

function writeTempConfig(content: string): string {
  const dir = join(tmpdir(), `429chain-test-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'config.yaml');
  writeFileSync(path, content, 'utf-8');
  return path;
}

describe('loadConfig', () => {
  it('loads and validates a correct config file', () => {
    const path = writeTempConfig(VALID_CONFIG);
    try {
      const config = loadConfig(path);
      expect(config.version).toBe(1);
      expect(config.settings.port).toBe(3429);
      expect(config.settings.apiKeys).toEqual(['test-key-123']);
      expect(config.settings.defaultChain).toBe('default');
      expect(config.providers).toHaveLength(2);
      expect(config.providers[0]!.id).toBe('openrouter');
      expect(config.providers[0]!.type).toBe('openrouter');
      expect(config.chains).toHaveLength(2);
      expect(config.chains[0]!.name).toBe('default');
      expect(config.chains[0]!.entries).toHaveLength(2);
    } finally {
      rmSync(path, { force: true });
    }
  });

  it('applies defaults for optional fields', () => {
    const minimalConfig = `
version: 1

settings:
  apiKeys:
    - "test-key"
  defaultChain: "default"

providers:
  - id: test
    name: Test Provider
    type: generic-openai
    apiKey: "sk-test"

chains:
  - name: default
    entries:
      - provider: test
        model: "test-model"
`;
    const path = writeTempConfig(minimalConfig);
    try {
      const config = loadConfig(path);
      expect(config.settings.port).toBe(3429);
      expect(config.settings.logLevel).toBe('info');
      expect(config.settings.cooldownDefaultMs).toBe(60000);
      expect(config.settings.requestTimeoutMs).toBe(30000);
    } finally {
      rmSync(path, { force: true });
    }
  });

  it('throws ConfigError for invalid YAML', () => {
    const path = writeTempConfig('{ invalid yaml: [}');
    try {
      expect(() => loadConfig(path)).toThrow(ConfigError);
    } finally {
      rmSync(path, { force: true });
    }
  });

  it('throws ConfigError when file does not exist', () => {
    expect(() => loadConfig('/nonexistent/path/config.yaml')).toThrow(ConfigError);
    expect(() => loadConfig('/nonexistent/path/config.yaml')).toThrow('Failed to read config file');
  });

  it('throws ConfigError when version is wrong', () => {
    const config = VALID_CONFIG.replace('version: 1', 'version: 2');
    const path = writeTempConfig(config);
    try {
      expect(() => loadConfig(path)).toThrow(ConfigError);
      expect(() => loadConfig(path)).toThrow('Config validation failed');
    } finally {
      rmSync(path, { force: true });
    }
  });

  it('throws ConfigError when chain references non-existent provider', () => {
    const config = `
version: 1

settings:
  apiKeys:
    - "test-key"
  defaultChain: "default"

providers:
  - id: real-provider
    name: Real
    type: groq
    apiKey: "gsk_test"

chains:
  - name: default
    entries:
      - provider: nonexistent-provider
        model: "some-model"
`;
    const path = writeTempConfig(config);
    try {
      expect(() => loadConfig(path)).toThrow(ConfigError);
      expect(() => loadConfig(path)).toThrow('provider id that does not exist');
    } finally {
      rmSync(path, { force: true });
    }
  });

  it('throws ConfigError when defaultChain references non-existent chain', () => {
    const config = `
version: 1

settings:
  apiKeys:
    - "test-key"
  defaultChain: "nonexistent-chain"

providers:
  - id: test
    name: Test
    type: groq
    apiKey: "gsk_test"

chains:
  - name: default
    entries:
      - provider: test
        model: "some-model"
`;
    const path = writeTempConfig(config);
    try {
      expect(() => loadConfig(path)).toThrow(ConfigError);
      expect(() => loadConfig(path)).toThrow('defaultChain must reference an existing chain');
    } finally {
      rmSync(path, { force: true });
    }
  });

  it('throws ConfigError when no providers are defined', () => {
    const config = `
version: 1

settings:
  apiKeys:
    - "test-key"
  defaultChain: "default"

providers: []

chains:
  - name: default
    entries:
      - provider: test
        model: "some-model"
`;
    const path = writeTempConfig(config);
    try {
      expect(() => loadConfig(path)).toThrow(ConfigError);
    } finally {
      rmSync(path, { force: true });
    }
  });

  it('throws ConfigError when no chains are defined', () => {
    const config = `
version: 1

settings:
  apiKeys:
    - "test-key"
  defaultChain: "default"

providers:
  - id: test
    name: Test
    type: groq
    apiKey: "gsk_test"

chains: []
`;
    const path = writeTempConfig(config);
    try {
      expect(() => loadConfig(path)).toThrow(ConfigError);
    } finally {
      rmSync(path, { force: true });
    }
  });
});
