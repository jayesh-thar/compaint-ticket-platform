import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { prisma, disconnectPrisma } from '../src/config/prisma.js';
import { cleanDatabase } from './helpers/db.js';
import { emailTransport } from '../src/shared/email.js';
import { hashToken } from '../src/shared/crypto.js';
import { env } from '../src/config/env.js';
import { createUser, createSession } from './helpers/factories.js';

describe('Authentication (Phase 2)', () => {
  const app = createApp();

  beforeEach(async () => {
    await cleanDatabase();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await cleanDatabase();
    await disconnectPrisma();
  });

  it('register -> verify -> login -> me -> logout happy path', async () => {
    const emailSendSpy = vi.spyOn(emailTransport, 'send').mockResolvedValue(undefined);

    // 1. Register
    const regRes = await request(app).post('/api/v1/auth/register').send({
      name: 'John Doe',
      email: 'john@example.com',
      password: 'Password123!',
    });

    expect(regRes.status).toBe(200);
    expect(regRes.body.message).toContain('verification link has been sent');
    expect(emailSendSpy).toHaveBeenCalledTimes(1);

    // Extract verify token from db (hashed)
    const tokenRecord = await prisma.emailToken.findFirst({
      where: { type: 'VERIFY_EMAIL' },
    });
    expect(tokenRecord).toBeDefined();

    // The email was called with the raw token in the text
    const sentEmailText = emailSendSpy.mock.calls[0][0].text;
    const tokenMatch = sentEmailText.match(/#token=([a-zA-Z0-9_-]+)/);
    expect(tokenMatch).not.toBeNull();
    const rawToken = tokenMatch![1];
    expect(hashToken(rawToken)).toBe(tokenRecord!.tokenHash);

    // 2. Verify Email
    const verifyRes = await request(app).post('/api/v1/auth/verify-email').send({ token: rawToken });

    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.message).toContain('successfully verified');

    const verifiedUser = await prisma.user.findUnique({
      where: { email: 'john@example.com' },
    });
    expect(verifiedUser?.emailVerifiedAt).not.toBeNull();

    // 3. Login
    const loginRes = await request(app).post('/api/v1/auth/login').send({
      email: 'john@example.com',
      password: 'Password123!',
    });

    expect(loginRes.status).toBe(200);
    expect(loginRes.body.user.email).toBe('john@example.com');
    expect(loginRes.body.user.emailVerified).toBe(true);

    const cookies = loginRes.headers['set-cookie'];
    expect(cookies).toBeDefined();
    const sidCookie = cookies[0];
    expect(sidCookie).toContain('sid=');
    expect(sidCookie).toContain('HttpOnly');

    // 4. GET /me with session cookie
    const meRes = await request(app).get('/api/v1/auth/me').set('Cookie', sidCookie);

    expect(meRes.status).toBe(200);
    expect(meRes.body.user.email).toBe('john@example.com');

    // 5. Logout
    const logoutRes = await request(app).post('/api/v1/auth/logout').set('Cookie', sidCookie);

    expect(logoutRes.status).toBe(200);

    // 6. Accessing /me after logout fails
    const meAfterLogout = await request(app).get('/api/v1/auth/me').set('Cookie', sidCookie);

    expect(meAfterLogout.status).toBe(401);
    expect(meAfterLogout.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('gives generic responses for existing registration and unknown login/reset', async () => {
    vi.spyOn(emailTransport, 'send').mockResolvedValue(undefined);

    // First registration
    await request(app)
      .post('/api/v1/auth/register')
      .send({ name: 'User One', email: 'existing@example.com', password: 'Password123!' });

    // Second registration with the same email gives the same generic 200 response
    const dupRes = await request(app)
      .post('/api/v1/auth/register')
      .send({ name: 'Imposter', email: 'existing@example.com', password: 'DifferentPassword123!' });

    expect(dupRes.status).toBe(200);
    expect(dupRes.body.message).toContain('verification link has been sent');

    // Forgot password with unknown email returns generic 200
    const forgotRes = await request(app).post('/api/v1/auth/forgot-password').send({ email: 'unknown@example.com' });

    expect(forgotRes.status).toBe(200);
    expect(forgotRes.body.message).toContain('password reset link has been sent');

    // Login with unknown email returns generic 401
    const loginUnknownRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'unknown@example.com', password: 'WrongPassword' });

    expect(loginUnknownRes.status).toBe(401);
    expect(loginUnknownRes.body.error.code).toBe('UNAUTHENTICATED');

    // Login with wrong password returns the exact same 401
    const loginWrongPassRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'existing@example.com', password: 'WrongPassword' });

    expect(loginWrongPassRes.status).toBe(401);
    expect(loginWrongPassRes.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects expired, used, or unknown tokens', async () => {
    // Unknown token
    const resUnknown = await request(app).post('/api/v1/auth/verify-email').send({ token: 'unknown_token_value' });

    expect(resUnknown.status).toBe(400);
    expect(resUnknown.body.error.code).toBe('VALIDATION_ERROR');

    // Create a user and an expired token directly
    const user = await prisma.user.create({
      data: {
        name: 'Expired User',
        email: 'expired@example.com',
        passwordHash: 'dummy_hash',
      },
    });

    await prisma.emailToken.create({
      data: {
        userId: user.id,
        type: 'VERIFY_EMAIL',
        tokenHash: hashToken('expired_token'),
        expiresAt: new Date(Date.now() - 1000), // expired 1 sec ago
      },
    });

    const resExpired = await request(app).post('/api/v1/auth/verify-email').send({ token: 'expired_token' });

    expect(resExpired.status).toBe(400);
    expect(resExpired.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('password reset revokes all active sessions for the user', async () => {
    const emailSendSpy = vi.spyOn(emailTransport, 'send').mockResolvedValue(undefined);

    // Register & verify
    await request(app)
      .post('/api/v1/auth/register')
      .send({ name: 'Reset User', email: 'reset@example.com', password: 'OldPassword123!' });

    const tokenText = emailSendSpy.mock.calls[0][0].text;
    const verifyToken = tokenText.match(/#token=([a-zA-Z0-9_-]+)/)![1];
    await request(app).post('/api/v1/auth/verify-email').send({ token: verifyToken });

    // Login in two separate browsers/sessions
    const login1 = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'reset@example.com', password: 'OldPassword123!' });
    const cookie1 = login1.headers['set-cookie'][0];

    const login2 = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'reset@example.com', password: 'OldPassword123!' });
    const cookie2 = login2.headers['set-cookie'][0];

    // Both sessions work
    expect((await request(app).get('/api/v1/auth/me').set('Cookie', cookie1)).status).toBe(200);
    expect((await request(app).get('/api/v1/auth/me').set('Cookie', cookie2)).status).toBe(200);

    // Request password reset
    await request(app).post('/api/v1/auth/forgot-password').send({ email: 'reset@example.com' });

    const resetEmailText = emailSendSpy.mock.calls[1][0].text;
    const resetToken = resetEmailText.match(/#token=([a-zA-Z0-9_-]+)/)![1];

    // Perform password reset
    const resetRes = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token: resetToken, newPassword: 'NewPassword123!' });

    expect(resetRes.status).toBe(200);

    // Both previous sessions must now be rejected
    expect((await request(app).get('/api/v1/auth/me').set('Cookie', cookie1)).status).toBe(401);
    expect((await request(app).get('/api/v1/auth/me').set('Cookie', cookie2)).status).toBe(401);

    // Old password fails, new password succeeds
    const oldLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'reset@example.com', password: 'OldPassword123!' });
    expect(oldLogin.status).toBe(401);

    const newLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'reset@example.com', password: 'NewPassword123!' });
    expect(newLogin.status).toBe(200);
  });

  it('rejects non-GET request from unauthorized origin', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .set('Origin', 'https://malicious-site.com')
      .send({ name: 'Malicious', email: 'bad@example.com', password: 'Password123!' });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('never stores plaintext tokens or passwords in the database', async () => {
    vi.spyOn(emailTransport, 'send').mockResolvedValue(undefined);

    await request(app)
      .post('/api/v1/auth/register')
      .send({ name: 'Secret User', email: 'secret@example.com', password: 'RawPlaintextPassword!' });

    const user = await prisma.user.findUnique({
      where: { email: 'secret@example.com' },
    });

    expect(user?.passwordHash).not.toBe('RawPlaintextPassword!');
    expect(user?.passwordHash).toContain('$argon2id$');

    const token = await prisma.emailToken.findFirst({
      where: { userId: user!.id },
    });

    // Token must be 64-char hex string (SHA-256)
    expect(token?.tokenHash).toMatch(/^[a-f0-9]{64}$/);
  });

  describe('with EMAIL_VERIFICATION_REQUIRED=false', () => {
    beforeEach(() => {
      env.EMAIL_VERIFICATION_REQUIRED = false;
    });
    afterAll(() => {
      env.EMAIL_VERIFICATION_REQUIRED = true;
    });

    it('register creates a verified account, sends no email, and can create an org', async () => {
      const emailSendSpy = vi.spyOn(emailTransport, 'send').mockResolvedValue(undefined);

      const regRes = await request(app).post('/api/v1/auth/register').send({
        name: 'No Verify',
        email: 'noverify@example.com',
        password: 'Password123!',
      });
      expect(regRes.status).toBe(200);
      expect(regRes.body.verificationRequired).toBe(false);
      expect(emailSendSpy).not.toHaveBeenCalled();
      expect(await prisma.emailToken.count()).toBe(0);

      const loginRes = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'noverify@example.com', password: 'Password123!' });
      expect(loginRes.status).toBe(200);
      expect(loginRes.body.user.emailVerified).toBe(true);
    });

    it('lets an older unverified account through requireVerified', async () => {
      const user = await createUser({ emailVerifiedAt: null });
      const { cookie } = await createSession(user.id);

      const me = await request(app).get('/api/v1/auth/me').set('Cookie', cookie);
      expect(me.body.user.emailVerified).toBe(true);

      const org = await request(app)
        .post('/api/v1/orgs')
        .set('Cookie', cookie)
        .set('Origin', env.APP_ORIGIN)
        .send({ name: 'Unverified Org', slug: 'unverified-org' });
      expect(org.status).toBe(201);
    });
  });
});
