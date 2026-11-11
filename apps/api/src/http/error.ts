import type { Response } from 'express';

export function apiError(res: Response, status: number, code: string, message: string) {
  return res.status(status).json({ error: { code, message, requestId: res.locals.requestId } });
}
