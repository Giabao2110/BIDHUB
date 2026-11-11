import type { Response } from 'express';
import { apiError } from '../../http/error.js';

const windowMs = 60_000;
const maxKeys = 10_000;

export function credentialAttempts() {
  const attempts = new Map<string, number>();
  let resetAt = 0;

  return (res: Response, ip: string, email: string): boolean => {
    const now = Date.now();
    if (now >= resetAt) {
      attempts.clear();
      resetAt = now + windowMs;
    }
    const ipKey = 'ip:' + ip;
    const emailKey = 'email:' + email;
    const ipAttempts = attempts.get(ipKey) ?? 0;
    const emailAttempts = attempts.get(emailKey) ?? 0;

    if (ipAttempts >= 30 || emailAttempts >= 8 || attempts.size >= maxKeys) {
      res.set('Retry-After', String(Math.ceil((resetAt - now) / 1000)));
      apiError(res, 429, 'RATE_LIMITED', 'Too many authentication attempts');
      return false;
    }
    attempts.set(ipKey, ipAttempts + 1);
    attempts.set(emailKey, emailAttempts + 1);
    return true;
  };
}
