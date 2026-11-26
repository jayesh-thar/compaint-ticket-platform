import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { Writable } from 'node:stream';
import pino from 'pino';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { prisma, disconnectPrisma } from '../src/config/prisma.js';
import { REDACT_PATHS } from '../src/config/logger.js';
import { hashPassword } from '../src/shared/crypto.js';
import { cleanDatabase } from './helpers/db.js';
import { createUser } from './helpers/factories.js';

// A fresh app per file: rate-limit counters live in memory per process.
const app = createApp();

/** Every login request in this file goes through here, so we know the per-IP count. */
let loginCalls = 0;
const login = (body: Record<string, string>) => {
  loginCalls++;
  return request(app).post('/api/v1/auth/login').send(body);
};

describe('Security hardening (Phase 10)', () => {
  beforeEach(cleanDatabase);
  afterAll(async () => {
    await cleanDatabase();
    await disconnectPrisma();
  });

  describe('rate limits (architecture 10)', () => {
    it('login: 5 failed attempts per IP + email, then 429; another email is still allowed', async () => {
      await createUser({ email: 'victim@example.com', passwordHash: await hashPassword('Correct-horse-1') });
      for (let i = 0; i < 5; i++) {
        const r = await login({ email: 'victim@example.com', password: 'wrong-password' });
        expect(r.status).toBe(401);
      }
      const blocked = await login({ email: 'victim@example.com', password: 'Correct-horse-1' });
      expect(blocked.status).toBe(429);
      expect(blocked.body.error.code).toBe('RATE_LIMITED');
      // A different account from the same IP is not locked out by someone else's failures.
      const other = await login({ email: 'other@example.com', password: 'whatever-1' });
      expect(other.status).toBe(401);
    });

    it('login: 10 attempts per IP in 15 minutes, then 429', async () => {
      let status = 0;
      while (status !== 429 && loginCalls < 20) {
        status = (await login({ email: `n${loginCalls}@example.com`, password: 'x' })).status;
      }
      expect(status).toBe(429);
      expect(loginCalls).toBe(11); // the 11th request from this IP is the first one refused
    });

    it('forgot password: 3 per email per hour (generic answer until then)', async () => {
      const statuses: number[] = [];
      for (let i = 0; i < 4; i++) {
        statuses.push(
          (await request(app).post('/api/v1/auth/forgot-password').send({ email: 'someone@example.com' })).status
        );
      }
      expect(statuses).toEqual([200, 200, 200, 429]);
    });
  });

  describe('logs', () => {
    it('redaction removes cookies, Set-Cookie, passwords, tokens and complaint/comment text', () => {
      const lines: string[] = [];
      const sink = new Writable({
        write(chunk, _enc, cb) {
          lines.push(chunk.toString());
          cb();
        },
      });
      const log = pino({ redact: { paths: REDACT_PATHS, remove: true } }, sink);
      log.info({
        req: { headers: { cookie: 'sid=SECRET_SESSION', authorization: 'Bearer SECRET_AUTH' } },
        res: { headers: { 'set-cookie': 'sid=SECRET_NEW_SESSION; HttpOnly' } },
        body: {
          password: 'SECRET_PW',
          token: 'SECRET_TOKEN',
          description: 'SECRET_COMPLAINT',
          body: 'SECRET_COMMENT',
          note: 'SECRET_NOTE',
        },
        password: 'SECRET_PW2',
      });
      const out = lines.join('');
      expect(out).not.toMatch(/SECRET_/);
    });

    it('error responses never contain stack traces or SQL', async () => {
      const res = await request(app).get('/api/v1/orgs/%E0%A4%A/tickets'); // malformed URI
      expect(JSON.stringify(res.body)).not.toMatch(/at \w+ \(|SELECT|prisma/i);
    });
  });

  describe('database', () => {
    it('passwords and tokens are stored only as hashes', async () => {
      await request(app)
        .post('/api/v1/auth/register')
        .send({ name: 'Plain Text', email: 'plain@example.com', password: 'My-plain-password-1' });
      const user = await prisma.user.findUniqueOrThrow({ where: { email: 'plain@example.com' } });
      expect(user.passwordHash).not.toContain('My-plain-password-1');
      expect(user.passwordHash.startsWith('$argon2id$')).toBe(true);
      const token = await prisma.emailToken.findFirstOrThrow();
      expect(token.tokenHash).toMatch(/^[a-f0-9]{64}$/); // SHA-256 hex
    });
  });
});
