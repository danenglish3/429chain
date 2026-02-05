/**
 * Structured JSON logger with API key redaction.
 * Must be imported before any logging occurs to ensure secrets are never leaked.
 */

import pino from 'pino';

const logLevel = process.env['LOG_LEVEL'] ?? 'info';

export const logger = pino({
  name: '429chain',
  level: logLevel,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers["api-key"]',
      '*.apiKey',
      '*.api_key',
    ],
    censor: '[REDACTED]',
  },
});
