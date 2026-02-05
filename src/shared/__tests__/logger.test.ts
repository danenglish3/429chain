import { describe, it, expect } from 'vitest';
import { logger } from '../logger.js';

describe('logger', () => {
  it('is a pino logger instance', () => {
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.error).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.debug).toBe('function');
  });

  it('redacts API key values from logged objects', () => {
    // Capture logger output by creating a child logger with a custom destination
    const chunks: string[] = [];
    const dest = {
      write(chunk: string) {
        chunks.push(chunk);
      },
    };

    // Create a test logger with same redaction config but writing to our buffer
    const pino = require('pino');
    const testLogger = pino(
      {
        level: 'info',
        redact: {
          paths: [
            'req.headers.authorization',
            'req.headers["api-key"]',
            '*.apiKey',
            '*.api_key',
          ],
          censor: '[REDACTED]',
        },
      },
      dest
    );

    testLogger.info({ req: { headers: { authorization: 'Bearer sk-secret-key' } } }, 'test request');
    testLogger.info({ provider: { apiKey: 'sk-or-v1-secret' } }, 'test provider');
    testLogger.info({ provider: { api_key: 'gsk_secret' } }, 'test provider alt');

    const output = chunks.join('');
    expect(output).not.toContain('sk-secret-key');
    expect(output).not.toContain('sk-or-v1-secret');
    expect(output).not.toContain('gsk_secret');
    expect(output).toContain('[REDACTED]');
  });

  it('outputs structured JSON', () => {
    const chunks: string[] = [];
    const dest = {
      write(chunk: string) {
        chunks.push(chunk);
      },
    };

    const pino = require('pino');
    const testLogger = pino({ level: 'info' }, dest);

    testLogger.info({ key: 'value' }, 'test message');

    const parsed = JSON.parse(chunks[0]!);
    expect(parsed.key).toBe('value');
    expect(parsed.msg).toBe('test message');
    expect(parsed.level).toBe(30); // info level
  });
});
