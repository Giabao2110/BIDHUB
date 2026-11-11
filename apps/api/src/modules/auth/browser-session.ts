import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Request, RequestHandler, Response } from 'express';
import type { Pool } from 'pg';
import { apiError } from '../../http/error.js';
import { findSessionUser } from './sessions.js';

export const sessionLifetimeMs = 7 * 24 * 60 * 60 * 1000;
const tokenFormat = /^[A-Za-z0-9_-]{43}$/;

function readCookie(req: Request, name: string): string {
  const prefix = name + '=';
  const matches = req.headers.cookie?.split(';').map(field => field.trim()).filter(field => field.startsWith(prefix));
  if (matches?.length !== 1) return '';
  const value = matches[0]?.slice(prefix.length) ?? '';
  return tokenFormat.test(value) ? value : '';
}

export function browserSession(db: Pool, webOrigin: string) {
  const secure = new URL(webOrigin).protocol === 'https:';
  const prefix = secure ? '__Host-' : '';
  const sessionName = prefix + 'bidhub_session';
  const csrfName = prefix + 'bidhub_csrf';
  const cookieOptions = { httpOnly: true, sameSite: 'lax' as const, secure, path: '/' };
  const csrfKey = randomBytes(32);
  const sessionToken = (req: Request) => readCookie(req, sessionName);
  const user = (req: Request) => findSessionUser(db, sessionToken(req));

  function signCsrf(seed: string, token: string): string {
    return createHmac('sha256', csrfKey).update(seed).update('.').update(token).digest('base64url');
  }

  function trustedOrigin(req: Request): boolean {
    const origin = req.get('Origin');
    return origin === undefined || origin === webOrigin;
  }

  const csrfBootstrap: RequestHandler = (req, res) => {
    if (!trustedOrigin(req)) {
      apiError(res, 403, 'INVALID_CSRF', 'Untrusted request origin');
      return;
    }
    let seed = readCookie(req, csrfName);
    if (!seed) {
      seed = randomBytes(32).toString('base64url');
      res.cookie(csrfName, seed, { ...cookieOptions, maxAge: sessionLifetimeMs });
    }
    res.json({ csrfToken: signCsrf(seed, sessionToken(req)) });
  };

  const requireCsrf: RequestHandler = (req, res, next) => {
    const seed = readCookie(req, csrfName);
    const token = req.get('X-CSRF-Token');
    if (trustedOrigin(req) && seed && token && tokenFormat.test(token)) {
      const expected = signCsrf(seed, sessionToken(req));
      if (timingSafeEqual(Buffer.from(expected), Buffer.from(token))) {
        next();
        return;
      }
    }
    apiError(res, 403, 'INVALID_CSRF', 'Invalid CSRF token or request origin');
  };

  const requireUser: RequestHandler = async (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    const currentUser = await user(req);
    if (!currentUser) {
      apiError(res, 401, 'UNAUTHENTICATED', 'Sign in to continue');
      return;
    }
    res.locals.user = currentUser;
    next();
  };

  return {
    csrfBootstrap,
    requireCsrf,
    requireUser,
    sessionToken,
    setCookie(res: Response, session: { token: string; expiresAt: Date }) {
      res.cookie(sessionName, session.token, { ...cookieOptions, expires: session.expiresAt });
    },
    clearCookie(res: Response) {
      res.clearCookie(sessionName, cookieOptions);
    },
  };
}

export type BrowserSession = ReturnType<typeof browserSession>;
