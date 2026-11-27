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
            // One readable line per request: the message already says method, url, status, time.
            ignore: 'pid,hostname,req,res,responseTime',
          },
        }
      : undefined,
});

/** Express rewrites req.url inside routers; originalUrl is the full path. */
const fullUrl = (req: { url?: string }) => (req as { originalUrl?: string }).originalUrl ?? req.url ?? '';

export const httpLogger = pinoHttp({
  logger,
  // Reuse a proxy's request id only if it looks like an id (no log injection).
  genReqId: (req) => {
    const incoming = req.headers['x-request-id'];
    return typeof incoming === 'string' && /^[\w-]{1,64}$/.test(incoming) ? incoming : crypto.randomUUID();
  },
  // Only what matters: every change (POST/PATCH/PUT/DELETE) and every failure.
  // Successful page loads (GET, 304) and the live-update stream are not logged.
  customLogLevel: (req, res, err) => {
    if (res.statusCode >= 500 || err) return 'error';
    // "Not logged in yet" on page load is normal, not a warning.
    if (res.statusCode === 401 && fullUrl(req).startsWith('/api/v1/auth/me')) return 'silent';
    if (res.statusCode >= 400) return 'warn';
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return 'silent';
    return 'info';
  },
  customSuccessMessage: (req, res, time) =>
    `${req.method} ${fullUrl(req)} -> ${res.statusCode} (${Math.round(time)} ms)`,
  customErrorMessage: (req, res) => `${req.method} ${fullUrl(req)} -> ${res.statusCode} failed`,
  // Small objects for production JSON logs: no header dumps.
  serializers: {
    req: (req: { id?: unknown; method?: string; url?: string }) => ({
      id: req.id,
      method: req.method,
      url: fullUrl(req),
    }),
    res: (res: { statusCode?: number }) => ({ statusCode: res.statusCode }),
  },
});
