import pino from 'pino';
import { pinoHttp } from 'pino-http';
import crypto from 'node:crypto';
import { env } from './env.js';

/** Never logged: credentials, cookies, tokens, and complaint / comment / note text. */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  // The login response sets the session cookie: never write the token to the logs.
  'res.headers["set-cookie"]',
  'password',
  'token',
  '*.password',
  '*.token',
  'body.password',
  'body.token',
  'body.description',
  'body.body',
  'body.note',
];

export const logger = pino({
  level: env.LOG_LEVEL,
  redact: { paths: REDACT_PATHS, remove: true },
  transport:
    env.NODE_ENV === 'development'
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            ignore: 'pid,hostname',
          },
        }
      : undefined,
});

export const httpLogger = pinoHttp({
  logger,
  // Reuse a proxy's request id only if it looks like an id (no log injection).
  genReqId: (req) => {
    const incoming = req.headers['x-request-id'];
    return typeof incoming === 'string' && /^[\w-]{1,64}$/.test(incoming) ? incoming : crypto.randomUUID();
  },
  customLogLevel: (_req, res, err) => {
    if (res.statusCode >= 500 || err) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
});
