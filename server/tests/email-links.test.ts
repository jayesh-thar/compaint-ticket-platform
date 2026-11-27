import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { disconnectPrisma } from '../src/config/prisma.js';
import { cleanDatabase } from './helpers/db.js';
import { createUser } from './helpers/factories.js';
import { emailTransport, formatLinkBlock } from '../src/shared/email.js';
import { env } from '../src/config/env.js';

describe('Console email links (Phase 11)', () => {
  const app = createApp();

  beforeEach(async () => {
    await cleanDatabase();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await cleanDatabase();
    await disconnectPrisma();
  });

  it('formats a link as a parseable JSON block', () => {
    const block = formatLinkBlock('a@example.com', 'Reset your password', {
      kind: 'RESET_PASSWORD',
      url: 'http://localhost:5173/reset-password#token=abc',
      validFor: '1 hour',
    });
    const json = JSON.parse(block.slice(block.indexOf('{'), block.lastIndexOf('}') + 1));
    expect(json).toMatchObject({
      type: 'RESET_PASSWORD',
      to: 'a@example.com',
      subject: 'Reset your password',
      link: 'http://localhost:5173/reset-password#token=abc',
      validFor: '1 hour',
    });
  });

  it('password reset email carries its link so the console can print it', async () => {
    const spy = vi.spyOn(emailTransport, 'send').mockResolvedValue(undefined);
    const user = await createUser({ email: 'links@example.com' });

    await request(app).post('/api/v1/auth/forgot-password').set('Origin', env.APP_ORIGIN).send({ email: user.email });

    expect(spy).toHaveBeenCalledTimes(1);
    const link = spy.mock.calls[0][0].link;
    expect(link?.kind).toBe('RESET_PASSWORD');
    expect(link?.url).toMatch(new RegExp(`^${env.APP_ORIGIN}/reset-password#token=[A-Za-z0-9_-]+$`));
  });
});
