import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { prisma, disconnectPrisma } from '../src/config/prisma.js';
import { cleanDatabase } from './helpers/db.js';
import { createUser } from './helpers/factories.js';

describe('Database Foundation (Phase 1)', () => {
  beforeEach(async () => {
    await cleanDatabase();
  });

  afterAll(async () => {
    await cleanDatabase();
    await disconnectPrisma();
  });

  it('successfully creates a user and session', async () => {
    const user = await createUser({ email: 'alice@example.com', name: 'Alice' });
    expect(user.id).toBeDefined();
    expect(user.email).toBe('alice@example.com');

    const session = await prisma.session.create({
      data: {
        userId: user.id,
        tokenHash: 'dummy_hash_token_123',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    expect(session.id).toBeDefined();
    expect(session.userId).toBe(user.id);
  });

  it('fails when inserting a duplicate email', async () => {
    await createUser({ email: 'duplicate@example.com' });

    await expect(
      createUser({ email: 'duplicate@example.com' })
    ).rejects.toThrow();
  });

  it('cleanDatabase helper empties the tables', async () => {
    await createUser({ email: 'bob@example.com' });
    const countBefore = await prisma.user.count();
    expect(countBefore).toBe(1);

    await cleanDatabase();
    const countAfter = await prisma.user.count();
    expect(countAfter).toBe(0);
  });
});
