/**
 * Structured JSON logger with API key redaction.
 * Must be imported before any logging occurs to ensure secrets are never leaked.
 */

import pino from 'pino';

const logLevel = process.env['LOG_LEVEL'] ?? 'info';

// Determine if pretty logging should be used:
// - Explicit LOG_FORMAT=pretty → use pretty
// - Explicit LOG_FORMAT=json → use JSON
// - Otherwise in non-production → use pretty (default dev experience)
// - Production → use JSON
const usePretty =
  process.env['LOG_FORMAT'] === 'pretty' ||
  (process.env['NODE_ENV'] !== 'production' && process.env['LOG_FORMAT'] !== 'json');

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
  ...(usePretty && {
    transport: {
      target: 'pino-pretty',
      options: {
        translateTime: 'HH:MM:ss.l',
        ignore: 'pid,hostname',
        colorize: true,
      },
    },
  }),
});
