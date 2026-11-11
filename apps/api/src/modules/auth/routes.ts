import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import pg, { type Pool, type PoolClient } from 'pg';
import { apiError } from '../../http/error.js';
import { withTransaction } from '../../realtime/after-commit.js';
import { credentialAttempts } from './attempts.js';
import { type BrowserSession, sessionLifetimeMs } from './browser-session.js';
import { hashPassword, verifyPassword } from './password.js';
import { createSessionInTransaction, revokeSession, type SessionUser } from './sessions.js';

type CredentialUser = SessionUser & { passwordHash: string; disabledAt: Date | null };
const userColumns = 'id, email, display_name AS "displayName", role';

function credentials(body: unknown, maxPasswordLength: number) {
  if (!body || typeof body !== 'object' || !('email' in body) || !('password' in body)) return null;
  if (typeof body.email !== 'string' || typeof body.password !== 'string') return null;
  const email = body.email.trim().toLowerCase();
  const password = body.password;
  if (email.length > 254 || !/^[^\s@\x00-\x1f\x7f]+@[^\s@\x00-\x1f\x7f]+\.[^\s@\x00-\x1f\x7f]+$/u.test(email)) return null;
  if (password.length < 1 || password.length > maxPasswordLength) return null;
  return { email, password };
}

function displayName(body: unknown): string | null {
  if (!body || typeof body !== 'object' || !('displayName' in body) || typeof body.displayName !== 'string') return null;
  const name = body.displayName.trim();
  return name.length >= 1 && name.length <= 80 && !/[\x00-\x1f\x7f]/u.test(name) ? name : null;
}

async function replaceSession(client: PoolClient, userId: string, previousToken: string) {
  const session = await createSessionInTransaction(client, userId, new Date(Date.now() + sessionLifetimeMs));
  if (session) await revokeSession(client, previousToken);
  return session;
}

export function authRouter(db: Pool, browser: BrowserSession): Router {
  const router = Router();
  const allowAttempt = credentialAttempts();
  let dummyHash: Promise<string> | undefined;

  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  router.get('/csrf', browser.csrfBootstrap);
  router.get('/me', browser.requireUser, (_req, res) => res.json({ user: res.locals.user }));

  router.post('/register', browser.requireCsrf, async (req, res) => {
    const input = credentials(req.body, 256);
    const name = displayName(req.body);
    if (!input || input.password.length < 8 || !name) {
      return apiError(res, 422, 'INVALID_INPUT', 'Enter a valid email, display name, and password');
    }
    if (!allowAttempt(res, req.ip ?? req.socket.remoteAddress ?? 'unknown', input.email)) return;

    const passwordHash = await hashPassword(input.password);
    try {
      const { user, session } = await withTransaction(db, async client => {
        const result = await client.query<SessionUser>(`INSERT INTO users(email,password_hash,display_name)
          VALUES($1,$2,$3) RETURNING ${userColumns}`, [input.email, passwordHash, name]);
        const user = result.rows[0];
        if (!user) throw new Error('Registration did not return an account');
        const session = await replaceSession(client, user.id, browser.sessionToken(req));
        if (!session) throw new Error('Registration could not issue a session');
        return { user, session };
      });
      browser.setCookie(res, session);
      return res.status(201).json({ user });
    } catch (error) {
      if (error instanceof pg.DatabaseError && error.code === '23505' && error.constraint === 'users_email_key') {
        return apiError(res, 409, 'EMAIL_EXISTS', 'This email is already in use');
      }
      throw error;
    }
  });

  router.post('/login', browser.requireCsrf, async (req, res) => {
    // Existing demo accounts may have passwords longer than registration accepts.
    const input = credentials(req.body, 1024);
    if (!input) return apiError(res, 422, 'INVALID_INPUT', 'Enter a valid email and password');
    if (!allowAttempt(res, req.ip ?? req.socket.remoteAddress ?? 'unknown', input.email)) return;

    const result = await db.query<CredentialUser>(`SELECT ${userColumns}, password_hash AS "passwordHash",
      disabled_at AS "disabledAt" FROM users WHERE email=$1`, [input.email]);
    const account = result.rows[0];
    const passwordHash = account?.passwordHash ?? await (dummyHash ??= hashPassword(randomBytes(32).toString('hex')));
    const valid = await verifyPassword(passwordHash, input.password);
    if (!valid || !account || account.disabledAt) {
      return apiError(res, 401, 'INVALID_CREDENTIALS', 'Incorrect email or password');
    }

    const session = await withTransaction(db, async client => {
      return replaceSession(client, account.id, browser.sessionToken(req));
    });
    if (!session) return apiError(res, 401, 'INVALID_CREDENTIALS', 'Incorrect email or password');
    const { id, email, displayName, role } = account;
    browser.setCookie(res, session);
    return res.json({ user: { id, email, displayName, role } });
  });

  router.post('/logout', browser.requireCsrf, async (req, res) => {
    await revokeSession(db, browser.sessionToken(req));
    browser.clearCookie(res);
    return res.status(204).end();
  });
  return router;
}
